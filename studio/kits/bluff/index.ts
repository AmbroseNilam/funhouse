// The bluff kit's entry (a real fact with a blank and fakes): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { addTallies, CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { bluffBlueprintProblems, createBluffGame, type BluffState } from "./bluff.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { bluffPersonas } from "./personas.ts";
import type { BluffDecisions } from "./bluff.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A bluff game: a real fact with a blank, fakes written in secret, and a pick. */
export interface BluffBlueprint {
    kit: "bluff";
    box: Box;
    decisions: BluffDecisions;
}

/**
 * Defines a bluff game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: BluffDecisions): BluffBlueprint {
    return { kit: "bluff", box, decisions };
}

/** The bluff kit, as discovery finds it. */
export const KIT: KitDefinition<BluffBlueprint> = {
    problems: (blueprint: BluffBlueprint): string[] => bluffBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: BluffBlueprint, random: () => number): AnyKitGame => erase(createBluffGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: BluffBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<BluffState> => createBluffGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        // Once with the model failing, and once with its second look "finding" the first two answers alike,
        // which turns the first fake into the true answer, so both ways a round can go are rehearsed.
        const failing: Tally = rehearseMany(make, bluffPersonas(), CHECK_SEEDS, options);
        const matching: Tally = rehearseMany(make, bluffPersonas(), CHECK_SEEDS, { ...options, content: options.content ?? "1, 2" });
        return addTallies(failing, matching);
    },
    pauseActions: NO_PAUSE,
};
