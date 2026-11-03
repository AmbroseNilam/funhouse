// Who's at the table during a game: everyone's name in their seat colour, with a word when they're
// talking, away, only watching, or holding the controller, so the colour never has to say it alone.

import type { ReactElement } from "react";
import type { Seat } from "../../shared/shell.ts";

/**
 * The word beside a name, if it needs one.
 * @param seat the seat.
 * @returns the word, or an empty string.
 */
function seatWord(seat: Seat): string {
    if (seat.connected === false) {
        return "away";
    }
    if (seat.talking === true) {
        return "talking";
    }
    if (seat.watching === true) {
        return "watching";
    }
    return seat.driving === true ? "controller" : "";
}

/**
 * The strip of seats along the top of a game.
 * @param props everyone in the room.
 * @returns the element, or nothing when nobody's here.
 */
export function SeatStrip(props: { seats: Seat[] }): ReactElement | null {
    if (props.seats.length === 0) {
        return null;
    }
    return (
        <ul className="seat-strip">
            {props.seats.map((seat: Seat) => {
                const word: string = seatWord(seat);
                return (
                    <li key={seat.playerId} className={word} style={{ background: seat.colour }}>
                        <strong>{seat.name}</strong>
                        {word !== "" ? <small>{word}</small> : null}
                    </li>
                );
            })}
        </ul>
    );
}
