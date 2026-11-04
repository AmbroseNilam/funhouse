// Puts blueprint games on a shelf. installBlueprint makes the InstalledGame the room expects
// from a blueprint, and studioShelf swaps blueprint versions in for hand-written games with the
// same id and adds blueprint games with new ids after them. Each game started from a blueprint
// logs one line naming the kit and id, so a run can prove which version played; it never logs
// what anyone said, what the host replied, or a name.

import type { InstalledGame } from "../cartridges/index.ts";
import { GameSession, type GameStage, type RunningGame } from "../room/game-session.ts";
import { log } from "../room/log.ts";
import { blueprintPauseActions, blueprintProblems, createKitGame, type Blueprint } from "./blueprint.ts";
import { LEADING_QUESTIONS_BLUEPRINT } from "./games/leading-questions.ts";
import { TWO_TAKES_BLUEPRINT } from "./games/two-takes/blueprint.ts";
import { MIND_THE_GAP_BLUEPRINT } from "./games/mind-the-gap/blueprint.ts";
import { OFF_BY_A_MILE_BLUEPRINT } from "./games/off-by-a-mile/blueprint.ts";
import { PAST_THE_GATE_BLUEPRINT } from "./games/past-the-gate/blueprint.ts";
import { CLUE_GALLERY_BLUEPRINT } from "./games/clue-gallery.ts";
import { PAINTED_WHISPERS_BLUEPRINT } from "./games/painted-whispers.ts";

import { TWENTY_DOORS_BLUEPRINT } from "./games/twenty-doors.ts";
import { MAGPIE_POCKETS_BLUEPRINT } from "./games/magpie-pockets.ts";
import { UNDER_THE_CUP_BLUEPRINT } from "./games/under-the-cup.ts";
import { NAME_TAG_BLUEPRINT } from "./games/name-tag.ts";
import { WHO_FITS_BLUEPRINT } from "./games/who-fits.ts";
import { frozenCopy } from "./kit/primitives.ts";
import { STRAY_WORD_BLUEPRINT } from "./games/stray-word/index.ts";
import { TIN_CAN_TELEPHONE_BLUEPRINT } from "./games/tin-can-telephone/index.ts";
import { WRONG_ROOM_BLUEPRINT } from "./games/wrong-room/index.ts";

/** The blueprints Studio ships with, in shelf order. */
export const BLUEPRINTS: readonly Blueprint[] = [
    TWENTY_DOORS_BLUEPRINT,
    LEADING_QUESTIONS_BLUEPRINT,
    WHO_FITS_BLUEPRINT,
    UNDER_THE_CUP_BLUEPRINT,
    MAGPIE_POCKETS_BLUEPRINT,
    TWO_TAKES_BLUEPRINT,
    PAST_THE_GATE_BLUEPRINT,
    OFF_BY_A_MILE_BLUEPRINT,
    MIND_THE_GAP_BLUEPRINT,
    TIN_CAN_TELEPHONE_BLUEPRINT,
    WRONG_ROOM_BLUEPRINT,
    STRAY_WORD_BLUEPRINT,
    NAME_TAG_BLUEPRINT,
    PAINTED_WHISPERS_BLUEPRINT,
    CLUE_GALLERY_BLUEPRINT,
];

/**
 * Games that are built and pass their scripted checks but stay off the shelf until a run against the real
 * thing clears them: each id maps to what is still missing. Clearing a game is deleting its line. A room started with STUDIO_SHOW_HELD=1 shows them anyway, for the
 * scripted runs that prove them.
 */
export const HELD_BACK: Readonly<Record<string, string>> = {
    nameTag: "no run with the real host yet",
    paintedWhispers: "no run with the real picture model; its cost and latency are unmeasured",
    clueGallery: "no run with the real picture model; its cost and latency are unmeasured",
};

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
    const installed: InstalledGame[] = BLUEPRINTS.filter((blueprint: Blueprint) => process.env.STUDIO_SHOW_HELD === "1" || HELD_BACK[blueprint.box.id] === undefined).map(installBlueprint);
    const replaced: InstalledGame[] = handWritten.map((game: InstalledGame) => installed.find((candidate: InstalledGame) => candidate.manifest.id === game.manifest.id) ?? game);
    const added: InstalledGame[] = installed.filter((game: InstalledGame) => handWritten.some((candidate: InstalledGame) => candidate.manifest.id === game.manifest.id) === false);
    return [...replaced, ...added];
}
