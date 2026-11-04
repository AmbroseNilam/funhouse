// The clue kit's entry (a secret word and one-word clues that cancel): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createClueGame, clueBlueprintProblems, type ClueState } from "./clue.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { cluePersonas } from "./personas.ts";
import type { ClueDecisions } from "./clue.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, giveUpRow, type KitDefinition } from "../../kit/definition.ts";

/** A clue game: a secret word, one-word clues that cancel when they match, one guess. */
export interface ClueBlueprint {
    kit: "clue";
    box: Box;
    decisions: ClueDecisions;
}

/**
 * Defines a clue game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: ClueDecisions): ClueBlueprint {
    return { kit: "clue", box, decisions };
}

/** The clue kit, as discovery finds it. */
export const KIT: KitDefinition<ClueBlueprint> = {
    problems: (blueprint: ClueBlueprint): string[] => clueBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: ClueBlueprint, random: () => number): AnyKitGame => erase(createClueGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: ClueBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<ClueState> => createClueGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, cluePersonas(), CHECK_SEEDS, options);
    },
    pauseActions: giveUpRow,
};
