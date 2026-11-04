// Decides whether text a player typed may reach the TV and the host. A local check runs first and
// sees through spacing, look-alike letters and leetspeak; anything it passes then goes to a
// classifier. Rude is fine at an adult table. Hate, sexual content, anything sexual about children,
// personal details, links and attempts to instruct the host are not. When in doubt, it says no.

import { HATE_PHRASES, JOINED_HATE, JOINED_SEXUAL, MINOR_SEXUAL, MINOR_WORDS, SEXUAL_CONTEXT, WORD_HATE, WORD_SEXUAL } from "./content-terms.ts";

/** Why text was refused. Logged, and never shown to the player. */
export type FilterCategory = "hate" | "sexual" | "minors" | "personal" | "instructions" | "classifier" | "empty";

/** The filter's answer: the tidied text to use, or why not. */
export type FilterResult = { allowed: true; text: string } | { allowed: false; category: FilterCategory };

/** Asks a model whether text is fit; true means allowed. Throwing counts as no. */
export type TextClassifier = (text: string) => Promise<boolean>;

/** Most letters a repeat may keep when squeezing, so "niiice" and "nice" read alike. */
const REPEAT_KEEP: number = 1;

/** Letters a term needs before it counts inside a longer word; shorter ones turn up in "lollipop" and "torpedo". */
const TERM_INSIDE_WORD_LETTERS: number = 6;

/** Digits in a row, ignoring separators, that look like a phone or card number. */
const LONG_NUMBER_DIGITS: number = 7;

/** Look-alike letters from other alphabets, and the symbols and digits people swap for letters. */
const LOOK_ALIKES: Record<string, string> = {
    а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", і: "i", ј: "j", ѕ: "s", һ: "h", к: "k", т: "t", м: "m", в: "b", н: "h", г: "r", п: "n",
    α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", γ: "y", η: "n",
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t", "8": "b", "9": "g",
    "@": "a", $: "s", "!": "i", "|": "l", "+": "t", "€": "e", "£": "l", "¡": "i",
};

/** Words that make a number look like a street address. Ones with everyday uses, like "a 10 minute drive", are left to the classifier. */
const STREET_WORDS: string = "street|st|avenue|ave|road|rd|boulevard|blvd|crescent|cres|apt|apartment|suite";

/** Personal details and links, tested on the text as typed. */
const PERSONAL_PATTERNS: RegExp[] = [
    /[^\s@]+\s*(?:@|\(at\)|\[at\]|\bat\b)\s*[a-z0-9-]+\s*(?:\.|\(dot\)|\[dot\]|\bdot\b)\s*(?:com|net|org|ca|io|co|edu|gov|live|me)\b/i,
    /\b(?:https?:\/\/|www\.)\S+/i,
    /\b[a-z0-9-]+\.(?:com|net|org|ca|io|gg|ly|me|tv|co|xyz|app|live)\b/i,
    /(?:^|\s)@[a-z0-9_.]{2,}/i,
    new RegExp(`\\b\\d{1,6}\\s+(?!(?:second|minute|hour|day|week|month|year|mile|km|lane)s?\\b)(?:[a-z]+\\s+){1,3}(?:${STREET_WORDS})\\b`, "i"),
    /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
    /\b(?:my|his|her|their)\s+(?:home\s+)?(?:address|phone|number|password|ssn|sin)\s+(?:is|=|:)/i,
    /\b(?:lives?|living)\s+at\s+\d/i,
    /\b[a-z]\d[a-z]\s?\d[a-z]\d\b/i,
];

/** Attempts to give the host instructions, tested on the tidied words. */
const INSTRUCTION_PATTERNS: RegExp[] = [
    /\b(?:ignore|forget|disregard|override)\b.{0,30}\b(?:instruction|instructions|rules|prompt|system|above|previous)\b/,
    /\b(?:system|developer)\s+(?:prompt|message)\b/,
    /\byou\s+are\s+now\b/,
    /\b(?:reveal|tell\s+me|say)\b.{0,20}\b(?:secret|your\s+prompt|your\s+instructions)\b/,
    /\b(?:the\s+host\s+must|host\s*:|assistant\s*:|system\s*:)/,
];

/** Ordinary words that hold a term or squeeze into one. */
const ORDINARY_WORDS: Set<string> = new Set(["niger", "nigeria", "nigerian", "nigerians", "snigger", "sniggers", "sniggered", "sniggering", "retardant", "retardants"]);

