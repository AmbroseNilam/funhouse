// The line kit's entry (a row of dated cards and a gap to place a new one): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createLineGame, lineBlueprintProblems, type LineState } from "./line.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { linePersonas } from "./personas.ts";
import type { LineDecisions } from "./line.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, giveUpRow, type KitDefinition } from "../../kit/definition.ts";

/** A line game: a row of dated cards, a new card each round, and a pick of which gap it goes in. */
export interface LineBlueprint {
    kit: "line";
    box: Box;
    decisions: LineDecisions;
}

/**
 * Defines a line game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: LineDecisions): LineBlueprint {
    return { kit: "line", box, decisions };
}

/** The line kit, as discovery finds it. */
export const KIT: KitDefinition<LineBlueprint> = {
    problems: (blueprint: LineBlueprint): string[] => lineBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: LineBlueprint, random: () => number): AnyKitGame => erase(createLineGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: LineBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<LineState> => createLineGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, linePersonas(blueprint.decisions), CHECK_SEEDS, options);
    },
    pauseActions: giveUpRow,
};
