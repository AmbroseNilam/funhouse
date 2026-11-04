// The console around the games: the shelf, a game's page, the players, and the pause menu. The
// room owns this state and both stages draw it, so every phone and the TV stay in step. A phone
// only ever says which way the thumb went.

/** Which screen the TV is on. */
export type ShellScreen = "home" | "game" | "pick" | "setup" | "startCard" | "players" | "addPlayer" | "addGuest" | "guestLine" | "agentOnPhone" | "play" | "pause" | "howTo" | "confirmEnd";

/** Which way a phone's swipes move the highlight, if at all. */
export type NavAxis = "x" | "y" | null;

/**
 * A choice to make before a game begins. Any game can have one: the TV shows the choices as boxes, a
 * phone moves through them like the shelf, and the first is ready if nobody chooses in time, unless
 * it waits. A follow-up asks another question on the same screen, and the answers reach the game
 * joined with START_PICK_SEPARATOR.
 */
export interface StartPick {
    /** The heading on the TV. */
    prompt: string;
    /** What the host is asked to say as it opens. */
    hostLine: string;
    choices: { id: string; label: string }[];
    /** True when it waits as long as it takes for someone to choose. */
    waits?: boolean;
    /** The next question, if there's another. */
    then?: StartPick;
}

/** Joins the answers of a choice with follow-ups, in order. */
export const START_PICK_SEPARATOR: string = "|";

/**
 * Finds a question in a choice with follow-ups.
 * @param pick the first question.
 * @param step how many questions along.
 * @returns the question, or null past the last.
 */
export function startPickAt(pick: StartPick | null | undefined, step: number): StartPick | null {
    if (pick === null || pick === undefined) {
        return null;
    }
    return step <= 0 ? pick : startPickAt(pick.then, step - 1);
}

/** One game box on the shelf. */
export interface ShelfGame {
    id: string;
    name: string;
    pitch: string;
    howToPlay: string[];
    players: string;
    art: string;
    /** Actions that affect everyone, offered on the pause menu so one stray tap can't end a game. */
    pauseActions: { id: string; label: string }[];
    /** Why it can't start right now, or null when it can. */
    blocked: string | null;
    /** True when AI guests may sit in on it. */
    guestsWelcome: boolean;
    /** What to choose before it begins, or null when it just begins. */
    startPick: StartPick | null;
    /** A few short lines shown before the first round in a room, or null for none. */
    startCard: string[] | null;
}

/** A person at the table. */
export interface Seat {
    playerId: string;
    name: string;
    colour: string;
    connected: boolean;
    driving: boolean;
    /** True while they're holding to talk. */
    talking: boolean;
    /** True while a tap-to-talk recording is running, so the TV can show whose mic is live. */
    recording: boolean;
    /** True when the game has them out, though they're still at the table. */
    out: boolean;
    /** True when their phone has left the app or locked, though it may still be connected. */
    phoneDown: boolean;
    /** True when they joined after this game began, so they're only watching it. */
    watching: boolean;
    /** True for a seat a machine plays: an AI guest or someone's agent. The TV always marks it, and it never drives. */
    guest: boolean;
    /** True when that machine is someone's own agent, from outside the room. */
    agent: boolean;
}

/** Everything the TV needs to draw the console. */
export interface ShellView {
    screen: ShellScreen;
    axis: NavAxis;
    /** Which item is highlighted, in shelf or menu order. */
    focus: number;
    games: ShelfGame[];
    /** The game whose page or session is open. */
    gameId: string | null;
    /** Rows on the current screen; empty when it has none. */
    menu: string[];
    /** The question on a game's own setup screen. */
    setup: { prompt: string; kicker: string } | null;
    seats: Seat[];
    /** True once a game has been decided and is showing its result. */
    gameOver: boolean;
    /** How many questions along the choice before a game is. */
    pickStep: number;
    /** True when every seat in a running game has dropped, so the game waits for them. */
    steppedOut: boolean;
    /** Who paused the game, or an empty string when it isn't paused. */
    pausedBy: string;
}

/** What a phone needs to know to behave as a controller. */
export interface PadView {
    colour: string;
    axis: NavAxis;
    canPrevious: boolean;
    canNext: boolean;
    driving: boolean;
    driverName: string;
    /** True when nobody who's here holds the controller. */
    controllerFree: boolean;
    /** True when this person joined after the game began, so they're only watching it. */
    watching: boolean;
    /** True when this phone's swipes would count now: it's driving, or the controller is free. */
    canDrive: boolean;
    /** What the back corner does here, or null when it does nothing. */
    backLabel: string | null;
    /** True when a tap on the surface would do something. */
    canSelect: boolean;
    /** Who paused the game, or an empty string when it isn't paused. */
    pausedBy: string;
    /** True on the phone that's being asked whether to end the game for everyone. */
    confirmEnd: boolean;
    /** The lines of a how-to card before a game begins; empty when there's none on show. */
    startCard: string[];
}

/** What a phone's thumb did. */
export type NavAction =
    | { kind: "step"; delta: number }
    | { kind: "select" }
    | { kind: "choose"; index: number }
    | { kind: "back" };
