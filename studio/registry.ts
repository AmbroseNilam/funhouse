// The one place that knows how to turn each kit's blueprint into a runnable game, check it, and read
// its pause menu. A new kit adds an import line, a type in blueprint.ts and one entry here, and
// nothing else changes; Blueprint's keys and this table must agree, which the compiler checks.

import type { Blueprint, AnyKitGame, ChainBlueprint, ClueBoardBlueprint, EstimateBlueprint, GalleryBlueprint, GateBlueprint, GuessingBlueprint, LineBlueprint, OddWordBlueprint, PlantBlueprint, StrangerBlueprint, TapBlueprint, WitBlueprint } from "./blueprint.ts";
import { CHECK_SEEDS, rehearsePictureGame, SEED_SPREAD } from "./check-support.ts";
import type { KitGame } from "./kit/kit.ts";
import { seededRandom } from "./kit/primitives.ts";
import { createGuessingGame, guessingBlueprintProblems, type GuessingState } from "./kits/guessing.ts";
import { createPlantGame, plantBlueprintProblems, type PlantState } from "./kits/plant.ts";
import { createFitsGame, fitsBlueprintProblems, type FitsState } from "./kits/tap-fits.ts";
import { createWitGame, witBlueprintProblems, type WitState } from "./kits/wit.ts";
import { createGateGame, gateBlueprintProblems, type GateState } from "./kits/gate.ts";
import { createEstimateGame, estimateBlueprintProblems, type EstimateState } from "./kits/estimate.ts";
import { createLineGame, lineBlueprintProblems, type LineState } from "./kits/line.ts";
import { createClueBoardGame, clueBoardBlueprintProblems, type ClueBoardState } from "./kits/clueboard.ts";
import { createStrangerGame, strangerBlueprintProblems, type StrangerState } from "./kits/stranger.ts";
import { createOddWordGame, oddWordBlueprintProblems, type OddWordState } from "./kits/oddword.ts";
import { createChainGame, chainBlueprintProblems, type ChainState } from "./kits/chain.ts";
import { createGalleryGame, galleryBlueprintProblems, type GalleryState } from "./kits/gallery.ts";
import { PLANT_GIVE_UP_ACTION } from "./kits/plant.ts";
import { chainPersonas, clueBoardContent, clueBoardPersonas, estimatePersonas, fitsPersonas, fitsTapCheck, galleryPersonas, gatePersonas, guessingPersonas, linePersonas, oddWordPersonas, oddWordRoleCheck, plantPersonas, plantRoleCheck, strangerPersonas, strangerRoleCheck } from "./personas.ts";
import { witPersonas } from "./personas-text.ts";
import { rehearseMany, type RehearsalOptions, type Tally } from "./rehearse.ts";

/** What the shelf needs to know about one kit's blueprints. */
export interface KitDefinition<B extends Blueprint> {
    /** The problems that make a blueprint unrunnable; empty when it runs. */
    problems(blueprint: B): string[];
    /** A running game. */
    create(blueprint: B, random: () => number): AnyKitGame;
    /** The default rehearsal. */
    check(blueprint: B, options: RehearsalOptions): Tally;
    /** The rows the game adds to the pause menu. */
    pauseActions(blueprint: B): { id: string; label: string }[];
}

/** Hides a kit game's state type; safe because the room only ever hands a game its own state back. */
function erase<State>(game: KitGame<State>): AnyKitGame {
    return game;
}

/** A kit with nothing extra in the pause menu. */
const NO_PAUSE = (): { id: string; label: string }[] => [];

