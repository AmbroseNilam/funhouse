// The gate kit's entry (a keeper the host plays and a secret rule): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createGateGame, gateBlueprintProblems, type GateState } from "./gate.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { gatePersonas } from "./personas.ts";
import type { GateDecisions } from "./gate.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, giveUpRow, type KitDefinition } from "../../kit/definition.ts";

/** A gate game: a keeper the host plays, a secret rule code checks against each plea, and cargo words. */
export interface GateBlueprint {
    kit: "gate";
    box: Box;
    decisions: GateDecisions;
}

/**
 * Defines a gate game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: GateDecisions): GateBlueprint {
    return { kit: "gate", box, decisions };
}

/** The gate kit, as discovery finds it. */
export const KIT: KitDefinition<GateBlueprint> = {
    problems: (blueprint: GateBlueprint): string[] => gateBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: GateBlueprint, random: () => number): AnyKitGame => erase(createGateGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: GateBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<GateState> => createGateGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, gatePersonas(), CHECK_SEEDS, options);
    },
    pauseActions: giveUpRow,
};
