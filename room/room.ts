// One room: its players, screens, timeline, and the per-phone transcription sessions.
// The room is the single owner of all mutable state here. It generates each stage's view
// from the timeline and the loaded cartridge, and it is the only thing that talks to the
// providers. The host acts on the room only through the HostStage methods below.

import type WebSocket from "ws";
import type { ListeningMode, PhoneView } from "../shared/controls.ts";
import { lobbyScene, type RosterEntry, type Scene } from "../shared/scene.ts";
import { appendEvent, type RoomEvent } from "../shared/timeline.ts";
import { parseMessage, type PhoneMessage, type RoomToPhoneMessage, type RoomToScreenMessage, type ScreenMessage } from "../shared/protocol.ts";
import { rawDataToText, TranscribeSession } from "../providers/meta/transcribe.ts";
import { OpenAiSpeech, type TextToSpeech } from "../providers/openai/speech.ts";
import { WEREWOLF_MANIFEST } from "../cartridges/werewolf/manifest.ts";
import { Host, PLACEHOLDER_PERSONA, type HostStage, type Spotlight } from "./host.ts";

/** A connected player and their phone. */
interface Player {
    playerId: string;
    name: string;
    socket: WebSocket;
    listening: ListeningMode;
    speaking: boolean;
    transcribe: TranscribeSession | null;
    holdingToTalk: boolean;
}

/** The last line spoken in the room, shown as a caption. */
interface Caption {
    speaker: string;
    text: string;
}

/** Bytes per second of host speech: 24 kHz, 16-bit, mono. */
const SPEECH_BYTES_PER_SECOND: number = 48000;

/** Pause before the host reacts, so bursts of events land in one turn. */
const WAKE_DELAY_MILLISECONDS: Record<"speech" | "join" | "leave" | "screen", number> = { speech: 250, join: 1200, leave: 1500, screen: 300 };

/** Characters used for room codes; no vowels, so codes never spell words. */
const CODE_ALPHABET: string = "BCDFGHJKLMNPQRSTVWXZ";

/**
 * Makes a four-letter room code.
 * @returns a code such as "KPTR".
 */
export function makeRoomCode(): string {
    let code: string = "";
    for (let index = 0; index < 4; index += 1) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return code;
}

/** The room runtime. One instance per live room. */
export class Room implements HostStage {
    public readonly code: string;
    private readonly joinUrl: string;
    private readonly players: Map<string, Player> = new Map();
    private readonly screens: Set<WebSocket> = new Set();
    private readonly timeline: RoomEvent[] = [];
    private readonly host: Host;
    private readonly speech: TextToSpeech = new OpenAiSpeech();
    private nextPlayerNumber: number = 1;
    private spotlight: Spotlight | null = null;
    private caption: Caption | null = null;
    private hostSpeaking: boolean = false;

    /**
     * Creates an empty room.
     * @param code the room code players type or scan.
     * @param publicUrl the base URL phones open, from PUBLIC_URL.
     */
    public constructor(code: string, publicUrl: string) {
        this.code = code;
        this.joinUrl = `${publicUrl.replace(/\/$/, "")}/phone/?room=${code}`;
        const games: string[] = [WEREWOLF_MANIFEST].map((manifest) => `${manifest.name}, ${manifest.minPlayers} to ${manifest.maxPlayers} players`);
        this.host = new Host(this, PLACEHOLDER_PERSONA, games);
    }

    /**
     * Attaches a screen and sends it the current scene.
     * @param socket the screen's WebSocket.
     */
    public attachScreen(socket: WebSocket): void {
        this.screens.add(socket);
        socket.on("close", () => { this.screens.delete(socket); });
        socket.on("message", (data: WebSocket.RawData) => {
            const message: ScreenMessage | null = parseMessage<ScreenMessage>(rawDataToText(data));
            if (message?.type !== "ready") {
                return;
            }
            const line: string = this.players.size === 0 ? "(The big screen just came on and nobody has joined yet. Welcome the room and invite people to scan the code.)" : "(The big screen came back on.)";
            this.host.notice(line, WAKE_DELAY_MILLISECONDS.screen);
        });
        this.sendToScreen(socket, { type: "scene", scene: this.currentScene(), joinUrl: this.joinUrl, roomCode: this.code });
        this.sendToScreen(socket, { type: "hostState", listening: false, speaking: this.hostSpeaking, hostName: this.host.persona.name });
    }

