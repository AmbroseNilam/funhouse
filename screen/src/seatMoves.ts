// What the TV knows of each machine at the table, from what that seat really did. Only the state of the
// move and a line it chose to say aloud, past the filter; never what it answered.

import type { SeatActivity } from "../../shared/protocol.ts";

/** How long something said aloud stays on the card. */
export const LINE_MILLISECONDS: number = 6000;

/** A machine's latest move. */
export interface SeatMove {
    activity: SeatActivity;
    /** The last thing it said aloud, or empty. It outlives the moves after it, as an agent reads on straight after speaking. */
    line: string;
    lineAt: number;
}

/**
 * The next move, keeping a line still in the air.
 * @param previous the move before, if any.
 * @param activity what it's doing now.
 * @param line what it said, or an empty string when this isn't speech.
 * @param at when this happened.
 * @returns the move.
 */
export function nextSeatMove(previous: SeatMove | undefined, activity: SeatActivity, line: string, at: number): SeatMove {
    if (activity === "saying") {
        return { activity, line, lineAt: at };
    }
    return { activity, line: previous?.line ?? "", lineAt: previous?.lineAt ?? 0 };
}

/**
 * Takes a line off a seat once its time is up, unless it has said something newer.
 * @param moves every machine's latest move.
 * @param playerId the seat.
 * @param at when the line was said.
 * @returns the moves.
 */
export function withoutOldLine(moves: Record<string, SeatMove>, playerId: string, at: number): Record<string, SeatMove> {
    const move: SeatMove | undefined = moves[playerId];
    if (move === undefined || move.lineAt !== at) {
        return moves;
    }
    return { ...moves, [playerId]: { ...move, line: "" } };
}
