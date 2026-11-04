// The plant kit's entry (a word the host holds, one player who knows it, questions, a vote): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createPlantGame, plantBlueprintProblems, type PlantState, PLANT_GIVE_UP_ACTION } from "./plant.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { plantPersonas, plantRoleCheck } from "./personas.ts";
import type { PlantDecisions } from "./plant.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, type KitDefinition } from "../../kit/definition.ts";

/** A plant game: a word the host holds, one player who knows it, questions, a vote. */
export interface PlantBlueprint {
    kit: "plant";
    box: Box;
    decisions: PlantDecisions;
}

/**
 * Defines a plant game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: PlantDecisions): PlantBlueprint {
    return { kit: "plant", box, decisions };
}

/** The plant kit, as discovery finds it. */
export const KIT: KitDefinition<PlantBlueprint> = {
    problems: (blueprint: PlantBlueprint): string[] => plantBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: PlantBlueprint, random: () => number): AnyKitGame => erase(createPlantGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: PlantBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<PlantState> => createPlantGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, plantPersonas(), CHECK_SEEDS, { ...options, roleCheck: plantRoleCheck(blueprint) });
    },
    pauseActions: () => [{ id: PLANT_GIVE_UP_ACTION, label: "We give up" }],
};
