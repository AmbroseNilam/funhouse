// Decides which short answers count as the same answer. Written locally so a kit never depends on a
// smarter matcher: the kit asks for a DuplicateMerger, and mergeDuplicates is the default one. It
// treats case, accents, hyphens, plurals, common word endings, British and American spellings and a
// single slipped letter in a longer word as the same answer. It leans toward keeping answers apart,
// since cancelling two different clues by mistake feels worse to a player than missing a near twin.

/** One answer from one player. */
export interface Answer {
    playerId: string;
    text: string;
}

/** Answers that count as one, in the order they were given. Always at least two answers. */
export interface MergedGroup {
    playerIds: string[];
}

/** Anything that can say which answers are the same; swap in a smarter one without touching a kit. */
export type DuplicateMerger = (answers: readonly Answer[]) => MergedGroup[];

/** Shortest longer word that may have one letter added or dropped and still count as the same. */
const TYPO_MINIMUM_LETTERS: number = 6;

/** Shortest longer word that may have a doubled letter added or dropped, as in "piza" for "pizza". */
const DOUBLED_MINIMUM_LETTERS: number = 5;

/** Shortest word that may differ by one swapped letter and still count as the same. */
const SWAP_MINIMUM_LETTERS: number = 7;

/** Spelling pairs worth folding: the left side is rewritten as the right. */
const SPELLING_RULES: readonly [RegExp, string][] = [
    [/ou(?=r\b|rs\b|ed\b|ing\b|ful\b|s\b|\b)/g, "o"],
    [/ise(?=\b|d\b|s\b)/g, "ize"],
    [/yse(?=\b|d\b|s\b)/g, "yze"],
    [/tre\b/g, "ter"],
    [/ll(?=ed\b|ing\b|er\b)/g, "l"],
    [/ae/g, "e"],
];

/** Endings that do not change what a word is about, longest first. */
const ENDINGS: readonly string[] = ["ingly", "ations", "ation", "ments", "ment", "ness", "ings", "ing", "ies", "ied", "ers", "est", "ed", "er", "es", "ly", "s", "y", "e"];

/**
 * Lower case, without accents, spaces, hyphens or other marks, so "Ice-Cream" and "ice cream" match.
 * @param text any text.
 * @returns letters and digits only.
 */
export function normalize(text: string): string {
    return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * The rough root of a word, with spelling variants folded and one common ending taken off.
 * @param text any text.
 * @returns the stem.
 */
export function stemOf(text: string): string {
    let word: string = normalize(text);
    for (const [pattern, replacement] of SPELLING_RULES) {
        word = word.replace(pattern, replacement);
    }
    for (const ending of ENDINGS) {
        if (word.endsWith(ending) === true && word.length - ending.length >= 3) {
            return undoDoubling(word.slice(0, word.length - ending.length));
        }
    }
    return undoDoubling(word);
}

/**
 * Takes a doubled last letter back to one, so "running" and "run" share a stem.
 * @param stem a stem.
 * @returns the stem with a doubled final consonant undone.
 */
function undoDoubling(stem: string): string {
    return /([^aeiou])\1$/.test(stem) === true && stem.length > 3 ? stem.slice(0, -1) : stem;
}

/**
 * How far apart two strings are by one slipped letter: 0 for equal, 1 for one added, dropped or
 * swapped-pair letter, 2 for one changed letter, and 3 for anything further.
 * @param first a string.
 * @param second a string.
 * @returns the distance as described.
 */
function slip(first: string, second: string): number {
    if (first === second) {
        return 0;
    }
    if (Math.abs(first.length - second.length) > 1) {
        return 3;
    }
    const shorter: string = first.length <= second.length ? first : second;
    const longer: string = first.length <= second.length ? second : first;
    let at: number = 0;
    while (at < shorter.length && shorter[at] === longer[at]) {
        at += 1;
    }
    if (shorter.length !== longer.length) {
        return shorter.slice(at) === longer.slice(at + 1) ? 1 : 3;
    }
    if (first.slice(at + 1) === second.slice(at + 1)) {
        return 2;
    }
    const swapped: boolean = first[at] === second[at + 1] && first[at + 1] === second[at] && first.slice(at + 2) === second.slice(at + 2);
    return swapped === true ? 1 : 3;
}

/**
 * Whether two answers count as the same: equal once tidied, the same stem, or a single slipped
 * letter in a long enough word.
 * @param first an answer.
 * @param second an answer.
 * @returns true when they are the same answer.
 */
export function sameAnswer(first: string, second: string): boolean {
    const left: string = normalize(first);
    const right: string = normalize(second);
    if (left === "" || right === "") {
        return false;
    }
    if (left === right || stemOf(left) === stemOf(right)) {
        return true;
    }
    const stems: [string, string] = [stemOf(left), stemOf(right)];
    const gap: number = slip(stems[0], stems[1]);
    const length: number = Math.max(stems[0].length, stems[1].length);
    if (gap === 1) {
        return length >= TYPO_MINIMUM_LETTERS || (length >= DOUBLED_MINIMUM_LETTERS && /(.)\1/.test(stems[0].length > stems[1].length ? stems[0] : stems[1]) === true);
    }
    return gap === 2 && length >= SWAP_MINIMUM_LETTERS;
}

/**
 * Groups answers that count as the same. An answer that matches nobody is not in any group.
 * @param answers everyone's answers.
 * @returns the groups of two or more players, ordered by the first answer in each.
 */
export function mergeDuplicates(answers: readonly Answer[]): MergedGroup[] {
    const parent: number[] = answers.map((_answer: Answer, index: number) => index);
    const root = (index: number): number => {
        let current: number = index;
        while (parent[current] !== current) {
            current = parent[current] ?? current;
        }
        return current;
    };
    for (let first = 0; first < answers.length; first += 1) {
        for (let second = first + 1; second < answers.length; second += 1) {
            if (sameAnswer(answers[first]?.text ?? "", answers[second]?.text ?? "") === true) {
                parent[root(second)] = root(first);
            }
        }
    }
    const groups: Map<number, string[]> = new Map();
    answers.forEach((answer: Answer, index: number) => {
        groups.set(root(index), [...(groups.get(root(index)) ?? []), answer.playerId]);
    });
    return [...groups.values()].filter((playerIds: string[]) => playerIds.length > 1).map((playerIds: string[]) => ({ playerIds }));
}
