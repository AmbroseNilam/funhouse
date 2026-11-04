// The match kit's entry (everyone types a card to match the room, and code stacks the cards): its
// blueprint type, how to define one, and how a blueprint runs, is checked and pauses. Discovery
// loads this module from the folder, so the shelf needs no edit when the kit is added.

import { addTallies, CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createMatchGame, matchBlueprintProblems, type MatchState } from "./match.ts";
import { PAPER_PLAYERS, rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { matchPersonas, PAPER_SAME_REPLY } from "./personas.ts";
import type { MatchDecisions } from "./match.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A match game: everyone types a card for one prompt and the room stacks the cards that match. */
export interface MatchBlueprint {
    kit: "match";
    box: Box;
    decisions: MatchDecisions;
}

/**
 * Defines a match game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: MatchDecisions): MatchBlueprint {
    return { kit: "match", box, decisions };
}

/** The match kit, as discovery finds it. */
export const KIT: KitDefinition<MatchBlueprint> = {
    problems: (blueprint: MatchBlueprint): string[] => matchBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: MatchBlueprint, random: () => number): AnyKitGame => erase(createMatchGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: MatchBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<MatchState> => createMatchGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        const contentFor = (request: string): string => (request.includes("are the two answers the same thing") === true ? PAPER_SAME_REPLY : options.content ?? "");
        const full: RehearsalOptions = { ...options, contentFor: options.contentFor ?? contentFor };
        const table: Tally = rehearseMany(make, matchPersonas(), CHECK_SEEDS, full);
        const three: Tally = rehearseMany(make, matchPersonas(), CHECK_SEEDS, { ...full, players: (options.players ?? PAPER_PLAYERS).slice(0, 3) });
        return addTallies(table, three);
    },
    pauseActions: NO_PAUSE,
};