/** Spelled-out digits, for a phone number given in words. */
const NUMBER_WORDS: string[] = ["zero", "oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * Decodes a ROT13 term.
 * @param term the stored term.
 * @returns the term.
 */
function decode(term: string): string {
    return term.replace(/[a-z]/g, (letter: string) => String.fromCharCode(((letter.charCodeAt(0) - 97 + 13) % 26) + 97));
}

const JOINED_TERMS: { category: FilterCategory; terms: string[] }[] = [
    { category: "hate", terms: JOINED_HATE.map(decode) },
    { category: "sexual", terms: JOINED_SEXUAL.map(decode) },
    { category: "minors", terms: MINOR_SEXUAL.map(decode) },
];
const WHOLE_WORDS: { category: FilterCategory; terms: Set<string> }[] = [
    { category: "minors", terms: new Set(MINOR_SEXUAL.map(decode)) },
    { category: "hate", terms: new Set(WORD_HATE.map(decode)) },
    { category: "sexual", terms: new Set(WORD_SEXUAL.map(decode)) },
];
const PHRASES: string[] = HATE_PHRASES.map(decode);
const MINORS: Set<string> = new Set(MINOR_WORDS.map(decode));
const SEXUAL_WORDS: Set<string> = new Set(SEXUAL_CONTEXT.map(decode));

/**
 * Squeezes repeated letters to one, on terms as much as on text, so stretched spellings match.
 * @param text lower-case text.
 * @returns the text with repeats squeezed.
 */
function squeeze(text: string): string {
    return text.replace(/(.)\1+/g, (_whole: string, letter: string) => letter.repeat(REPEAT_KEEP));
}

/**
 * Strips what hides a word: invisible characters, accents, look-alike letters and swapped symbols.
 * @param text the text as typed.
 * @returns lower-case text in plain letters.
 */
export function plainLetters(text: string): string {
    const composed: string = text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[\p{Cf}\p{Cc}]/gu, " ").toLowerCase();
    return [...composed].map((letter: string) => LOOK_ALIKES[letter] ?? letter).join("");
}

/**
 * Splits text into words, running together any letters typed one at a time ("n i g" or "n.i.g").
 * @param plain text from plainLetters.
 * @returns the words.
 */
export function wordsOf(plain: string): string[] {
    const tokens: string[] = plain.split(/[^\p{L}]+/u).filter((token: string) => token !== "");
    const words: string[] = [];
    let run: string = "";
    for (const token of tokens) {
        if (token.length === 1) {
            run += token;
            continue;
        }
        if (run !== "") {
            words.push(run);
            run = "";
        }
        words.push(token);
    }
    if (run !== "") {
        words.push(run);
    }
    return words;
}

/**
 * Whether the text holds a long run of digits or spelled-out digits.
 * @param text the text as typed.
 * @returns true when it looks like a phone, card or ID number.
 */
function holdsLongNumber(text: string): boolean {
    const digits: string = text.replace(/[\s().+-]/g, "");
    if (new RegExp(`\\d{${LONG_NUMBER_DIGITS},}`).test(digits) === true) {
        return true;
    }
    let inARow: number = 0;
    for (const word of text.toLowerCase().split(/[^a-z]+/)) {
        inARow = NUMBER_WORDS.includes(word) === true ? inARow + 1 : 0;
        if (inARow >= LONG_NUMBER_DIGITS) {
            return true;
        }
    }
    return false;
}

/**
 * Tidies text for use: no control characters, none of the brackets rulings and stage notes use, and
 * single spaces.
 * @param text the text as typed.
 * @param limit the longest allowed.
 * @returns the tidied text.
 */