    /**
     * Attaches a phone. The phone becomes a player once it says hello.
     * @param socket the phone's WebSocket.
     */
    public attachPhone(socket: WebSocket): void {
        let player: Player | null = null;
        socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
            if (isBinary === true) {
                if (player !== null) {
                    this.onAudioFrame(player, Buffer.isBuffer(data) ? data : Buffer.from(rawDataToText(data)));
                }
                return;
            }
            const message: PhoneMessage | null = parseMessage<PhoneMessage>(rawDataToText(data));
            if (message === null) {
                return;
            }
            if (message.type === "hello") {
                player = this.join(socket, message.name);
                return;
            }
            if (player === null) {
                return;
            }
            if (message.type === "holdToTalk") {
                this.onHoldToTalk(player, message.down);
                return;
            }
            this.record({ type: "controlUsed", at: Date.now(), playerId: player.playerId, value: message.input.value, controlIndex: message.input.controlIndex });
        });
        socket.on("close", () => {
            if (player === null) {
                return;
            }
            player.transcribe?.abort();
            this.players.delete(player.playerId);
            this.record({ type: "playerLeft", at: Date.now(), playerId: player.playerId });
            this.host.notice(`(${player.name} left the room)`, WAKE_DELAY_MILLISECONDS.leave);
            this.broadcastScene();
        });
    }

    /**
     * Registers a new player and tells everyone.
     * @param socket the phone's WebSocket.
     * @param rawName the name the player typed.
     * @returns the player record.
     */
    private join(socket: WebSocket, rawName: string): Player {
        const name: string = rawName.trim().slice(0, 24) || `Player ${this.nextPlayerNumber}`;
        const playerId: string = `p${this.nextPlayerNumber}`;
        this.nextPlayerNumber += 1;
        const player: Player = { playerId, name, socket, listening: "holdToTalk", speaking: false, transcribe: null, holdingToTalk: false };
        this.players.set(playerId, player);
        this.record({ type: "playerJoined", at: Date.now(), playerId, name });
        this.sendToPhone(player, { type: "welcome", playerId, roomCode: this.code });
        this.sendToPhone(player, { type: "view", view: this.phoneView(player) });
        this.broadcastScene();
        this.host.notice(`(${name} joined the room)`, WAKE_DELAY_MILLISECONDS.join);
        return player;
    }

    /**
     * Opens or closes the player's transcription session as they press and release.
     * @param player the player.
     * @param down true while the button is held.
     */
    private onHoldToTalk(player: Player, down: boolean): void {
        player.holdingToTalk = down;
        if (down === true) {
            this.host.interrupt();
        }
        if (down === true && player.transcribe === null) {
            this.openTranscribe(player, "PUSH_TO_TALK");
            return;
        }
        if (down === false && player.transcribe !== null) {
            player.transcribe.end();
        }
    }

    /**
     * Starts a transcription session for a player and wires its events onto the timeline.
     * @param player the player.
     * @param mode push-to-talk for held speech, endpointing for an open floor.
     */
    private openTranscribe(player: Player, mode: "PUSH_TO_TALK" | "ENDPOINTING"): void {
        const session: TranscribeSession = new TranscribeSession({ mode, keywords: this.keywords() }, {
            onSpeechStart: (): void => {
                player.speaking = true;
                this.record({ type: "speechStarted", at: Date.now(), playerId: player.playerId });
                this.broadcastScene();
            },
            onTranscript: (text: string, isFinal: boolean): void => {
                if (isFinal === true && mode === "PUSH_TO_TALK") {
                    this.onSpeechEnded(player, text);
                }
            },
            onSpeechComplete: (_turnId: string, text: string): void => { this.onSpeechEnded(player, text); },
            onError: (message: string): void => { console.error(`transcribe error for ${player.playerId}: ${message}`); },
            onClose: (): void => {
                player.transcribe = null;
                player.speaking = false;
                this.broadcastScene();
            },
        });
        player.transcribe = session;
        session.open().catch((error: unknown) => {
            console.error(`transcribe open failed for ${player.playerId}:`, error instanceof Error ? error.message : String(error));
            player.transcribe = null;
        });
    }

    /**
     * Forwards one PCM frame to the player's transcription session, if listening allows it.
     * @param player the player.
     * @param frame raw PCM bytes.
     */
    private onAudioFrame(player: Player, frame: Buffer): void {
        if (player.listening === "muted" || player.listening === "hostSpeaking") {
            return;
        }
        if (player.listening === "holdToTalk" && player.holdingToTalk === false) {
            return;
        }
        if (player.transcribe === null) {
            return;
        }
        try {
            player.transcribe.sendFrame(new Uint8Array(frame));
        } catch {
            // Session not acknowledged yet; the first few frames are dropped by design.
        }
    }

    /**
     * Records a finished utterance on the timeline. The host loop is woken from here.
     * @param player who spoke.
     * @param text what they said.
     */
    private onSpeechEnded(player: Player, text: string): void {
        player.speaking = false;
        const said: string = text.trim();
        this.record({ type: "speechEnded", at: Date.now(), playerId: player.playerId, text: said });
        if (said === "") {
            this.broadcastScene();
            return;
        }
        this.caption = { speaker: player.name, text: said };
        this.broadcastScene();
        this.host.notice(`${player.name}: ${said}`, WAKE_DELAY_MILLISECONDS.speech);
    }

    /**
     * Names of the players present, for the host's briefing.
     * @returns one name per connected player.
     */
    public playerNames(): string[] {
        return [...this.players.values()].map((player) => player.name);
    }

    /**
     * Puts the host's headline on the screen.
     * @param spotlight the headline, detail and mood.
     */
    public show(spotlight: Spotlight): void {
        this.spotlight = spotlight;
        this.broadcastScene();
    }

    /**
     * Streams one host line to every screen as PCM and resolves once it should have finished
     * playing, so the next line does not talk over it. Cancelling stops the stream and tells
     * the screens to drop what they have queued.
     * @param text what the host says.
     * @param style delivery direction for the voice.
     * @param signal cancels the line when someone cuts in.
     */
    public async speak(text: string, style: string, signal: AbortSignal): Promise<void> {
        this.record({ type: "hostSaid", at: Date.now(), text, scopeKey: "public" });
        this.caption = { speaker: this.host.persona.name, text };
        this.broadcastScene();
        this.setHostSpeaking(true);
        let firstChunkAt: number = 0;
        let bytes: number = 0;
        let carry: Uint8Array = new Uint8Array(0);
        try {
            this.broadcastToScreens({ type: "audioStart", mediaType: this.speech.mediaType });
            for await (const chunk of this.speech.speak({ text, voice: this.host.persona.voice, style, signal })) {
                const joined: Uint8Array = new Uint8Array(carry.length + chunk.length);
                joined.set(carry);
                joined.set(chunk, carry.length);
                const even: number = joined.length - (joined.length % 2);
                carry = joined.slice(even);
                if (even === 0) {
                    continue;
                }
                if (firstChunkAt === 0) {
                    firstChunkAt = Date.now();
                }
                bytes += even;
                this.broadcastAudio(joined.subarray(0, even));
            }
            this.broadcastToScreens({ type: "audioEnd" });
            const remaining: number = firstChunkAt + (bytes / SPEECH_BYTES_PER_SECOND) * 1000 - Date.now();
            await waitUnlessAborted(remaining, signal);
        } catch (error: unknown) {
            if (signal.aborted === false) {
                console.error("host speech failed:", error instanceof Error ? error.message : String(error));
            }
        }
        if (signal.aborted === true) {
            this.broadcastToScreens({ type: "audioCancel" });
        }
        this.setHostSpeaking(false);
    }

    /**
     * Tells screens and phones whether the host is talking.
     * @param speaking true while host audio is playing.
     */
    private setHostSpeaking(speaking: boolean): void {
        if (this.hostSpeaking === speaking) {
            return;
        }
        this.hostSpeaking = speaking;
        this.broadcastToScreens({ type: "hostState", listening: false, speaking, hostName: this.host.persona.name });
        for (const player of this.players.values()) {
            this.sendToPhone(player, { type: "view", view: this.phoneView(player) });
        }
    }

    /**
     * Appends an event to the bounded timeline.
     * @param event the event.
     */
    private record(event: RoomEvent): void {
        appendEvent(this.timeline, event);
    }

    /**
     * Words transcription should be biased toward: player names and the host's name.
     * @returns the keyword list.
     */
    private keywords(): string[] {
        return [this.host.persona.name, ...this.playerNames()];
    }

    /**
     * The roster as the screen shows it.
     * @returns one entry per connected player.
     */
    private roster(): RosterEntry[] {
        return [...this.players.values()].map((player) => ({ playerId: player.playerId, name: player.name, speaking: player.speaking, muted: player.listening === "muted" }));
    }

    /**
     * The scene for the current moment: the lobby, the host's spotlight, and the last line said.
     * Until a cartridge is loaded, the base is always the lobby.
     * @returns the scene.
     */
    private currentScene(): Scene {
        const scene: Scene = lobbyScene(this.joinUrl, this.code, this.roster());
        if (this.spotlight !== null) {
            scene.mood = this.spotlight.mood ?? scene.mood;
            scene.blocks.splice(1, 0, { type: "text", text: this.spotlight.headline, emphasis: "large" });
            if (this.spotlight.detail !== undefined) {
                scene.blocks.splice(2, 0, { type: "text", text: this.spotlight.detail });
            }
        }
        if (this.caption !== null) {
            scene.blocks.push({ type: "caption", speaker: this.caption.speaker, text: this.caption.text, final: true });
        }
        return scene;
    }

    /**
     * What one phone should show right now.
     * @param player the player.
     * @returns the phone view.
     */
    private phoneView(player: Player): PhoneView {
        return {
            playerName: player.name,
            listening: player.listening,
            status: this.hostSpeaking === true ? `${this.host.persona.name} is talking. Hold to cut in.` : `Hold the button to talk to ${this.host.persona.name}.`,
            controls: [{ type: "waiting", text: `You are in room ${this.code}. Waiting for the host.` }],
        };
    }

    /** Sends the current scene to every screen. */
    private broadcastScene(): void {
        this.broadcastToScreens({ type: "scene", scene: this.currentScene(), joinUrl: this.joinUrl, roomCode: this.code });
    }

    /**
     * Sends a message to every attached screen.
     * @param message the message.
     */
    private broadcastToScreens(message: RoomToScreenMessage): void {
        const text: string = JSON.stringify(message);
        for (const screen of this.screens) {
            screen.send(text);
        }
    }

    /**
     * Sends one chunk of host audio to every attached screen as a binary frame.
     * @param chunk PCM bytes, always an even count.
     */
    private broadcastAudio(chunk: Uint8Array): void {
        for (const screen of this.screens) {
            screen.send(chunk);
        }
    }

    /**
     * Sends a message to one screen.
     * @param socket the screen.
     * @param message the message.
     */
    private sendToScreen(socket: WebSocket, message: RoomToScreenMessage): void {
        socket.send(JSON.stringify(message));
    }

    /**
     * Sends a message to one phone.
     * @param player the player.
     * @param message the message.
     */
    private sendToPhone(player: Player, message: RoomToPhoneMessage): void {
        player.socket.send(JSON.stringify(message));
    }
}

/**
 * Waits the given time, returning early if the signal aborts.
 * @param milliseconds how long to wait; zero or less returns at once.
 * @param signal ends the wait early.
 */
function waitUnlessAborted(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (milliseconds <= 0 || signal.aborted === true) {
        return Promise.resolve();
    }
    return new Promise((resolve: () => void) => {
        const timer: NodeJS.Timeout = setTimeout(() => {
            signal.removeEventListener("abort", stop);
            resolve();
        }, milliseconds);
        const stop = (): void => {
            clearTimeout(timer);
            resolve();
        };
        signal.addEventListener("abort", stop, { once: true });
    });
}
