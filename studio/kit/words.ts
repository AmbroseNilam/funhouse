// Word handling shared by the word-game kits: shuffling, reading a list the host's model wrote,
// pulling one clue word and a number out of speech, and the local content check every word the
// model writes passes before a player can see it. Pure functions over plain data.

import { localCategory } from "../../room/content-filter.ts";
import { squash } from "./kit.ts";

/** The numbers a player may say as words. */
const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, to: 2, too: 2, for: 4, won: 1 };

/** Words a person says around a clue that are not the clue. */
const FILLER_WORDS: ReadonlySet<string> = new Set(["the", "a", "an", "um", "uh", "er", "erm", "my", "our", "clue", "clues", "is", "its", "it's", "it", "okay", "ok", "so", "number", "words", "word", "and", "of", "i", "say", "go", "with", "that", "s", "comma", "then", "please", "like", "just", "maybe", "oh", "yeah", "hmm", "mm", "ah", "well"]);

/** Longest word accepted for a clue or a board word. */
const PLAIN_WORD_LIMIT: number = 16;

/**
 * Shuffles a list without changing it.
 * @param items the items.
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
 * Capitalises the first letter.
 * @param word any text.
 * @returns the text with a capital first letter.
 */
export function titleCase(word: string): string {
    return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/**
 * Checks a word is one plain word: letters only, short, no spaces.
 * @param word the word.
 * @returns true when it is.
 */
export function isPlainWord(word: string): boolean {
    return word.length >= 2 && word.length <= PLAIN_WORD_LIMIT && /^\p{L}+$/u.test(word) === true;
}

/**
 * Whether a word passes the room's local content check, so a word the model wrote can be shown.
 * @param word the word.
 * @returns true when it is fit to show.
 */
export function fitForTable(word: string): boolean {
    return localCategory(word) === null;
}

/**
 * Reads a list the model wrote, one plain word per item, however it separated them.
 * @param reply the model's reply.
 * @returns the distinct plain words that pass the content check, lower case, in order.
 */
export function listedWords(reply: string): string[] {
    const seen: Set<string> = new Set();
    const words: string[] = [];
    for (const piece of reply.split(/[,;\n]+/)) {
        const word: string = piece.trim().replace(/^[\s\d.)-]+/, "").replace(/["'.!?]+$/g, "").replace(/^["']+/, "").toLowerCase();
        if (isPlainWord(word) === false || fitForTable(word) === false || seen.has(squash(word)) === true) {
            continue;
        }
        seen.add(squash(word));
        words.push(word);
    }
    return words;
}

/**
 * Finds a number in speech, as digits or as a word from one to ten.
 * @param text what was said.
 * @returns the number, or null.
 */
export function numberIn(text: string): number | null {
    const tokens: string[] = text.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, " ").split(/\s+/).filter((token: string) => token !== "");
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
        const token: string = tokens[index] ?? "";
        if (/^\d{1,2}$/.test(token) === true) {
            return Number(token);
        }
        const spoken: number | undefined = NUMBER_WORDS[token];
        if (spoken !== undefined && (token.length > 3 || index > 0)) {
            return spoken;
        }
    }
    return null;
}

/**
 * Pulls the one word out of speech that may be wrapped in fillers and a number, such as
 * "my clue is ocean, three". Number words and digits are dropped.
 * @param text what was said.
 * @returns the word, or null when there is none or more than one.
 */
export function singleWord(text: string): string | null {
    const tokens: string[] = text.toLowerCase().replace(/[^\p{L}\p{N}' -]/gu, " ").split(/\s+/).map((token: string) => token.replace(/^[-']+|[-']+$/g, "")).filter((token: string) => token !== "");
    const rest: string[] = tokens.filter((token: string) => FILLER_WORDS.has(token) === false && /^\d+$/.test(token) === false && NUMBER_WORDS[token] === undefined);
    const only: string | undefined = rest[0];
    return rest.length === 1 && only !== undefined && isPlainWord(only) === true ? only : null;
}

/**
 * Whether a clue is the same as a word, or hides one: contains it, is inside it, or shares a long
 * start with it, so "apples" and "applesauce" are both taken for "apple".
 * @param clue the clue.
 * @param word the word.
 * @returns true when they are too close.
 */
export function tooClose(clue: string, word: string): boolean {
    const first: string = squash(clue);
    const second: string = squash(word);
    if (first === "" || second === "") {
        return false;
    }
    if (first === second || (second.length >= 3 && first.includes(second) === true) || (first.length >= 3 && second.includes(first) === true)) {
        return true;
    }
    return first.length >= 5 && second.length >= 5 && first.slice(0, 5) === second.slice(0, 5);
}

/**
 * Whether a typed guess names a target: the same letters, or one inside the other when long enough.
 * A leading "the", "a" or "an" is ignored.
 * @param target what it should be.
 * @param guess what was typed.
 * @returns true when it counts.
 */
export function guessMatches(target: string, guess: string): boolean {
    const wanted: string = squash(target);
    const given: string = squash(guess.replace(/^(the|a|an)\s+/i, ""));
    return given.length >= 3 && (given === wanted || (given.length >= 4 && wanted.includes(given) === true) || (wanted.length >= 4 && given.includes(wanted) === true));
}
