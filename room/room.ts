// One room: its players, screens, timeline, host, and the per-phone transcription sessions.
// The room is the single owner of all mutable state here. It generates each stage's view
// from its state, and it is the only thing that talks to the providers. The host acts on the
// room only through the HostStage methods; the host's voice reaches screens through
// VoiceOutput. A phone that drops keeps its seat for a grace period and can resume it.

import { randomBytes } from "node:crypto";
import type WebSocket from "ws";
import type { ListeningMode, PhoneView } from "../shared/controls.ts";
import { lobbyScene, type RosterEntry, type Scene } from "../shared/scene.ts";
import { appendEvent, type RoomEvent } from "../shared/timeline.ts";
import { parseMessage, type PhoneMessage, type RoomToPhoneMessage, type RoomToScreenMessage, type ScreenMessage } from "../shared/protocol.ts";
import { rawDataToText, TranscribeSession } from "../providers/meta/transcribe.ts";
import { OpenAiSpeech } from "../providers/openai/speech.ts";
import { WEREWOLF_MANIFEST } from "../cartridges/werewolf/manifest.ts";
import { Host, PLACEHOLDER_PERSONA, type HostStage } from "./host.ts";
import { HostVoice, type VoiceOutput } from "./voice.ts";
import { log } from "./log.ts";

/** A player and their phone. The seat outlives a dropped connection for a grace period. */
interface Player {
    playerId: string;
    name: string;
    /** Secret the phone keeps so only it can resume this seat. */
    resumeToken: string;
    socket: WebSocket;
    connected: boolean;
    leaveTimer: NodeJS.Timeout | null;
    listening: ListeningMode;
    speaking: boolean;
    transcribe: TranscribeSession | null;
    holdingToTalk: boolean;
    /** True from pressing talk until that utterance's final text is handled once. */
    awaitingFinal: boolean;
    releasedAt: number;
}

/** The last line spoken in the room, shown as a caption. */
interface Caption {
    speaker: string;
    text: string;
}

/** Pause before the host reacts, so bursts of events land in one turn. */
const WAKE_DELAY_MILLISECONDS: Record<"speech" | "join" | "leave" | "screen", number> = { speech: 100, join: 1200, leave: 1500, screen: 300 };

