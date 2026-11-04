// The guessing kit's entry (a secret the host holds, a judge, a count): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createGuessingGame, guessingBlueprintProblems, type GuessingState } from "./guessing.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { guessingPersonas } from "./personas.ts";
import type { GuessingDecisions } from "./guessing.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, type KitDefinition } from "../../kit/definition.ts";

/** A guessing game: a secret the host holds, a judge, a count. */
export interface GuessingBlueprint {
    kit: "guessing";
    box: Box;
    decisions: GuessingDecisions;
}

/**
 * Defines a guessing game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: GuessingDecisions): GuessingBlueprint {
    return { kit: "guessing", box, decisions };
}

/** The guessing kit, as discovery finds it. */
export const KIT: KitDefinition<GuessingBlueprint> = {
    problems: (blueprint: GuessingBlueprint): string[] => guessingBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: GuessingBlueprint, random: () => number): AnyKitGame => erase(createGuessingGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: GuessingBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<GuessingState> => createGuessingGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, guessingPersonas(blueprint.decisions), CHECK_SEEDS, options);
    },
    pauseActions: (blueprint: GuessingBlueprint) => (blueprint.decisions.giveUpButton === true ? [{ id: "giveup", label: "We give up" }] : []),
};
