// What every kit's paper players share: how long a quiet table waits, who speaks on a given move, and the
// first thing a player may press. Kept apart from the kits so a new kit's personas import it without
// touching any other kit.

import type { CartridgePlayer, LegalAction } from "../shared/cartridge.ts";
import type { Glimpse } from "./rehearse.ts";

/** Seconds a quiet table lets pass at a time. */
export const QUIET_SECONDS: number = 30;

/**
 * Who speaks on a given move, going round the table.
 * @param players who is at the table.
 * @param turn the move number.
 * @returns their id.
 */
export function speakerOf(players: readonly CartridgePlayer[], turn: number): string {
    return players[turn % Math.max(1, players.length)]?.playerId ?? "nobody";
}

/**
 * The first thing a player may press, or null.
 * @param glimpse what the persona sees.
 * @param playerId the player.
 * @returns the action id, or null.
 */
export function firstAction<State>(glimpse: Glimpse<State>, playerId: string): string | null {
    const actions: LegalAction[] = glimpse.legal(playerId);
    return actions[0]?.actionId ?? null;
}
