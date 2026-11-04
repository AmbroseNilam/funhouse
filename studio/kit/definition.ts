// What a kit folder must export: the definition the shelf, the room and the checks use to run a blueprint
// of that kit. Each kit builds its own from its typed blueprint; nothing shared lists the kits.

import type { AnyKitGame, Blueprint } from "../blueprint.ts";
import type { RehearsalOptions, Tally } from "../rehearse.ts";
import type { KitGame } from "./kit.ts";

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

/**
 * Hides a kit game's state type; safe because the room only ever hands a game its own state back.
 * @param game a kit game.
 * @returns the same game with its state type hidden.
 */
export function erase<State>(game: KitGame<State>): AnyKitGame {
    return game;
}

/**
 * The give-up row a kit offers when its blueprint turns the button on.
 * @param blueprint a blueprint whose decisions have a give-up switch.
 * @returns the pause row, or none.
 */
export function giveUpRow(blueprint: { decisions: { giveUpButton: boolean } }): { id: string; label: string }[] {
    return blueprint.decisions.giveUpButton === true ? [{ id: "giveup", label: "We give up" }] : [];
}

/**
 * A kit with nothing extra in the pause menu.
 * @returns no rows.
 */
export function NO_PAUSE(): { id: string; label: string }[] {
    return [];
}
