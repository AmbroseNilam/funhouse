// Who's at the table: a place card for each person, standing along the table's edge in their seat
// colour. The card itself says how they are, so the table stays quiet: it lifts and shows their
// full name while they talk or touch their phone, lies flat with a tick once they've gone, and
// fades when they're away or their phone is down. Anyone who's only watching is counted, not listed.
// An AI guest's card always says so, whatever else its name is cut down to. A machine's card also shows
// what it's really doing: soft dots while it reads and thinks, a check once its answer has gone in, and for
// a few seconds any line it says aloud. Never what it answered.

import type { ReactElement } from "react";
import type { Seat } from "../../shared/shell.ts";
import type { Turn } from "../../shared/turn.ts";
import type { SeatMove } from "./seatMoves.ts";

/** Above this many cards, names get shorter so everyone still fits along the table. */
const ROOMY_CARDS: number = 7;

/**
 * How a card stands right now.
 * @param seat the seat.
 * @param turn whose turn it is.
 * @param touched whether this person's phone was just touched.
 * @param move what this seat last did, if it's a machine.
 * @returns the class names.
 */
function cardState(seat: Seat, turn: Turn | null, touched: boolean, move: SeatMove | undefined): string {
    const up: boolean = turn?.kind === "one" && turn.playerId === seat.playerId;
    const done: boolean = turn?.kind === "everyone" && turn.doneIds.includes(seat.playerId) === true;
    const present: boolean = seat.connected === true && seat.phoneDown === false;
    const thinking: boolean = present === true && done === false && (move?.activity === "reading" || move?.activity === "thinking");
    return [
        thinking === true ? "thinking" : "",
        done === false && move?.activity === "sent" ? "answered" : "",
        move !== undefined && move.line !== "" ? "speaking" : "",
        seat.connected === false && seat.phoneDown === true ? "away" : "",
        seat.out === true ? "out" : "",
        seat.connected === true && seat.phoneDown === true ? "phone-down" : "",
        seat.talking === true || touched === true ? "lifted" : "",
        seat.recording === true ? "recording" : "",
        up === true ? "up" : "",
        done === true ? "done" : "",
        seat.driving === true ? "driving" : "",
    ].filter((part: string) => part !== "").join(" ");
}

/**
 * The place cards.
 * @param props everyone in the room, whose turn it is, whose phone was just touched, and what each machine last did.
 * @returns the element, or nothing when nobody's here.
 */
export function PlaceCards(props: { seats: Seat[]; turn: Turn | null; touchedId: string | null; moves: Record<string, SeatMove> }): ReactElement | null {
    const playing: Seat[] = props.seats.filter((seat: Seat) => seat.watching === false);
    const watching: number = props.seats.length - playing.length;
    if (props.seats.length === 0) {
        return null;
    }
    return (
        <ul className={`place-cards ${playing.length > ROOMY_CARDS ? "crowded" : ""}`}>
            {playing.map((seat: Seat) => (
                <li key={seat.playerId} className={cardState(seat, props.turn, props.touchedId === seat.playerId, seat.guest === true ? props.moves[seat.playerId] : undefined)} style={{ background: seat.colour }}>
                    <span className="short-name">{seat.name.split(" ")[0]}</span>
                    <span className="full-name">{seat.name}</span>
                    {seat.guest === true ? <small className="guest-mark">{seat.agent === true ? "AI agent" : "AI guest"}</small> : null}
                    <i className="tick" aria-hidden="true" />
                    <span className="seat-dots" aria-hidden="true"><i /><i /><i /></span>
                    {seat.guest === true && (props.moves[seat.playerId]?.line ?? "") !== "" ? <span className="seat-line">{props.moves[seat.playerId]?.line}</span> : null}
                </li>
            ))}
            {watching > 0 ? <li className="watching-count">and {watching} watching</li> : null}
        </ul>
    );
}
