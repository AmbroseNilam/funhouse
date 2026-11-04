// The tap kit's entry (games played by tapping phones, in three styles): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { CHECK_SEEDS } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createDiceGame, diceBlueprintProblems, type DiceDecisions, type DiceState } from "./tap-dice.ts";
import { createPushGame, pushBlueprintProblems, type PushDecisions, type PushState } from "./tap-push.ts";
import { createFitsGame, fitsBlueprintProblems, type FitsDecisions, type FitsState } from "./tap-fits.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { dicePersonas, diceSecrecyCheck, pushChoiceCheck, pushPersonas, fitsPersonas, fitsTapCheck } from "./personas.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** The tap games, each its own style on the tap kit. */
export type TapDecisions = FitsDecisions | DiceDecisions | PushDecisions;

/** A tap game: people play by tapping their phones, and the host only talks. */
export interface TapBlueprint<Decisions extends TapDecisions = TapDecisions> {
    kit: "tap";
    box: Box;
    decisions: Decisions;
}


/**
 * Defines a tap game, typed to its style.
 * @param box the game's box.
 * @param decisions the style's decisions.
 * @returns the blueprint.
 */
export function defineGame<Decisions extends TapDecisions>(box: Box, decisions: Decisions): TapBlueprint<Decisions> {
    return { kit: "tap", box, decisions };
}

/** The tap kit, as discovery finds it. */
export const KIT: KitDefinition<TapBlueprint> = {
    problems(blueprint: TapBlueprint): string[] {
        if (blueprint.decisions.style === "dice") {
            return diceBlueprintProblems(blueprint.box, blueprint.decisions);
        }
        if (blueprint.decisions.style === "push") {
            return pushBlueprintProblems(blueprint.box, blueprint.decisions);
        }
        return fitsBlueprintProblems(blueprint.box, blueprint.decisions);
    },
    create(blueprint: TapBlueprint, random: () => number): AnyKitGame {
        if (blueprint.decisions.style === "dice") {
            return erase(createDiceGame(blueprint.box, blueprint.decisions, random));
        }
        if (blueprint.decisions.style === "push") {
            return erase(createPushGame(blueprint.box, blueprint.decisions, random));
        }
        return erase(createFitsGame(blueprint.box, blueprint.decisions));
    },
    check(blueprint: TapBlueprint, options: RehearsalOptions): Tally {
        if (blueprint.decisions.style === "dice") {
            const dice: DiceDecisions = blueprint.decisions;
            const makeDice = (seed: number): KitGame<DiceState> => createDiceGame(blueprint.box, dice, seededRandom(seed));
            return rehearseMany(makeDice, dicePersonas(dice), CHECK_SEEDS, { ...options, roleCheck: diceSecrecyCheck(blueprint.box, dice) });
        }
        if (blueprint.decisions.style === "push") {
            const push: TapBlueprint<PushDecisions> = { ...blueprint, decisions: blueprint.decisions };
            const makePush = (seed: number): KitGame<PushState> => createPushGame(push.box, push.decisions, seededRandom(seed));
            return rehearseMany(makePush, pushPersonas(), CHECK_SEEDS, { ...options, roleCheck: pushChoiceCheck(push) });
        }
        const fits: TapBlueprint<FitsDecisions> = { ...blueprint, decisions: blueprint.decisions };
        const makeFits = (): KitGame<FitsState> => createFitsGame(fits.box, fits.decisions);
        return rehearseMany(makeFits, fitsPersonas(), CHECK_SEEDS, { ...options, roleCheck: fitsTapCheck(fits) });
    },
    pauseActions: NO_PAUSE,
};
