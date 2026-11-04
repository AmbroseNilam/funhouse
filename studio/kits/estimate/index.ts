// The estimate kit's entry (a numeric question and bets on the closest guess): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createEstimateGame, estimateBlueprintProblems, type EstimateState } from "./estimate.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { estimatePersonas } from "./personas.ts";
import type { EstimateDecisions } from "./estimate.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, giveUpRow, type KitDefinition } from "../../kit/definition.ts";

/** An estimate game: a numeric question, secret guesses, and bets on whose guess is closest. */
export interface EstimateBlueprint {
    kit: "estimate";
    box: Box;
    decisions: EstimateDecisions;
}

/**
 * Defines a estimate game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: EstimateDecisions): EstimateBlueprint {
    return { kit: "estimate", box, decisions };
}

/** The estimate kit, as discovery finds it. */
export const KIT: KitDefinition<EstimateBlueprint> = {
    problems: (blueprint: EstimateBlueprint): string[] => estimateBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: EstimateBlueprint, random: () => number): AnyKitGame => erase(createEstimateGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: EstimateBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<EstimateState> => createEstimateGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, estimatePersonas(blueprint.decisions), CHECK_SEEDS, options);
    },
    pauseActions: giveUpRow,
};
