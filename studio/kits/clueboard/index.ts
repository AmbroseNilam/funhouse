// The clueboard kit's entry (two teams, a grid of words and a hidden key): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS, SEED_SPREAD } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createClueBoardGame, clueBoardBlueprintProblems, type ClueBoardState } from "./clueboard.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { clueBoardContent, clueBoardPersonas } from "./personas.ts";
import type { ClueBoardDecisions } from "./clueboard.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A clue-board game: two teams, a shared grid of words, a hidden key and a clue-giver on each side. */
export interface ClueBoardBlueprint {
    kit: "clueboard";
    box: Box;
    decisions: ClueBoardDecisions;
}

/**
 * Defines a clueboard game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: ClueBoardDecisions): ClueBoardBlueprint {
    return { kit: "clueboard", box, decisions };
}

/** The clueboard kit, as discovery finds it. */
export const KIT: KitDefinition<ClueBoardBlueprint> = {
    problems: (blueprint: ClueBoardBlueprint): string[] => clueBoardBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: ClueBoardBlueprint, random: () => number): AnyKitGame => erase(createClueBoardGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: ClueBoardBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<ClueBoardState> => createClueBoardGame(blueprint.box, blueprint.decisions, seededRandom(seed * SEED_SPREAD));
        return rehearseMany(make, clueBoardPersonas(), CHECK_SEEDS, { contentFor: clueBoardContent, ...options });
    },
    pauseActions: NO_PAUSE,
};
