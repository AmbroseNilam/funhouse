// The identity kit's entry (every player wears a name tag the others can see): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createIdentityGame, identityBlueprintProblems, type IdentityState } from "./identity.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { identityNameCheck, identityPersonas } from "./personas.ts";
import type { IdentityDecisions } from "./identity.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** An identity game: every player wears a name tag the others can see, and works out who they are by asking. */
export interface IdentityBlueprint {
    kit: "identity";
    box: Box;
    decisions: IdentityDecisions;
}

/**
 * Defines a identity game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: IdentityDecisions): IdentityBlueprint {
    return { kit: "identity", box, decisions };
}

/** The identity kit, as discovery finds it. */
export const KIT: KitDefinition<IdentityBlueprint> = {
    problems: (blueprint: IdentityBlueprint): string[] => identityBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: IdentityBlueprint, random: () => number): AnyKitGame => erase(createIdentityGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: IdentityBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<IdentityState> => createIdentityGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, identityPersonas(), CHECK_SEEDS, { ...options, roleCheck: identityNameCheck(blueprint) });
    },
    pauseActions: NO_PAUSE,
};
