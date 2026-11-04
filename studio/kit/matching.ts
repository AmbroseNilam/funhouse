// Rules a spoken guess against an answer in code. Speech arrives as transcribed text, so the match
// forgives word order, small words, plurals, endings and a one-letter mishearing, but never a
// missing key word. A guess that gets part of the way there is "close", which a game can cheer
// without saying what was right. Pure functions; no host and no model is involved.

/** How a guess compares with the answer. */
export type GuessRuling = "match" | "close" | "miss";

/** Small words that are not worth matching on their own. */
const SMALL_WORDS: ReadonlySet<string> = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "and", "or", "for", "with", "is", "it", "its", "i", "my", "his", "her", "their", "that"]);

/** Shortest word that a one-letter mishearing is forgiven in. */
const FUZZY_FROM_LETTERS: number = 5;

/** Shortest word that a two-letter mishearing is forgiven in, when judging "close". */
const CLOSE_FROM_LETTERS: number = 7;

/** Letters a stem must share at the start for two single words to be "close". */
const SHARED_START_LETTERS: number = 4;

/** Most words of a guess that are looked at; a long ramble is cut here. */
const GUESS_WORD_LIMIT: number = 24;

/**
 * Plain lower-case words: accents, punctuation and apostrophes gone.
 * @param text any text.
 * @returns its words.
 */
export function wordsOf(text: string): string[] {
    const plain: string = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "");
    return plain.split(/[^\p{L}\p{N}]+/u).filter((word: string) => word !== "");
}

/**
 * The part of a word that stays the same across endings, so "sneezing", "sneezes" and "sneeze"
 * are one word.
 * @param word a plain lower-case word.
 * @returns its stem.
 */
export function stemOf(word: string): string {
    let stem: string = withoutEnding(word);
    if (stem.length > 3 && stem.endsWith("e") === true) {
        stem = stem.slice(0, -1);
    }
    if (stem.length > 3 && stem.at(-1) === stem.at(-2)) {
        stem = stem.slice(0, -1);
    }
    return stem;
}

/**
 * Takes off one common ending: -ing, -ies, -ed, -es or -s.
 * @param word a plain lower-case word.
 * @returns the word without its ending, or the word itself.
 */
function withoutEnding(word: string): string {
    if (word.length > 5 && word.endsWith("ing") === true) {
        return word.slice(0, -3);
    }
    if (word.length > 4 && word.endsWith("ies") === true) {
        return `${word.slice(0, -3)}y`;
    }
    if (word.length > 4 && (word.endsWith("ed") === true || word.endsWith("es") === true)) {
        return word.slice(0, -2);
    }
    if (word.length > 3 && word.endsWith("s") === true && word.endsWith("ss") === false) {
        return word.slice(0, -1);
    }
    return word;
}

/**
 * The words that must be matched: the answer's words without the small ones, as stems.
 * @param text an answer.
 * @returns its key stems.
 */
export function keyStems(text: string): string[] {
    return wordsOf(text).filter((word: string) => SMALL_WORDS.has(word) === false).map(stemOf);
}

/**
 * How many letters must change to turn one word into another, counting a swap of neighbours as one.
 * @param first a word.
 * @param second a word.
 * @returns the distance.
 */
export function editDistance(first: string, second: string): number {
    const rows: number[][] = Array.from({ length: first.length + 1 }, (_row: unknown, index: number) => [index, ...Array.from({ length: second.length }, () => 0)]);
    for (let column = 1; column <= second.length; column += 1) {
        (rows[0] as number[])[column] = column;
    }
    for (let row = 1; row <= first.length; row += 1) {
        for (let column = 1; column <= second.length; column += 1) {
            const cost: number = first[row - 1] === second[column - 1] ? 0 : 1;
            const above: number = (rows[row - 1] as number[])[column] as number;
            const left: number = (rows[row] as number[])[column - 1] as number;
            const corner: number = (rows[row - 1] as number[])[column - 1] as number;
            let best: number = Math.min(above + 1, left + 1, corner + cost);
            const swapped: boolean = row > 1 && column > 1 && first[row - 1] === second[column - 2] && first[row - 2] === second[column - 1];
            if (swapped === true) {
                best = Math.min(best, ((rows[row - 2] as number[])[column - 2] as number) + 1);
            }
            (rows[row] as number[])[column] = best;
        }
    }
    return (rows[first.length] as number[])[second.length] as number;
}

/**
 * Whether a spoken stem stands for an answer's stem: the same, or one letter off in a word long
 * enough that this is a mishearing and not a different word.
 * @param spoken a stem from the guess.
 * @param wanted a stem from the answer.
 * @returns true when they match.
 */
export function stemsMatch(spoken: string, wanted: string): boolean {
    if (spoken === wanted) {
        return true;
    }
    return Math.min(spoken.length, wanted.length) >= FUZZY_FROM_LETTERS && editDistance(spoken, wanted) <= 1;
}

/**
 * Whether a spoken stem is near an answer's stem without matching: two letters off in a long word,
 * or the same long start.
 * @param spoken a stem from the guess.
 * @param wanted a stem from the answer.
 * @returns true when it is near.
 */
function stemsNear(spoken: string, wanted: string): boolean {
    const shortest: number = Math.min(spoken.length, wanted.length);
    if (shortest >= CLOSE_FROM_LETTERS && editDistance(spoken, wanted) <= 2) {
        return true;
    }
    return shortest >= SHARED_START_LETTERS && spoken.slice(0, SHARED_START_LETTERS) === wanted.slice(0, SHARED_START_LETTERS);
}

/**
 * Rules one guess against one accepted form of the answer.
 * @param spoken the guess's stems.
 * @param form one accepted way to say the answer.
 * @returns the ruling.
 */
function ruleAgainst(spoken: readonly string[], form: string): GuessRuling {
    const wanted: string[] = keyStems(form);
    if (wanted.length === 0) {
        return "miss";
    }
    const found: number = wanted.filter((stem: string) => spoken.some((word: string) => stemsMatch(word, stem) === true)).length;
    if (found === wanted.length) {
        return "match";
    }
    if (found > 0 && found >= Math.ceil(wanted.length / 2)) {
        return "close";
    }
    const nearSingle: boolean = wanted.length === 1 && spoken.some((word: string) => stemsNear(word, wanted[0] ?? "") === true);
    return nearSingle === true ? "close" : "miss";
}

/**
 * Rules a spoken guess against an answer and the other ways of saying it.
 * @param guess what was heard.
 * @param answer the answer.
 * @param alsoAccepted other ways to say the answer that count just the same.
 * @returns "match" when every key word is there, "close" when part of the way, else "miss".
 */
export function ruleGuess(guess: string, answer: string, alsoAccepted: readonly string[]): GuessRuling {
    const spoken: string[] = wordsOf(guess).slice(0, GUESS_WORD_LIMIT).map(stemOf);
    let best: GuessRuling = "miss";
    for (const form of [answer, ...alsoAccepted]) {
        const ruling: GuessRuling = ruleAgainst(spoken, form);
        if (ruling === "match") {
            return "match";
        }
        if (ruling === "close") {
            best = "close";
        }
    }
    return best;
}
