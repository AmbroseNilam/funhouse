// Puts blueprint games on a shelf. installBlueprint makes the InstalledGame the room expects
// from a blueprint, and studioShelf swaps blueprint versions in for hand-written games with the
// same id and adds blueprint games with new ids after them. Each game started from a blueprint
// logs one line naming the kit and id, so a run can prove which version played; it never logs
// what anyone said, what the host replied, or a name.

import type { InstalledGame } from "../cartridges/index.ts";
import { GameSession, type GameStage, type RunningGame } from "../room/game-session.ts";
import { log } from "../room/log.ts";
import { blueprintPauseActions, blueprintProblems, createKitGame, type Blueprint } from "./blueprint.ts";
import { COLD_READ_BLUEPRINT } from "./games/cold-read.ts";
import { LEADING_QUESTIONS_BLUEPRINT } from "./games/leading-questions.ts";
import { TWENTY_DOORS_BLUEPRINT } from "./games/twenty-doors.ts";
import { WHO_FITS_BLUEPRINT } from "./games/who-fits.ts";
import { frozenCopy } from "./kit/primitives.ts";

/** The blueprints Studio ships with, in shelf order. */
export const BLUEPRINTS: readonly Blueprint[] = [TWENTY_DOORS_BLUEPRINT, LEADING_QUESTIONS_BLUEPRINT, WHO_FITS_BLUEPRINT, COLD_READ_BLUEPRINT];

/**
 * Makes an installable game from a blueprint. The blueprint is copied first, so changing it
 * afterwards changes neither the shelf entry nor any game started from it.
 * @param given a runnable blueprint.
 * @returns the game, ready for a shelf.
 * @throws when the blueprint is not runnable, naming the problems.
 */
export function installBlueprint(given: Blueprint): InstalledGame {
    const blueprint: Blueprint = frozenCopy(given);
    const problems: string[] = blueprintProblems(blueprint);
    if (problems.length > 0) {
        throw new Error(`Blueprint ${blueprint.box.id} can't run: ${problems.join(" ")}`);
    }
    return {
        manifest: createKitGame(blueprint).cartridge.manifest,
        pitch: blueprint.box.pitch,
        howToPlay: [...blueprint.box.howToPlay],
        art: blueprint.box.art,
        pauseActions: blueprintPauseActions(blueprint),
        remarks: [...blueprint.box.remarks],
        create: (stage: GameStage): RunningGame => {
            log("studio", `starting blueprint ${blueprint.box.id} on the ${blueprint.kit} kit`);
            return new GameSession(createKitGame(blueprint).cartridge, stage);
        },
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
