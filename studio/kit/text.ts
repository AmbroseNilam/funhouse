// The small parts the typing games share: reading lines the host's model wrote, checking host-written
// text before it is shown, shuffling answers so their order tells nothing, merging answers that mean
// the same, and keeping score. Pure functions over plain data, so a rehearsal can replay any of them
// from a seed. A kit that has players type answers imports these; nothing here knows one game.

import { localCategory } from "../../room/content-filter.ts";

/** Words that change nothing about what an answer means. */
const FILLER_WORDS: ReadonlySet<string> = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "is", "are", "was", "it", "its", "and", "or", "my", "your", "his", "her", "their", "our", "some", "that", "this"]);

/** Spelled-out numbers up to twenty, so "forty" and "40" merge as one answer. */
const NUMBER_WORDS: Readonly<Record<string, string>> = {
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
    eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
    thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100", thousand: "1000",
};

/** Shortest word a plural or past ending is trimmed from, so "bus" and "gas" keep their s. */
const STEM_MINIMUM_LETTERS: number = 5;

/** Words an answer needs at least this many letters in to be merged by spelling alone. */
const TYPO_MINIMUM_LETTERS: number = 6;

/** Letters of a long answer that may differ and still count as the same one typed badly. */
const TYPO_LONG_ALLOWANCE: number = 2;

/** Letters at which a longer allowance for typos begins. */
const TYPO_LONG_LETTERS: number = 12;

/**
 * Splits what the model wrote into lines, dropping numbering, bullets and quote marks.
 * @param raw the model's whole reply.
 * @returns the non-empty lines, tidied.
 */
export function linesOf(raw: string): string[] {
    return raw
        .split(/\r?\n/)
        .map((line: string) => line.replace(/^\s*(?:[-*•]|\(?\d{1,2}[.):])\s*/, "").replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim())
        .filter((line: string) => line !== "");
}

/**
 * Whether text the host's model wrote is fit to show on the TV and put in the host's brief: not
 * empty, short, free of the brackets rulings use, and clean under the same local check player
 * text gets. Blanks written as a run of underscores are allowed.
 * @param text the text.
 * @param limit the most characters allowed.
 * @returns true when it may be shown.
 */
