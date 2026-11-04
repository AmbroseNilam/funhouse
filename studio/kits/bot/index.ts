// The bot kit's entry (the host writes one answer among the humans'): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { addTallies, CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { botBlueprintProblems, createBotGame, type BotState } from "./bot.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { botPersonas } from "./personas.ts";
import type { BotDecisions } from "./bot.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A bot game: everyone answers in secret, the host writes one more, and the table votes for the machine's. */
export interface BotBlueprint {
    kit: "bot";
    box: Box;
    decisions: BotDecisions;
}

/**
 * Defines a bot game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: BotDecisions): BotBlueprint {
    return { kit: "bot", box, decisions };
}

/** The bot kit, as discovery finds it. */
export const KIT: KitDefinition<BotBlueprint> = {
    problems: (blueprint: BotBlueprint): string[] => botBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: BotBlueprint, random: () => number): AnyKitGame => erase(createBotGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: BotBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<BotState> => createBotGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        // Once with the model failing, and once with it writing one line for everything it is asked, which
        // gives the game a prompt of the model's and a machine's answer of the model's to place among the humans'.
        const failing: Tally = rehearseMany(make, botPersonas(), CHECK_SEEDS, options);
        const writing: Tally = rehearseMany(make, botPersonas(), CHECK_SEEDS, { ...options, content: options.content ?? "Gerald the goldfish" });
        return addTallies(failing, writing);
    },
    pauseActions: NO_PAUSE,
};
