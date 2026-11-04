// The gallery kit's entry (hands of painted cards, a clue, a vote): its blueprint type, how to define one, and how a
// blueprint runs, is checked and pauses. Discovery loads this module from the folder, so the shelf
// needs no edit when the kit is added.

import { rehearsePictureGame } from "../../check-support.ts";
import type { KitGame, Box } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createGalleryGame, galleryBlueprintProblems, type GalleryState } from "./gallery.ts";
import { type RehearsalOptions, type Tally } from "../../rehearse.ts";
import { galleryPersonas } from "./personas.ts";
import type { GalleryDecisions } from "./gallery.ts";
import type { AnyKitGame } from "../../blueprint.ts";
import { erase, NO_PAUSE, type KitDefinition } from "../../kit/definition.ts";

/** A gallery game: private hands of painted cards, a clue, a matching card from everyone, a vote. */
export interface GalleryBlueprint {
    kit: "gallery";
    box: Box;
    decisions: GalleryDecisions;
}

/**
 * Defines a gallery game, typed to this kit.
 * @param box the game's box.
 * @param decisions the kit's decisions.
 * @returns the blueprint.
 */
export function defineGame(box: Box, decisions: GalleryDecisions): GalleryBlueprint {
    return { kit: "gallery", box, decisions };
}

/** The gallery kit, as discovery finds it. */
export const KIT: KitDefinition<GalleryBlueprint> = {
    problems: (blueprint: GalleryBlueprint): string[] => galleryBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint: GalleryBlueprint, random: () => number): AnyKitGame => erase(createGalleryGame(blueprint.box, blueprint.decisions, random)),
    check(blueprint: GalleryBlueprint, options: RehearsalOptions): Tally {
        const make = (seed: number): KitGame<GalleryState> => createGalleryGame(blueprint.box, blueprint.decisions, seededRandom(seed));
        return rehearsePictureGame(make, galleryPersonas(), blueprint.decisions.voteSeconds, options);
    },
    pauseActions: NO_PAUSE,
};
