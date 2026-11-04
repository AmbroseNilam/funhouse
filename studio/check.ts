// The default check for any blueprint: rehearse it with its kit's paper players across seeds, with
// the model failing and succeeding, and, for a kit with a hidden role, check that who holds the
// role changes nothing anyone else sees. This is what "it passes rehearsal" means.

import type { Blueprint } from "./blueprint.ts";
import type { KitGame } from "./kit/kit.ts";
import { seededRandom } from "./kit/primitives.ts";
import { createEstimateGame, type EstimateState } from "./kits/estimate.ts";
import { createGateGame, type GateState } from "./kits/gate.ts";
import { createGuessingGame, type GuessingState } from "./kits/guessing.ts";
import { createPlantGame, type PlantState } from "./kits/plant.ts";
import { estimatePersonas, gatePersonas, guessingPersonas, plantPersonas, plantRoleCheck } from "./personas.ts";
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
    if (blueprint.kit === "gate") {
        const makeGate = (seed: number): KitGame<GateState> => createGateGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(makeGate, gatePersonas(), CHECK_SEEDS, options);
    }
    if (blueprint.kit === "estimate") {
        const makeEstimate = (seed: number): KitGame<EstimateState> => createEstimateGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(makeEstimate, estimatePersonas(blueprint.decisions), CHECK_SEEDS, options);
    }
    const makePlant = (seed: number): KitGame<PlantState> => createPlantGame(blueprint.box, blueprint.decisions, seededRandom(seed));
    return rehearseMany(makePlant, plantPersonas(), CHECK_SEEDS, { ...options, roleCheck: plantRoleCheck(blueprint) });
}
