// Every game the room can run. Adding a game means adding one line here; the room, the lobby
// and the host's brief all read from this list.

import { GameSession, type GameStage, type RunningGame } from "../room/game-session.ts";
import type { CartridgeManifest } from "../shared/cartridge.ts";
import { TWENTY_DOORS_MANIFEST } from "./twenty-doors/manifest.ts";
import { createTwentyDoors } from "./twenty-doors/rules.ts";
import { WEREWOLF_MANIFEST } from "./werewolf/manifest.ts";
import { createWerewolf } from "./werewolf/rules.ts";

/** One installed game. */
export interface InstalledGame {
    manifest: CartridgeManifest;
    /** One sentence for the lobby and the host, saying what the game is. */
    pitch: string;
    /** Readies a new game in a room. */
    create(stage: GameStage): RunningGame;
}

/** The installed games, in the order the lobby lists them. */
export const GAMES: InstalledGame[] = [
    { manifest: TWENTY_DOORS_MANIFEST, pitch: "You hold the secret; they get twenty yes-or-no questions to find it.", create: (stage: GameStage) => new GameSession(createTwentyDoors(), stage) },
    { manifest: WEREWOLF_MANIFEST, pitch: "A village, secret werewolves, and a vote each day.", create: (stage: GameStage) => new GameSession(createWerewolf(), stage) },
];
