// The pure parts of Same Page: grouping typed cards into stacks, finding the pairs a local check
// cannot settle, joining stacks a model said are the same, and scoring a round. Nothing here knows
// a phone, a timer or the host, so a test or a rehearsal can replay any of it. The local check
// leans toward keeping cards apart: a wrong merge costs a player a point they earned, so the
// seams that merge by meaning (Jev, then one closed Spark question) can only add merges, and their
// silence means "separate".

import { mergeDuplicates, normalize, stemOf, type DuplicateMerger, type MergedGroup } from "../../kit/merge.ts";

/** One typed card and who wrote it. */
export interface Card {
    playerId: string;
    text: string;
}

/** Players whose cards sit together, in seat order. A stack of one is a lone card. */
export type Stack = string[];

/** Two stacks, by position, that the local check could not settle. */
export type Doubt = [number, number];

/** Words that carry no meaning of their own, so "a bat" and "the bat" share nothing but a bat. */
const IDLE_WORDS: ReadonlySet<string> = new Set(["the", "and", "for", "with", "some", "that", "this", "your", "from", "into", "out", "its"]);

/** Shortest word that counts when two cards are checked for a shared word. */
const SHARED_WORD_MINIMUM_LETTERS: number = 3;

/** Shortest card that may sit whole inside another and still raise a doubt. */
const CONTAINED_MINIMUM_LETTERS: number = 4;

/** Points a stack of exactly this many cards scores to each card, as set by the rules. */
const PAIR_SIZE: number = 2;

/**
 * The words of a card that could make it a twin of another.
 * @param text a card.
 * @returns the stems of its meaningful words.
 */
function stemsIn(text: string): string[] {
    return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word: string) => word.length >= SHARED_WORD_MINIMUM_LETTERS && IDLE_WORDS.has(word) === false).map(stemOf);
}

/**
 * Whether two cards that did not merge still look like they might be the same thing: they share a
 * word, or one sits whole inside the other. "bat" and "baseball bat" do; "bat" and "bait" do not.
 * @param first a card.
 * @param second a card.
 * @returns true when a closer look is worth one question.
 */
export function looksAlike(first: string, second: string): boolean {
    const left: string = normalize(first);
    const right: string = normalize(second);
    if (left === "" || right === "" || left === right) {
        return false;
    }
    if (left.length >= CONTAINED_MINIMUM_LETTERS && right.includes(left) === true) {
        return true;
    }
    if (right.length >= CONTAINED_MINIMUM_LETTERS && left.includes(right) === true) {
        return true;
    }
    const mine: string[] = stemsIn(first);
    return stemsIn(second).some((stem: string) => mine.includes(stem) === true);
}

/**
 * Groups cards that the local check calls the same, and leaves every other card alone in its own stack.
 * @param cards the round's cards, in seat order.
 * @param merge how to group; the local merger unless a test gives its own.
 * @returns the stacks, ordered by the seat of their first card.
 */