/** How long a dropped phone keeps its seat before the room says they left. */
const REJOIN_GRACE_MILLISECONDS: number = 30000;

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
    private readonly voice: HostVoice;
    private nextPlayerNumber: number = 1;
    private caption: Caption | null = null;
    private hostThinking: boolean = false;
    private hostSpeaking: boolean = false;
    private hostTurnText: string = "";

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
        this.voice = new HostVoice(new OpenAiSpeech(), this.voiceOutput());
    }

    /**
     * Attaches a screen and sends it the current scene.
     * @param socket the screen's WebSocket.
     */
    public attachScreen(socket: WebSocket): void {
        this.screens.add(socket);
        log(this.scope(), `screen connected (${this.screens.size} open)`);
        socket.on("close", () => {
            this.screens.delete(socket);
            log(this.scope(), `screen disconnected (${this.screens.size} open)`);
        });
        socket.on("message", (data: WebSocket.RawData) => {
            const message: ScreenMessage | null = parseMessage<ScreenMessage>(rawDataToText(data));
            if (message?.type !== "ready") {
                return;
            }
            const line: string = this.players.size === 0 ? "(The big screen just came on and nobody has joined yet. Welcome the room and invite people to scan the code.)" : "(The big screen came back on.)";
            this.host.notice(line, WAKE_DELAY_MILLISECONDS.screen);
        });
        this.sendToScreen(socket, { type: "scene", scene: this.currentScene(), joinUrl: this.joinUrl, roomCode: this.code });
        this.sendToScreen(socket, this.hostStateMessage());
    }

    /**
     * Attaches a phone. The phone becomes a player, new or resumed, once it says hello.
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
                player = this.resume(socket, message.playerId, message.resumeToken) ?? this.join(socket, message.name);
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
        socket.on("close", (code: number) => {
            if (player === null || player.socket !== socket) {
                return;
            }
            this.onDisconnect(player, code);
        });
    }

    /**
     * Names of the players present, for the host's briefing.
     * @returns one name per seated player.
     */
    public playerNames(): string[] {
        return [...this.players.values()].map((player) => player.name);
    }

    /**
     * Shows or clears the cue that the host is working out a reply. A new turn starts a new
     * caption.
     * @param thinking true while the host is composing.
     */
    public setThinking(thinking: boolean): void {
        if (thinking === true) {
            this.hostTurnText = "";
        }
        if (this.hostThinking === thinking) {
            return;
        }
        this.hostThinking = thinking;
        this.broadcastHostState();
    }

    /**
     * Queues one host sentence for the voice and adds it to the caption.
     * @param text the sentence.
     * @param style delivery direction.
     */
    public say(text: string, style: string): void {
        this.record({ type: "hostSaid", at: Date.now(), text, scopeKey: "public" });
        this.hostTurnText = `${this.hostTurnText} ${text}`.trim();
        this.caption = { speaker: this.host.persona.name, text: this.hostTurnText };
        this.broadcastScene();
        this.voice.say(text, this.host.persona.voice, style);
    }

    /**
     * Resolves when the host's queued speech has finished playing.
     * @param signal ends the wait early on interruption.
     */
    public finishSpeaking(signal: AbortSignal): Promise<void> {
        return this.voice.finish(signal);
    }

    /** Silences the host at once. */
    public stopSpeaking(): void {
        this.voice.stop();
    }

    /**
     * Seats a new player and tells everyone.
     * @param socket the phone's WebSocket.
     * @param rawName the name the player typed.
     * @returns the player record.
     */
    private join(socket: WebSocket, rawName: string): Player {
        const name: string = rawName.trim().slice(0, 24) || `Player ${this.nextPlayerNumber}`;
        const playerId: string = `p${this.nextPlayerNumber}`;
        this.nextPlayerNumber += 1;
        const player: Player = { playerId, name, resumeToken: randomBytes(16).toString("hex"), socket, connected: true, leaveTimer: null, listening: "holdToTalk", speaking: false, transcribe: null, holdingToTalk: false, awaitingFinal: false, releasedAt: 0 };
        this.players.set(playerId, player);
        this.record({ type: "playerJoined", at: Date.now(), playerId, name });
        log(this.scope(), `${name} joined as ${playerId}`);
        this.welcome(player);
        this.broadcastScene();
        this.host.notice(`(${name} joined the room)`, WAKE_DELAY_MILLISECONDS.join);
        return player;
    }

    /**
     * Puts a returning phone back in its seat, if the id and token match a seated player.
     * @param socket the phone's new WebSocket.
     * @param playerId the seat the phone remembers.
     * @param resumeToken the secret the phone was given on joining.
     * @returns the resumed player, or null when there is no such seat.
     */
    private resume(socket: WebSocket, playerId: string | undefined, resumeToken: string | undefined): Player | null {
        const player: Player | undefined = playerId === undefined ? undefined : this.players.get(playerId);
        if (player === undefined || resumeToken === undefined || player.resumeToken !== resumeToken) {
            return null;
        }
        if (player.leaveTimer !== null) {
            clearTimeout(player.leaveTimer);
            player.leaveTimer = null;
        }
        const previous: WebSocket = player.socket;
        player.socket = socket;
        player.connected = true;
        if (previous !== socket) {
            previous.close(4000, "resumed elsewhere");
        }
        log(this.scope(), `${player.name} rejoined ${player.playerId}`);
        this.welcome(player);
        this.broadcastScene();
        return player;
    }

    /**
     * Sends a phone its seat and current view.
     * @param player the seated player.
     */
    private welcome(player: Player): void {
        this.sendToPhone(player, { type: "welcome", playerId: player.playerId, roomCode: this.code, name: player.name, resumeToken: player.resumeToken });
        this.sendToPhone(player, { type: "view", view: this.phoneView(player) });
    }

    /**
     * Holds a dropped player's seat for the grace period, then lets them go.
     * @param player the player whose phone dropped.
     * @param code the WebSocket close code, logged to tell refreshes from network loss.
     */
    private onDisconnect(player: Player, code: number): void {
        player.connected = false;
        player.holdingToTalk = false;
        player.speaking = false;
        player.transcribe?.abort();
        log(this.scope(), `${player.name} disconnected (code ${code}); holding seat ${REJOIN_GRACE_MILLISECONDS / 1000} s`);
        this.broadcastScene();
        player.leaveTimer = setTimeout(() => {
            this.players.delete(player.playerId);
            this.record({ type: "playerLeft", at: Date.now(), playerId: player.playerId });
            log(this.scope(), `${player.name} left`);
            this.host.notice(`(${player.name} left the room)`, WAKE_DELAY_MILLISECONDS.leave);
            this.broadcastScene();
        }, REJOIN_GRACE_MILLISECONDS);
    }

    /**
     * Opens or closes the player's transcription session as they press and release. Pressing
     * also cuts the host off.
     * @param player the player.
     * @param down true while the button is held.
     */
    private onHoldToTalk(player: Player, down: boolean): void {
        player.holdingToTalk = down;
        if (down === true) {
            player.awaitingFinal = true;
            if (this.hostSpeaking === true || this.hostThinking === true) {
                log(this.scope(), `${player.name} cut in`);
            }
            this.host.interrupt();
        }
        if (down === true && player.transcribe === null) {
            this.openTranscribe(player, "PUSH_TO_TALK");
            return;
        }
        if (down === false && player.transcribe !== null) {
            player.releasedAt = Date.now();
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
            onError: (message: string): void => { log(this.scope(), `transcribe error for ${player.name}: ${message}`); },
            onClose: (): void => {
                if (player.transcribe === session) {
                    player.transcribe = null;
                }
                player.speaking = false;
                this.broadcastScene();
            },
        });
        player.transcribe = session;
        session.open().catch((error: unknown) => {
            log(this.scope(), `transcribe open failed for ${player.name}: ${error instanceof Error ? error.message : String(error)}`);
            if (player.transcribe === session) {
                player.transcribe = null;
            }
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
        player.transcribe.sendFrame(new Uint8Array(frame));
    }

    /**
     * Handles one finished utterance, once, and wakes the host.
     * @param player who spoke.
     * @param text what they said.
     */
    private onSpeechEnded(player: Player, text: string): void {
        player.speaking = false;
        if (player.awaitingFinal === false) {
            return;
        }
        player.awaitingFinal = false;
        const said: string = text.trim();
        const sinceRelease: string = player.releasedAt === 0 ? "" : ` (${Date.now() - player.releasedAt} ms after release)`;
        log(this.scope(), `heard ${player.name}: "${said}"${sinceRelease}`);
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
     * Wires the host's voice to the screens and the speaking indicator.
     * @returns the output the voice writes to.
     */
    private voiceOutput(): VoiceOutput {
        return {
            lineStarted: (): void => { this.broadcastToScreens({ type: "audioStart", mediaType: "audio/pcm;rate=24000" }); },
            chunk: (bytes: Uint8Array): void => { this.broadcastAudio(bytes); },
            lineEnded: (): void => { this.broadcastToScreens({ type: "audioEnd" }); },
            cancelled: (): void => { this.broadcastToScreens({ type: "audioCancel" }); },
            speakingChanged: (speaking: boolean): void => {
                this.hostSpeaking = speaking;
                this.broadcastHostState();
            },
        };
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
     * @returns one entry per seated player.
     */
    private roster(): RosterEntry[] {
        return [...this.players.values()].map((player) => {
            const entry: RosterEntry = { playerId: player.playerId, name: player.name, speaking: player.speaking, muted: player.listening === "muted" };
            if (player.connected === false) {
                entry.badge = "reconnecting";
            }
            return entry;
        });
    }

    /**
     * The scene for the current moment: the lobby and the last line said.
     * Until a cartridge is loaded, the base is always the lobby.
     * @returns the scene.
     */
    private currentScene(): Scene {
        const scene: Scene = lobbyScene(this.joinUrl, this.code, this.roster());
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
        const hostName: string = this.host.persona.name;
        let status: string = `Hold the button to talk to ${hostName}.`;
        if (this.hostThinking === true) {
            status = `${hostName} is thinking…`;
        }
        if (this.hostSpeaking === true) {
            status = `${hostName} is talking. Hold to cut in.`;
        }
        return {
            playerName: player.name,
            listening: player.listening,
            status,
            controls: [{ type: "waiting", text: `You're in room ${this.code}. Waiting for the game to start.` }],
        };
    }

    /**
     * The host indicator state for screens.
     * @returns the message.
     */
    private hostStateMessage(): RoomToScreenMessage {
        return { type: "hostState", thinking: this.hostThinking, speaking: this.hostSpeaking, hostName: this.host.persona.name };
    }

    /** Tells screens and phones what the host is doing. */
    private broadcastHostState(): void {
        this.broadcastToScreens(this.hostStateMessage());
        for (const player of this.players.values()) {
            this.sendToPhone(player, { type: "view", view: this.phoneView(player) });
        }
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
     * Sends a message to one phone, if its connection is up.
     * @param player the player.
     * @param message the message.
     */
    private sendToPhone(player: Player, message: RoomToPhoneMessage): void {
        if (player.connected === false) {
            return;
        }
        player.socket.send(JSON.stringify(message));
    }

    /**
     * The log scope for this room.
     * @returns a label such as "room KPTR".
     */
    private scope(): string {
        return `room ${this.code}`;
    }
}
