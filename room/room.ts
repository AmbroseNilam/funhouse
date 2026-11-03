// One room: its players, screens, timeline, host, and the per-phone transcription sessions.
// The room is the single owner of all mutable state here. It generates each stage's view
// from its state, and it is the only thing that talks to the providers. The host acts on the
// room only through the HostStage methods; the host's voice reaches screens through
// VoiceOutput. A phone that drops keeps its seat for a grace period and can resume it.
// Latency moves, measured and explained in the planning notes: partial transcripts show live
// on the screen, each phone keeps a transcription session open ahead of its next press, and a
// short pre-recorded acknowledgement plays when the host was addressed and its reply is not
// audible soon after the final text arrives.

import { randomBytes } from "node:crypto";
import type WebSocket from "ws";
import type { CartridgeManifest } from "../shared/cartridge.ts";
import type { Control, ListeningMode, PhoneView } from "../shared/controls.ts";
import { lobbyScene, type RosterEntry, type Scene } from "../shared/scene.ts";
import { appendEvent, type RoomEvent } from "../shared/timeline.ts";
import { isPhoneMessage, parseMessage, type PhoneMessage, type RoomToPhoneMessage, type RoomToScreenMessage, type ScreenMessage } from "../shared/protocol.ts";
import { rawDataToText, TranscribeSession } from "../providers/meta/transcribe.ts";
import { OpenAiRealtimeSpeech } from "../providers/openai/realtime-speech.ts";
import { SilentSpeech } from "../providers/silent-speech.ts";
import { GAMES, type InstalledGame } from "../cartridges/index.ts";
import { drawImage, type Drawing } from "../providers/meta/image.ts";
import { streamSpark } from "../providers/meta/spark.ts";
import type { NavAction, Seat, ShelfGame } from "../shared/shell.ts";
import type { GameStage, RunningGame } from "./game-session.ts";
import { Shell, type ShellStage } from "./shell.ts";
import { Host, PLACEHOLDER_PERSONA, type HostPersona, type HostStage } from "./host.ts";
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
    /** A session opened ahead of the next press, so pressing never waits for a handshake. */
    standby: TranscribeSession | null;
    /** Replaces the standby before the provider closes it for sitting idle. */
    standbyTimer: NodeJS.Timeout | null;
    holdingToTalk: boolean;
    /** Sessions whose press has not produced final text yet; a new press can overlap the last. */
    awaitingFinal: Set<TranscribeSession>;
    /** The seat's colour, on the TV and as the phone's background. */
    colour: string;
    /** A short message replacing the phone's status line, such as a press that wasn't heard. */
    hint: string;
    hintTimer: NodeJS.Timeout | null;
    releasedAt: number;
    /** Latest partial transcript of the current utterance. */
    partial: string;
}

/** The last line spoken in the room, shown as a caption; not final while still being said. */
interface Caption {
    speaker: string;
    text: string;
    final: boolean;
}

/** Pause before the host reacts, so bursts of events land in one turn. */
const WAKE_DELAY_MILLISECONDS: Record<"speech" | "join" | "leave" | "screen", number> = { speech: 0, join: 900, leave: 1500, screen: 300 };

/**
 * How long after the final text the host's reply may take before an acknowledgement plays.
 * Long enough that quick replies skip it: fillers help with medium and long waits, and heard
 * on every turn they sound mechanical (arXiv 2507.22352, 2508.11781).
 */
const ACKNOWLEDGE_AFTER_MILLISECONDS: number = 800;

/** Chance an eligible turn gets an acknowledgement, so they stay occasional. */
const ACKNOWLEDGE_CHANCE: number = 0.6;

/** How many of the latest acknowledgements are not reused. */
const ACKNOWLEDGE_NO_REPEAT: number = 4;

/** Short, varied acknowledgements, rendered once per room and played sparingly. */
const ACKNOWLEDGEMENTS: string[] = ["Hm.", "Okay.", "Right.", "Oh.", "Mm-hm.", "Ooh.", "Let's see.", "Alright.", "Huh.", "Yeah."];

/**
 * How long a standby session may wait before it is replaced. Measured: the provider closes a
 * session with "Ingress audio slower than real-time" once it falls about 15 s behind real
 * time, and an idle session falls behind from the moment it opens.
 */
const STANDBY_REFRESH_MILLISECONDS: number = 10000;

/**
 * True in the text-only test mode: phones send text instead of audio, the voice is silent, and
 * no transcription sessions open. Off unless the server is started with GAME_ROOM_TEXT_ONLY=1.
 */
const TEXT_ONLY: boolean = process.env.GAME_ROOM_TEXT_ONLY === "1";

/** Room for hidden reasoning plus a list of questions or a secret. */
const CONTENT_TOKEN_LIMIT: number = 2000;

/** How long content may take. After that the game uses its own, so it can't sit waiting. */
const CONTENT_TIME_LIMIT_MILLISECONDS: number = 15000;

/** Most pictures one room draws. Each costs about a cent and sits in memory until it closes. */
const MAX_DRAWINGS: number = 24;

/**
 * True when pictures are drawn. The text-only test mode skips them to stay fast, unless asked
 * with GAME_ROOM_DRAW=1.
 */
const DRAWING_ON: boolean = TEXT_ONLY === false || process.env.GAME_ROOM_DRAW === "1";

/** Unsent bytes a screen may build up: about 2 minutes of voice. */
const MAX_SCREEN_BUFFER_BYTES: number = 5760000;

