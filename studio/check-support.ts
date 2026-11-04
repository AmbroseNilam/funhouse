// What every kit's default check shares: the seeds, the spread that keeps nearby seeds apart, and the
// four-ways rehearsal for games that ask for pictures. Kept apart from the kit registry so neither
// imports the other.

import type { KitGame } from "./kit/kit.ts";
import { rehearseMany, type Persona, type RehearsalOptions, type Tally } from "./rehearse.ts";

/** Seeds every blueprint is rehearsed with. */
export const CHECK_SEEDS: readonly number[] = [1, 2, 3, 4, 5];

/** Multiplies a seed so the first draws of nearby seeds don't all land on the same seat or team. */
export const SEED_SPREAD: number = 104729;

/**
 * Rehearses a game that asks the room for pictures four ways: they arrive at once, they arrive
 * in a few seconds, they arrive after the game has stopped waiting, and they never arrive. A
 * picture game has to work, and look fine, in all four.
 * @param makeGame builds a fresh game from a seed.
 * @param personas the paper players.
 * @param waitSeconds how long the game waits for a picture before it gives up on it.
 * @param options content and players.
 * @returns the counts of all four runs together, with problems naming the way pictures behaved.
 */
export function rehearsePictureGame<State>(
    makeGame: (seed: number) => KitGame<State>,
    personas: readonly Persona<State>[],
    waitSeconds: number,
    options: RehearsalOptions = {},
): Tally {
    const ways: [string, number | null][] = [["pictures at once", 0], ["pictures in a few seconds", PICTURE_FEW_SECONDS], ["pictures too late", waitSeconds + PICTURE_LATE_EXTRA_SECONDS], ["no pictures", null]];
    const tallies: [string, Tally][] = ways.map(([name, drawSeconds]: [string, number | null]): [string, Tally] => {
        return [name, rehearseMany(makeGame, personas, CHECK_SEEDS, { ...options, drawSeconds })];
    });
    const outcomes: Record<string, number> = {};
    for (const [, tally] of tallies) {
        for (const [outcome, count] of Object.entries(tally.outcomes)) {
            outcomes[outcome] = (outcomes[outcome] ?? 0) + count;
        }
    }
    const first: Tally | undefined = tallies[0]?.[1];
    return {
        rehearsals: tallies.reduce((sum: number, [, tally]: [string, Tally]) => sum + tally.rehearsals, 0),
        ended: tallies.reduce((sum: number, [, tally]: [string, Tally]) => sum + tally.ended, 0),
        outcomes,
        phasesNeverReached: (first?.phasesNeverReached ?? []).filter((phase: string) => {
            return tallies.every(([, tally]: [string, Tally]) => tally.phasesNeverReached.includes(phase) === true);
        }),
        problems: tallies.flatMap(([name, tally]: [string, Tally]) => tally.problems.map((problem: string) => `${name}: ${problem}`)),
    };
}

/** Seconds a typical picture takes in the "in a few seconds" rehearsal. */
const PICTURE_FEW_SECONDS: number = 12;

/** Seconds past the game's wait that a late picture arrives. */
const PICTURE_LATE_EXTRA_SECONDS: number = 20;

/**
 * Adds two sets of rehearsal counts together.
 * @param first one tally.
 * @param second another.
 * @returns their sum; a phase is never reached only if neither reached it.
 */
export function addTallies(first: Tally, second: Tally): Tally {
    const outcomes: Record<string, number> = { ...first.outcomes };
    for (const [outcome, count] of Object.entries(second.outcomes)) {
        outcomes[outcome] = (outcomes[outcome] ?? 0) + count;
    }
    return {
        rehearsals: first.rehearsals + second.rehearsals,
        ended: first.ended + second.ended,
        outcomes,
        phasesNeverReached: first.phasesNeverReached.filter((phase: string) => second.phasesNeverReached.includes(phase) === true),
        problems: [...first.problems, ...second.problems],
    };
}
