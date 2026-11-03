// Who's at the table during a game: everyone's name in their seat colour, with a word when they're
// talking, away, up, done, only watching, or holding the controller, so the colour never has to say
// it alone. A touch on someone's phone lifts their seat, so people can tell whose phone is whose.

import type { ReactElement } from "react";
import type { Seat } from "../../shared/shell.ts";
import type { Turn } from "../../shared/turn.ts";

/**
 * The word beside a name, if it needs one.
 * @param seat the seat.
 * @param turn whose turn it is.
 * @returns the word, or an empty string.
 */
function seatWord(seat: Seat, turn: Turn | null): string {
    if (seat.connected === false) {
        return "away";
    }
    if (seat.talking === true) {
        return "talking";
    }
    if (turn?.kind === "one" && turn.playerId === seat.playerId) {
        return "up";
    }
    if (turn?.kind === "everyone" && turn.playerIds.includes(seat.playerId) === true) {
        return turn.doneIds.includes(seat.playerId) === true ? "done" : "to go";
    }
    if (seat.watching === true) {
        return "watching";
    }
    return seat.driving === true ? "controller" : "";
}

/**
 * The strip of seats along the top of a game.
 * @param props everyone in the room, whose turn it is, and whose phone was just touched.
 * @returns the element, or nothing when nobody's here.
 */
export function SeatStrip(props: { seats: Seat[]; turn: Turn | null; touchedId: string | null }): ReactElement | null {
    if (props.seats.length === 0) {
        return null;
    }
    return (
        <ul className="seat-strip">
            {props.seats.map((seat: Seat) => {
                const word: string = seatWord(seat, props.turn);
                return (
                    <li key={seat.playerId} className={`${word.replace(" ", "-")} ${props.touchedId === seat.playerId ? "touched" : ""}`} style={{ background: seat.colour }}>
                        <strong>{seat.name}</strong>
                        {word !== "" ? <small>{word}</small> : null}
                    </li>
                );
            })}
            {props.turn !== null ? <li className="turn-label">{props.turn.label}</li> : null}
        </ul>
    );
}
