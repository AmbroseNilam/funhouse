// The charades kit's entry (one player acts a prompt in silence): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createCharadesGame, charadesBlueprintProblems, type CharadesState } from "./charades.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { charadesPersonas } from "./personas.ts";
import type { CharadesDecisions } from "./charades.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, giveUpRow, type KitDefinition } from "../../kit/definition.ts";

/** A charades game: one player acts a private prompt in silence while the rest shout guesses. */
export interface CharadesBlueprint {
    kit: "charades";
    box: Box;
    decisions: CharadesDecisions;
}

/**
 * Defines a charades game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: CharadesDecisions): CharadesBlueprint {
    return { kit: "charades", box, decisions };
}

/** The charades kit, as discovery finds it. */
export const KIT: KitDefinition<CharadesBlueprint> = {
    problems: (blueprint: CharadesBlueprint): string[] => charadesBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: CharadesBlueprint, random: () => number): AnyKitGame => erase(createCharadesGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: CharadesBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<CharadesState> => createCharadesGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, charadesPersonas(blueprint.decisions), CHECK_SEEDS, options);
    },
    pauseActions: giveUpRow,
};
