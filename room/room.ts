// One room: its players, screens, timeline, host, and the per-phone transcription sessions.
// The room is the single owner of all mutable state here. It generates each stage's view
// from its state, and it is the only thing that talks to the providers. The host acts on the
// room only through the HostStage methods; the host's voice reaches screens through
// VoiceOutput. A phone that drops keeps its seat for a grace period and can resume it.
// Latency moves, measured and explained in the planning notes: partial transcripts show live
// on the screen, each phone keeps a transcription session open ahead of its next press, and a
// short pre-recorded filler plays when a reply is slow to start.

import { randomBytes, randomInt } from "node:crypto";
import type WebSocket from "ws";
import type { ContentGrounding, CartridgeManifest } from "../shared/cartridge.ts";
import type { Control, ListeningMode, PhoneView } from "../shared/controls.ts";
import { lobbyScene, type RosterEntry, type Scene } from "../shared/scene.ts";
import { appendEvent, type RoomEvent } from "../shared/timeline.ts";
import { isPhoneMessage, parseMessage, type PhoneMessage, type RoomToPhoneMessage, type RoomToScreenMessage, type ScreenMessage } from "../shared/protocol.ts";
import { isFitForRoom } from "../providers/meta/moderation.ts";
import { FAST_SPARK_MODEL, SPARK_MODEL } from "../providers/meta/spark.ts";
import { filterText, nicknameCategory, type FilterResult } from "./content-filter.ts";
import { kindByRule, mergeAnswers, utteranceKind, voiceCommand, type UtteranceKind } from "./decide.ts";
import { commandByKeywords, DESTRUCTIVE_COMMANDS, type VoiceCommand } from "./voice-commands.ts";
import { rawDataToText, TranscribeSession } from "../providers/meta/transcribe.ts";
import { ELEVENLABS_KEY_VARIABLE, ElevenLabsSpeech } from "../providers/elevenlabs/speech.ts";
import { OpenAiRealtimeSpeech } from "../providers/openai/realtime-speech.ts";
import { OpenAiSpeech } from "../providers/openai/speech.ts";
import { SilentSpeech } from "../providers/silent-speech.ts";
import type { InstalledGame } from "../cartridges/index.ts";
import { groundedContent } from "./grounded-content.ts";
import type { SearchedText } from "../providers/meta/search.ts";
import { BUDGET, RateWindow } from "./limits.ts";
import { recordedLine } from "./lineBank.ts";
import { drawImage, type Drawing } from "../providers/meta/image.ts";
import { streamSpark } from "../providers/meta/spark.ts";
import type { NavAction, PadView, Seat, ShelfGame } from "../shared/shell.ts";
import type { GameStage, RunningGame } from "./game-session.ts";
import { Shell, type ShellStage } from "./shell.ts";
import type { HostMood } from "../shared/hostMood.ts";
import type { PhoneTurn, Turn } from "../shared/turn.ts";
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
    /** When this phone last had a typed answer checked. */
    lastTextAnswerAt: number;
    /** False when this phone's owner turned the host's quick reactions off. */
    wantsReactions: boolean;
    /** Sessions whose press has not produced final text yet; a new press can overlap the last. */
    awaitingFinal: Set<TranscribeSession>;
    /** When this seat last pressed to talk, or zero if it never has. */
    lastPressAt: number;
    talkMilliseconds: number;
    /** How much of this press came in while the TV's voice could be heard. */
    overlapMilliseconds: number;
    phoneDown: boolean;
    phoneDownTimer: NodeJS.Timeout | null;
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

/** A filler only plays if the reply still hasn't started this long after a thumb lifts; people hear anything sooner as not listening. */
const FILLER_AFTER_RELEASE_MILLISECONDS: number = 600;

/** A press shorter than this gets a real reply with nothing in front of it. */
const FILLER_MINIMUM_WORDS: number = 3;

/** Chance an eligible press gets a filler, the one dial for how often the host reacts; 0 turns it off. Repeated fillers soon grate (arXiv 2508.11781). */
const FILLER_CHANCE: number = 0.5;

/** Fillers that can't disagree with what comes next, because the ruling isn't known yet. */
const NEUTRAL_REACTIONS: string[] = ["Hm.", "Let's see.", "Okay."];

/** After a question, only thinking sounds; anything else sounds like an answer. */
const QUESTION_REACTIONS: string[] = ["Hm.", "Let's see."];

/**
/** The one game the livelier host is tried in, in rooms opened for it: moods, callbacks, quicker reactions and now and then speaking up. */
const LIVELY_GAME: string = "twentyDoors";

/** How long nothing may have happened before the host may speak up. */
const LULL_MILLISECONDS: number = 30000;

/** Least time between two times the host speaks up. With no room mic it can't tell if the table is deep in talk, so this stays rare. */
const LULL_GAP_MILLISECONDS: number = 150000;

/** Most times the host speaks up in one game. */
const LULL_LIMIT: number = 3;

/** How often a room checks for a lull. */
const LULL_CHECK_MILLISECONDS: number = 5000;

/** How long a mood stays on the lantern's face after the line ends. */
const MOOD_LINGER_MILLISECONDS: number = 1500;

/** How long a phone must be away from the app before the TV says so. */
const PHONE_DOWN_AFTER_MILLISECONDS: number = 3000;

/** Least time between the host being told someone joined, so it doesn't greet every arrival. */
const JOIN_NOTICE_GAP_MILLISECONDS: number = 30000;

/** Longest a host line's words wait for its voice before appearing anyway. */
const CAPTION_WAIT_MILLISECONDS: number = 2500;

/** How many of the latest acknowledgements are not reused. */
const ACKNOWLEDGE_NO_REPEAT: number = 4;

/** How long someone has to repeat a command that would lose the game. */
const COMMAND_CONFIRM_MILLISECONDS: number = 20000;

/** Longest typed answer a game can ask for. */
const TEXT_ANSWER_LIMIT: number = 80;

/** Least time between one phone's typed answers, as each costs a check. */
const TEXT_ANSWER_GAP_MILLISECONDS: number = 1000;

/** What someone hears when the filter says no. It never says why. */
const ANSWER_REFUSED_NOTE: string = "That one won't work. Try another.";

/** Nicknames the classifier has already judged, so a rejoin or a common name takes no time. Bounded because anyone can send names. */
const CHECKED_NICKNAMES: Map<string, boolean> = new Map();

/** Most nicknames remembered. */
const CHECKED_NICKNAME_LIMIT: number = 2000;

/**
 * Asks the classifier about a nickname, remembering clear answers. A failure counts as no and isn't remembered.
 * @param name the name.
 * @returns true when it may be used.
 */
async function nicknameIsFit(name: string): Promise<boolean> {
    const key: string = name.toLowerCase();
    const known: boolean | undefined = CHECKED_NICKNAMES.get(key);
    if (known !== undefined) {
        return known;
    }
    if (BUDGET.spend("spark") === false) {
        return false;
    }
    const fit: boolean | null = await isFitForRoom(name, "nickname").catch(() => null);
    if (fit === null) {
        return false;
    }
    if (CHECKED_NICKNAMES.size >= CHECKED_NICKNAME_LIMIT) {
        CHECKED_NICKNAMES.clear();
    }
    CHECKED_NICKNAMES.set(key, fit);
    return fit;
}

/** Longest name a seat can have. */
const NAME_CHARACTER_LIMIT: number = 24;

/**
 * Picks the host's voice: silent in the test mode, ElevenLabs where its key is set, otherwise OpenAI's.
 * @returns the voice.
 */
function chooseVoice(): OpenAiRealtimeSpeech | SilentSpeech | ElevenLabsSpeech {
    if (TEXT_ONLY === true) {
        return new SilentSpeech();
    }
    return (process.env[ELEVENLABS_KEY_VARIABLE] ?? "").trim() !== "" ? new ElevenLabsSpeech(new OpenAiSpeech()) : new OpenAiRealtimeSpeech();
}

/** Every filler, rendered once per room. */
const ACKNOWLEDGEMENTS: string[] = [...new Set([...NEUTRAL_REACTIONS, ...QUESTION_REACTIONS])];

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

/** False when the server is started with WEB_SEARCH_OFF=1: games then only get content the model writes from memory. */
const WEB_SEARCH_ON: boolean = process.env.WEB_SEARCH_OFF !== "1";

/** What the model is told when it writes content for a game. */
const CONTENT_SYSTEM: string = "You write content for a family party game. Keep it suitable for all ages, even if a topic pushes otherwise. Reply with exactly what is asked and nothing else.";

/** How long content may take. After that the game uses its own, so it can't sit waiting. */
const CONTENT_TIME_LIMIT_MILLISECONDS: number = 15000;

/** Most pictures one room draws. Each costs about a cent and sits in memory until it closes. */
const MAX_DRAWINGS: number = 40;

/**
 * True when pictures are drawn. The text-only test mode skips them to stay fast, unless asked
 * with GAME_ROOM_DRAW=1.
 */
const DRAWING_ON: boolean = TEXT_ONLY === false || process.env.GAME_ROOM_DRAW === "1";

/** Unsent bytes a screen may build up: about 2 minutes of voice. */
const MAX_SCREEN_BUFFER_BYTES: number = 5760000;

/** Messages a socket may send per second. Thumb leans alone reach 30. */
const TEXT_MESSAGES_PER_SECOND: number = 60;

