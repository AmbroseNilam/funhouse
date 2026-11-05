// Who's at the table: a place card for each person, standing along the table's edge in their seat
// colour. The card itself says how they are, so the table stays quiet: it lifts and shows their
// full name while they talk or touch their phone, lies flat with a tick once they've gone, and
// fades when they're away or their phone is down. Anyone who's only watching is counted, not listed.
// An AI guest's card always says so, whatever else its name is cut down to.

import type { ReactElement } from "react";
import type { Seat } from "../../shared/shell.ts";
import type { Turn } from "../../shared/turn.ts";

/** Above this many cards, names get shorter so everyone still fits along the table. */
const ROOMY_CARDS: number = 7;

/**
 * How a card stands right now.
 * @param seat the seat.
 * @param turn whose turn it is.
 * @param touched whether this person's phone was just touched.
 * @returns the class names.
 */
function cardState(seat: Seat, turn: Turn | null, touched: boolean): string {
    const up: boolean = turn?.kind === "one" && turn.playerId === seat.playerId;
    const done: boolean = turn?.kind === "everyone" && turn.doneIds.includes(seat.playerId) === true;
    // During a secret turn, whose phone is still up or being touched could say who has something to do.
    if (turn?.kind === "secret") {
        return [seat.out === true ? "out" : "", seat.driving === true ? "driving" : ""].filter((part: string) => part !== "").join(" ");
    }
    return [
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
 * @param props everyone in the room, whose turn it is, and whose phone was just touched.
 * @returns the element, or nothing when nobody's here.
 */
export function PlaceCards(props: { seats: Seat[]; turn: Turn | null; touchedId: string | null }): ReactElement | null {
    const playing: Seat[] = props.seats.filter((seat: Seat) => seat.watching === false);
    const watching: number = props.seats.length - playing.length;
    if (props.seats.length === 0) {
        return null;
    }
    return (
        <ul className={`place-cards ${playing.length > ROOMY_CARDS ? "crowded" : ""}`}>
            {playing.map((seat: Seat) => (
                <li key={seat.playerId} data-seat={seat.playerId} className={cardState(seat, props.turn, props.touchedId === seat.playerId)} style={{ background: seat.colour }}>
                    <span className="short-name">{seat.name.split(" ")[0]}</span>
                    <span className="full-name">{seat.name}</span>
                    {seat.guest === true ? <small className="guest-mark">{seat.agent === true ? "AI agent" : "AI guest"}</small> : null}
                    <i className="tick" aria-hidden="true" />
                </li>
            ))}
            {watching > 0 ? <li className="watching-count">and {watching} watching</li> : null}
        </ul>
    );
}
