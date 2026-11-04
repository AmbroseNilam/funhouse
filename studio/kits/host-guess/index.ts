// The hostGuess kit's entry (players hold a thing in secret and the host asks questions): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createHostGuessGame, hostGuessBlueprintProblems, type HostGuessState } from "./host-guess.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { hostGuessPersonas } from "./personas.ts";
import type { HostGuessDecisions } from "./host-guess.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A host-guess game: the players hold a thing in secret and the host asks questions to find it. */
export interface HostGuessBlueprint {
    kit: "hostGuess";
    box: Box;
    decisions: HostGuessDecisions;
}

/**
 * Defines a hostGuess game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: HostGuessDecisions): HostGuessBlueprint {
    return { kit: "hostGuess", box, decisions };
}

/** The hostGuess kit, as discovery finds it. */
export const KIT: KitDefinition<HostGuessBlueprint> = {
    problems: (blueprint: HostGuessBlueprint): string[] => hostGuessBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: HostGuessBlueprint, random: () => number): AnyKitGame => erase(createHostGuessGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: HostGuessBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<HostGuessState> => createHostGuessGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(make, hostGuessPersonas(blueprint.decisions), CHECK_SEEDS, options);
    },
    pauseActions: NO_PAUSE,
};
