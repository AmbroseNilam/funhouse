// What a kit is. A kind of game is written once as a kit: a reviewed cartridge that declares
// typed decisions. A blueprint names a kit, its decisions and its box. The kit owns every word
// the host is told, so nothing a creator writes reaches the host's brief; a creator chooses
// values, never prompts. This file also holds the checks every kit shares.

import type { Cartridge } from "../../shared/cartridge.ts";

/** What the shelf shows and the room needs to seat a game. */
export interface Box {
    /** The game's id on the shelf and in the host's lobby brief: letters only. */
    id: string;
    name: string;
    pitch: string;
    howToPlay: string[];
    /** Browsing remarks, recorded in the host's voice: eight words or fewer, no exclamation marks. */
    remarks: string[];
    art: string;
    minPlayers: number;
    maxPlayers: number;
    /** Vocabulary to bias transcription toward. */
    keywords: string[];
}

/** A value some viewers may not see, and who may. */
export interface HiddenValue {
    /** What it is, for a report, such as "the word". */
    label: string;
    text: string;
    /** Who may see it: "host", or player ids. Everyone else, including the TV, may not. */
    seenBy: string[];
    /**
     * When set, the value only counts as seen in a line that also says this, such as a player's
     * name beside "Plant". For values that are fine on their own but give a secret away together.
     */
    near?: string;
}

/** A running kit game, with what a rehearsal needs to check it. */
export interface KitGame<State> {
    cartridge: Cartridge<State>;
    /** What must stay hidden right now, and from whom. Empty once nothing is secret. */
    hidden(state: State): HiddenValue[];
}

/** Ruling names the room or the host reserve for themselves; a game may not use them. */
export const RESERVED_RULINGS: readonly string[] = ["start", "quit", "mood"];

/** Most words in a browsing remark. */
const REMARK_WORDS: number = 8;

/** Longest name, category or word a creator may give. */
export const SHORT_TEXT_LIMIT: number = 40;

/**
 * Checks a number is a finite whole number inside a range.
 * @param value the number.
 * @param low the least allowed.
 * @param high the most allowed.
 * @returns true when it is.
 */
export function isWholeIn(value: number, low: number, high: number): boolean {
    return Number.isInteger(value) === true && value >= low && value <= high;
}

/**
 * Checks short creator text: a name, a category, a word. Letters, digits, spaces and a little
 * punctuation, no brackets, so it can't open a ruling or an aside in a prompt.
 * @param text the text.
 * @returns true when it is acceptable.
 */
export function isShortText(text: string): boolean {
    return text.trim() !== "" && text.length <= SHORT_TEXT_LIMIT && /^[\p{L}\p{N} '’,.-]+$/u.test(text) === true;
}

/**
 * Letters only, lower case, so a hidden value is found however it is spaced or punctuated.
 * @param text any text.
 * @returns the letters and digits, lower case.
 */
export function squash(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Checks the box.
 * @param box the box.
 * @param hidden values that must never appear in a remark, such as fallback secrets.
 * @returns the problems, in plain words.
 */
export function boxProblems(box: Box, hidden: readonly string[]): string[] {
    const problems: string[] = [];
    if (/^[a-zA-Z]+$/.test(box.id) === false) {
        problems.push("The game's id must be letters only.");
    }
    if (isShortText(box.name) === false) {
        problems.push("The game needs a short name.");
    }
    if (isWholeIn(box.minPlayers, 1, 12) === false || isWholeIn(box.maxPlayers, box.minPlayers, 12) === false) {
        problems.push("The player range must be whole numbers from 1 to 12, smallest first.");
    }
    for (const remark of box.remarks) {
        if (remark.split(/\s+/).filter((word: string) => word !== "").length > REMARK_WORDS || remark.includes("!") === true) {
            problems.push(`A remark is too long or shouts: "${remark}".`);
        }
        const squashed: string = squash(remark);
        if (hidden.some((secret: string) => squash(secret).length >= 3 && squashed.includes(squash(secret)) === true) === true) {
            problems.push("A remark gives away a secret.");
        }
    }
    return problems;
}

/**
 * Checks a ruling name.
 * @param name the name.
 * @returns a problem, or null.
 */
export function rulingNameProblem(name: string): string | null {
    if (/^[a-zA-Z]+$/.test(name) === false) {
        return `Ruling "${name}" must be letters only, so the host can write it.`;
    }
    if (RESERVED_RULINGS.includes(name.toLowerCase()) === true) {
        return `Ruling "${name}" is reserved by the room.`;
    }
    return null;
}