/** Audio frames a socket may send per second: real time is 12.5, plus a little catch-up. */
const AUDIO_FRAMES_PER_SECOND: number = 30;

/** Longest a single press can talk. */
const PRESS_LIMIT_MILLISECONDS: number = 30000;

/** How long a screen may wait to be lit before it's dropped, so idle tabs can't hold rooms. */
const UNLIT_SCREEN_MILLISECONDS: number = 600000;

/** Shortest gap between game starts in a room. */
const GAME_START_GAP_MILLISECONDS: number = 10000;

/** Fewest milliseconds between voice-level messages to screens. */
const MIC_LEVEL_GAP_MILLISECONDS: number = 100;

/** Unsent bytes a phone may build up before it's dropped and reconnects. */
const MAX_PHONE_BUFFER_BYTES: number = 1048576;

/** How long since a seat's last press its standby session keeps being refreshed. */
const STANDBY_IDLE_MILLISECONDS: number = 120000;

/** Longest speech passed on to the host and the screen. */
const MAX_HEARD_CHARACTERS: number = 300;

/** Fewest milliseconds between name changes. */
const RENAME_GAP_MILLISECONDS: number = 5000;

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
const REJOIN_GRACE_MILLISECONDS: number = 120000;

/** The same during a game: a locked phone mustn't lose its seat, and every phase has a timer. */
const GAME_REJOIN_GRACE_MILLISECONDS: number = 180000;

/** How long every seat must be gone before the game waits, so one person's reload isn't a pause. */
const STEP_OUT_AFTER_MILLISECONDS: number = 10000;

/** How long after the host's voice ends the TV may still be heard: its last word, and what the phone kept from just before a press. */
const HOST_AUDIO_GUARD_MILLISECONDS: number = 300;

/** Bytes per millisecond of phone audio: 24 kHz, 16-bit, mono. */
const PHONE_AUDIO_BYTES_PER_MILLISECOND: number = 48;

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
        code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
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

/**
 * Makes a typed name safe to show and to put in front of the host: one line, printable, short.
 * @param raw what was typed.
 * @returns the name, possibly empty.
 */
