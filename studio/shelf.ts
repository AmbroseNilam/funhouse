// Puts the discovered blueprint games on a shelf. installBlueprint makes the InstalledGame the room expects
// from a blueprint, and studioShelf swaps blueprint versions in for hand-written games with the
// same id and adds blueprint games with new ids after them. Which games exist, and which are held,
// comes from the game folders' metadata (see discovery.ts). Each game started from a blueprint
// logs one line naming the kit and id, so a run can prove which version played; it never logs
// what anyone said, what the host replied, or a name.

import type { InstalledGame } from "../cartridges/index.ts";
import { GameSession, type GameStage, type RunningGame } from "../room/game-session.ts";
import { log } from "../room/log.ts";
import { blueprintPauseActions, blueprintProblems, createKitGame, type Blueprint, type Kits } from "./blueprint.ts";
import type { Catalog, DiscoveredGame, GameLevel } from "./discovery.ts";
import { CATALOG, KITS } from "./registry.ts";
import { frozenCopy } from "./kit/primitives.ts";

/** The blueprints Studio ships with, in shelf order. */
export const BLUEPRINTS: readonly Blueprint[] = CATALOG.games.map((game: DiscoveredGame) => game.blueprint);

/**
 * Games that are built and pass their scripted checks but stay off the shelf until a run against the real
 * thing clears them: each id maps to what is still missing. A game is held by saying so in its game.meta.json,
 * and cleared by changing its level to "visible". A room started with STUDIO_SHOW_HELD=1 shows them anyway, for the
 * scripted runs that prove them.
 */
export const HELD_BACK: Readonly<Record<string, string>> = reasonsFor(CATALOG, "held");

/**
 * The reason each game at a level gives for not being visible yet.
 * @param catalog the discovered games.
 * @param level the level to list.
 * @returns reasons by game id.
 */
function reasonsFor(catalog: Catalog, level: GameLevel): Record<string, string> {
    const reasons: Record<string, string> = {};
    for (const game of catalog.games) {
        if (game.meta.level === level) {
            reasons[game.meta.id] = game.meta.reason ?? "";
        }
    }
    return reasons;
}

/**
 * Makes an installable game from a blueprint. The blueprint is copied first, so changing it
 * afterwards changes neither the shelf entry nor any game started from it.
 * @param given a runnable blueprint.
 * @param kits the kits it may run on.
 * @returns the game, ready for a shelf.
 * @throws when the blueprint is not runnable, naming the problems.
 */
export function installBlueprint(given: Blueprint, kits: Kits = KITS): InstalledGame {
    const blueprint: Blueprint = frozenCopy(given);
    const problems: string[] = blueprintProblems(blueprint, kits);
    if (problems.length > 0) {
        throw new Error(`Blueprint ${blueprint.box.id} can't run: ${problems.join(" ")}`);
    }
    return {
        manifest: createKitGame(blueprint, Math.random, kits).cartridge.manifest,
        pitch: blueprint.box.pitch,
        howToPlay: [...blueprint.box.howToPlay],
        art: blueprint.box.art,
        pauseActions: blueprintPauseActions(blueprint, kits),
        remarks: [...blueprint.box.remarks],
        startCard: [...blueprint.box.howToPlay],
        create: (stage: GameStage): RunningGame => {
            log("studio", `starting blueprint ${blueprint.box.id} on the ${blueprint.kit} kit`);
            return new GameSession(createKitGame(blueprint, Math.random, kits).cartridge, stage);
        },
    };
}

/**
 * A shelf where every shipped blueprint stands in for the hand-written game with the same id,
 * and blueprints with new ids come after the hand-written games. A game that can't be installed is
 * logged and left off, so a hand-written game it would replace stays on the shelf.
 * @param handWritten the games written in TypeScript.
 * @param showHeld true to include the games on hold or in testing, each marked as testing in its pitch.
 * @param catalog the games and kits to build from; the discovered ones unless a test gives its own.
 * @returns the shelf.
 */
export function studioShelf(handWritten: InstalledGame[], showHeld: boolean = false, catalog: Catalog = CATALOG): InstalledGame[] {
    const shown: DiscoveredGame[] = catalog.games.filter((game: DiscoveredGame) => game.meta.level === "visible" || showHeld === true || process.env.STUDIO_SHOW_HELD === "1");
    const installed: InstalledGame[] = shown.flatMap((game: DiscoveredGame) => {
        try {
            const made: InstalledGame = installBlueprint(game.blueprint, catalog.kits);
            return [game.meta.level === "visible" ? made : { ...made, pitch: `Testing. ${made.pitch}` }];
        } catch (error: unknown) {
            log("studio", `LEFT OUT ${game.meta.id}: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    });
    const replaced: InstalledGame[] = handWritten.map((game: InstalledGame) => installed.find((candidate: InstalledGame) => candidate.manifest.id === game.manifest.id) ?? game);
    const added: InstalledGame[] = installed.filter((game: InstalledGame) => handWritten.some((candidate: InstalledGame) => candidate.manifest.id === game.manifest.id) === false);
    return [...replaced, ...added];
}

/**
 * The shelf every room gets: the hand-written games, which keep what they ask for before they begin,
 * then the blueprint games that are visible.
 * @param handWritten the games written in TypeScript.
 * @param showHeld true to include the games on hold, each marked as testing in its pitch.
 * @param catalog the games and kits to build from; the discovered ones unless a test gives its own.
 * @returns the shelf.
 */
export function showcaseShelf(handWritten: InstalledGame[], showHeld: boolean = false, catalog: Catalog = CATALOG): InstalledGame[] {
    return studioShelf(handWritten, showHeld, catalog).map((game: InstalledGame) => handWritten.find((candidate: InstalledGame) => candidate.manifest.id === game.manifest.id) ?? game);
}
