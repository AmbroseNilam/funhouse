// The default check for any blueprint: rehearse it with its kit's paper players across seeds, with
// the model failing and succeeding, and, for a kit with a hidden role, check that who holds the
// role changes nothing anyone else sees. This is what "it passes rehearsal" means.

import type { Blueprint } from "./blueprint.ts";
import type { KitGame } from "./kit/kit.ts";
import { seededRandom } from "./kit/primitives.ts";
import { createGuessingGame, type GuessingState } from "./kits/guessing.ts";
import { createPlantGame, type PlantState } from "./kits/plant.ts";
import { createBluffGame, type BluffState } from "./kits/bluff.ts";
import { createBotGame, type BotState } from "./kits/bot.ts";
import { createWitGame, type WitState } from "./kits/wit.ts";
import { guessingPersonas, plantPersonas, plantRoleCheck } from "./personas.ts";
import { bluffPersonas, botPersonas, witPersonas } from "./personas-text.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "./rehearse.ts";

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
    if (blueprint.kit === "wit") {
        const makeWit = (seed: number): KitGame<WitState> => createWitGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(makeWit, witPersonas(), CHECK_SEEDS, options);
    }
    if (blueprint.kit === "bluff") {
        const makeBluff = (seed: number): KitGame<BluffState> => createBluffGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        // Once with the model failing, and once with its second look "finding" the first two answers alike,
        // which turns the first fake into the true answer, so both ways a round can go are rehearsed.
        const failing: Tally = rehearseMany(makeBluff, bluffPersonas(), CHECK_SEEDS, options);
        const matching: Tally = rehearseMany(makeBluff, bluffPersonas(), CHECK_SEEDS, { ...options, content: options.content ?? "1, 2" });
        return addTallies(failing, matching);
    }
    if (blueprint.kit === "bot") {
        const makeBot = (seed: number): KitGame<BotState> => createBotGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        // Once with the model failing, and once with it writing one line for everything it is asked, which
        // gives the game a prompt of the model's and a machine's answer of the model's to place among the humans'.
        const failing: Tally = rehearseMany(makeBot, botPersonas(), CHECK_SEEDS, options);
        const writing: Tally = rehearseMany(makeBot, botPersonas(), CHECK_SEEDS, { ...options, content: options.content ?? "Gerald the goldfish" });
        return addTallies(failing, writing);
    }
    const makePlant = (seed: number): KitGame<PlantState> => createPlantGame(blueprint.box, blueprint.decisions, seededRandom(seed));
    return rehearseMany(makePlant, plantPersonas(), CHECK_SEEDS, { ...options, roleCheck: plantRoleCheck(blueprint) });
}

/**
 * Adds two sets of rehearsal counts together.
 * @param first one tally.
 * @param second another.
 * @returns their sum; a phase is never reached only if neither reached it.
 */
function addTallies(first: Tally, second: Tally): Tally {
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