export function isHostSafe(text: string, limit: number): boolean {
    const trimmed: string = text.trim();
    if (trimmed === "" || trimmed.length > limit || /[[\]{}<>`\p{Cc}\p{Cf}]/u.test(trimmed) === true) {
        return false;
    }
    return localCategory(trimmed.replace(/_+/g, " ")) === null;
}

/**
 * Shuffles without changing the original, so the order of answers tells nobody anything.
 * @param items what to shuffle.
 * @param random a function returning [0, 1).
 * @returns a shuffled copy.
 */
export function shuffled<Item>(items: readonly Item[], random: () => number): Item[] {
    const copy: Item[] = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const other: number = Math.floor(random() * (index + 1));
        const held: Item | undefined = copy[index];
        const swapped: Item | undefined = copy[other];
        if (held === undefined || swapped === undefined) {
            continue;
        }
        copy[index] = swapped;
        copy[other] = held;
    }
    return copy;
}

/**
 * Trims a plural or past ending, lightly, so "pickles", "boxes" and "pickle" match.
 * @param word a lower-case word.
 * @returns the word without its ending.
 */
function stemmed(word: string): string {
    if (word.length < STEM_MINIMUM_LETTERS) {
        return word;
    }
    if (word.endsWith("ies") === true) {
        return `${word.slice(0, -3)}y`;
    }
    if (/(?:[sxz]|ch|sh)es$/.test(word) === true) {
        return word.slice(0, -2);
    }
    if (word.endsWith("s") === true && word.endsWith("ss") === false) {
        return word.slice(0, -1);
    }
    for (const ending of ["ing", "ed"]) {
        if (word.endsWith(ending) === true && word.length - ending.length >= STEM_MINIMUM_LETTERS - 1) {
            return word.slice(0, word.length - ending.length);
        }
    }
    return word;
}

/**
 * An answer reduced to what it means: lower case, no accents or punctuation, no filler words,
 * numbers in digits, endings trimmed, words in order of spelling.
 * @param text an answer.
 * @returns its reduced form.
 */
export function meaningOf(text: string): string {
    const plain: string = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    const words: string[] = plain.split(/[^\p{L}\p{N}]+/u).filter((word: string) => word !== "");
    const kept: string[] = words.filter((word: string) => FILLER_WORDS.has(word) === false).map((word: string) => NUMBER_WORDS[word] ?? stemmed(word));
    return (kept.length === 0 ? words : kept).sort().join(" ");
}

/**
 * How many single-letter edits turn one string into another.
 * @param first a string.
 * @param second another.
 * @returns the distance.
 */
function editDistance(first: string, second: string): number {
    let previous: number[] = Array.from({ length: second.length + 1 }, (_unused: unknown, index: number) => index);
    for (let row = 1; row <= first.length; row += 1) {
        const current: number[] = [row];
        for (let column = 1; column <= second.length; column += 1) {
            const cost: number = first[row - 1] === second[column - 1] ? 0 : 1;
            current.push(Math.min((current[column - 1] ?? 0) + 1, (previous[column] ?? 0) + 1, (previous[column - 1] ?? 0) + cost));
        }
        previous = current;
    }
    return previous[second.length] ?? 0;
}

/**
 * Whether two answers say the same thing, judged by spelling alone: the same words in any order
 * once filler, endings and number words are set aside, or the same thing typed with a slip.
 * @param first an answer.
 * @param second another.
 * @returns true when they should count as one answer.
 */
export function sameMeaning(first: string, second: string): boolean {
    const left: string = meaningOf(first);
    const right: string = meaningOf(second);
    if (left === "" || right === "") {
        return false;
    }
    if (left === right) {
        return true;
    }
    const shortest: number = Math.min(left.length, right.length);
    if (shortest < TYPO_MINIMUM_LETTERS || /\d/.test(left + right) === true) {
        return false;
    }
    return editDistance(left, right) <= (shortest >= TYPO_LONG_LETTERS ? TYPO_LONG_ALLOWANCE : 1);
}

/** Entries grouped as one answer, in the order they first appeared. */
export interface Merged<Entry> {
    /** The entry whose wording is shown. */
    shown: Entry;
    /** Everyone's entry that counts toward it, the shown one first. */
    members: Entry[];
}

/**
 * Groups entries whose answers mean the same, by spelling alone.
 * @param entries the entries, in the order they were given.
 * @param textOf reads an entry's answer.
 * @returns the groups.
 */
export function mergeBySpelling<Entry>(entries: readonly Entry[], textOf: (entry: Entry) => string): Merged<Entry>[] {
    const groups: Merged<Entry>[] = [];
    for (const entry of entries) {
        const home: Merged<Entry> | undefined = groups.find((group: Merged<Entry>) => group.members.some((member: Entry) => sameMeaning(textOf(member), textOf(entry)) === true));
        if (home === undefined) {
            groups.push({ shown: entry, members: [entry] });
            continue;
        }
        home.members.push(entry);
    }
    return groups;
}

/**
 * Reads the groups the model found among numbered answers. Each line lists the numbers that mean
 * the same thing, such as "2, 5". Anything that isn't a line of two or more known numbers is
 * ignored, and a number used twice stays with the first group that named it.
 * @param raw the model's reply.
 * @param count how many answers were numbered, from 1.
 * @returns groups of zero-based indexes, each of two or more, in the order named.
 */
export function readGroups(raw: string, count: number): number[][] {
    const used: Set<number> = new Set();
    const groups: number[][] = [];
    for (const line of raw.split(/\r?\n/)) {
        const listed: string = line.replace(/\band\b/gi, ",");
        if (/^[\s\d,;&]+$/.test(listed) === false) {
            continue;
        }
        const numbers: number[] = [...new Set((listed.match(/\d+/g) ?? []).map(Number))].filter((number: number) => number >= 1 && number <= count && used.has(number) === false);
        if (numbers.length < 2) {
            continue;
        }
        for (const number of numbers) {
            used.add(number);
        }
        groups.push(numbers.map((number: number) => number - 1));
    }
    return groups;
}

/**
 * Adds points to a score table without changing it.
 * @param scores the table, by player id.
 * @param playerId who earns.
 * @param points how many.
 * @returns the new table.
 */
export function withPoints(scores: Readonly<Record<string, number>>, playerId: string, points: number): Record<string, number> {
    return { ...scores, [playerId]: (scores[playerId] ?? 0) + points };
}

/**
 * Makes an answer fit for a line on a phone or the TV: one line, single spaces, at most a length.
 * @param text any text.
 * @param limit the most characters.
 * @returns the tidied text.
 */
export function oneLine(text: string, limit: number): string {
    return text.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, limit).trim();
}

/**
 * Quotes a player's words for the host, so they read as words said, never as instructions. Quote
 * marks inside are softened so a player can't close the quote early.
 * @param text a player's answer, already through the room's filter.
 * @returns the answer in curly quotes.
 */
export function quoted(text: string): string {
    return `“${text.replace(/["“”]/g, "'")}”`;
}
