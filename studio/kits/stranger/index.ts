// The stranger kit's entry (everyone but one knows the place): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS, SEED_SPREAD } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createStrangerGame, strangerBlueprintProblems, type StrangerState } from "./stranger.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { strangerPersonas, strangerRoleCheck } from "./personas.ts";
import type { StrangerDecisions } from "./stranger.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A stranger game: everyone but one player knows the place, and they question each other in turn. */
export interface StrangerBlueprint {
    kit: "stranger";
    box: Box;
    decisions: StrangerDecisions;
}

/**
 * Defines a stranger game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: StrangerDecisions): StrangerBlueprint {
    return { kit: "stranger", box, decisions };
}

/** The stranger kit, as discovery finds it. */
export const KIT: KitDefinition<StrangerBlueprint> = {
    problems: (blueprint: StrangerBlueprint): string[] => strangerBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: StrangerBlueprint, random: () => number): AnyKitGame => erase(createStrangerGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: StrangerBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<StrangerState> => createStrangerGame(blueprint.box, blueprint.decisions, seededRandom(seed * SEED_SPREAD));
        return rehearseMany(make, strangerPersonas(), CHECK_SEEDS, { ...options, roleCheck: strangerRoleCheck(blueprint) });
    },
    pauseActions: NO_PAUSE,
};