/** Every kit, by the name blueprints give it. */
export const KITS: { [Name in Blueprint["kit"]]: KitDefinition<Extract<Blueprint, { kit: Name }>> } = {
    guessing: {
        problems: (blueprint: GuessingBlueprint): string[] => guessingBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: GuessingBlueprint, random: () => number): AnyKitGame => erase(createGuessingGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: GuessingBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<GuessingState> => createGuessingGame(blueprint.box, blueprint.decisions, seededRandom(seed));
            return rehearseMany(make, guessingPersonas(blueprint.decisions), CHECK_SEEDS, options);
        },
        pauseActions: (blueprint: GuessingBlueprint) => (blueprint.decisions.giveUpButton === true ? [{ id: "giveup", label: "We give up" }] : []),
    },
    plant: {
        problems: (blueprint: PlantBlueprint): string[] => plantBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: PlantBlueprint, random: () => number): AnyKitGame => erase(createPlantGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: PlantBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<PlantState> => createPlantGame(blueprint.box, blueprint.decisions, seededRandom(seed));
            return rehearseMany(make, plantPersonas(), CHECK_SEEDS, { ...options, roleCheck: plantRoleCheck(blueprint) });
        },
        pauseActions: () => [{ id: PLANT_GIVE_UP_ACTION, label: "We give up" }],
    },
    tap: {
        problems: (blueprint: TapBlueprint): string[] => fitsBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: TapBlueprint): AnyKitGame => erase(createFitsGame(blueprint.box, blueprint.decisions)),
        check(blueprint: TapBlueprint, options: RehearsalOptions): Tally {
            const make = (): KitGame<FitsState> => createFitsGame(blueprint.box, blueprint.decisions);
            return rehearseMany(make, fitsPersonas(), CHECK_SEEDS, { ...options, roleCheck: fitsTapCheck(blueprint) });
        },
        pauseActions: NO_PAUSE,
    },
    wit: {
        problems: (blueprint: WitBlueprint): string[] => witBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: WitBlueprint, random: () => number): AnyKitGame => erase(createWitGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: WitBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<WitState> => createWitGame(blueprint.box, blueprint.decisions, seededRandom(seed));
            return rehearseMany(make, witPersonas(), CHECK_SEEDS, options);
        },
        pauseActions: NO_PAUSE,
    },
    gate: {
        problems: (blueprint: GateBlueprint): string[] => gateBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: GateBlueprint, random: () => number): AnyKitGame => erase(createGateGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: GateBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<GateState> => createGateGame(blueprint.box, blueprint.decisions, seededRandom(seed));
            return rehearseMany(make, gatePersonas(), CHECK_SEEDS, options);
        },
        pauseActions: NO_PAUSE,
    },
    estimate: {
        problems: (blueprint: EstimateBlueprint): string[] => estimateBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: EstimateBlueprint, random: () => number): AnyKitGame => erase(createEstimateGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: EstimateBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<EstimateState> => createEstimateGame(blueprint.box, blueprint.decisions, seededRandom(seed));
            return rehearseMany(make, estimatePersonas(blueprint.decisions), CHECK_SEEDS, options);
        },
        pauseActions: NO_PAUSE,
    },
    line: {
        problems: (blueprint: LineBlueprint): string[] => lineBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: LineBlueprint, random: () => number): AnyKitGame => erase(createLineGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: LineBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<LineState> => createLineGame(blueprint.box, blueprint.decisions, seededRandom(seed));
            return rehearseMany(make, linePersonas(blueprint.decisions), CHECK_SEEDS, options);
        },
        pauseActions: NO_PAUSE,
    },
    clueboard: {
        problems: (blueprint: ClueBoardBlueprint): string[] => clueBoardBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: ClueBoardBlueprint, random: () => number): AnyKitGame => erase(createClueBoardGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: ClueBoardBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<ClueBoardState> => createClueBoardGame(blueprint.box, blueprint.decisions, seededRandom(seed * SEED_SPREAD));
            return rehearseMany(make, clueBoardPersonas(), CHECK_SEEDS, { contentFor: clueBoardContent, ...options });
        },
        pauseActions: NO_PAUSE,
    },
    stranger: {
        problems: (blueprint: StrangerBlueprint): string[] => strangerBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: StrangerBlueprint, random: () => number): AnyKitGame => erase(createStrangerGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: StrangerBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<StrangerState> => createStrangerGame(blueprint.box, blueprint.decisions, seededRandom(seed * SEED_SPREAD));
            return rehearseMany(make, strangerPersonas(), CHECK_SEEDS, { ...options, roleCheck: strangerRoleCheck(blueprint) });
        },
        pauseActions: NO_PAUSE,
    },
    oddword: {
        problems: (blueprint: OddWordBlueprint): string[] => oddWordBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: OddWordBlueprint, random: () => number): AnyKitGame => erase(createOddWordGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: OddWordBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<OddWordState> => createOddWordGame(blueprint.box, blueprint.decisions, seededRandom(seed * SEED_SPREAD));
            return rehearseMany(make, oddWordPersonas(), CHECK_SEEDS, { ...options, roleCheck: oddWordRoleCheck(blueprint) });
        },
        pauseActions: NO_PAUSE,
    },
    chain: {
        problems: (blueprint: ChainBlueprint): string[] => chainBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: ChainBlueprint, random: () => number): AnyKitGame => erase(createChainGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: ChainBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<ChainState> => createChainGame(blueprint.box, blueprint.decisions, seededRandom(seed));
            return rehearsePictureGame(make, chainPersonas(), blueprint.decisions.paintSeconds, options);
        },
        pauseActions: NO_PAUSE,
    },
    gallery: {
        problems: (blueprint: GalleryBlueprint): string[] => galleryBlueprintProblems(blueprint.box, blueprint.decisions),
        create: (blueprint: GalleryBlueprint, random: () => number): AnyKitGame => erase(createGalleryGame(blueprint.box, blueprint.decisions, random)),
        check(blueprint: GalleryBlueprint, options: RehearsalOptions): Tally {
            const make = (seed: number): KitGame<GalleryState> => createGalleryGame(blueprint.box, blueprint.decisions, seededRandom(seed));
            return rehearsePictureGame(make, galleryPersonas(), blueprint.decisions.voteSeconds, options);
        },
        pauseActions: NO_PAUSE,
    },
};
