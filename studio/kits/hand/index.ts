// The hand kit's entry (dealt cards and a rotating judge): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createHandGame, handBlueprintProblems, type HandState } from "./hand.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { handPersonas } from "./personas.ts";
import type { HandDecisions } from "./hand.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A hand game: dealt cards on phones, a rotating judge, a prompt with a gap. */
export interface HandBlueprint {
    kit: "hand";
    box: Box;
    decisions: HandDecisions;
}

/**
 * Defines a hand game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: HandDecisions): HandBlueprint {
    return { kit: "hand", box, decisions };
}

/** The hand kit, as discovery finds it. */
export const KIT: KitDefinition<HandBlueprint> = {
    problems: (blueprint: HandBlueprint): string[] => handBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: HandBlueprint, random: () => number): AnyKitGame => erase(createHandGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: HandBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<HandState> => createHandGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, handPersonas(), CHECK_SEEDS, options);
    },
    pauseActions: NO_PAUSE,
};