/** Longest text a phone may send through a control. */
const MAX_INPUT_CHARACTERS: number = 200;

/** Seat colours, as painted card. */
const SEAT_COLOURS: string[] = ["#b5532a", "#2f7a72", "#a8861f", "#a33a4e", "#4f7a3a", "#3f6a96", "#8a5a70", "#6e7a82"];

/** How long the highlight must rest on a box before the host may remark on it. */
const REMARK_DWELL_MILLISECONDS: number = 1500;

/** Shortest gap between remarks. */
const REMARK_GAP_MILLISECONDS: number = 30000;

/** Chance a resting highlight gets a remark. */
const REMARK_CHANCE: number = 0.5;

/** Most players one room seats. The largest game plays ten; two more can watch and talk. */
const MAX_PLAYERS: number = 12;

/** How long a released press may wait for its final text before it counts as not heard. */
const FINAL_WAIT_MILLISECONDS: number = 6000;

/** How long a hint stays on the phone. */
const HINT_MILLISECONDS: number = 3000;

/** What a phone shows when a press produced no words. */
const NOT_HEARD_HINT: string = "Didn't catch that. Try again?";

/** How long a dropped phone keeps its seat before the room says they left. */
const REJOIN_GRACE_MILLISECONDS: number = 30000;

/** The same during a game: a locked phone mustn't lose its seat, and every phase has a timer. */
const GAME_REJOIN_GRACE_MILLISECONDS: number = 180000;

/** Bytes between the samples measured for loudness; every fourth sample is plenty. */
const LEVEL_SAMPLE_STRIDE_BYTES: number = 8;

/** Scales raw loudness so ordinary speech fills most of the 0 to 1 range. */
const LEVEL_GAIN: number = 5;

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

/**
 * Measures how loud one frame of PCM is, for the orb on the big screen.
 * @param frame 16-bit little-endian samples.
 * @returns loudness from 0 to about 1, rounded to keep the message short.
 */