export function tidyText(text: string, limit: number): string {
    return text.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/[()[\]{}<>*_`#~]/g, "").replace(/\s+/g, " ").trim().slice(0, limit).trim();
}

/**
 * The local check, needing no network.
 * @param text the text as typed.
 * @returns the category it breaks, or null when it passes.
 */
export function localCategory(text: string): FilterCategory | null {
    if (holdsLongNumber(text) === true || PERSONAL_PATTERNS.some((pattern: RegExp) => pattern.test(text)) === true) {
        return "personal";
    }
    const plain: string = plainLetters(text);
    const words: string[] = wordsOf(plain);
    const spaced: string = words.join(" ");
    const pieces: string[] = words.flatMap((_word: string, index: number) => [words.slice(index, index + 2), words.slice(index, index + 3)].filter((group: string[]) => group.length > 1).map((group: string[]) => squeeze(group.join(""))));
    const squeezedWords: string[] = words.map(squeeze);
    if (INSTRUCTION_PATTERNS.some((pattern: RegExp) => pattern.test(text.toLowerCase()) || pattern.test(spaced)) === true) {
        return "instructions";
    }
    for (const group of JOINED_TERMS) {
        const inWord = (term: string): boolean => words.some((word: string) => ORDINARY_WORDS.has(word) === false && (squeeze(word) === squeeze(term) || (squeeze(term).length >= TERM_INSIDE_WORD_LETTERS && squeeze(word).includes(squeeze(term)))));
        if (group.terms.some((term: string) => inWord(term) === true || pieces.includes(squeeze(term)) === true) === true) {
            return group.category;
        }
    }
    for (const group of WHOLE_WORDS) {
        const terms: Set<string> = new Set([...group.terms].map(squeeze));
        if (words.some((word: string) => group.terms.has(word)) === true || squeezedWords.some((word: string) => terms.has(word)) === true) {
            return group.category;
        }
    }
    if (PHRASES.some((phrase: string) => ` ${spaced} `.includes(` ${phrase} `)) === true) {
        return "hate";
    }
    if (words.some((word: string) => MINORS.has(word)) === true && words.some((word: string) => SEXUAL_WORDS.has(word)) === true) {
        return "minors";
    }
    return null;
}

/** One word wholly in capitals, which a classifier can take for an acronym. */
const ONE_WORD_IN_CAPITALS: RegExp = /^\p{Lu}{2,}$/u;

/**
 * Runs both layers. The classifier only sees what the local check passed, and a classifier that
 * fails counts as no, so a provider outage can't let anything through.
 * @param text the text as typed.
 * @param limit the longest allowed.
 * @param classify the classifier.
 * @returns the tidied text, or why it was refused.
 */
export async function filterText(text: string, limit: number, classify: TextClassifier): Promise<FilterResult> {
    const tidy: string = tidyText(text, limit);
    if (tidy === "") {
        return { allowed: false, category: "empty" };
    }
    const local: FilterCategory | null = localCategory(text) ?? localCategory(tidy);
    if (local !== null) {
        return { allowed: false, category: local };
    }
    const fit: boolean = await classify(tidy).catch(() => false);
    if (fit === true) {
        return { allowed: true, text: tidy };
    }
    if (ONE_WORD_IN_CAPITALS.test(tidy) === false) {
        return { allowed: false, category: "classifier" };
    }
    // A word in capitals can read as an acronym ("MAP"). Ask again about the plain word, and show what passed.
    const plain: string = tidy.toLowerCase();
    const plainFit: boolean = await classify(plain).catch(() => false);
    return plainFit === true ? { allowed: true, text: plain } : { allowed: false, category: "classifier" };
}

/** Words that read as the room itself talking, anywhere in a name. */
const RESERVED_WORDS: string[] = ["host", "system", "admin", "moderator", "narrator", "referee", "funhouse"];

/** Names that only read that way on their own. */
const RESERVED_NAMES: string[] = ["game", "the game"];

/**
 * The local check for a nickname: everything a typed line must pass, and it mustn't pose as the host.
 * @param name the cleaned name.
 * @param hostName the host's name.
 * @returns why it can't be used, or null when it passes.
 */
export function nicknameCategory(name: string, hostName: string): FilterCategory | "impersonation" | null {
    const local: FilterCategory | null = localCategory(name);
    if (local !== null) {
        return local;
    }
    const words: string[] = wordsOf(plainLetters(name));
    const spaced: string = words.join(" ");
    const pieces: string[] = [...words, ...words.slice(1).map((word: string, index: number) => `${words[index] ?? ""}${word}`), words.join("")];
    const posesAsHost: boolean = pieces.some((piece: string) => squeeze(piece) === squeeze(hostName.toLowerCase()));
    const reserved: boolean = words.some((word: string) => RESERVED_WORDS.includes(word) === true) || RESERVED_NAMES.includes(spaced) === true;
    return posesAsHost === true || reserved === true ? "impersonation" : null;
}
