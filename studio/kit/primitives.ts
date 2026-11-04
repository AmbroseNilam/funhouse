// The small parts every kit is built from: a seeded random source, dealing one hidden role, a
// budget that runs out, a vote tally with ties, and the "because" fact that names the decision
// behind each fact. Pure functions over plain data, so a rehearsal can replay any of them from a
// seed. Kits import these; nothing here knows about any one game.

import type { CartridgePlayer } from "../../shared/cartridge.ts";
import type { ScopedFact } from "../../shared/visibility.ts";

/** The kind of the system fact that names a decision. */
export const BECAUSE_KIND: string = "because";

/**
 * A small deterministic random source, so a game can be replayed from its seed.
 * @param seed any integer.
 * @returns a function returning [0, 1).
 */
export function seededRandom(seed: number): () => number {
    let value: number = (seed >>> 0) || 1;
    return (): number => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 4294967296;
    };
}

/**
 * Picks one item.
 * @param items what to pick from; must not be empty.
 * @param random the random source.
 * @returns the item.
 * @throws when there is nothing to pick from.
 */
export function pick<Item>(items: readonly Item[], random: () => number): Item {
    const chosen: Item | undefined = items[Math.floor(random() * items.length)] ?? items[0];
    if (chosen === undefined) {
        throw new Error("Nothing to pick from.");
    }
    return chosen;
}

/**
 * Puts items in a random order, leaving the original alone.
 * @param items what to shuffle.
 * @param random the random source.
 * @returns a shuffled copy.
 */
export function shuffle<Item>(items: readonly Item[], random: () => number): Item[] {
    const result: Item[] = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const other: number = Math.floor(random() * (index + 1));
        const held: Item | undefined = result[index];
        result[index] = result[other] as Item;
        result[other] = held as Item;
    }
    return result;
}

/**
 * Deals one hidden role to one player.
 * @param players everyone at the table; must not be empty.
 * @param random the random source.
 * @returns the id of the player dealt the role.
 */
export function dealOne(players: readonly CartridgePlayer[], random: () => number): string {
    return pick(players, random).playerId;
}

/** A budget that is spent one at a time and runs out. */
export interface Budget {
    used: number;
    max: number;
    /** How many left at which the room is told. */
    warnAt: readonly number[];
}

/** What spending one of a budget did. */
export interface Spent {
    budget: Budget;
    left: number;
    /** True when this spend used the last one. */
    exhausted: boolean;
    /** True when exactly this many are left that the room should be told. */
    warn: boolean;
}

/**
 * Spends one.
 * @param budget the budget.
 * @returns the new budget and what it means.
 */
export function spend(budget: Budget): Spent {
    const next: Budget = { ...budget, used: budget.used + 1 };
    const left: number = Math.max(0, next.max - next.used);
    return { budget: next, left, exhausted: left === 0, warn: left > 0 && budget.warnAt.includes(left) === true };
}

/** One row of a counted vote. */
export interface TallyRow {
    playerId: string;
    votes: number;
}

/** A counted vote. */
export interface Tally {
    /** Every candidate with their votes, most first, ties in seat order. */
    rows: TallyRow[];
    /** Everyone with the most votes; empty when nobody voted. */
    leaders: string[];
    /** True when more than one candidate shares the most votes. */
    tied: boolean;
}

/**
 * Counts a vote. Votes for someone who isn't a candidate are not counted.
 * @param votes the vote of each voter, by voter id.
 * @param candidates who may be voted for, in seat order.
 * @returns the tally.
 */
export function tally(votes: Readonly<Record<string, string>>, candidates: readonly string[]): Tally {
    const counts: Map<string, number> = new Map(candidates.map((candidate: string) => [candidate, 0]));
    for (const target of Object.values(votes)) {
        const current: number | undefined = counts.get(target);
        if (current !== undefined) {
            counts.set(target, current + 1);
        }
    }
    const rows: TallyRow[] = candidates.map((playerId: string) => ({ playerId, votes: counts.get(playerId) ?? 0 }));
    rows.sort((first: TallyRow, second: TallyRow) => second.votes - first.votes);
    const top: number = rows[0]?.votes ?? 0;
    const leaders: string[] = top === 0 ? [] : rows.filter((row: TallyRow) => row.votes === top).map((row: TallyRow) => row.playerId);
    return { rows, leaders, tied: leaders.length > 1 };
}

/**
 * A fact followed by the decision that produced it. The second fact is system-scoped, so the room
 * shows it to nobody and never briefs the host on it.
 * @param fact the fact.
 * @param decision the decision id.
 * @returns both facts, in order.
 */
export function because(fact: ScopedFact, decision: string): ScopedFact[] {
    return [fact, { scope: { kind: "system" }, kind: BECAUSE_KIND, text: decision, quiet: true }];
}

/**
 * A copy that cannot be changed, so a game never shares objects with whoever handed it its
 * decisions, and a rule that tries to change state in place fails loudly.
 * @param value plain data.
 * @returns a frozen deep copy.
 */
export function frozenCopy<Value>(value: Value): Value {
    return deepFreeze(structuredClone(value));
}

/**
 * Freezes a value and everything inside it.
 * @param value plain data.
 * @returns the same value, frozen.
 */
export function deepFreeze<Value>(value: Value): Value {
    if (typeof value !== "object" || value === null || Object.isFrozen(value) === true) {
        return value;
    }
    for (const inner of Object.values(value)) {
        deepFreeze(inner);
    }
    return Object.freeze(value);
}

/** One line a player said that is waiting for a ruling. */
export interface WaitingLine {
    playerId: string;
    text: string;
}

/**
 * Adds a player's line to those waiting for a ruling. Each player has at most one: a newer line
 * replaces theirs and goes to the back, so the list stays oldest first. The same rule as the
 * hand-written Twenty Doors.
 * @param waiting the lines waiting, oldest first.
 * @param playerId who spoke.
 * @param text what they said.
 * @returns the new list.
 */
export function waitForRuling(waiting: readonly WaitingLine[], playerId: string, text: string): WaitingLine[] {
    return [...waiting.filter((line: WaitingLine) => line.playerId !== playerId), { playerId, text }];
}

/**
 * Takes the line a ruling answers: the named player's, or else the oldest waiting, because the host
 * may rule without saying who it was answering. The same rule as the hand-written Twenty Doors.
 * @param waiting the lines waiting, oldest first.
 * @param playerId who the host was answering, or null.
 * @returns the line, or undefined when nothing is waiting, and the lines left.
 */
export function takeRuledLine(waiting: readonly WaitingLine[], playerId: string | null): { line: WaitingLine | undefined; rest: WaitingLine[] } {
    const line: WaitingLine | undefined = waiting.find((candidate: WaitingLine) => candidate.playerId === playerId) ?? waiting[0];
    return { line, rest: waiting.filter((candidate: WaitingLine) => candidate !== line) };
}
