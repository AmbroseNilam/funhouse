// One room: its players, screens, timeline, and the per-phone transcription sessions.
// The room is the single owner of all mutable state here. It generates each stage's view
// from the timeline and the loaded cartridge, and it is the only thing that talks to the
// providers. The host loop plugs in through onSpeech and onEvent once it exists.

import type WebSocket from "ws";
import type { ListeningMode, PhoneView } from "../shared/controls.ts";
import { lobbyScene, type RosterEntry, type Scene } from "../shared/scene.ts";
import { appendEvent, type RoomEvent } from "../shared/timeline.ts";
import { parseMessage, type PhoneMessage, type RoomToPhoneMessage, type RoomToScreenMessage } from "../shared/protocol.ts";
import { rawDataToText, TranscribeSession } from "../providers/meta/transcribe.ts";

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
export class Room {
    public readonly code: string;
    private readonly joinUrl: string;
    private readonly players: Map<string, Player> = new Map();
    private readonly screens: Set<WebSocket> = new Set();
    private readonly timeline: RoomEvent[] = [];
    private nextPlayerNumber: number = 1;

    /**
     * Creates an empty room.
     * @param code the room code players type or scan.
     * @param publicUrl the base URL phones open, from PUBLIC_URL.
     */
    public constructor(code: string, publicUrl: string) {
        this.code = code;
        this.joinUrl = `${publicUrl.replace(/\/$/, "")}/phone/?room=${code}`;
    }

    /**
     * Attaches a screen and sends it the current scene.
     * @param socket the screen's WebSocket.
     */
    public attachScreen(socket: WebSocket): void {
        this.screens.add(socket);
        socket.on("close", () => { this.screens.delete(socket); });
        this.sendToScreen(socket, { type: "scene", scene: this.currentScene(), joinUrl: this.joinUrl, roomCode: this.code });
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
        return player;
    }

    /**
     * Opens or closes the player's transcription session as they press and release.
     * @param player the player.
     * @param down true while the button is held.
     */
    private onHoldToTalk(player: Player, down: boolean): void {
        player.holdingToTalk = down;
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
                this.broadcastToScreens({ type: "hostState", listening: true, speaking: false });
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
        this.record({ type: "speechEnded", at: Date.now(), playerId: player.playerId, text });
        this.broadcastToScreens({ type: "scene", scene: this.currentScene(text, player.name), joinUrl: this.joinUrl, roomCode: this.code });
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
        return [...this.players.values()].map((player) => player.name);
    }

    /**
     * The roster as the screen shows it.
     * @returns one entry per connected player.
     */
    private roster(): RosterEntry[] {
        return [...this.players.values()].map((player) => ({ playerId: player.playerId, name: player.name, speaking: player.speaking, muted: player.listening === "muted" }));
    }

    /**
     * The scene for the current moment. Until a cartridge is loaded, this is the lobby.
     * @param captionText an optional last utterance to show as a caption.
     * @param captionSpeaker who said it.
     * @returns the scene.
     */
    private currentScene(captionText?: string, captionSpeaker?: string): Scene {
        const scene: Scene = lobbyScene(this.joinUrl, this.code, this.roster());
        if (captionText !== undefined && captionSpeaker !== undefined) {
            scene.blocks.push({ type: "caption", speaker: captionSpeaker, text: captionText, final: true });
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
            status: "Hold the button to talk to the host.",
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
