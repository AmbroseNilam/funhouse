// A blueprint is a game as data: which kit it is, the decisions on that kit, and its box. Studio
// edits blueprints; the kit turns one into a cartridge the room can run. A blueprint never holds
// words the host is told: kits own those, so no creator text reaches the host's brief except short
// checked names. This file is the one place that knows every kit.

import type { Cartridge } from "../shared/cartridge.ts";
import type { Box, HiddenValue, KitGame } from "./kit/kit.ts";
import { chainBlueprintProblems, createChainGame, type ChainDecisions } from "./kits/chain.ts";
import { createGalleryGame, galleryBlueprintProblems, type GalleryDecisions } from "./kits/gallery.ts";
import { createGuessingGame, guessingBlueprintProblems, type GuessingDecisions } from "./kits/guessing.ts";
import { createPlantGame, plantBlueprintProblems, type PlantDecisions } from "./kits/plant.ts";

/** A guessing game: a secret the host holds, a judge, a count. */
export interface GuessingBlueprint {
    kit: "guessing";
    box: Box;
    decisions: GuessingDecisions;
}

/** A plant game: a word the host holds, one player who knows it, questions, a vote. */
export interface PlantBlueprint {
    kit: "plant";
    box: Box;
    decisions: PlantDecisions;
}

/** A chain game: lines and paintings passed round the table, then shown in full. */
export interface ChainBlueprint {
    kit: "chain";
    box: Box;
    decisions: ChainDecisions;
}

/** A gallery game: private hands of painted cards, a clue, a matching card from everyone, a vote. */
export interface GalleryBlueprint {
    kit: "gallery";
    box: Box;
    decisions: GalleryDecisions;
}

/** Any game as data. */
export type Blueprint = GuessingBlueprint | PlantBlueprint | ChainBlueprint | GalleryBlueprint;

/** A running game of any kit, with its state hidden behind the cartridge. */
export interface AnyKitGame {
    cartridge: Cartridge<unknown>;
    hidden(state: unknown): HiddenValue[];
}

/**
 * Checks a blueprint is one its kit can run. Studio never offers a value that fails this, so a
 * creator cannot make an unrunnable game; the check guards hand-written and stored blueprints.
 * @param blueprint the blueprint.
 * @returns the problems found, in plain words; empty when it is runnable.
 */
export function blueprintProblems(blueprint: Blueprint): string[] {
    if (blueprint.kit === "guessing") {
        return guessingBlueprintProblems(blueprint.box, blueprint.decisions);
    }
    if (blueprint.kit === "chain") {
        return chainBlueprintProblems(blueprint.box, blueprint.decisions);
    }
    if (blueprint.kit === "gallery") {
        return galleryBlueprintProblems(blueprint.box, blueprint.decisions);
    }
    return plantBlueprintProblems(blueprint.box, blueprint.decisions);
}

/**
 * Builds a running game from a blueprint. The kit copies what it is given, so changing the
 * blueprint afterwards never reaches a game in progress.
 * @param blueprint a runnable blueprint.
 * @param random a function returning [0, 1).
 * @returns the game.
 */
export function createKitGame(blueprint: Blueprint, random: () => number = Math.random): AnyKitGame {
    if (blueprint.kit === "guessing") {
        return erase(createGuessingGame(blueprint.box, blueprint.decisions, random));
    }
    if (blueprint.kit === "chain") {
        return erase(createChainGame(blueprint.box, blueprint.decisions, random));
    }
    if (blueprint.kit === "gallery") {
        return erase(createGalleryGame(blueprint.box, blueprint.decisions, random));
    }
    return erase(createPlantGame(blueprint.box, blueprint.decisions, random));
}

/**
 * Hides a kit game's state type, so the shelf and room can hold games of any kit. Safe because
 * the room only ever passes a game's own state back to it; TypeScript allows it because methods
 * compare their parameters both ways.
 * @param game a kit game.
 * @returns the same game.
 */
function erase<State>(game: KitGame<State>): AnyKitGame {
    return game;
}

/**
 * The buttons a game offers in the pause menu. Only games with a way to give up have one.
 * @param blueprint the blueprint.
 * @returns the actions.
 */
export function pauseActionsOf(blueprint: Blueprint): { id: string; label: string }[] {
    const gives: boolean = blueprint.kit === "plant" || (blueprint.kit === "guessing" && blueprint.decisions.giveUpButton === true);
    return gives === true ? [{ id: "giveup", label: "We give up" }] : [];
}
