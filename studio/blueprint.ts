// A blueprint is a game as data: which kit it is, the decisions on that kit, and its box. Studio
// edits blueprints; the kit turns one into a cartridge the room can run. A blueprint never holds
// words the host is told: kits own those, so no creator text reaches the host's brief except short
// checked names. This file knows no kit: each kit folder types its own blueprint and discovery finds it.

import type { Cartridge } from "../shared/cartridge.ts";
import type { Box, HiddenValue } from "./kit/kit.ts";
import type { KitDefinition } from "./kit/definition.ts";
import { KITS } from "./registry.ts";

/** Any game as data. Each kit folder narrows `decisions` to its own type and `kit` to its own name. */
export interface Blueprint {
    kit: string;
    box: Box;
    decisions: unknown;
}

/** The kits, by the name blueprints give them. */
export type Kits = Readonly<Record<string, KitDefinition<Blueprint>>>;

/** A running game of any kit, with its state hidden behind the cartridge. */
export interface AnyKitGame {
    cartridge: Cartridge<unknown>;
    hidden(state: unknown): HiddenValue[];
}

/**
 * A blueprint's kit, looked up by the name the blueprint gives it.
 * @param blueprint the blueprint.
 * @param kits the kits to look in.
 * @returns the kit's definition.
 */
function kitOf(blueprint: Blueprint, kits: Kits): KitDefinition<Blueprint> {
    const kit: KitDefinition<Blueprint> | undefined = kits[blueprint.kit];
    if (kit === undefined) {
        throw new Error(`Game ${blueprint.box.id} names the kit "${blueprint.kit}", which does not exist.`);
    }
    return kit;
}

/**
 * Checks a blueprint is one its kit can run. Studio never offers a value that fails this, so a
 * creator cannot make an unrunnable game; the check guards hand-written and stored blueprints.
 * @param blueprint the blueprint.
 * @param kits the kits to look in; the discovered ones unless a test gives its own.
 * @returns the problems found, in plain words; empty when it is runnable.
 */
export function blueprintProblems(blueprint: Blueprint, kits: Kits = KITS): string[] {
    return kitOf(blueprint, kits).problems(blueprint);
}

/**
 * Builds a running game from a blueprint. The kit copies what it is given, so changing the
 * blueprint afterwards never reaches a game in progress.
 * @param blueprint a runnable blueprint.
 * @param random a function returning [0, 1).
 * @param kits the kits to look in; the discovered ones unless a test gives its own.
 * @returns the game.
 */
export function createKitGame(blueprint: Blueprint, random: () => number = Math.random, kits: Kits = KITS): AnyKitGame {
    return kitOf(blueprint, kits).create(blueprint, random);
}

/**
 * The rows a game adds to the pause menu, so one stray tap can't end it.
 * @param blueprint the game.
 * @param kits the kits to look in; the discovered ones unless a test gives its own.
 * @returns the actions, by id and label.
 */
export function blueprintPauseActions(blueprint: Blueprint, kits: Kits = KITS): { id: string; label: string }[] {
    return kitOf(blueprint, kits).pauseActions(blueprint);
}