function cleanName(raw: string): string {
    return raw.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/[()[\]:]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_CHARACTER_LIMIT);
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
    private readonly speech: OpenAiRealtimeSpeech | SilentSpeech | ElevenLabsSpeech = chooseVoice();
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
    /** Paused from the phone menu; only someone at the menu undoes this. */
    private menuPaused: boolean = false;
    /** Every seat in the running game has dropped, and the game waits for them. */
    private steppedOut: boolean = false;
    private stepOutTimer: NodeJS.Timeout | null = null;
    /** Every phone connected, seated or still typing a name. */
    private readonly phones: Set<WebSocket> = new Set();
    /** Who was seated when the game began; anyone later watches and can't drive. */
    private gamePlayerIds: Set<string> = new Set();
    private readonly drawings: Map<string, Drawing> = new Map();
    private readonly groundedPrompts: Set<string> = new Set();
    private drawingsAsked: number = 0;
    private lastGameStartAt: number = 0;
    private lastMicLevelAt: number = 0;
    /** Who spoke last, so a ruling can be credited to them. */
    private lastSpeakerId: string | null = null;
    private nextPlayerNumber: number = 1;
    private caption: Caption | null = null;
    private hostThinking: boolean = false;
    /** What was chosen before each game, so saying "go again" keeps it. */
    private readonly lastPicks: Map<string, string> = new Map();
    /** Content being written for the game. The lantern shows it as thinking; nothing else treats the host as busy. */
    private contentBeingWritten: number = 0;
    private hostMood: HostMood | null = null;
    private lastJoinNoticeAt: number = 0;
    private captionGeneration: number = 0;
    private lastOutKey: string = "";
    private releasedAt: number = 0;
    /** The last thumb lift, which the timeline log counts from. */
    private lastLiftAt: number = 0;
    /** True when the previous heard press got a filler; two in a row never play. */
    private filledLastTurn: boolean = false;
    private replyClockAt: number = 0;
    private lastLullPlayerId: string | null = null;
    private moodTimer: NodeJS.Timeout | null = null;
    private lastActivityAt: number = 0;
    private lastLullAt: number = 0;
    private lullsThisGame: number = 0;
    private readonly livelyRoom: boolean;
    private readonly tapToTalk: boolean;
    /** A command waiting to be said again. */
    private pendingCommand: { playerId: string; command: VoiceCommand; at: number } | null = null;
    /** The last line spoken, for "say that again". */
    private lastSpoken: { text: string; style: string } | null = null;
    /** Controls each player has answered this game, as "player|control". */
    private readonly answered: Set<string> = new Set();
    /** Typed answers waiting on the filter. */
    private readonly checking: Set<string> = new Set();
    /** Typed answers the filter refused, until the next try. */
    private readonly refused: Set<string> = new Set();
    private readonly fastReplies: boolean;
    private readonly lullTimer: NodeJS.Timeout | null;
    private hostSpeaking: boolean = false;
    /** When the TV's voice may last have been heard, from its last stop and the guard after it. */
    private hostAudioEndsAt: number = 0;
    /** The words of the host's latest turn; a line still in the voice's queue keeps adding to its own turn. */
    private hostTurn: { text: string } = { text: "" };
    private readonly acknowledgements: Uint8Array[] = [];
    /** Indexes of the latest acknowledgements played, newest last. */
    private readonly recentAcknowledgements: number[] = [];
    /** Counts filler plans, so one still waiting on a decision can tell it has been called off. */
    private fillerTurn: number = 0;
    /** Waits to play a filler. */
    private acknowledgeTimer: NodeJS.Timeout | null = null;
    /** What is on this room's shelf; a room may gain games while it is open. */
    private readonly games: InstalledGame[];
    /** A replacement for the running game's shelf entry, installed when that game ends. */
    private waitingInstall: InstalledGame | null = null;

    /**
     * Creates an empty room.
     * @param code the room code players type or scan.
     * @param publicUrl the base URL phones open, from PUBLIC_URL.
     * @param games what is on the shelf to begin with, in shelf order.
     * @param livelyRoom true for the lively host.
     * @param tapToTalk true when phones offer the Talk button.
     * @param fastReplies true when the room was opened to try the faster reply model.
     */
    public constructor(code: string, publicUrl: string, games: InstalledGame[], livelyRoom: boolean = false, tapToTalk: boolean = false, fastReplies: boolean = false) {
        this.code = code;
        this.games = [...games];
        this.livelyRoom = livelyRoom;
        this.tapToTalk = tapToTalk;
        this.fastReplies = fastReplies;
        this.lullTimer = livelyRoom === true ? setInterval(() => { this.checkLull(); }, LULL_CHECK_MILLISECONDS).unref() : null;
        this.joinUrl = `${publicUrl.replace(/\/$/, "")}/phone/?room=${code}`;
        this.host = new Host(this, PLACEHOLDER_PERSONA);
        this.voice = new HostVoice(this.speech, this.voiceOutput());
        this.shell = new Shell(this.shellStage());
    }

    /**
     * Puts a game on this room's shelf, replacing one with the same id, so a game a creator keeps
     * can be played without restarting the room. A replacement for the game being played waits
     * until that game ends, because the shell reads the running game's pause menu from the shelf.
     * @param game the game.
     */
    public install(game: InstalledGame): void {
        if (this.game !== null && this.game.manifest.id === game.manifest.id) {
            this.waitingInstall = game;
            return;
        }
        const index: number = this.games.findIndex((candidate: InstalledGame) => candidate.manifest.id === game.manifest.id);
        if (index === -1) {
            this.games.push(game);
        }
        if (index !== -1) {
            this.games[index] = game;
        }
        this.broadcastShell();
    }

    /**
     * True when no screen or player is in the room.
     * @returns whether the room is empty.
     */
    public isEmpty(): boolean {
        return this.screens.size === 0 && this.players.size === 0;
    }

    /**
     * True when anyone holds a seat, connected or not.
     * @returns whether the room has players.
     */
    public hasPlayers(): boolean {
        return this.players.size > 0;
    }

    /** Tells every screen and phone the room is gone, so none of them waits on it or tries to come back. */
    public turnEveryoneAway(): void {
        for (const screen of this.screens) {
            this.sendToScreen(screen, { type: "rejected", reason: "roomClosed" });
            screen.close(4004, "roomClosed");
        }
        const rejected: RoomToPhoneMessage = { type: "rejected", reason: "unknownRoom" };
        for (const phone of this.phones) {
            phone.send(JSON.stringify(rejected));
            phone.close(4004, "unknownRoom");
        }
    }

    /** Silences the host and releases the room's voice connection. */
    public close(): void {
        this.game?.stop();
        this.shell.close();
        this.host.close();
        this.speech.close();
        this.scheduleRemark(null);
        this.drawings.clear();
        if (this.stepOutTimer !== null) {
            clearTimeout(this.stepOutTimer);
        }
        for (const player of this.players.values()) {
            if (player.phoneDownTimer !== null) {
                clearTimeout(player.phoneDownTimer);
                player.phoneDownTimer = null;
            }
        }
        if (this.lullTimer !== null) {
            clearInterval(this.lullTimer);
        }
        if (this.moodTimer !== null) {
            clearTimeout(this.moodTimer);
        }
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
        let lit: boolean = false;
        const unlitTimer: NodeJS.Timeout = setTimeout(() => { socket.close(4008, "never lit"); }, UNLIT_SCREEN_MILLISECONDS);
        socket.on("close", () => { clearTimeout(unlitTimer); });
        socket.on("message", (data: WebSocket.RawData) => {
            const message: ScreenMessage | null = parseMessage<ScreenMessage>(rawDataToText(data));
            if (message?.type !== "ready" || lit === true) {
                return;
            }
            lit = true;
            clearTimeout(unlitTimer);
            this.wake();
            if (message.resumed === true) {
                return;
            }
            const line: string = this.players.size === 0 ? "(The big screen just came on and nobody has joined yet. Welcome the room and invite people to scan the code.)" : "(The big screen came back on.)";
            this.noticeIfAnyoneIsThere(line, WAKE_DELAY_MILLISECONDS.screen);
        });
        this.sendToScreen(socket, { type: "scene", scene: this.currentScene(), joinUrl: this.joinUrl, roomCode: this.code, turn: this.game?.turn() ?? null });
        this.sendToScreen(socket, this.hostStateMessage());
        this.sendToScreen(socket, { type: "shell", view: this.shell.view() });
    }

    /**
     * Attaches a phone. The phone becomes a player, new or resumed, once it says hello.
     * @param socket the phone's WebSocket.
     */
    public attachPhone(socket: WebSocket): void {
        this.phones.add(socket);
        socket.on("close", () => { this.phones.delete(socket); });
        let player: Player | null = null;
        let lastRenameAt: number = 0;
        const textRate: RateWindow = new RateWindow(TEXT_MESSAGES_PER_SECOND, 1000);
        const audioRate: RateWindow = new RateWindow(AUDIO_FRAMES_PER_SECOND, 1000);
        socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
            if ((isBinary === true ? audioRate : textRate).allow() === false) {
                socket.close(1008, "too many messages");
                return;
            }
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
                player = this.seat(socket, message);
                return;
            }
            if (player === null || message.type === "hello") {
                return;
            }
            if (message.type === "holdToTalk") {
                this.onHoldToTalk(player, message.down);
                return;
            }
            if (message.type === "presence") {
                if (player.socket === socket) {
                    this.onPresence(player, message.away);
                }
                return;
            }
            if (message.type === "reactions") {
                player.wantsReactions = message.wanted;
                return;
            }
            if (message.type === "micSettings") {
                log(this.scope(), `${player.playerId} mic settings: echo ${message.echoCancellation}, noise ${message.noiseSuppression}, gain ${message.autoGainControl}`);
                return;
            }
            if (message.type === "released") {
                if (message.why !== undefined) {
                    log(this.scope(), `${player.playerId} tap recording ended: ${message.why}`);
                }
                this.onReleased(player);
                return;
            }
            if (message.type === "touched") {
                this.broadcastToScreens({ type: "seatTouched", playerId: player.playerId });
                return;
            }
            if (message.type === "rename") {
                if (Date.now() - lastRenameAt >= RENAME_GAP_MILLISECONDS) {
                    lastRenameAt = Date.now();
                    this.rename(player, message.name);
                }
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
                if (this.shell.isDriving(player.playerId) === false) {
                    return;
                }
                this.broadcastToScreens({ type: "lean", x: Math.max(-1, Math.min(1, message.x)), y: Math.max(-1, Math.min(1, message.y)) });
                return;
            }
            if (message.type === "leave") {
                this.removePlayer(player);
                player = null;
                return;
            }
            if (message.type === "answer") {
                this.onAnswer(player, message.controlId, message.value);
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
            return [this.game.brief(), this.turnBrief(), "If the group clearly wants to stop playing, write [[quit]] first."].filter((part: string) => part !== "").join("\n\n");
        }
        const games: string[] = this.games.map((game: InstalledGame) => {
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
            log(this.scope(), "ignored a ruling the moment doesn't allow");
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
            this.hostTurn = { text: "" };
        }
        if (this.hostThinking === thinking) {
            return;
        }
        this.hostThinking = thinking;
        this.logMoment(thinking === true ? "thinking on" : "thinking off");
        this.broadcastHostState();
    }

    /**
     * Queues one host sentence for the voice and adds it to the caption.
     * @param text the sentence.
     * @param style delivery direction.
     */
    public say(text: string, style: string): void {
        this.lastSpoken = { text, style };
        if (this.replyClockAt !== 0) {
            log(this.scope(), `reply ready ${Date.now() - this.replyClockAt} ms after release`);
            this.replyClockAt = 0;
        }
        this.record({ type: "hostSaid", at: Date.now(), text, scopeKey: "public" });
        this.logMoment("line queued");
        const generation: number = this.captionGeneration;
        const turn: { text: string } = this.hostTurn;
        let shown: boolean = false;
        let captionTimer: NodeJS.Timeout | null = null;
        // The words appear as the voice starts, or after a short wait from its turn if the voice never does.
        const showCaption = (): void => {
            if (shown === true || generation !== this.captionGeneration) {
                return;
            }
            shown = true;
            if (captionTimer !== null) {
                clearTimeout(captionTimer);
            }
            this.logMoment("caption");
            turn.text = `${turn.text} ${text}`.trim();
            this.caption = { speaker: this.host.persona.name, text: turn.text, final: true };
            this.broadcastScene();
        };
        if (BUDGET.spend("voice") === false) {
            showCaption();
            return;
        }
        this.voice.say(text, this.host.persona.voice, style, showCaption, (aheadMilliseconds: number): void => {
            captionTimer = setTimeout(showCaption, aheadMilliseconds + CAPTION_WAIT_MILLISECONDS);
            captionTimer.unref();
        });
    }

    /**
     * Whether this moment gets the livelier host.
     * @returns true in a room opened for it, in the game it's being tried in.
     */
    public lively(): boolean {
        return this.livelyRoom === true && this.game?.manifest.id === LIVELY_GAME;
    }

    /**
     * Whether the moment allows this ruling.
     * @param ruling the ruling.
     * @returns true when the game allows it.
     */
    public mayRule(ruling: string): boolean {
        return this.game?.allowsRuling(ruling) === true;
    }

    /**
     * Finds a player by name.
     * @param name the name, in any case.
     * @returns the player's id, or null.
     */
    public playerIdNamed(name: string): string | null {
        return [...this.players.values()].find((player: Player) => player.name.toLowerCase() === name.toLowerCase())?.playerId ?? null;
    }

    /**
     * The model this room's replies come from.
     * @returns the model's name.
     */
    public replyModel(): string {
        return this.fastReplies === true ? FAST_SPARK_MODEL : SPARK_MODEL;
    }

    /**
     * Logs one moment of a turn in a room opened for the livelier host, timed from the last thumb
     * lift, so one game can be read as a single timeline. Never carries anyone's words.
     * @param moment what just happened.
     */
    private logMoment(moment: string): void {
        if (this.livelyRoom === false) {
            return;
        }
        log(this.scope(), `timeline ${moment}${this.lastLiftAt === 0 ? "" : ` +${Date.now() - this.lastLiftAt} ms`}`);
    }

    /**
     * Puts the mood of the next line on the lantern's face.
     * @param mood the mood.
     */
    public showMood(mood: HostMood): void {
        if (this.moodTimer !== null) {
            clearTimeout(this.moodTimer);
            this.moodTimer = null;
        }
        this.hostMood = mood;
        this.logMoment(`mood ${mood}`);
        this.broadcastHostState();
    }

    /** Silences the host at once. */
    public stopSpeaking(): void {
        this.logMoment("host cut off");
        this.captionGeneration += 1;
        this.voice.stop();
    }

    /**
     * Finds a phone its seat: the one it remembers, or one it's asked to take over, or a new
     * one. A name already at the table is checked first, because the same person often arrives
     * twice, as Safari and the home-screen app don't share a seat. Taking a seat is only offered
     * outside a game and when its phone has gone, with a new token, so a name alone can't reach
     * anyone's secret role or push them out.
     * @param socket the phone's WebSocket.
     * @param hello what the phone said.
     * @returns the player, or null while the phone is deciding or the room is full.
     */
    private seat(socket: WebSocket, hello: Extract<PhoneMessage, { type: "hello" }>): Player | null {
        const resumed: Player | null = this.resume(socket, hello.playerId, hello.resumeToken);
        if (resumed !== null) {
            return resumed;
        }
        const wanted: string = hello.name.trim().toLowerCase();
        const namesake: Player | undefined = [...this.players.values()].find((candidate: Player) => candidate.name.toLowerCase() === wanted);
        if (namesake === undefined || namesake.connected === true || this.game !== null || hello.sameName === "newSeat") {
            return this.join(socket, hello.name);
        }
        if (hello.sameName === "takeSeat") {
            namesake.resumeToken = randomBytes(16).toString("hex");
            return this.resume(socket, namesake.playerId, namesake.resumeToken);
        }
        const asking: RoomToPhoneMessage = { type: "nameTaken", name: namesake.name };
        socket.send(JSON.stringify(asking));
        return null;
    }

    /**
     * Makes a name different from everyone else's, so the TV and the host can tell two people apart.
     * @param name the cleaned name.
     * @param ownerId who wants it, whose own name doesn't count, or null for someone new.
     * @returns the name, with a number added if it's taken.
     */
    private freeName(name: string, ownerId: string | null): string {
        const taken: string[] = [...this.players.values()].filter((player: Player) => player.playerId !== ownerId).map((player: Player) => player.name.toLowerCase());
        let candidate: string = name;
        for (let number: number = 2; taken.includes(candidate.toLowerCase()) === true; number += 1) {
            candidate = `${name.slice(0, NAME_CHARACTER_LIMIT - String(number).length - 1)} ${number}`;
        }
        return candidate;
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
        const placeholder: string = this.freeName(`Player ${this.nextPlayerNumber}`, null);
        const wanted: string = cleanName(rawName);
        const passedLocally: boolean = wanted !== "" && this.nicknameRefused(wanted) === false;
        const name: string = passedLocally === true && TEXT_ONLY === true ? this.freeName(wanted, null) : placeholder;
        const playerId: string = `p${this.nextPlayerNumber}`;
        this.nextPlayerNumber += 1;
        const player: Player = { playerId, name, lastPressAt: 0, overlapMilliseconds: 0, talkMilliseconds: 0, phoneDown: false, phoneDownTimer: null, colour: SEAT_COLOURS[(this.nextPlayerNumber - 2) % SEAT_COLOURS.length] ?? "#8c5a2b", resumeToken: randomBytes(16).toString("hex"), socket, connected: true, leaveTimer: null, listening: "holdToTalk", speaking: false, transcribe: null, standby: null, standbyTimer: null, holdingToTalk: false, wantsReactions: true, lastTextAnswerAt: 0, awaitingFinal: new Set(), hint: "", hintTimer: null, releasedAt: 0, partial: "" };
        this.players.set(playerId, player);
        this.record({ type: "playerJoined", at: Date.now(), playerId, name });
        log(this.scope(), `${playerId} joined`);
        this.shell.seatsChanged();
        this.welcome(player);
        this.broadcastScene();
        this.broadcastShell();
        this.refreshPhones();
        this.prepareStandby(player);
        if (passedLocally === true && TEXT_ONLY === false) {
            void this.settleNickname(player, wanted);
            return player;
        }
        if (wanted !== "" && passedLocally === false) {
            this.setHint(player, `That name won't work, so you're ${name} for now. Change it from the menu.`);
        }
        this.announceJoin(player);
        return player;
    }

    /**
     * Tells the host someone has joined, by the name they ended up with.
     * @param player who.
     */
    private announceJoin(player: Player): void {
        if (Date.now() - this.lastJoinNoticeAt >= JOIN_NOTICE_GAP_MILLISECONDS) {
            this.lastJoinNoticeAt = Date.now();
            this.host.notice(`(${player.name} joined the room)`, WAKE_DELAY_MILLISECONDS.join);
            return;
        }
        this.host.remark(`(${player.name} joined the room)`);
    }

    /**
     * Whether the local check refuses a nickname. The reason goes to the log, never the name.
     * @param name the cleaned name.
     * @returns true when it can't be used.
     */
    private nicknameRefused(name: string): boolean {
        const category: string | null = nicknameCategory(name, this.host.persona.name);
        if (category !== null) {
            log(this.scope(), `a nickname was refused: ${category}`);
        }
        return category !== null;
    }

    /**
     * A new player sits as "Player 3" until the classifier has passed their name, so nothing it
     * would refuse reaches the TV or the host even for a moment. If it can't answer they stay that.
     * @param player who.
     * @param wanted the name they asked for, which the local check passed.
     */
    private async settleNickname(player: Player, wanted: string): Promise<void> {
        const fit: boolean = await nicknameIsFit(wanted);
        if (this.players.get(player.playerId) !== player) {
            return;
        }
        const locked: boolean = this.game !== null && this.gamePlayerIds.has(player.playerId) === true;
        if (fit === true && locked === false) {
            player.name = this.freeName(wanted, player.playerId);
            this.welcome(player);
            this.broadcastScene();
            this.broadcastShell();
            this.refreshPhones();
        }
        if (fit === false || locked === true) {
            this.setHint(player, fit === false ? `That name won't work, so you're ${player.name} for now. Change it from the menu.` : `You're ${player.name} for this game. Change it from the menu after.`);
        }
        this.announceJoin(player);
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
        if (player.phoneDownTimer !== null) {
            clearTimeout(player.phoneDownTimer);
            player.phoneDownTimer = null;
        }
        player.phoneDown = false;
        if (player.holdingToTalk === true) {
            player.holdingToTalk = false;
            this.finishPress(player);
        }
        if (previous !== socket) {
            previous.close(4000, "resumed elsewhere");
        }
        log(this.scope(), `${player.playerId} rejoined`);
        this.checkSteppedOut();
        this.welcome(player);
        this.broadcastScene();
        this.broadcastShell();
        this.refreshPhones();
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
     * Takes one answer to a textInput, numberInput or slider. Anything but a live control of this
     * player's, a value in its range, and a first answer is ignored.
     * @param player who.
     * @param controlId the control.
     * @param value what they entered.
     */
    private onAnswer(player: Player, controlId: string, value: string | number): void {
        const key: string = `${player.playerId}|${controlId}`;
        const control: Control | undefined = this.answerControl(player, controlId);
        if (this.paused === true || control === undefined || this.answered.has(key) === true || this.checking.has(key) === true) {
            return;
        }
        if (control.type === "textInput") {
            if (typeof value === "string") {
                void this.checkTextAnswer(player, controlId, value, Math.min(control.maxLength, TEXT_ANSWER_LIMIT));
            }
            return;
        }
        if (control.type !== "numberInput" && control.type !== "slider") {
            return;
        }
        const steps: number = typeof value === "number" ? (value - control.min) / (control.step ?? 1) : Number.NaN;
        if (typeof value !== "number" || value < control.min || value > control.max || Math.abs(steps - Math.round(steps)) > 1e-9) {
            return;
        }
        this.acceptAnswer(player, controlId, value);
    }

    /**
     * Finds a control this player can answer right now.
     * @param player who.
     * @param controlId the control.
     * @returns the control, if it's in their view.
     */
    private answerControl(player: Player, controlId: string): Control | undefined {
        return this.game?.controls(player.playerId).find((control: Control) => "id" in control && control.id === controlId);
    }

    /**
     * Runs a typed answer past the filter. The text goes nowhere else until it passes.
     * @param player who.
     * @param controlId the control.
     * @param text what they typed.
     * @param limit the longest allowed.
     */
    private async checkTextAnswer(player: Player, controlId: string, text: string, limit: number): Promise<void> {
        const key: string = `${player.playerId}|${controlId}`;
        if (Date.now() - player.lastTextAnswerAt < TEXT_ANSWER_GAP_MILLISECONDS) {
            return;
        }
        player.lastTextAnswerAt = Date.now();
        const game: RunningGame | null = this.game;
        this.checking.add(key);
        this.refused.delete(key);
        this.refreshPhones();
        const classify = async (line: string): Promise<boolean> => BUDGET.spend("spark") === true && await isFitForRoom(line);
        const result: FilterResult = await filterText(text.slice(0, limit * 2), limit, classify);
        this.checking.delete(key);
        if (this.game !== game || game === null || this.answerControl(player, controlId) === undefined) {
            this.refreshPhones();
            return;
        }
        if (result.allowed === false) {
            log(this.scope(), `${player.playerId} answer filtered: ${result.category}`);
            this.refused.add(key);
            this.refreshPhones();
            return;
        }
        this.acceptAnswer(player, controlId, result.text);
    }

    /**
     * Marks an answer as given and hands it to the game.
     * @param player who.
     * @param controlId the control.
     * @param value the checked answer.
     */
    private acceptAnswer(player: Player, controlId: string, value: string | number): void {
        this.answered.add(`${player.playerId}|${controlId}`);
        const event: RoomEvent = { type: "answered", at: Date.now(), playerId: player.playerId, controlId, value };
        this.record(event);
        this.game?.event(event);
        this.refreshPhones();
    }

    /**
     * Applies what a phone's thumb did on the console.
     * @param player who.
     * @param action what.
     */
    private onNav(player: Player, action: NavAction): void {
        this.lastActivityAt = Date.now();
        if (this.game !== null && this.gamePlayerIds.has(player.playerId) === false) {
            return;
        }
        this.shell.act(player.playerId, action);
    }

    /**
     * What the console needs from this room.
     * @returns the stage.
     */
    private shellStage(): ShellStage {
        return {
            games: (): ShelfGame[] => this.games.map((game: InstalledGame) => this.shelfGame(game)),
            seats: (): Omit<Seat, "driving">[] => [...this.players.values()].map(({ playerId, name, colour, connected, holdingToTalk, phoneDown }: Player) => ({
                playerId,
                name,
                colour,
                connected,
                talking: holdingToTalk,
                recording: holdingToTalk === true && this.tapToTalk === true,
                phoneDown,
                out: this.game?.outIds().includes(playerId) === true,
                watching: this.game !== null && this.gamePlayerIds.has(playerId) === false,
            })),
            startGame: (gameId: string, pick?: string): void => { this.startGame(gameId, false, pick); },
            pickOpened: (hostLine: string): void => { this.noticeIfAnyoneIsThere(`(Game: ${hostLine} One short line.)`, WAKE_DELAY_MILLISECONDS.screen); },
            endGame: (): void => { this.endGame(); },
            gameOver: (): boolean => this.game !== null && this.game.outcome() !== null,
            focusChanged: (gameId: string | null): void => { this.scheduleRemark(gameId); },
            refused: (reason: string): void => { this.host.notice(`(Game: ${reason} Say so in a few words.)`, WAKE_DELAY_MILLISECONDS.screen); },
            driverChanged: (name: string): void => { this.noticeIfAnyoneIsThere(`(${name} has the controller now. Mention it in a few words.)`, WAKE_DELAY_MILLISECONDS.leave); },
            steppedOut: (): boolean => this.steppedOut,
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
     * Records a pause or resume from the phone menu.
     * @param paused true to pause.
     */
    private setPaused(paused: boolean): void {
        this.menuPaused = paused;
        this.applyPause();
    }

    /**
     * Passes something to the host, unless the game is waiting for an empty table.
     * @param line the note.
     * @param delayMilliseconds how long the host waits before acting on it.
     */
    private noticeIfAnyoneIsThere(line: string, delayMilliseconds: number): void {
        if (this.steppedOut === true) {
            return;
        }
        this.host.notice(line, delayMilliseconds);
    }

    /** Makes the game wait once every seat has been gone a moment, and carries on as soon as one is back. */
    private checkSteppedOut(): void {
        const seats: Player[] = [...this.gamePlayerIds].flatMap((playerId: string) => this.players.get(playerId) ?? []);
        const allGone: boolean = this.game !== null && this.game.outcome() === null && seats.length > 0 && seats.every((seat: Player) => seat.connected === false);
        if (allGone === true) {
            if (this.steppedOut === false && this.stepOutTimer === null) {
                this.stepOutTimer = setTimeout(() => {
                    this.stepOutTimer = null;
                    this.setSteppedOut(true);
                }, STEP_OUT_AFTER_MILLISECONDS);
            }
            return;
        }
        if (this.stepOutTimer !== null) {
            clearTimeout(this.stepOutTimer);
            this.stepOutTimer = null;
        }
        this.setSteppedOut(false);
    }

    /**
     * Records whether the table is empty and tells the room.
     * @param steppedOut true when every seat is gone.
     */
    private setSteppedOut(steppedOut: boolean): void {
        if (this.steppedOut === steppedOut) {
            return;
        }
        this.steppedOut = steppedOut;
        log(this.scope(), steppedOut === true ? "everyone stepped out" : "the game has stopped waiting");
        this.applyPause();
        this.broadcastShell();
        this.refreshPhones();
    }

    /** Pauses or resumes for real: the host stops, timers hold, and phones go quiet. */
    private applyPause(): void {
        const paused: boolean = this.menuPaused === true || this.steppedOut === true;
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
        return { id, name, pitch: game.pitch, howToPlay: game.howToPlay, players, art: game.art, pauseActions: game.pauseActions, startPick: game.startPick ?? null, startCard: game.startCard ?? null, blocked };
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
        const holding: boolean = [...this.players.values()].some((player: Player) => player.holdingToTalk === true);
        const talking: boolean = this.hostThinking === true || this.voice.isBusy() === true || holding === true;
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
        log(this.scope(), `remarked on ${gameId}`);
        this.host.remark(line.text);
        this.caption = { speaker: this.host.persona.name, text: line.text, final: true };
        this.broadcastScene();
        this.voice.sayRecorded(line.pcm);
    }

    /** Records every game's remarks in the host's voice. */
    private async renderRemarks(): Promise<void> {
        const persona: HostPersona = this.host.persona;
        for (const game of this.games) {
            const lines: { text: string; pcm: Uint8Array }[] = [];
            for (const text of game.remarks) {
                const style: string = `${persona.style} Muttered aside, half to yourself.`;
                const pcm: Uint8Array | null = await recordedLine(`${persona.voice}|${style}|${text}`, () => this.voice.render(text, persona.voice, style));
                if (pcm === null) {
                    return;
                }
                lines.push({ text, pcm });
            }
            this.remarks.set(game.manifest.id, lines);
        }
        log(this.scope(), "recorded remarks");
    }

    /**
     * Starts a game, if it's installed and the room has the right number of players.
     * @param gameId the game's id or name, in any case.
     * @param replay true when someone asked to play again, which the gap between starts doesn't apply to.
     */
    private startGame(gameId: string, replay: boolean = false, pick?: string): void {
        const wanted: string = gameId.trim().toLowerCase();
        const matches = (game: InstalledGame): boolean => game.manifest.id.toLowerCase() === wanted || game.manifest.name.toLowerCase() === wanted;
        const installed: InstalledGame | undefined = this.games.find(matches);
        if (installed === undefined || this.game !== null) {
            log(this.scope(), "couldn't start a game by that name");
            return;
        }
        const count: number = this.players.size;
        if (count < installed.manifest.minPlayers || count > installed.manifest.maxPlayers) {
            const { name, minPlayers, maxPlayers }: CartridgeManifest = installed.manifest;
            this.host.notice(`(Game: ${name} needs ${minPlayers} to ${maxPlayers} players and there are ${count}.)`, WAKE_DELAY_MILLISECONDS.screen);
            return;
        }
        if (replay === false && Date.now() - this.lastGameStartAt < GAME_START_GAP_MILLISECONDS) {
            return;
        }
        this.lastGameStartAt = Date.now();
        this.gamePlayerIds = new Set(this.players.keys());
        log(this.scope(), `starting ${installed.manifest.id} with ${count}`);
        this.caption = null;
        const chosen: string | undefined = pick ?? (replay === true ? this.lastPicks.get(installed.manifest.id) : undefined);
        if (chosen !== undefined) {
            this.lastPicks.set(installed.manifest.id, chosen);
        }
        this.game = installed.create(this.gameStage(), chosen);
        this.lastActivityAt = Date.now();
        this.lastLullAt = 0;
        this.lullsThisGame = 0;
        this.game.start([...this.players.values()].map((player: Player) => ({ playerId: player.playerId, name: player.name })));
        this.gameDecided = false;
        this.shell.gameStarted(installed.manifest.id);
        const opening: string = `(Game: ${installed.manifest.name} has just started, so this is for you. Say something out loud now, and do what "This moment" says. Don't stay quiet.)`;
        this.host.notice(opening, WAKE_DELAY_MILLISECONDS.screen);
        this.broadcastScene();
    }

    /** Ends the running game and returns everyone to the shelf. */
    private endGame(): void {
        if (this.game === null) {
            return;
        }
        log(this.scope(), `ended ${this.game.manifest.id}`);
        this.game.stop();
        this.game = null;
        this.answered.clear();
        this.checking.clear();
        this.refused.clear();
        this.caption = null;
        this.shell.gameEnded();
        const waiting: InstalledGame | null = this.waitingInstall;
        this.waitingInstall = null;
        if (waiting !== null) {
            this.install(waiting);
        }
        this.checkSteppedOut();
        this.broadcastScene();
    }

    /**
     * What a game may ask of this room.
     * @returns the stage.
     */
    private gameStage(): GameStage {
        return {
            tellHost: (line: string): void => { this.noticeIfAnyoneIsThere(line, WAKE_DELAY_MILLISECONDS.screen); },
            changed: (): void => {
                this.broadcastScene();
                if (this.gameDecided === false && this.game?.outcome() !== null) {
                    this.gameDecided = true;
                    this.shell.gameDecided();
                    this.checkSteppedOut();
                }
                this.refreshPhones();
            },
            requestContent: (prompt: string, grounding?: ContentGrounding): void => { this.writeContent(prompt, grounding); },
            requestMerge: (id: string, question: string, answers: string[]): void => { void this.mergeForGame(id, question, answers); },
            requestDrawing: (id: string, prompt: string): void => { this.draw(id, prompt); },
            record: (event: RoomEvent): void => {
                this.record(event);
                if (event.type === "phaseChanged") {
                    this.logMoment(`phase ${event.phaseId}`);
                }
            },
        };
    }

    /**
     * Merges answers for the running game. Merging can't fail: an outage only means fewer merges.
     * @param id the game's id for this request.
     * @param question what was asked.
     * @param answers the answers.
     */
    private async mergeForGame(id: string, question: string, answers: string[]): Promise<void> {
        const game: RunningGame | null = this.game;
        const groups = await mergeAnswers(question, answers);
        if (this.game === game) {
            game?.event({ type: "answersMerged", at: Date.now(), id, groups });
        }
    }

    /**
     * Has the host's model write content for the running game. Failure comes back as empty
     * text, and the game falls back on its own content.
     * @param prompt what to write.
     * @param grounding set to try web search first, with the plain writing running beside it.
     */
    private writeContent(prompt: string, grounding?: ContentGrounding): void {
        const game: RunningGame | null = this.game;
        if (BUDGET.spend("spark") === false) {
            game?.event({ type: "contentReady", at: Date.now(), text: "" });
            return;
        }
        const startedAt: number = Date.now();
        const stopWriting: AbortController = new AbortController();
        this.contentBeingWritten += 1;
        this.broadcastHostState();
        const collect = async (): Promise<string> => {
            let text: string = "";
            for await (const delta of streamSpark([{ role: "system", content: CONTENT_SYSTEM }, { role: "user", content: prompt }], { maxTokens: CONTENT_TOKEN_LIMIT, signal: AbortSignal.any([stopWriting.signal, AbortSignal.timeout(CONTENT_TIME_LIMIT_MILLISECONDS)]) })) {
                text += delta;
            }
            return text;
        };
        const written: Promise<string> = collect().catch((error: unknown) => {
            if (stopWriting.signal.aborted === false) {
                log(this.scope(), `content failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            return "";
        });
        const content: Promise<SearchedText> = grounding === undefined || WEB_SEARCH_ON === false || BUDGET.spend("spark") === false
            ? written.then((text: string) => ({ text, sources: [] }))
            : this.groundOr(prompt, grounding, written, stopWriting);
        content.then(({ text, sources }: SearchedText) => {
            this.contentBeingWritten -= 1;
            this.broadcastHostState();
            log(this.scope(), `content ready in ${Date.now() - startedAt} ms`);
            if (this.game === game) {
                game?.event({ type: "contentReady", at: Date.now(), text, ...(sources.length > 0 ? { sources } : {}) });
            }
        }).catch((error: unknown) => { log(this.scope(), `content not applied: ${error instanceof Error ? error.message : String(error)}`); });
    }

    /**
     * Waits for a web search, and falls back on the plain writing already under way if it fails.
     * A room asking for the same thing twice searches again, so a replay isn't the same quiz.
     * @param prompt what to write.
     * @param grounding how the game judges and keeps the reply.
     * @param written the plain writing.
     * @param stopWriting stops the plain writing once the search has won.
     * @returns the content.
     */
    private async groundOr(prompt: string, grounding: ContentGrounding, written: Promise<string>, stopWriting: AbortController): Promise<SearchedText> {
        const asked: string = prompt.toLowerCase();
        const mayReuse: boolean = this.groundedPrompts.has(asked) === false;
        this.groundedPrompts.add(asked);
        try {
            const reply: SearchedText = await groundedContent(CONTENT_SYSTEM, prompt, grounding, mayReuse);
            stopWriting.abort();
            log(this.scope(), `content grounded, ${reply.sources.length} pages`);
            return reply;
        } catch (error: unknown) {
            log(this.scope(), `grounding skipped: ${error instanceof Error ? error.message : String(error)}`);
            return { text: await written, sources: [] };
        }
    }

    /**
     * Draws a picture for the running game and tells it where to find the result. A failed
     * drawing is only logged; every game has to look fine without its pictures.
     * @param id the game's name for the picture.
     * @param prompt what to draw.
     */
    private draw(id: string, prompt: string): void {
        if (DRAWING_ON === false || this.drawingsAsked >= MAX_DRAWINGS || BUDGET.spend("image") === false) {
            return;
        }
        this.drawingsAsked += 1;
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
        this.onPresence(player, true);
        player.holdingToTalk = false;
        player.speaking = false;
        player.transcribe?.abort();
        player.standby?.abort();
        player.standby = null;
        this.clearStandbyTimer(player);
        const grace: number = this.game !== null && this.game.outcome() === null ? GAME_REJOIN_GRACE_MILLISECONDS : REJOIN_GRACE_MILLISECONDS;
        log(this.scope(), `${player.playerId} disconnected (code ${code}); holding seat ${grace / 1000} s`);
        this.broadcastScene();
        this.broadcastShell();
        this.refreshPhones();
        player.leaveTimer = setTimeout(() => { this.removePlayer(player); }, grace);
        this.checkSteppedOut();
    }

    /**
     * Gives a player their seat up for good and tells the room.
     * @param player the player who is leaving.
     */
    private removePlayer(player: Player): void {
        if (player.phoneDownTimer !== null) {
            clearTimeout(player.phoneDownTimer);
            player.phoneDownTimer = null;
        }
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
        log(this.scope(), `${player.playerId} left`);
        // With no seats left nobody could ever play on, because seats are fixed when a game starts.
        if ([...this.gamePlayerIds].some((playerId: string) => this.players.has(playerId)) === false) {
            this.endGame();
        }
        this.checkSteppedOut();
        if (this.players.size > 0) {
            this.noticeIfAnyoneIsThere(`(${player.name} left the room)`, WAKE_DELAY_MILLISECONDS.leave);
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
        const wanted: string = cleanName(rawName);
        if (wanted === "" || this.freeName(wanted, player.playerId) === player.name) {
            return;
        }
        if (this.game !== null) {
            this.setHint(player, "You can change your name after the game.");
            return;
        }
        if (this.nicknameRefused(wanted) === true) {
            this.setHint(player, "That name won't work. Try another.");
            return;
        }
        if (TEXT_ONLY === true) {
            this.applyRename(player, wanted);
            return;
        }
        void nicknameIsFit(wanted).then((fit: boolean) => {
            if (this.players.get(player.playerId) !== player || this.game !== null) {
                return;
            }
            if (fit === false) {
                this.setHint(player, "That name won't work. Try another.");
                return;
            }
            this.applyRename(player, wanted);
        });
    }

    /**
     * Gives a player the checked name they asked for and tells the table.
     * @param player who.
     * @param wanted the name.
     */
    private applyRename(player: Player, wanted: string): void {
        const name: string = this.freeName(wanted, player.playerId);
        const previous: string = player.name;
        player.name = name;
        log(this.scope(), `${player.playerId} changed their name`);
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
        this.broadcastShell();
        if (down === true) {
            this.game?.event({ type: "speechStarted", at: Date.now(), playerId: player.playerId });
            this.startPress(player);
            return;
        }
        this.finishPress(player);
    }

    /**
     * Whether the TV's voice could be in a phone's mic right now.
     * @returns true while the host speaks and for a moment after.
     */
    private hostAudible(): boolean {
        return this.hostSpeaking === true || Date.now() < this.hostAudioEndsAt;
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
        player.overlapMilliseconds = 0;
        this.logMoment(`press ${player.playerId}`);
        this.lastActivityAt = Date.now();
        player.partial = "";
        // The phone still has the last press's words until it's told otherwise.
        this.sendToPhone(player, { type: "view", view: this.phoneView(player) });
        this.setHint(player, "");
        this.cancelAcknowledgement();
        if (this.hostSpeaking === true || this.hostThinking === true) {
            log(this.scope(), `${player.playerId} cut in`);
        }
        this.host.interrupt(this.hostSpeaking);
        const session: TranscribeSession = player.standby ?? this.openTranscribe(player, "PUSH_TO_TALK");
        player.standby = null;
        this.clearStandbyTimer(player);
        player.transcribe = session;
        player.awaitingFinal.add(session);
        player.lastPressAt = Date.now();
        setTimeout(() => {
            if (player.transcribe === session) {
                player.holdingToTalk = false;
                this.broadcastShell();
                this.finishPress(player);
            }
        }, PRESS_LIMIT_MILLISECONDS).unref();
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
        if (player.overlapMilliseconds > 0) {
            log(this.scope(), `${player.playerId} press overlapped host audio by ${Math.round(player.overlapMilliseconds)} ms${this.tapToTalk === true ? ", dropped" : ""}`);
        }
        player.talkMilliseconds += Math.max(0, player.releasedAt - player.lastPressAt);
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
        const idle: boolean = Date.now() - player.lastPressAt > STANDBY_IDLE_MILLISECONDS;
        if (TEXT_ONLY === true || player.connected === false || player.standby !== null || idle === true) {
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
            onError: (message: string): void => { log(this.scope(), `transcribe error for ${player.playerId}: ${message}`); },
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
                    log(this.scope(), `lost a press from ${player.playerId}`);
                    this.onNotHeard(player);
                }
            },
        });
        session.open().catch((error: unknown) => {
            log(this.scope(), `transcribe open failed for ${player.playerId}: ${error instanceof Error ? error.message : String(error)}`);
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
        if (this.hostAudible() === true) {
            player.overlapMilliseconds += frame.length / PHONE_AUDIO_BYTES_PER_MILLISECOND;
            // Tap rooms keep the TV's voice out of what's transcribed; the transcript has no word timings to trim later.
            // Silence goes in its place, as the speech service closes a session that falls behind real time.
            if (this.tapToTalk === true) {
                player.transcribe.sendFrame(new Uint8Array(frame.length));
                return;
            }
        }
        player.transcribe.sendFrame(new Uint8Array(frame));
        if (Date.now() - this.lastMicLevelAt >= MIC_LEVEL_GAP_MILLISECONDS) {
            this.lastMicLevelAt = Date.now();
            this.broadcastToScreens({ type: "micLevel", level: frameLevel(frame) });
        }
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
        log(this.scope(), said === "" ? `heard nothing from ${player.playerId}${sinceRelease}` : `heard ${player.playerId}${sinceRelease}`);
        if (said === "") {
            this.record({ type: "speechEnded", at: Date.now(), playerId: player.playerId, text: said });
            this.onNotHeard(player);
            return;
        }
        this.logMoment(`heard ${player.playerId}`);
        this.onHeard(player, said);
        if (commandByKeywords(said) === null) {
            this.scheduleFiller(player, said);
        }
    }

    /**
     * Takes in something a player said: the screen shows it, the game hears it, the host reacts.
     * @param player who spoke.
     * @param said their words.
     */
    private onHeard(player: Player, heard: string): void {
        const said: string = heard.slice(0, MAX_HEARD_CHARACTERS);
        this.lastActivityAt = Date.now();
        this.lastSpeakerId = player.playerId;
        this.caption = { speaker: player.name, text: said, final: true };
        this.broadcastScene();
        const sure: VoiceCommand | null = commandByKeywords(said);
        if (sure !== null) {
            if (this.runCommand(player, sure) === false) {
                this.passToGame(player, said);
            }
            return;
        }
        if (this.livelyRoom === false && this.tapToTalk === false) {
            this.passToGame(player, said);
            return;
        }
        void voiceCommand(said, true).then((decision) => {
            if (decision.value !== null && this.runCommand(player, decision.value) === true) {
                this.cancelAcknowledgement();
                return;
            }
            this.passToGame(player, said);
        });
    }

    /**
     * Treats a press as talk: the game hears it and the host may answer.
     * @param player who spoke.
     * @param said their words.
     */
    private passToGame(player: Player, said: string): void {
        const event: RoomEvent = { type: "speechEnded", at: Date.now(), playerId: player.playerId, text: said };
        this.record(event);
        this.game?.event(event);
        this.host.notice(`${player.name}: ${said}`, WAKE_DELAY_MILLISECONDS.speech);
    }

    /**
     * Does what a voice command says, if it means anything right now, and has the host narrate what
     * really happened. Restarting, ending or changing the topic of a game in progress waits for the same player to say it again.
     * @param player who said it.
     * @param command the command.
     * @returns false when it doesn't apply, so the words are ordinary talk.
     */
    private runCommand(player: Player, command: VoiceCommand): boolean {
        log(this.scope(), `${player.playerId} voice command: ${command}`);
        const game: RunningGame | null = this.game;
        const decided: boolean = game?.outcome() !== null && game?.outcome() !== undefined;
        if (command === "repeat") {
            if (this.lastSpoken === null) {
                return false;
            }
            this.hostTurn = { text: "" };
            this.say(this.lastSpoken.text, this.lastSpoken.style);
            return true;
        }
        if (game === null || this.gamePlayerIds.has(player.playerId) === false) {
            return false;
        }
        if (command === "whoseTurn") {
            const turn: string = this.turnBrief();
            if (turn !== "") {
                this.host.notice(`(Game: ${player.name} asked whose turn it is. ${turn} Tell them in a few words.)`, WAKE_DELAY_MILLISECONDS.speech);
            }
            return turn !== "";
        }
        const asksForEveryone: boolean = command === "pause" || (decided === false && (command === "end" || command === "restart"));
        if (asksForEveryone === true && this.shell.claimForGame(player.playerId) === false) {
            this.host.notice(`(Game: ${player.name} asked to ${command} the game, but ${this.shell.driverName()} has the controller and decides that for everyone. Tell them in a few words, and that they can leave for themselves from their menu.)`, WAKE_DELAY_MILLISECONDS.speech);
            return true;
        }
        if (command === "pause") {
            return this.shell.pauseGame(player.playerId);
        }
        const actionId: string | undefined = { giveUp: "giveup", skip: "skip", changeTopic: "changeTopic" }[command as string];
        if (actionId !== undefined) {
            if (decided === true || game.hasAction(player.playerId, actionId) === false) {
                return false;
            }
            if (DESTRUCTIVE_COMMANDS.includes(command) === true && this.confirmed(player, command) === false) {
                this.host.notice(`(Game: ${player.name} asked to change the topic. Nothing has changed yet. Ask them to say it again if they mean it, in a few words.)`, WAKE_DELAY_MILLISECONDS.speech);
                return true;
            }
            game.input(player.playerId, actionId);
            this.refreshPhones();
            return true;
        }
        if (decided === false && DESTRUCTIVE_COMMANDS.includes(command) === true && this.confirmed(player, command) === false) {
            this.host.notice(`(Game: ${player.name} asked to ${command === "restart" ? "restart" : "end"} the game. Nothing has changed yet. Ask them to say it again if they mean it, in a few words.)`, WAKE_DELAY_MILLISECONDS.speech);
            return true;
        }
        const gameId: string = game.manifest.id;
        this.pendingCommand = null;
        this.endGame();
        if (command === "restart") {
            this.startGame(gameId, true);
            return true;
        }
        this.host.notice(`(Game: ${player.name} ended the game. Everyone is back at the shelf of games. Say so in a few words.)`, WAKE_DELAY_MILLISECONDS.speech);
        return true;
    }

    /**
     * Notes a request that needs saying twice.
     * @param player who said it.
     * @param command the command.
     * @returns true when this is the second time, from the same player, in time.
     */
    private confirmed(player: Player, command: VoiceCommand): boolean {
        const pending = this.pendingCommand;
        const again: boolean = pending?.playerId === player.playerId && pending.command === command && Date.now() - pending.at <= COMMAND_CONFIRM_MILLISECONDS;
        this.pendingCommand = again === true ? null : { playerId: player.playerId, command, at: Date.now() };
        return again;
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
        this.sendToPhone(player, { type: "view", view: this.phoneView(player) });
    }

    /**
     * Clears the lantern's mood a moment after the host stops talking.
     * @param speaking whether the host is talking now.
     */
    private letMoodFade(speaking: boolean): void {
        if (speaking === true || this.hostMood === null) {
            return;
        }
        this.moodTimer = setTimeout(() => {
            this.moodTimer = null;
            this.hostMood = null;
            this.logMoment("mood cleared");
            this.broadcastHostState();
        }, MOOD_LINGER_MILLISECONDS);
    }

    /**
     * Lets the host speak up after a lull, rarely: only in a phase that allows it, with no phone held
     * and the voice idle, and it picks whoever has gone longest without talking to it. The host can't
     * hear the table, so it's told not to claim the room is silent, and it may still choose to say nothing.
     */
    private checkLull(): void {
        const now: number = Date.now();
        const present: Player[] = [...this.players.values()].filter((player: Player) => player.connected === true);
        const holding: boolean = present.some((player: Player) => player.holdingToTalk === true || player.speaking === true);
        const busy: boolean = this.paused === true || holding === true || this.hostThinking === true || this.voice.isBusy() === true;
        const tooSoon: boolean = now - this.lastActivityAt < LULL_MILLISECONDS || now - this.lastLullAt < LULL_GAP_MILLISECONDS;
        if (this.lively() === false || this.game?.hostMayInterject() !== true || busy === true || tooSoon === true || this.lullsThisGame >= LULL_LIMIT) {
            return;
        }
        const candidates: Player[] = present.length > 1 ? present.filter((player: Player) => player.playerId !== this.lastLullPlayerId) : present;
        const quietest: Player | undefined = [...candidates].sort((first: Player, second: Player) => first.talkMilliseconds - second.talkMilliseconds)[0];
        if (quietest === undefined) {
            return;
        }
        this.lastLullAt = now;
        this.lullsThisGame += 1;
        this.lastLullPlayerId = quietest.playerId;
        log(this.scope(), `spoke up to ${quietest.playerId} after a lull`);
        const prompt: string = [
            "(Nobody has spoken to you for a while. You can't hear the table, so they may be busy talking; don't say the room is quiet.",
            `In one short line, starting with the name ${quietest.name}, ask them one direct question about this game that they can answer out loud.`,
            "No ruling. Or reply (quiet) if it wouldn't help.)",
        ].join(" ");
        this.host.notice(prompt, WAKE_DELAY_MILLISECONDS.screen);
    }

    /**
     * Starts the reply clock as soon as someone's thumb lifts; the TV nods in the livelier host only.
     * @param player who let go.
     */
    private onReleased(player: Player): void {
        if (player.holdingToTalk === false || this.paused === true) {
            return;
        }
        this.releasedAt = Date.now();
        this.replyClockAt = this.releasedAt;
        this.lastLiftAt = this.releasedAt;
        this.logMoment(`release ${player.playerId}`);
        this.cancelAcknowledgement();
        if (this.lively() === true) {
            this.broadcastToScreens({ type: "heardYou", playerId: player.playerId });
        }
    }

    /**
     * Sets up a filler for a press now heard, in case the reply runs late.
     * @param player who spoke.
     * @param said what they said.
     */
    private scheduleFiller(player: Player, said: string): void {
        if (player.wantsReactions === false) {
            return;
        }
        const named: boolean = said.toLowerCase().includes(this.host.persona.name.toLowerCase()) === true;
        if (this.game?.hostMostlyQuiet() === true && named === false) {
            return;
        }
        const longEnough: boolean = said.split(/\s+/).length >= FILLER_MINIMUM_WORDS;
        const eligible: boolean = longEnough === true && this.filledLastTurn === false && Math.random() < FILLER_CHANCE;
        this.filledLastTurn = false;
        if (eligible === false) {
            return;
        }
        this.cancelAcknowledgement();
        const turn: number = this.fillerTurn;
        const kind: Promise<UtteranceKind> = this.livelyRoom === true || this.tapToTalk === true
            ? utteranceKind(said).then((decision) => decision.value)
            : Promise.resolve(kindByRule(said));
        void kind.then((value: UtteranceKind) => {
            this.logMoment(`kind ${value}`);
            if (turn !== this.fillerTurn || value === "noise" || value === "command") {
                return;
            }
            this.acknowledgeTimer = setTimeout(() => {
                this.acknowledgeTimer = null;
                this.playReaction(value === "question");
            }, Math.max(0, this.lastLiftAt + FILLER_AFTER_RELEASE_MILLISECONDS - Date.now()));
        });
    }

    /**
     * Plays one recorded filler, not the same as the last, if the host is working on a reply it hasn't started.
     * @param question true when the press was a question.
     */
    private playReaction(question: boolean): void {
        if (this.hostThinking === false || this.voice.isBusy() === true) {
            return;
        }
        const pool: string[] = question === true ? QUESTION_REACTIONS : NEUTRAL_REACTIONS;
        const usable = (text: string, index: number): boolean => pool.includes(text) === true && this.acknowledgements[index] !== undefined;
        const indexes: number[] = ACKNOWLEDGEMENTS.flatMap((text: string, index: number) => (usable(text, index) === true ? [index] : []));
        const fresh: number[] = indexes.filter((index: number) => this.recentAcknowledgements.at(-1) !== index);
        const index: number | undefined = fresh[Math.floor(Math.random() * fresh.length)];
        const pcm: Uint8Array | undefined = index === undefined ? undefined : this.acknowledgements[index];
        if (index === undefined || pcm === undefined) {
            return;
        }
        this.recentAcknowledgements.push(index);
        this.recentAcknowledgements.splice(0, Math.max(0, this.recentAcknowledgements.length - ACKNOWLEDGE_NO_REPEAT));
        this.filledLastTurn = true;
        this.logMoment("filler");
        this.voice.sayRecorded(pcm);
    }

    /**
     * One line on how much each person has talked, for the host's prompt only.
     * @returns the line.
     */
    public talkShare(): string {
        const present: Player[] = [...this.players.values()].filter((player: Player) => player.connected === true);
        const total: number = present.reduce((sum: number, player: Player) => sum + player.talkMilliseconds, 0);
        if (total === 0) {
            return "Nobody has talked much yet.";
        }
        return `Talk so far: ${present.map((player: Player) => `${player.name} ${Math.round((player.talkMilliseconds / total) * 100)}%`).join(", ")}.`;
    }

    /**
     * Notes that a phone has left the app or come back. Leaving only counts after a moment, so a
     * quick glance elsewhere neither flickers on the TV nor cuts anyone off; then it ends any hold.
     * @param player whose phone.
     * @param away true when it has gone.
     */
    private onPresence(player: Player, away: boolean): void {
        if (player.phoneDownTimer !== null) {
            clearTimeout(player.phoneDownTimer);
            player.phoneDownTimer = null;
        }
        if (away === true) {
            player.phoneDownTimer = setTimeout(() => {
                player.phoneDownTimer = null;
                this.onHoldToTalk(player, false);
                this.setPhoneDown(player, true);
            }, PHONE_DOWN_AFTER_MILLISECONDS);
            return;
        }
        this.setPhoneDown(player, false);
    }

    /**
     * Records whether a phone is down and tells the TV and the other phones.
     * @param player whose phone.
     * @param down true when it's down.
     */
    private setPhoneDown(player: Player, down: boolean): void {
        if (player.phoneDown === down) {
            return;
        }
        player.phoneDown = down;
        log(this.scope(), `${player.playerId} phone ${down === true ? "down" : "back"}`);
        this.broadcastShell();
        this.refreshPhones();
    }

    /** Cancels a pending acknowledgement. */
    private cancelAcknowledgement(): void {
        this.fillerTurn += 1;
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
            const style: string = `${persona.style} A quick, quiet acknowledgement, as if thinking.`;
            const pcm: Uint8Array | null = await recordedLine(`${persona.voice}|${style}|${text}`, () => this.voice.render(text, persona.voice, style));
            if (pcm === null) {
                return;
            }
            this.acknowledgements.push(pcm);
        }
        log(this.scope(), `rendered ${this.acknowledgements.length} acknowledgements`);
    }

    /**
     * Wires the host's voice to the screens and the speaking indicator.
     * @returns the output the voice writes to.
     */
    private voiceOutput(): VoiceOutput {
        return {
            lineStarted: (): void => {
                this.broadcastToScreens({ type: "audioStart", mediaType: "audio/pcm;rate=24000" });
                if (this.releasedAt !== 0) {
                    log(this.scope(), `first sound ${Date.now() - this.releasedAt} ms after release`);
                    this.releasedAt = 0;
                }
            },
            chunk: (bytes: Uint8Array): void => { this.broadcastAudio(bytes); },
            lineEnded: (): void => { this.broadcastToScreens({ type: "audioEnd" }); },
            cancelled: (): void => { this.broadcastToScreens({ type: "audioCancel" }); },
            speakingChanged: (speaking: boolean): void => {
                this.logMoment(speaking === true ? "voice on" : "voice off");
                this.hostSpeaking = speaking;
                if (speaking === false) {
                    this.hostAudioEndsAt = Date.now() + HOST_AUDIO_GUARD_MILLISECONDS;
                    setTimeout(() => { this.refreshPhones(); }, HOST_AUDIO_GUARD_MILLISECONDS).unref();
                }
                this.lastActivityAt = Date.now();
                this.broadcastHostState();
                this.letMoodFade(speaking);
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
            status = `${hostName} is talking. Hold to cut in.`;
        }
        if (player.hint !== "") {
            status = player.hint;
        }
        player.listening = this.game?.listening(player.playerId) ?? "holdToTalk";
        if (this.canTalk(player) === false) {
            status = this.paused === true ? "Paused" : "Phones are quiet for now";
        }
        return { playerName: player.name, listening: this.canTalk(player) === true ? player.listening : "muted", status, controls: this.phoneControls(player), pad: this.padFor(player), hearing: player.holdingToTalk === true ? player.partial : "", tapToTalk: this.tapToTalk, talkWaiting: this.hostAudible(), turn: this.phoneTurn(player) };
    }

    /**
     * What the game's turn means for one phone. A secret turn looks the same on every phone.
     * @param player the player.
     * @returns the turn, or null when this phone has nothing to wait for or do.
     */
    private phoneTurn(player: Player): PhoneTurn | null {
        const turn: Turn | null = this.game?.turn() ?? null;
        if (this.game?.outIds().includes(player.playerId) === true) {
            return null;
        }
        if (turn?.kind === "anyone") {
            return { yours: false, open: true, line: turn.label };
        }
        if (turn?.kind === "one") {
            return turn.playerId === player.playerId ? { yours: true, open: false, line: "Your turn" } : { yours: false, open: false, line: this.waitingLine(turn.playerId) };
        }
        if (turn?.kind !== "everyone" || turn.playerIds.includes(player.playerId) === false) {
            return null;
        }
        if (turn.doneIds.includes(player.playerId) === false) {
            return { yours: true, open: false, line: "Your turn" };
        }
        const left: string[] = turn.playerIds.filter((playerId: string) => turn.doneIds.includes(playerId) === false);
        return left.length === 1 ? { yours: false, open: false, line: this.waitingLine(left[0] ?? "") } : { yours: false, open: false, line: `Waiting for ${left.length} people` };
    }

    /**
     * Says who a phone is waiting for, and if their phone is down, so nobody waits in the dark.
     * @param playerId who.
     * @returns the line.
     */
    private waitingLine(playerId: string): string {
        const waitingFor: Player | undefined = this.players.get(playerId);
        return `Waiting for ${waitingFor?.name ?? "someone"}${waitingFor?.phoneDown === true ? ". Their phone is down." : ""}`;
    }

    /**
     * One line for the host about who's up, using what's already public.
     * @returns the line, or an empty string when no one in particular is.
     */
    private turnBrief(): string {
        const turn: Turn | null = this.game?.turn() ?? null;
        const nameOf = (playerId: string): string => this.players.get(playerId)?.name ?? "someone";
        if (turn?.kind === "one") {
            return `It's ${nameOf(turn.playerId)}'s turn.`;
        }
        if (turn?.kind !== "everyone") {
            return "";
        }
        const left: string[] = turn.playerIds.filter((playerId: string) => turn.doneIds.includes(playerId) === false);
        return left.length === 0 ? "" : `Still to go: ${left.map(nameOf).join(", ")}.`;
    }

    /**
     * How one phone's surface behaves; someone who joined mid-game just watches.
     * @param player the player.
     * @returns the pad.
     */
    private padFor(player: Player): PadView {
        const pad: PadView = this.shell.pad(player.playerId, player.colour);
        if (this.game === null || this.gamePlayerIds.has(player.playerId) === true) {
            return pad;
        }
        return { ...pad, axis: null, canDrive: false, canSelect: false, backLabel: null, watching: true };
    }

    /**
     * What a phone shows besides its touch surface: only what's private to it in the game.
     * @param player the player.
     * @returns the controls.
     */
    private phoneControls(player: Player): Control[] {
        return (this.game?.controls(player.playerId) ?? []).map((control: Control): Control => {
            if ("id" in control === false) {
                return control;
            }
            const key: string = `${player.playerId}|${control.id}`;
            if (this.answered.has(key) === true) {
                return { type: "notice", text: "Sent.", tone: "info" };
            }
            if (this.checking.has(key) === true) {
                return { type: "notice", text: "Just checking that.", tone: "info" };
            }
            return this.refused.has(key) === true ? { ...control, note: ANSWER_REFUSED_NOTE } : control;
        });
    }

    /**
     * The host indicator state for screens.
     * @returns the message.
     */
    private hostStateMessage(): RoomToScreenMessage {
        return { type: "hostState", thinking: this.hostThinking === true || this.contentBeingWritten > 0, speaking: this.hostSpeaking, hostName: this.host.persona.name, mood: this.hostMood };
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
        this.broadcastToScreens({ type: "scene", scene: this.currentScene(), joinUrl: this.joinUrl, roomCode: this.code, turn: this.game?.turn() ?? null });
        const outKey: string = (this.game?.outIds() ?? []).join(",");
        if (outKey !== this.lastOutKey) {
            this.lastOutKey = outKey;
            this.broadcastShell();
        }
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
        if (player.socket.bufferedAmount > MAX_PHONE_BUFFER_BYTES) {
            player.socket.terminate();
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

