// The claims kit's entry (three claims, one lie, and a host that interviews): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createClaimsGame, claimsBlueprintProblems, type ClaimsState } from "./claims.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { claimsPersonas } from "./personas.ts";
import type { ClaimsDecisions } from "./claims.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A claims game: players write three claims, one false, and a host interviews each claimant before the table votes. */
export interface ClaimsBlueprint {
    kit: "claims";
    box: Box;
    decisions: ClaimsDecisions;
}

/**
 * Defines a claims game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: ClaimsDecisions): ClaimsBlueprint {
    return { kit: "claims", box, decisions };
}

/** The claims kit, as discovery finds it. */
export const KIT: KitDefinition<ClaimsBlueprint> = {
    problems: (blueprint: ClaimsBlueprint): string[] => claimsBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: ClaimsBlueprint, random: () => number): AnyKitGame => erase(createClaimsGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: ClaimsBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<ClaimsState> => createClaimsGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, claimsPersonas(), CHECK_SEEDS, options);
    },
    pauseActions: NO_PAUSE,
};
