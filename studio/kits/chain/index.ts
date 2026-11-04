// The chain kit's entry (lines and paintings passed round the table): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { rehearsePictureGame } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createChainGame, chainBlueprintProblems, type ChainState } from "./chain.ts";
import { type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { chainPersonas } from "./personas.ts";
import type { ChainDecisions } from "./chain.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A chain game: lines and paintings passed round the table, then shown in full. */
export interface ChainBlueprint {
    kit: "chain";
    box: Box;
    decisions: ChainDecisions;
}

/**
 * Defines a chain game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: ChainDecisions): ChainBlueprint {
    return { kit: "chain", box, decisions };
}

/** The chain kit, as discovery finds it. */
export const KIT: KitDefinition<ChainBlueprint> = {
    problems: (blueprint: ChainBlueprint): string[] => chainBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: ChainBlueprint, random: () => number): AnyKitGame => erase(createChainGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: ChainBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<ChainState> => createChainGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearsePictureGame(make, chainPersonas(), blueprint.decisions.paintSeconds, options);
    },
    pauseActions: NO_PAUSE,
};
