// The scene language: what the public screen can show, as a vocabulary of blocks the host
// and the cartridge compose. A renderer on the screen draws it. Keeping this a small
// vocabulary is what lets an authoring agent use it reliably and lets Muse Spark emit it as
// structured output.

/** Named style intents the renderer maps to its own tokens. The host picks by name. */
export type Mood = "neutral" | "lobby" | "night" | "dawn" | "tense" | "victory" | "defeat";

/** How a scene replaces the previous one. */
export type Transition = "cut" | "fade" | "slide" | "dim";

/** One visual block on the screen. */
export type SceneBlock =
    | { type: "title"; text: string; kicker?: string }
    | { type: "text"; text: string; emphasis?: "normal" | "large" | "whisper" }
    | { type: "image"; src: string; caption?: string }
    | { type: "roster"; players: RosterEntry[] }
    | { type: "timer"; seconds: number; label?: string; running: boolean }
    | { type: "tally"; title: string; rows: TallyRow[] }
    | { type: "progress"; label: string; current: number; max: number }
    | { type: "caption"; speaker: string; text: string; final: boolean };

/** A player as the screen shows them. */
export interface RosterEntry {
    playerId: string;
    name: string;
    /** True while this player's phone is sending speech. */
    speaking: boolean;
    /** True when the room has muted or gated this phone. */
    muted: boolean;
    /** Optional public badge such as "eliminated". */
    badge?: string;
}

/** One row of a vote tally or scoreboard. */
export interface TallyRow {
    label: string;
    count: number;
    highlight?: boolean;
}

/** A complete screen. */
export interface Scene {
    mood: Mood;
    transition: Transition;
    blocks: SceneBlock[];
    /** A picture to show behind everything, dimmed. */
    backdrop?: string;
}

/** The screen before any game starts. */
export function lobbyScene(joinUrl: string, roomCode: string, players: RosterEntry[]): Scene {
    return {
        mood: "lobby",
        transition: "fade",
        blocks: [
            { type: "title", text: "Game Room", kicker: `Room ${roomCode}` },
            { type: "text", text: `Scan to join, or open ${joinUrl}` },
            { type: "roster", players },
        ],
    };
}
