// The default check for any blueprint: rehearse it with its kit's paper players across seeds, with
// the model failing and succeeding, and, for a kit with a hidden role, check that who holds the
// role changes nothing anyone else sees. This is what "it passes rehearsal" means.

import type { Blueprint, TapBlueprint } from "./blueprint.ts";
import type { KitGame } from "./kit/kit.ts";
import { seededRandom } from "./kit/primitives.ts";
import { createGuessingGame, type GuessingState } from "./kits/guessing.ts";
import { createPlantGame, type PlantState } from "./kits/plant.ts";
import { createDiceGame, type DiceDecisions, type DiceState } from "./kits/tap-dice.ts";
import { createFitsGame, type FitsDecisions, type FitsState } from "./kits/tap-fits.ts";
import { dicePersonas, diceSecrecyCheck, fitsPersonas, fitsTapCheck, guessingPersonas, plantPersonas, plantRoleCheck } from "./personas.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "./rehearse.ts";

/** Seeds every blueprint is rehearsed with. */
export const CHECK_SEEDS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Rehearses a blueprint the default way.
 * @param blueprint the game.
 * @param options content and players.
 * @returns the counts and every problem found.
 */
export function checkBlueprint(blueprint: Blueprint, options: RehearsalOptions = {}): Tally {
    if (blueprint.kit === "guessing") {
        const makeGuessing = (seed: number): KitGame<GuessingState> => createGuessingGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(makeGuessing, guessingPersonas(blueprint.decisions), CHECK_SEEDS, options);
    }
    if (blueprint.kit === "plant") {
        const makePlant = (seed: number): KitGame<PlantState> => createPlantGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(makePlant, plantPersonas(), CHECK_SEEDS, { ...options, roleCheck: plantRoleCheck(blueprint) });
    }
    if (blueprint.decisions.style === "dice") {
        const dice: DiceDecisions = blueprint.decisions;
        const makeDice = (seed: number): KitGame<DiceState> => createDiceGame(blueprint.box, dice, seededRandom(seed));
        return rehearseMany(makeDice, dicePersonas(dice), CHECK_SEEDS, { ...options, roleCheck: diceSecrecyCheck(blueprint.box, dice) });
    }
    const fits: TapBlueprint<FitsDecisions> = { ...blueprint, decisions: blueprint.decisions };
    const makeFits = (): KitGame<FitsState> => createFitsGame(fits.box, fits.decisions);
    return rehearseMany(makeFits, fitsPersonas(), CHECK_SEEDS, { ...options, roleCheck: fitsTapCheck(fits) });
}