export function stackCards(cards: readonly Card[], merge: DuplicateMerger = mergeDuplicates): Stack[] {
    const groups: MergedGroup[] = merge(cards.map((card: Card) => ({ playerId: card.playerId, text: card.text })));
    const stacks: Stack[] = cards.map((card: Card): Stack => groups.find((group: MergedGroup) => group.playerIds.includes(card.playerId) === true)?.playerIds ?? [card.playerId]);
    const seen: Set<string> = new Set();
    return stacks.filter((stack: Stack) => {
        const key: string = [...stack].sort().join("|");
        if (seen.has(key) === true) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/**
 * The pairs of stacks that did not merge but look alike, so a model may be asked about them.
 * @param stacks the stacks.
 * @param textsOf the texts typed on a stack's cards.
 * @returns the pairs, by position, in order.
 */
export function doubtsAmong(stacks: readonly Stack[], textsOf: (stack: Stack) => string[]): Doubt[] {
    const doubts: Doubt[] = [];
    for (let first = 0; first < stacks.length; first += 1) {
        for (let second = first + 1; second < stacks.length; second += 1) {
            const mine: string[] = textsOf(stacks[first] ?? []);
            const theirs: string[] = textsOf(stacks[second] ?? []);
            if (mine.some((one: string) => theirs.some((other: string) => looksAlike(one, other) === true)) === true) {
                doubts.push([first, second]);
            }
        }
    }
    return doubts;
}

/**
 * The two cards that made a pair of stacks a doubt: the first pair of texts that look alike.
 * @param first one stack's texts.
 * @param second the other stack's texts.
 * @returns the pair, or null when none looks alike.
 */
export function doubtedTexts(first: readonly string[], second: readonly string[]): [string, string] | null {
    for (const one of first) {
        const other: string | undefined = second.find((candidate: string) => looksAlike(one, candidate) === true);
        if (other !== undefined) {
            return [one, other];
        }
    }
    return null;
}

/**
 * The text that stands for a stack: its shortest card, the earliest on a tie, without trailing punctuation.
 * @param texts a stack's texts.
 * @returns the text, or an empty string.
 */
export function standIn(texts: readonly string[]): string {
    const shortest: string = [...texts].sort((first: string, second: string) => normalize(first).length - normalize(second).length)[0] ?? "";
    return shortest.replace(/[.!?,;:\s]+$/u, "");
}

/**
 * Joins the stacks a model said are the same. Joining is the only thing it can do.
 * @param stacks the stacks.
 * @param same pairs of positions that are the same thing.
 * @returns the joined stacks, ordered by their first stack.
 */
export function joinStacks(stacks: readonly Stack[], same: readonly Doubt[]): Stack[] {
    const parent: number[] = stacks.map((_stack: Stack, index: number) => index);
    const root = (index: number): number => {
        let current: number = index;
        while (parent[current] !== current) {
            current = parent[current] ?? current;
        }
        return current;
    };
    for (const [first, second] of same) {
        if (stacks[first] === undefined || stacks[second] === undefined) {
            continue;
        }
        const high: number = Math.max(root(first), root(second));
        const low: number = Math.min(root(first), root(second));
        parent[high] = low;
    }
    const joined: Map<number, Stack> = new Map();
    stacks.forEach((stack: Stack, index: number) => {
        joined.set(root(index), [...(joined.get(root(index)) ?? []), ...stack]);
    });
    return [...joined.values()];
}

/**
 * What a round is worth to each card: one point for every other card in its stack, except that a
 * stack of exactly two scores two each. A lone card scores nothing.
 * @param stacks the round's stacks.
 * @param pairPoints what each card of a stack of two scores.
 * @returns points by player id, for every player who had a card.
 */
export function scoreStacks(stacks: readonly Stack[], pairPoints: number): Record<string, number> {
    const points: Record<string, number> = {};
    for (const stack of stacks) {
        for (const playerId of stack) {
            points[playerId] = stack.length === PAIR_SIZE ? pairPoints : stack.length - 1;
        }
    }
    return points;
}

/**
 * Who holds the hat after a round. The hat moves only to a card that sits alone when it is the
 * only one: two lone cards tie, and a tie goes to nobody, so the hat stays where it was. A round
 * with fewer than two cards has nothing to match, so it moves nothing either.
 * @param holder who held it before, or null.
 * @param stacks the round's stacks.
 * @returns the holder now.
 */
export function hatAfter(holder: string | null, stacks: readonly Stack[]): string | null {
    const cards: number = stacks.reduce((total: number, stack: Stack) => total + stack.length, 0);
    const lone: Stack[] = stacks.filter((stack: Stack) => stack.length === 1);
    const only: string | undefined = lone[0]?.[0];
    if (cards < PAIR_SIZE || lone.length !== 1 || only === undefined) {
        return holder;
    }
    return only;
}
