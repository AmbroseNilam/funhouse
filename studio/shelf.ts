// Puts blueprint games on a shelf. installBlueprint makes the InstalledGame the room expects
// from a blueprint, and studioShelf swaps blueprint versions in for hand-written games with the
// same id, which is how the existing scenarios prove a blueprint plays the same. Later phases
// add games a creator kept; this is the one place the room learns about them.

import { GameSession, type GameStage, type RunningGame } from "../room/game-session.ts";
import type { InstalledGame } from "../cartridges/index.ts";
import { blueprintProblems, type Blueprint } from "./blueprint.ts";
import { createBlueprintGame } from "./interpreter.ts";
import { TWENTY_DOORS_BLUEPRINT } from "./games/twenty-doors.ts";

/** The blueprints Studio ships with, in shelf order. */
export const BLUEPRINTS: Blueprint[] = [TWENTY_DOORS_BLUEPRINT];

/**
 * Makes an installable game from a blueprint.
 * @param blueprint a runnable blueprint.
 * @returns the game, ready for a shelf.
 * @throws when the blueprint is not runnable, naming the problems.
 */
export function installBlueprint(blueprint: Blueprint): InstalledGame {
    const problems: string[] = blueprintProblems(blueprint);
    if (problems.length > 0) {
        throw new Error(`Blueprint ${blueprint.id} can't run: ${problems.join(" ")}`);
    }
    return {
        manifest: createBlueprintGame(blueprint).cartridge.manifest,
        pitch: blueprint.pitch,
        howToPlay: blueprint.howToPlay,
        art: blueprint.art,
        pauseActions: blueprint.giveUp === null ? [] : [{ id: blueprint.giveUp.actionId, label: blueprint.giveUp.label }],
        remarks: blueprint.remarks,
        create: (stage: GameStage): RunningGame => new GameSession(createBlueprintGame(blueprint).cartridge, stage),
    };
}

/**
 * A shelf where every shipped blueprint stands in for the hand-written game with the same id,
 * and blueprints with new ids come after the hand-written games.
 * @param handWritten the games written in TypeScript.
 * @returns the shelf.
 */
export function studioShelf(handWritten: InstalledGame[]): InstalledGame[] {
    const installed: InstalledGame[] = BLUEPRINTS.map(installBlueprint);
    const replaced: InstalledGame[] = handWritten.map((game: InstalledGame) => installed.find((candidate: InstalledGame) => candidate.manifest.id === game.manifest.id) ?? game);
    const added: InstalledGame[] = installed.filter((game: InstalledGame) => handWritten.some((candidate: InstalledGame) => candidate.manifest.id === game.manifest.id) === false);
    return [...replaced, ...added];
}
