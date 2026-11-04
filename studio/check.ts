// The default check for any blueprint: rehearse it with its kit's paper players across seeds, with
// the model failing and succeeding, and, for a kit with a hidden role, check that who holds the
// role changes nothing anyone else sees. This is what "it passes rehearsal" means.

import type { Blueprint, TapBlueprint } from "./blueprint.ts";
import type { KitGame } from "./kit/kit.ts";
import { seededRandom } from "./kit/primitives.ts";
import { createEstimateGame, type EstimateState } from "./kits/estimate.ts";
import { createGateGame, type GateState } from "./kits/gate.ts";
import { createLineGame, type LineState } from "./kits/line.ts";
import { createGuessingGame, type GuessingState } from "./kits/guessing.ts";
import { createPlantGame, type PlantState } from "./kits/plant.ts";
import { createFitsGame, type FitsDecisions, type FitsState } from "./kits/tap-fits.ts";
import { createWitGame, type WitState } from "./kits/wit.ts";
import { clueBoardContent, clueBoardPersonas, estimatePersonas, fitsPersonas, fitsTapCheck, gatePersonas, guessingPersonas, linePersonas, oddWordPersonas, oddWordRoleCheck, plantPersonas, plantRoleCheck, strangerPersonas, strangerRoleCheck } from "./personas.ts";
import { witPersonas } from "./personas-text.ts";
import { createClueBoardGame, type ClueBoardState } from "./kits/clueboard.ts";
import { createOddWordGame, type OddWordState } from "./kits/oddword.ts";
import { createStrangerGame, type StrangerState } from "./kits/stranger.ts";

import { rehearseMany, type RehearsalOptions, type Tally } from "./rehearse.ts";

/** Seeds every blueprint is rehearsed with. */
export const CHECK_SEEDS: readonly number[] = [1, 2, 3, 4, 5];

/** Multiplies a seed so the first draws of nearby seeds don't all land on the same seat or team. */
const SEED_SPREAD: number = 104729;

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
    if (blueprint.kit === "wit") {
        const makeWit = (seed: number): KitGame<WitState> => createWitGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(makeWit, witPersonas(), CHECK_SEEDS, options);
    }
    if (blueprint.kit === "gate") {
        const makeGate = (seed: number): KitGame<GateState> => createGateGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(makeGate, gatePersonas(), CHECK_SEEDS, options);
    }
    if (blueprint.kit === "estimate") {
        const makeEstimate = (seed: number): KitGame<EstimateState> => createEstimateGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(makeEstimate, estimatePersonas(blueprint.decisions), CHECK_SEEDS, options);
    }
    if (blueprint.kit === "line") {
        const makeLine = (seed: number): KitGame<LineState> => createLineGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearseMany(makeLine, linePersonas(blueprint.decisions), CHECK_SEEDS, options);
    }
    if (blueprint.kit === "clueboard") {
        const makeBoard = (seed: number): KitGame<ClueBoardState> => createClueBoardGame(blueprint.box, blueprint.decisions, seededRandom(seed * SEED_SPREAD));
        return rehearseMany(makeBoard, clueBoardPersonas(), CHECK_SEEDS, { contentFor: clueBoardContent, ...options });
    }
    if (blueprint.kit === "stranger") {
        const makeStranger = (seed: number): KitGame<StrangerState> => createStrangerGame(blueprint.box, blueprint.decisions, seededRandom(seed * SEED_SPREAD));
        return rehearseMany(makeStranger, strangerPersonas(), CHECK_SEEDS, { ...options, roleCheck: strangerRoleCheck(blueprint) });
    }
    if (blueprint.kit === "oddword") {
        const makeOddWord = (seed: number): KitGame<OddWordState> => createOddWordGame(blueprint.box, blueprint.decisions, seededRandom(seed * SEED_SPREAD));
        return rehearseMany(makeOddWord, oddWordPersonas(), CHECK_SEEDS, { ...options, roleCheck: oddWordRoleCheck(blueprint) });
    }
    const fits: TapBlueprint & { decisions: FitsDecisions } = { ...blueprint, decisions: blueprint.decisions };
    const makeFits = (): KitGame<FitsState> => createFitsGame(fits.box, fits.decisions);
    return rehearseMany(makeFits, fitsPersonas(), CHECK_SEEDS, { ...options, roleCheck: fitsTapCheck(fits) });
}
