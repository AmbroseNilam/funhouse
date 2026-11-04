// The cartridge contract: what a game is to Funhouse. The rules core is code the room runs
// in isolation. The manifest is declarative: the host's brief, per-phase listening modes and
// controls, and variant options collected in the lobby. The room never lets the host override
// the rules; the host narrates whatever the rules say is true.

import type { Turn } from "./turn.ts";
import type { Control, ListeningMode } from "./controls.ts";
import type { Scene } from "./scene.ts";
import type { RoomEvent } from "./timeline.ts";
import type { Scope, ScopedFact } from "./visibility.ts";

/** A player as the cartridge sees them. */
export interface CartridgePlayer {
    playerId: string;
    name: string;
}

/** An option the lobby offers before the game starts. */
export interface VariantOption {
    id: string;
    label: string;
    description: string;
    defaultOn: boolean;
}

/** Listening and host behavior for one phase. */
export interface PhaseSpec {
    id: string;
    /** What the host should do in this phase, in plain words. */
    hostBrief: string;
    /** Listening mode per role id; "*" is the default for roles not listed. */
    listening: Record<string, ListeningMode>;
    /** Whether the host may speak unprompted during this phase. */
    hostMayInterject: boolean;
    /** True when players mostly talk to each other, so the host only reacts when named. */
    hostMostlyQuiet?: boolean;
    /** Seconds of silence before the host is woken; 0 disables the silence trigger. */
    silenceSeconds: number;
    /**
     * Rulings the host may make in this phase, by name, each with when to make it. The host
     * judges what it hears, such as whether a guess is right; the rules decide what follows.
     */
    hostRulings?: Record<string, string>;
}

/** Declarative half of a cartridge. */
export interface CartridgeManifest {
    id: string;
    name: string;
    minPlayers: number;
    maxPlayers: number;
    /** Who the host is in this game and what it must never reveal. */
    hostBrief: string;
    /** Vocabulary the host should bias transcription toward. */
    keywords: string[];
    variants: VariantOption[];
    phases: PhaseSpec[];
}

/** An action a player may take, offered through phone controls. */
export interface LegalAction {
    actionId: string;
    label: string;
}

/** How a game wants web search used for content it asks for. */
export interface ContentGrounding {
    /** Whether a searched reply is good enough to use; if not, the game gets what the model writes without searching. */
    usable: (text: string) => boolean;
    /** True when the same request can get the same reply for a while, such as a quiz on one topic. */
    cacheable: boolean;
}

/** Result of applying an action or event: the new state plus facts to record. */
export interface Step<State> {
    state: State;
    facts: ScopedFact[];
    /** Phase to enter, when the step changes phase. */
    nextPhaseId?: string;
    /** Timers to start, in seconds, keyed by timer id. */
    timers?: Record<string, number>;
    /** Asks the host's model to write content, such as a secret; it returns as contentReady. */
    contentRequest?: string;
    /** Asks that contentRequest be tried with web search first; without it the model only writes from memory. */
    contentGrounding?: ContentGrounding;
    /**
     * Asks which answers say the same thing, such as "the moon" and "luna". It returns as an
     * answersMerged event with this id. Only filtered text, and no player names.
     */
    mergeRequest?: { id: string; question: string; answers: string[] };
    /** Asks the fast model for one setup follow-up. It returns as followUpReady, with empty text if it failed. */
    followUpRequest?: { id: string; prompt: string };
    /** Pictures to draw ahead of need; each returns as drawingReady, or never if drawing fails. */
    draws?: { id: string; prompt: string }[];
}

/** The executable half of a cartridge. Pure functions over an immutable state. */
export interface Cartridge<State> {
    manifest: CartridgeManifest;
    /** Builds the initial state once the lobby has players and variant choices. */
    init(players: CartridgePlayer[], variants: Record<string, boolean>): Step<State>;
    /** The current phase id. */
    phaseOf(state: State): string;
    /** Who is out of the game but still at the table. Pure. Left out means nobody. */
    outOf?(state: State): string[];
    /** Whose turn it is. Pure, and it never changes the rules. Left out, or returning null, shows no turn at all. */
    turn?(state: State): Turn | null;
    /** The role id of a player, used to look up listening modes. */
    roleOf(state: State, playerId: string): string;
    /** Group ids a player belongs to, used for group-scoped facts. */
    groupsOf(state: State, playerId: string): ReadonlySet<string>;
    /** Actions a player may take right now. */
    legalActions(state: State, playerId: string): LegalAction[];
    /** Applies one player action, an option id or typed text; must reject illegal ones by returning the same state with no facts. */
    apply(state: State, playerId: string, actionId: string): Step<State>;
    /** Reacts to a room event such as a timer or a host request to advance. */
    onEvent(state: State, event: RoomEvent): Step<State>;
    /** What the public screen may show. */
    publicScene(state: State): Scene;
    /** What one phone may show. */
    privateControls(state: State, playerId: string): Control[];
    /** Facts the host may narrate right now, filtered by the scope it is speaking into. */
    hostFacts(state: State, scope: Scope): ScopedFact[];
    /** Winner description once the game is over, else null. */
    outcome(state: State): string | null;
}
