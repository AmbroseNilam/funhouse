// The default check for any blueprint: rehearse it with its kit's paper players across seeds, with
// the model failing and succeeding, and, for a kit with a hidden role, check that who holds the
// role changes nothing anyone else sees. This is what "it passes rehearsal" means.

import type { Blueprint } from "./blueprint.ts";
import type { KitGame } from "./kit/kit.ts";
import { seededRandom } from "./kit/primitives.ts";
import { createChainGame, type ChainState } from "./kits/chain.ts";
import { createGuessingGame, type GuessingState } from "./kits/guessing.ts";
import { createPlantGame, type PlantState } from "./kits/plant.ts";
import { chainPersonas, guessingPersonas, plantPersonas, plantRoleCheck } from "./personas.ts";
import { rehearseMany, type Persona, type RehearsalOptions, type Tally } from "./rehearse.ts";

/** Seeds every blueprint is rehearsed with. */
export const CHECK_SEEDS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Rehearses a blueprint the default way.
 * @param blueprint the game.
 * @param options content and players.
 * @returns the counts and every problem found.
 */
export function checkBlueprint(blueprint: Blueprint, options: RehearsalOptions = {}): Tally {
    if (blueprint.kit === "guessing") {
        const makeGuessing = (seed: number): KitGame<GuessingState> => createGuessingGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(makeGuessing, guessingPersonas(blueprint.decisions), CHECK_SEEDS, options);
    }
    if (blueprint.kit === "chain") {
        const makeChain = (seed: number): KitGame<ChainState> => createChainGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearsePictureGame(makeChain, chainPersonas(), blueprint.decisions.paintSeconds, options);
    }
    const makePlant = (seed: number): KitGame<PlantState> => createPlantGame(blueprint.box, blueprint.decisions, seededRandom(seed));
    return rehearseMany(makePlant, plantPersonas(), CHECK_SEEDS, { ...options, roleCheck: plantRoleCheck(blueprint) });
}

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
