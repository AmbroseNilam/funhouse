// Every game the room can run. Adding a game means adding one entry here; the shelf, the game's
// page and the host's brief all read from this list.

import { GameSession, type GameStage, type RunningGame } from "../room/game-session.ts";
import { HOST_NAME } from "../shared/brand.ts";
import type { CartridgeManifest } from "../shared/cartridge.ts";
import type { StartPick } from "../shared/shell.ts";
import { QUIZMASTER_MANIFEST } from "./quizmaster/manifest.ts";
import { createQuizmaster, QUIZMASTER_PICK } from "./quizmaster/rules.ts";
import { TWENTY_DOORS_MANIFEST } from "./twenty-doors/manifest.ts";
import { createTwentyDoors, TWENTY_DOORS_PICK } from "./twenty-doors/rules.ts";
import { WEREWOLF_MANIFEST } from "./werewolf/manifest.ts";
import { createWerewolf } from "./werewolf/rules.ts";

/** One installed game. */
export interface InstalledGame {
    manifest: CartridgeManifest;
    /** One sentence for the game's page and the host, saying what the game is. */
    pitch: string;
    /** The rules in a few short lines, read from across a room. */
    howToPlay: string[];
    /** The box art, under the screen stage. */
    art: string;
    /** Actions for everyone, offered on the pause menu. */
    pauseActions: { id: string; label: string }[];
    /** What the host may mutter when someone lingers on this box. Eight words at most. */
    remarks: string[];
    /** What to choose before it begins, if anything. */
    startPick?: StartPick;
    /**
     * Readies a new game in a room.
     * @param stage the room.
     * @param pick the id of what was chosen before it began, if anything.
     */
    create(stage: GameStage, pick?: string): RunningGame;
}

/** The installed games, in shelf order. */
export const GAMES: InstalledGame[] = [
    {
        manifest: TWENTY_DOORS_MANIFEST,
        pitch: `${HOST_NAME} thinks of something. You get twenty questions to find it.`,
        howToPlay: ["Tap to talk on your phone, or hold to talk, and ask a yes-or-no question out loud.", "Every answer opens a door. You get twenty.", "Say what you think it is when you're ready."],
        art: "art/twenty-doors.webp",
        pauseActions: [{ id: "giveup", label: "We give up" }],
        remarks: ["Twenty doors. I've picked something good.", "Go on. I'm hard to crack.", "Nobody's guessed mine in under ten."],
        startPick: TWENTY_DOORS_PICK,
        create: (stage: GameStage, pick?: string) => new GameSession(createTwentyDoors(Math.random, pick), stage),
    },
    {
        manifest: QUIZMASTER_MANIFEST,
        pitch: `Name any topic out loud. ${HOST_NAME} writes the questions and judges the answers.`,
        howToPlay: ["Say a topic. Anything you think you know.", "Tap to talk on your phone, or hold to talk, to answer each question out loud.", "Two points for right, one for close. One try each."],
        art: "art/quizmaster.webp",
        pauseActions: [{ id: "skip", label: "Skip this question" }],
        remarks: ["Pick a topic you actually know.", "I'll go easy. Probably.", "Bold, for someone who hasn't warmed up."],
        startPick: QUIZMASTER_PICK,
        create: (stage: GameStage, pick?: string) => new GameSession(createQuizmaster(pick), stage),
    },
    {
        manifest: WEREWOLF_MANIFEST,
        pitch: "A village, a secret werewolf, and a vote every day.",
        howToPlay: ["Your phone tells you your role. Keep it to yourself.", "At night, the werewolf chooses someone on their phone.", "By day, argue out loud, then vote someone out."],
        art: "art/werewolf.webp",
        pauseActions: [],
        remarks: ["I like this one. Everyone lies.", "You'll want more friends for this.", "Don't look at me. I don't know either."],
        create: (stage: GameStage) => new GameSession(createWerewolf(), stage),
    },
];
