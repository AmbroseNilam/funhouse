// The oddword kit's entry (everyone but one knows the secret word): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS, SEED_SPREAD } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createOddWordGame, oddWordBlueprintProblems, type OddWordState } from "./oddword.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { oddWordPersonas, oddWordRoleCheck } from "./personas.ts";
import type { OddWordDecisions } from "./oddword.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** An odd-word game: everyone knows the secret word but one player, and says one word about it each round. */
export interface OddWordBlueprint {
    kit: "oddword";
    box: Box;
    decisions: OddWordDecisions;
}

/**
 * Defines a oddword game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: OddWordDecisions): OddWordBlueprint {
    return { kit: "oddword", box, decisions };
}

/** The oddword kit, as discovery finds it. */
export const KIT: KitDefinition<OddWordBlueprint> = {
    problems: (blueprint: OddWordBlueprint): string[] => oddWordBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: OddWordBlueprint, random: () => number): AnyKitGame => erase(createOddWordGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: OddWordBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<OddWordState> => createOddWordGame(blueprint.box, blueprint.decisions, seededRandom(seed * SEED_SPREAD));
        return rehearseMany(make, oddWordPersonas(), CHECK_SEEDS, { ...options, roleCheck: oddWordRoleCheck(blueprint) });
    },
    pauseActions: NO_PAUSE,
};
