// The wit kit's entry (two players answer one prompt in secret and the room votes): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createWitGame, witBlueprintProblems, type WitState } from "./wit.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { witPersonas } from "./personas.ts";
import type { WitDecisions } from "./wit.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A wit game: two players answer one prompt in secret and the room votes. */
export interface WitBlueprint {
    kit: "wit";
    box: Box;
    decisions: WitDecisions;
}

/**
 * Defines a wit game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: WitDecisions): WitBlueprint {
    return { kit: "wit", box, decisions };
}

/** The wit kit, as discovery finds it. */
export const KIT: KitDefinition<WitBlueprint> = {
    problems: (blueprint: WitBlueprint): string[] => witBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: WitBlueprint, random: () => number): AnyKitGame => erase(createWitGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: WitBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<WitState> => createWitGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, witPersonas(), CHECK_SEEDS, options);
    },
    pauseActions: NO_PAUSE,
};
