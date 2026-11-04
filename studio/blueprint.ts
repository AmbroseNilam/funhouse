// A blueprint is a game as data: which kit it is, the decisions on that kit, and its box. Studio
// edits blueprints; the kit turns one into a cartridge the room can run. A blueprint never holds
// words the host is told: kits own those, so no creator text reaches the host's brief except short
// checked names. This file is the one place that knows every kit.

import type { Cartridge } from "../shared/cartridge.ts";
import type { Box, HiddenValue, KitGame } from "./kit/kit.ts";
import { createGuessingGame, guessingBlueprintProblems, type GuessingDecisions } from "./kits/guessing.ts";
import { createPlantGame, PLANT_GIVE_UP_ACTION, plantBlueprintProblems, type PlantDecisions } from "./kits/plant.ts";
import { createFitsGame, fitsBlueprintProblems, type FitsDecisions } from "./kits/tap-fits.ts";

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

/** The tap games, each its own style on the tap kit. */
export type TapDecisions = FitsDecisions;

/** A tap game: people play by tapping their phones, and the host only talks. */
export interface TapBlueprint {
    kit: "tap";
    box: Box;
    decisions: TapDecisions;
}

/** Any game as data. */
export type Blueprint = GuessingBlueprint | PlantBlueprint | TapBlueprint;

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
    if (blueprint.kit === "plant") {
        return plantBlueprintProblems(blueprint.box, blueprint.decisions);
    }
    return fitsBlueprintProblems(blueprint.box, blueprint.decisions);
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
    if (blueprint.kit === "plant") {
        return erase(createPlantGame(blueprint.box, blueprint.decisions, random));
    }
    return erase(createFitsGame(blueprint.box, blueprint.decisions));
}

/**
 * The rows a game adds to the pause menu, so one stray tap can't end it.
 * @param blueprint the game.
 * @returns the actions, by id and label.
 */
export function blueprintPauseActions(blueprint: Blueprint): { id: string; label: string }[] {
    if (blueprint.kit === "guessing") {
        return blueprint.decisions.giveUpButton === true ? [{ id: "giveup", label: "We give up" }] : [];
    }
    if (blueprint.kit === "plant") {
        return [{ id: PLANT_GIVE_UP_ACTION, label: "We give up" }];
    }
    return [];
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