function frameLevel(frame: Buffer): number {
    let sum: number = 0;
    let count: number = 0;
    for (let offset = 0; offset + 1 < frame.length; offset += LEVEL_SAMPLE_STRIDE_BYTES) {
        const sample: number = frame.readInt16LE(offset) / 32768;
        sum += sample * sample;
        count += 1;
    }
    if (count === 0) {
        return 0;
    }
    return Math.round(Math.min(1, Math.sqrt(sum / count) * LEVEL_GAIN) * 100) / 100;
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
    private readonly speech: OpenAiRealtimeSpeech | SilentSpeech = TEXT_ONLY === true ? new SilentSpeech() : new OpenAiRealtimeSpeech();
    private woken: boolean = false;
    private game: RunningGame | null = null;
    private readonly shell: Shell;
    /** Recorded remarks per game, ready to play at once. */
    private readonly remarks: Map<string, { text: string; pcm: Uint8Array }[]> = new Map();
    private readonly remarkedOn: Set<string> = new Set();
    private remarkTimer: NodeJS.Timeout | null = null;
    private lastRemarkAt: number = 0;
    private gameDecided: boolean = false;
    private paused: boolean = false;
    private readonly drawings: Map<string, Drawing> = new Map();
    /** Who spoke last, so a ruling can be credited to them. */
    private lastSpeakerId: string | null = null;
    private nextPlayerNumber: number = 1;
    private caption: Caption | null = null;
    private hostThinking: boolean = false;
    private hostSpeaking: boolean = false;
    private hostTurnText: string = "";
    private readonly acknowledgements: Uint8Array[] = [];
    /** Indexes of the latest acknowledgements played, newest last. */
    private readonly recentAcknowledgements: number[] = [];
    /** True when the previous addressed turn got an acknowledgement; two in a row never play. */
    private acknowledgedLastTurn: boolean = false;
    private acknowledgeTimer: NodeJS.Timeout | null = null;

    /**
     * Creates an empty room.
     * @param code the room code players type or scan.
     * @param publicUrl the base URL phones open, from PUBLIC_URL.
     */
    public constructor(code: string, publicUrl: string) {
        this.code = code;
        this.joinUrl = `${publicUrl.replace(/\/$/, "")}/phone/?room=${code}`;
        this.host = new Host(this, PLACEHOLDER_PERSONA);
        this.voice = new HostVoice(this.speech, this.voiceOutput());
        this.shell = new Shell(this.shellStage());
    }

    /**
     * True when no screen or player is in the room.
     * @returns whether the room is empty.
     */
    public isEmpty(): boolean {
        return this.screens.size === 0 && this.players.size === 0;
    }

    /** Silences the host and releases the room's voice connection. */
    public close(): void {
        this.game?.stop();
        this.host.interrupt(false);
        this.speech.close();
        this.scheduleRemark(null);
        this.drawings.clear();
    }

    /**
     * Finds a picture this room has drawn.
     * @param key the random key in its address.
     * @returns the picture, or undefined.
     */
    public drawing(key: string): Drawing | undefined {
        return this.drawings.get(key);
    }

    /** Readies the voice on first real use, so a page load alone spends nothing. */
    private wake(): void {
        if (this.woken === true) {
            return;
        }
        this.woken = true;
        this.speech.warm();
        const renderLines = async (): Promise<void> => {
            await this.renderAcknowledgements();
            await this.renderRemarks();
        };
        renderLines().catch((error: unknown) => { log(this.scope(), `recorded lines unavailable: ${error instanceof Error ? error.message : String(error)}`); });
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
            this.wake();
            const line: string = this.players.size === 0 ? "(The big screen just came on and nobody has joined yet. Welcome the room and invite people to scan the code.)" : "(The big screen came back on.)";
            this.host.notice(line, WAKE_DELAY_MILLISECONDS.screen);
        });
        this.sendToScreen(socket, { type: "scene", scene: this.currentScene(), joinUrl: this.joinUrl, roomCode: this.code });
        this.sendToScreen(socket, this.hostStateMessage());
        this.sendToScreen(socket, { type: "shell", view: this.shell.view() });
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
            const parsed: (PhoneMessage & Record<string, unknown>) | null = parseMessage<PhoneMessage & Record<string, unknown>>(rawDataToText(data));
            if (parsed === null || isPhoneMessage(parsed) === false) {
                return;
            }
            const message: PhoneMessage = parsed;
            if (message.type === "hello" && player === null) {
                player = this.resume(socket, message.playerId, message.resumeToken) ?? this.join(socket, message.name);
                return;
            }
            if (player === null || message.type === "hello") {
                return;
            }
            if (message.type === "holdToTalk") {
                this.onHoldToTalk(player, message.down);
                return;
            }
            if (message.type === "rename") {
                this.rename(player, message.name);
                return;
            }
            if (message.type === "textOnlySay") {
                this.onTextOnlySay(player, message.text);
                return;
            }
            if (message.type === "nav") {
                this.onNav(player, message.action);
                return;
            }
            if (message.type === "lean") {
                this.broadcastToScreens({ type: "lean", x: Math.max(-1, Math.min(1, message.x)), y: Math.max(-1, Math.min(1, message.y)) });
                return;
            }
            if (message.type === "leave") {
                this.removePlayer(player);
                player = null;
                return;
            }
            this.onControl(player, message.input.value.slice(0, MAX_INPUT_CHARACTERS), message.input.controlIndex);
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
     * What the host needs to know: the running game, or the lobby and what can be started.
     * @returns the brief.
     */
    public brief(): string {
        if (this.game !== null) {
            return `${this.game.brief()}\n\nIf the group clearly wants to stop playing, write [[quit]] first.`;
        }
        const games: string[] = GAMES.map((game: InstalledGame) => {
            const { id, name, minPlayers, maxPlayers }: CartridgeManifest = game.manifest;
            return `- ${name} (id ${id}), ${minPlayers} to ${maxPlayers} players: ${game.pitch}`;
        });
        return [
            "Right now: the lobby. Games you can start:",
            ...games,
            "When the group clearly asks to play one and there are enough players, write [[start: id]] first, then one short line. If there aren't enough, say how many more you need. People can also browse the shelf with their phones.",
        ].join("\n");
    }

    /**
     * Acts on a ruling from the host. A ruling the moment doesn't allow is dropped, so the host
     * can never change the game on its own say-so.
     * @param ruling the ruling's name.
     * @param detail anything written after it.
     * @param speakerId who the host was answering, from when its turn began.
     */
    public applyRuling(ruling: string, detail: string, speakerId: string | null): void {
        if (this.game === null) {
            if (ruling === "start") {
                this.startGame(detail);
            }
            return;
        }
        if (ruling === "quit") {
            this.endGame();
            return;
        }
        if (this.game.allowsRuling(ruling) === false) {
            log(this.scope(), `ignored ruling ${ruling}`);
            return;
        }
        this.game.event({ type: "hostRuled", at: Date.now(), ruling, detail, playerId: speakerId });
    }

    /**
     * Who spoke last, so a turn can credit its ruling to the person it's answering.
     * @returns the player's id, or null.
     */
    public currentSpeaker(): string | null {
        return this.lastSpeakerId;
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
        this.caption = { speaker: this.host.persona.name, text: this.hostTurnText, final: true };
        this.broadcastScene();
        this.voice.say(text, this.host.persona.voice, style);
    }

    /** Silences the host at once. */
    public stopSpeaking(): void {
        this.voice.stop();
    }

    /**
     * Seats a new player and tells everyone.
     * @param socket the phone's WebSocket.
     * @param rawName the name the player typed.
     * @returns the player record, or null when the room is full.
     */
    private join(socket: WebSocket, rawName: string): Player | null {
        if (this.players.size >= MAX_PLAYERS) {
            const rejected: RoomToPhoneMessage = { type: "rejected", reason: "roomFull" };
            socket.send(JSON.stringify(rejected));
            socket.close(4003, "room full");
            return null;
        }
        this.wake();
        const name: string = rawName.trim().slice(0, 24) || `Player ${this.nextPlayerNumber}`;
        const playerId: string = `p${this.nextPlayerNumber}`;
        this.nextPlayerNumber += 1;
        const player: Player = { playerId, name, colour: SEAT_COLOURS[(this.nextPlayerNumber - 2) % SEAT_COLOURS.length] ?? "#8c5a2b", resumeToken: randomBytes(16).toString("hex"), socket, connected: true, leaveTimer: null, listening: "holdToTalk", speaking: false, transcribe: null, standby: null, standbyTimer: null, holdingToTalk: false, awaitingFinal: new Set(), hint: "", hintTimer: null, releasedAt: 0, partial: "" };
        this.players.set(playerId, player);
        this.record({ type: "playerJoined", at: Date.now(), playerId, name });
        log(this.scope(), `${name} joined as ${playerId}`);
        this.shell.seatsChanged();
        this.welcome(player);
        this.broadcastScene();
        this.broadcastShell();
        this.refreshPhones();
        this.prepareStandby(player);
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
        if (player.holdingToTalk === true) {
            player.holdingToTalk = false;
            this.finishPress(player);
        }
        if (previous !== socket) {
            previous.close(4000, "resumed elsewhere");
        }
        log(this.scope(), `${player.name} rejoined ${player.playerId}`);
        this.welcome(player);
        this.broadcastScene();
        this.broadcastShell();
        this.prepareStandby(player);
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
     * Passes a button press or typed text to the running game.
     * @param player who.
     * @param value the option id or text.
     * @param controlIndex which control.
     */
    private onControl(player: Player, value: string, controlIndex: number): void {
        this.record({ type: "controlUsed", at: Date.now(), playerId: player.playerId, value, controlIndex });
        if (this.paused === true) {
            return;
        }
        this.game?.input(player.playerId, value);
        this.refreshPhones();
    }

    /**
     * Applies what a phone's thumb did on the console.
     * @param player who.
     * @param action what.
     */
    private onNav(player: Player, action: NavAction): void {
        this.shell.act(player.playerId, action);
    }

    /**
     * What the console needs from this room.
     * @returns the stage.
     */
    private shellStage(): ShellStage {
        return {
            games: (): ShelfGame[] => GAMES.map((game: InstalledGame) => this.shelfGame(game)),
            seats: (): Omit<Seat, "driving">[] => [...this.players.values()].map(({ playerId, name, colour, connected }: Player) => ({ playerId, name, colour, connected })),
            startGame: (gameId: string): void => { this.startGame(gameId); },
            endGame: (): void => { this.endGame(); },
            gameOver: (): boolean => this.game !== null && this.game.outcome() !== null,
            focusChanged: (gameId: string | null): void => { this.scheduleRemark(gameId); },
            refused: (reason: string): void => { this.host.notice(`(Game: ${reason} Say so in a few words.)`, WAKE_DELAY_MILLISECONDS.screen); },
            driverChanged: (name: string): void => { this.host.notice(`(${name} has the controller now. Mention it in a few words.)`, WAKE_DELAY_MILLISECONDS.leave); },
            paused: (paused: boolean): void => { this.setPaused(paused); },
            gameAction: (playerId: string, actionId: string): void => { this.game?.input(playerId, actionId); },
            edge: (): void => { this.broadcastToScreens({ type: "edge" }); },
            changed: (): void => {
                this.broadcastShell();
                this.refreshPhones();
            },
        };
    }

    /**
     * Pauses or resumes for real: the host stops, timers hold, and phones go quiet.
     * @param paused true to pause.
     */
    private setPaused(paused: boolean): void {
        if (this.paused === paused) {
            return;
        }
        this.paused = paused;
        if (paused === true) {
            this.game?.pause();
            this.cancelAcknowledgement();
            this.host.interrupt(this.hostSpeaking);
            this.broadcastScene();
            return;
        }
        this.game?.resume();
        this.broadcastScene();
        if (this.game !== null && this.game.outcome() === null) {
            this.host.notice("(The game is back on after a pause. Say where things stand in a few words.)", WAKE_DELAY_MILLISECONDS.screen);
        }
    }

    /**
     * One game as the shelf shows it.
     * @param game the game.
     * @returns its box.
     */
    private shelfGame(game: InstalledGame): ShelfGame {
        const { id, name, minPlayers, maxPlayers }: CartridgeManifest = game.manifest;
        const count: number = this.players.size;
        const short: number = minPlayers - count;
        const blocked: string | null = short > 0 ? `Needs ${minPlayers} people. ${short} more to go.` : count > maxPlayers ? `Fits ${maxPlayers} people at most.` : null;
        const players: string = minPlayers === 1 ? `Up to ${maxPlayers} people` : `${minPlayers} to ${maxPlayers} people`;
        return { id, name, pitch: game.pitch, howToPlay: game.howToPlay, players, art: game.art, pauseActions: game.pauseActions, blocked };
    }

    /**
     * Lets the host maybe remark on a box once the highlight has rested there.
     * @param gameId the box, or null when the highlight has moved off the shelf.
     */
    private scheduleRemark(gameId: string | null): void {
        if (this.remarkTimer !== null) {
            clearTimeout(this.remarkTimer);
            this.remarkTimer = null;
        }
        if (gameId === null) {
            return;
        }
        this.remarkTimer = setTimeout(() => {
            this.remarkTimer = null;
            this.playRemark(gameId);
        }, REMARK_DWELL_MILLISECONDS);
    }

    /**
     * Plays one recorded remark, unless the moment isn't right.
     * @param gameId the box.
     */
    private playRemark(gameId: string): void {
        const talking: boolean = this.hostThinking === true || this.voice.isBusy() === true || [...this.players.values()].some((player: Player) => player.holdingToTalk === true);
        const tooSoon: boolean = Date.now() - this.lastRemarkAt < REMARK_GAP_MILLISECONDS;
        if (talking === true || tooSoon === true || this.remarkedOn.has(gameId) === true || Math.random() >= REMARK_CHANCE) {
            return;
        }
        const lines: { text: string; pcm: Uint8Array }[] = this.remarks.get(gameId) ?? [];
        const line: { text: string; pcm: Uint8Array } | undefined = lines[Math.floor(Math.random() * lines.length)];
        if (line === undefined) {
            return;
        }
        this.remarkedOn.add(gameId);
        this.lastRemarkAt = Date.now();
        log(this.scope(), `remarked "${line.text}"`);
        this.host.remark(line.text);
        this.caption = { speaker: this.host.persona.name, text: line.text, final: true };
        this.broadcastScene();
        this.voice.sayRecorded(line.pcm);
    }

    /** Records every game's remarks in the host's voice. */
    private async renderRemarks(): Promise<void> {
        const persona: HostPersona = this.host.persona;
        for (const game of GAMES) {
            const lines: { text: string; pcm: Uint8Array }[] = [];
            for (const text of game.remarks) {
                lines.push({ text, pcm: await this.voice.render(text, persona.voice, `${persona.style} Muttered aside, half to yourself.`) });
            }
            this.remarks.set(game.manifest.id, lines);
        }
        log(this.scope(), "recorded remarks");
    }

    /**
     * Starts a game, if it's installed and the room has the right number of players.
     * @param gameId the game's id or name, in any case.
     */
    private startGame(gameId: string): void {
        const wanted: string = gameId.trim().toLowerCase();
        const installed: InstalledGame | undefined = GAMES.find((game: InstalledGame) => game.manifest.id.toLowerCase() === wanted || game.manifest.name.toLowerCase() === wanted);
        if (installed === undefined || this.game !== null) {
            log(this.scope(), `can't start "${gameId}"`);
            return;
        }
        const count: number = this.players.size;
        if (count < installed.manifest.minPlayers || count > installed.manifest.maxPlayers) {
            const { name, minPlayers, maxPlayers }: CartridgeManifest = installed.manifest;
            this.host.notice(`(Game: ${name} needs ${minPlayers} to ${maxPlayers} players and there are ${count}.)`, WAKE_DELAY_MILLISECONDS.screen);
            return;
        }
        log(this.scope(), `starting ${installed.manifest.name} with ${count}`);
        this.caption = null;
        this.game = installed.create(this.gameStage());
        this.game.start([...this.players.values()].map((player: Player) => ({ playerId: player.playerId, name: player.name })));
        this.gameDecided = false;
        this.shell.gameStarted(installed.manifest.id);
        this.host.notice(`(Game: ${installed.manifest.name} has just started, so this is addressed to you. Say something out loud now, and do what "This moment" says. Don't stay quiet.)`, WAKE_DELAY_MILLISECONDS.screen);
        this.broadcastScene();
    }

    /** Ends the running game and returns everyone to the shelf. */
    private endGame(): void {
        if (this.game === null) {
            return;
        }
        log(this.scope(), `ended ${this.game.manifest.name}`);
        this.game.stop();
        this.game = null;
        this.caption = null;
        this.shell.gameEnded();
        this.broadcastScene();
    }

    /**
     * What a game may ask of this room.
     * @returns the stage.
     */
    private gameStage(): GameStage {
        return {
            tellHost: (line: string): void => { this.host.notice(line, WAKE_DELAY_MILLISECONDS.screen); },
            changed: (): void => {
                this.broadcastScene();
                if (this.gameDecided === false && this.game?.outcome() !== null) {
                    this.gameDecided = true;
                    this.shell.gameDecided();
                }
                this.refreshPhones();
            },
            requestContent: (prompt: string): void => { this.writeContent(prompt); },
            requestDrawing: (id: string, prompt: string): void => { this.draw(id, prompt); },
            record: (event: RoomEvent): void => { this.record(event); },
        };
    }

    /**
     * Has the host's model write content for the running game. Failure comes back as empty
     * text, and the game falls back on its own content.
     * @param prompt what to write.
     */
    private writeContent(prompt: string): void {
        const game: RunningGame | null = this.game;
        const startedAt: number = Date.now();
        const collect = async (): Promise<string> => {
            let text: string = "";
            const system: string = "You write content for a party game. Reply with exactly what is asked and nothing else.";
            for await (const delta of streamSpark([{ role: "system", content: system }, { role: "user", content: prompt }], { maxTokens: CONTENT_TOKEN_LIMIT, signal: AbortSignal.timeout(CONTENT_TIME_LIMIT_MILLISECONDS) })) {
                text += delta;
            }
            return text;
        };
        collect().catch((error: unknown) => {
            log(this.scope(), `content failed: ${error instanceof Error ? error.message : String(error)}`);
            return "";
        }).then((text: string) => {
            log(this.scope(), `content ready in ${Date.now() - startedAt} ms`);
            if (this.game === game) {
                game?.event({ type: "contentReady", at: Date.now(), text });
            }
        }).catch((error: unknown) => { log(this.scope(), `content not applied: ${error instanceof Error ? error.message : String(error)}`); });
    }

    /**
     * Draws a picture for the running game and tells it where to find the result. A failed
     * drawing is only logged; every game has to look fine without its pictures.
     * @param id the game's name for the picture.
     * @param prompt what to draw.
     */
    private draw(id: string, prompt: string): void {
        if (DRAWING_ON === false || this.drawings.size >= MAX_DRAWINGS) {
            return;
        }
        const game: RunningGame | null = this.game;
        const key: string = randomBytes(16).toString("hex");
        const startedAt: number = Date.now();
        drawImage(prompt).then((drawing: Drawing) => {
            this.drawings.set(key, drawing);
            log(this.scope(), `drew ${id} in ${Date.now() - startedAt} ms`);
            if (this.game === game) {
                game?.event({ type: "drawingReady", at: Date.now(), id, src: `/drawings/${this.code}/${key}` });
            }
        }).catch((error: unknown) => { log(this.scope(), `couldn't draw ${id}: ${error instanceof Error ? error.message : String(error)}`); });
    }

    /** Sends every phone its current view. */
    private refreshPhones(): void {
        for (const player of this.players.values()) {
            this.sendToPhone(player, { type: "view", view: this.phoneView(player) });
        }
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
        player.standby?.abort();
        player.standby = null;
        this.clearStandbyTimer(player);
        const grace: number = this.game !== null && this.game.outcome() === null ? GAME_REJOIN_GRACE_MILLISECONDS : REJOIN_GRACE_MILLISECONDS;
        log(this.scope(), `${player.name} disconnected (code ${code}); holding seat ${grace / 1000} s`);
        this.broadcastScene();
        this.broadcastShell();
        player.leaveTimer = setTimeout(() => { this.removePlayer(player); }, grace);
    }

    /**
     * Gives a player their seat up for good and tells the room.
     * @param player the player who is leaving.
     */
    private removePlayer(player: Player): void {
        if (player.leaveTimer !== null) {
            clearTimeout(player.leaveTimer);
            player.leaveTimer = null;
        }
        player.connected = false;
        player.transcribe?.abort();
        player.standby?.abort();
        player.standby = null;
        this.clearStandbyTimer(player);
        this.setHint(player, "");
        this.players.delete(player.playerId);
        const left: RoomEvent = { type: "playerLeft", at: Date.now(), playerId: player.playerId };
        this.record(left);
        this.game?.event(left);
        log(this.scope(), `${player.name} left`);
        if (this.players.size > 0) {
            this.host.notice(`(${player.name} left the room)`, WAKE_DELAY_MILLISECONDS.leave);
        }
        this.shell.seatsChanged();
        this.broadcastScene();
        this.broadcastShell();
        this.refreshPhones();
    }

    /**
     * Changes a player's name and tells the room. A blank or unchanged name does nothing, and
     * a game in progress keeps the names it started with.
     * @param player the player.
     * @param rawName the name the player typed.
     */
    private rename(player: Player, rawName: string): void {
        const name: string = rawName.trim().slice(0, 24);
        if (name === "" || name === player.name) {
            return;
        }
        if (this.game !== null) {
            this.setHint(player, "You can change your name after the game.");
            return;
        }
        const previous: string = player.name;
        player.name = name;
        log(this.scope(), `${previous} is now ${name}`);
        this.welcome(player);
        this.broadcastScene();
        this.broadcastShell();
        this.host.notice(`(${previous} now goes by ${name})`, WAKE_DELAY_MILLISECONDS.join);
    }

    /**
     * Opens the player's transcription session on a press and finishes it on release. A session
     * belongs to one press, so a quick second press gets its own and the first can still deliver
     * its text. Pressing also cuts the host off.
     * @param player the player.
     * @param down true while the button is held.
     */
    private onHoldToTalk(player: Player, down: boolean): void {
        if (down === player.holdingToTalk || (down === true && this.canTalk(player) === false)) {
            return;
        }
        player.holdingToTalk = down;
        if (down === true) {
            this.startPress(player);
            return;
        }
        this.finishPress(player);
    }

    /**
     * Whether this player's microphone is allowed to open right now.
     * @param player the player.
     * @returns false when the game has phones quiet.
     */
    private canTalk(player: Player): boolean {
        if (this.paused === true) {
            return false;
        }
        const mode: ListeningMode = this.game?.listening(player.playerId) ?? "holdToTalk";
        return mode === "holdToTalk" || mode === "openFloor";
    }

    /**
     * Starts one press: quiets the host and puts a session on the player's audio.
     * @param player the player.
     */
    private startPress(player: Player): void {
        player.partial = "";
        this.setHint(player, "");
        this.cancelAcknowledgement();
        if (this.hostSpeaking === true || this.hostThinking === true) {
            log(this.scope(), `${player.name} cut in`);
        }
        this.host.interrupt(this.hostSpeaking);
        const session: TranscribeSession = player.standby ?? this.openTranscribe(player, "PUSH_TO_TALK");
        player.standby = null;
        this.clearStandbyTimer(player);
        player.transcribe = session;
        player.awaitingFinal.add(session);
    }

    /**
     * Finishes one press: asks for its final text, gives up on it if none comes, and readies
     * the next session straight away.
     * @param player the player.
     */
    private finishPress(player: Player): void {
        const session: TranscribeSession | null = player.transcribe;
        if (session === null) {
            return;
        }
        player.transcribe = null;
        player.releasedAt = Date.now();
        session.end();
        setTimeout(() => {
            if (player.awaitingFinal.has(session) === true) {
                session.abort();
            }
        }, FINAL_WAIT_MILLISECONDS);
        this.prepareStandby(player);
    }

    /**
     * Tells a player their press produced no words.
     * @param player the player.
     */
    private onNotHeard(player: Player): void {
        player.speaking = false;
        this.setHint(player, NOT_HEARD_HINT);
        this.broadcastScene();
    }

    /**
     * Shows a short message on a player's phone for a moment. An empty message clears it.
     * @param player the player.
     * @param hint the message.
     */
    private setHint(player: Player, hint: string): void {
        if (player.hintTimer !== null) {
            clearTimeout(player.hintTimer);
            player.hintTimer = null;
        }
        if (hint === "" && player.hint === "") {
            return;
        }
        player.hint = hint;
        this.sendToPhone(player, { type: "view", view: this.phoneView(player) });
        if (hint === "") {
            return;
        }
        player.hintTimer = setTimeout(() => { this.setHint(player, ""); }, HINT_MILLISECONDS);
    }

    /**
     * Treats text from a test phone as a finished utterance. Ignored outside the test mode, so
     * no phone can put words in the room without speaking them.
     * @param player the player.
     * @param text the words.
     */
    private onTextOnlySay(player: Player, text: string): void {
        if (TEXT_ONLY === false || this.canTalk(player) === false) {
            return;
        }
        this.host.interrupt(this.hostSpeaking);
        this.onHeard(player, text);
    }

    /**
     * Opens the player's next transcription session ahead of time, unless one is waiting.
     * @param player the player.
     */
    private prepareStandby(player: Player): void {
        if (TEXT_ONLY === true || player.connected === false || player.standby !== null) {
            return;
        }
        const session: TranscribeSession = this.openTranscribe(player, "PUSH_TO_TALK");
        player.standby = session;
        this.clearStandbyTimer(player);
        player.standbyTimer = setTimeout(() => {
            player.standbyTimer = null;
            if (player.standby !== session) {
                return;
            }
            player.standby = null;
            session.abort();
            this.prepareStandby(player);
        }, STANDBY_REFRESH_MILLISECONDS);
    }

    /**
     * Stops the timer that would replace the player's standby session.
     * @param player the player.
     */
    private clearStandbyTimer(player: Player): void {
        if (player.standbyTimer === null) {
            return;
        }
        clearTimeout(player.standbyTimer);
        player.standbyTimer = null;
    }

    /**
     * Opens a transcription session for a player and wires its events onto the timeline. When
     * it closes, the next standby session is prepared.
     * @param player the player.
     * @param mode push-to-talk for held speech, endpointing for an open floor.
     * @returns the session, opening in the background.
     */
    private openTranscribe(player: Player, mode: "PUSH_TO_TALK" | "ENDPOINTING"): TranscribeSession {
        const session: TranscribeSession = new TranscribeSession({ mode, keywords: this.keywords() }, {
            onSpeechStart: (): void => {
                player.speaking = true;
                this.record({ type: "speechStarted", at: Date.now(), playerId: player.playerId });
                this.broadcastScene();
            },
            onTranscript: (text: string, isFinal: boolean): void => {
                if (isFinal === true && mode === "PUSH_TO_TALK") {
                    this.onSpeechEnded(player, session, text);
                    return;
                }
                if (isFinal === false && player.awaitingFinal.has(session) === true) {
                    this.onPartial(player, text);
                }
            },
            onSpeechComplete: (_turnId: string, text: string): void => { this.onSpeechEnded(player, session, text); },
            onError: (message: string): void => { log(this.scope(), `transcribe error for ${player.name}: ${message}`); },
            onClose: (): void => {
                if (player.standby === session) {
                    player.standby = null;
                }
                const wasCurrent: boolean = player.transcribe === session;
                if (wasCurrent === true) {
                    player.transcribe = null;
                    this.prepareStandby(player);
                }
                if (player.awaitingFinal.delete(session) === true) {
                    log(this.scope(), `lost a press from ${player.name}`);
                    this.onNotHeard(player);
                }
            },
        });
        session.open().catch((error: unknown) => {
            log(this.scope(), `transcribe open failed for ${player.name}: ${error instanceof Error ? error.message : String(error)}`);
            if (player.transcribe === session) {
                player.transcribe = null;
            }
            if (player.standby === session) {
                player.standby = null;
            }
            if (player.awaitingFinal.delete(session) === true) {
                this.onNotHeard(player);
            }
        });
        return session;
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
        this.broadcastToScreens({ type: "micLevel", level: frameLevel(frame) });
    }

    /**
     * Handles one finished utterance, once, and wakes the host.
     * @param player who spoke.
     * @param session the session that heard them.
     * @param text what they said.
     */
    private onSpeechEnded(player: Player, session: TranscribeSession, text: string): void {
        player.speaking = false;
        if (player.awaitingFinal.delete(session) === false) {
            return;
        }
        const said: string = text.trim();
        const sinceRelease: string = player.releasedAt === 0 ? "" : ` (${Date.now() - player.releasedAt} ms after release)`;
        log(this.scope(), said === "" ? `heard nothing from ${player.name}${sinceRelease}` : `heard ${player.name}: "${said}"${sinceRelease}`);
        if (said === "") {
            this.record({ type: "speechEnded", at: Date.now(), playerId: player.playerId, text: said });
            this.onNotHeard(player);
            return;
        }
        this.onHeard(player, said);
        this.scheduleAcknowledgement(said);
    }

    /**
     * Takes in something a player said: the screen shows it, the game hears it, the host reacts.
     * @param player who spoke.
     * @param said their words.
     */
    private onHeard(player: Player, said: string): void {
        const event: RoomEvent = { type: "speechEnded", at: Date.now(), playerId: player.playerId, text: said };
        this.record(event);
        this.lastSpeakerId = player.playerId;
        this.game?.event(event);
        this.caption = { speaker: player.name, text: said, final: true };
        this.broadcastScene();
        this.host.notice(`${player.name}: ${said}`, WAKE_DELAY_MILLISECONDS.speech);
    }

    /**
     * Shows a partial transcript live on the screen while the player is still talking.
     * @param player who is talking.
     * @param text the cumulative partial text.
     */
    private onPartial(player: Player, text: string): void {
        const partial: string = text.trim();
        if (partial === "" || partial === player.partial) {
            return;
        }
        player.partial = partial;
        this.caption = { speaker: player.name, text: partial, final: false };
        this.broadcastScene();
    }

    /**
     * Sometimes plays a short acknowledgement if the host was clearly addressed and has not
     * started replying shortly after the final text. Addressed means the host's name was said,
     * or there is only one player, so side chat between players never gets an acknowledgement.
     * Never on two addressed turns in a row, and never one of the last few played.
     * @param said what the player said so far.
     */
    private scheduleAcknowledgement(said: string): void {
        const addressed: boolean = said.toLowerCase().includes(this.host.persona.name.toLowerCase()) === true || this.players.size === 1;
        if (addressed === false || this.acknowledgements.length === 0) {
            return;
        }
        this.cancelAcknowledgement();
        if (this.acknowledgedLastTurn === true || Math.random() >= ACKNOWLEDGE_CHANCE) {
            this.acknowledgedLastTurn = false;
            return;
        }
        this.acknowledgedLastTurn = false;
        this.acknowledgeTimer = setTimeout(() => {
            this.acknowledgeTimer = null;
            if (this.hostThinking === false || this.voice.isBusy() === true) {
                return;
            }
            const indexes: number[] = this.acknowledgements.map((_pcm: Uint8Array, index: number) => index);
            const fresh: number[] = indexes.filter((index: number) => this.recentAcknowledgements.includes(index) === false);
            const index: number | undefined = fresh[Math.floor(Math.random() * fresh.length)];
            const pcm: Uint8Array | undefined = index === undefined ? undefined : this.acknowledgements[index];
            if (index === undefined || pcm === undefined) {
                return;
            }
            this.recentAcknowledgements.push(index);
            if (this.recentAcknowledgements.length > ACKNOWLEDGE_NO_REPEAT) {
                this.recentAcknowledgements.shift();
            }
            this.acknowledgedLastTurn = true;
            log(this.scope(), `acknowledged with "${ACKNOWLEDGEMENTS[index] ?? ""}"`);
            this.voice.sayRecorded(pcm);
        }, ACKNOWLEDGE_AFTER_MILLISECONDS);
    }

    /** Cancels a pending acknowledgement. */
    private cancelAcknowledgement(): void {
        if (this.acknowledgeTimer === null) {
            return;
        }
        clearTimeout(this.acknowledgeTimer);
        this.acknowledgeTimer = null;
    }

    /** Renders the acknowledgement bank once, in the host's voice. */
    private async renderAcknowledgements(): Promise<void> {
        const persona: HostPersona = this.host.persona;
        for (const text of ACKNOWLEDGEMENTS) {
            this.acknowledgements.push(await this.voice.render(text, persona.voice, `${persona.style} A quick, quiet acknowledgement, as if thinking.`));
        }
        log(this.scope(), `rendered ${this.acknowledgements.length} acknowledgements`);
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
     * The scene for the current moment: the game's, or the lobby, with who is talking marked
     * on any roster and the last line said underneath.
     * @returns the scene.
     */
    private currentScene(): Scene {
        const scene: Scene = this.game === null ? lobbyScene(this.joinUrl, this.code, this.roster()) : this.game.scene();
        for (const block of scene.blocks) {
            if (block.type === "timer" && this.paused === true) {
                block.running = false;
            }
            if (block.type === "roster") {
                block.players = block.players.map((entry: RosterEntry) => ({ ...entry, speaking: this.players.get(entry.playerId)?.speaking === true }));
            }
        }
        if (this.caption !== null) {
            scene.blocks.push({ type: "caption", speaker: this.caption.speaker, text: this.caption.text, final: this.caption.final });
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
        let status: string = "";
        if (this.hostThinking === true) {
            status = `${hostName} is thinking…`;
        }
        if (this.hostSpeaking === true) {
            status = `${hostName} is talking. Press and hold to cut in.`;
        }
        if (player.hint !== "") {
            status = player.hint;
        }
        player.listening = this.game?.listening(player.playerId) ?? "holdToTalk";
        if (this.canTalk(player) === false) {
            status = this.paused === true ? "Paused" : "Phones are quiet for now";
        }
        return { playerName: player.name, listening: player.listening, status, controls: this.phoneControls(player), pad: this.shell.pad(player.playerId, player.colour) };
    }

    /**
     * What a phone shows besides its touch surface: only what's private to it in the game.
     * @param player the player.
     * @returns the controls.
     */
    private phoneControls(player: Player): Control[] {
        return this.game?.controls(player.playerId) ?? [];
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
        this.refreshPhones();
    }

    /** Sends the console to every screen. */
    private broadcastShell(): void {
        this.broadcastToScreens({ type: "shell", view: this.shell.view() });
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
            this.sendUnlessLagging(screen, text);
        }
    }

    /**
     * Sends one chunk of host audio to every attached screen as a binary frame.
     * @param chunk PCM bytes, always an even count.
     */
    private broadcastAudio(chunk: Uint8Array): void {
        for (const screen of this.screens) {
            this.sendUnlessLagging(screen, chunk);
        }
    }

    /**
     * Sends to a screen, or ends its connection if it has fallen too far behind. It reconnects
     * to the current state rather than playing old audio and filling the server's memory.
     * @param screen the screen.
     * @param data what to send.
     */
    private sendUnlessLagging(screen: WebSocket, data: string | Uint8Array): void {
        if (screen.bufferedAmount > MAX_SCREEN_BUFFER_BYTES) {
            log(this.scope(), "ended a screen that fell too far behind");
            screen.terminate();
            return;
        }
        screen.send(data);
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

