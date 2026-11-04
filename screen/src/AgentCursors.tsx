// The machines at the table, made visible: each AI guest and outside agent has a small labelled cursor in
// its seat colour. It moves only on what that seat really did: it goes to the prompt when it reads, stays
// there while it thinks, and comes back to its card with a click when it answers. When nothing is happening
// it rests. It never shows what was answered; only a line an agent chose to say aloud, past the filter.

import { useEffect, useLayoutEffect, useState, type ReactElement } from "react";
import type { SeatActivity } from "../../shared/protocol.ts";
import type { Seat } from "../../shared/shell.ts";

/** What the TV knows of a machine's latest move. */
export interface SeatMove {
    activity: SeatActivity;
    /** The last thing it said aloud. It outlives the moves after it, as an agent reads on straight after speaking. */
    line: string;
    lineAt: number;
    at: number;
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
        return { activity, line, lineAt: at, at };
    }
    return { activity, line: previous?.line ?? "", lineAt: previous?.lineAt ?? 0, at };
}

/** How often a resting cursor checks where its card has gone, as cards move when people come and go. */
const REPOSITION_MILLISECONDS: number = 700;

/** How long a line about a finished move stays up. */
const LABEL_MILLISECONDS: Partial<Record<SeatActivity, number>> = { joined: 3000, sent: 2500 };

/** How long something said aloud stays up. */
const LINE_MILLISECONDS: number = 6000;

/** Space between cursors at the prompt, so they don't sit on each other. */
const CURSOR_GAP_PIXELS: number = 44;

/**
 * Where a cursor belongs now, in pixels on the TV.
 * @param seat its seat.
 * @param activity what it's doing.
 * @param index its place among the cursors.
 * @returns the point, or null when its card isn't on screen.
 */
function targetOf(seat: Seat, activity: SeatActivity, index: number): { x: number; y: number } | null {
    const card: Element | null = document.querySelector(`[data-seat="${CSS.escape(seat.playerId)}"]`);
    const prompt: Element | null = document.querySelector(".blocks > :first-child");
    // The TV is letterboxed inside the window, and these are placed on the TV.
    const stage: DOMRect | undefined = document.querySelector(".agent-cursors")?.getBoundingClientRect();
    const left: number = stage?.left ?? 0;
    const top: number = stage?.top ?? 0;
    if ((activity === "reading" || activity === "thinking") && prompt !== null) {
        const rect: DOMRect = prompt.getBoundingClientRect();
        return { x: rect.right - 6 - left, y: rect.bottom - 8 + index * CURSOR_GAP_PIXELS - top };
    }
    if (card === null) {
        return null;
    }
    const rect: DOMRect = card.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - left, y: rect.top - 6 - top };
}

/**
 * What a cursor's label says.
 * @param name the seat's short name.
 * @param move its latest move.
 * @returns the words, or an empty string for none.
 */
function labelOf(name: string, move: SeatMove): string {
    const words: Record<SeatActivity, string> = {
        joined: `${name} sat down`,
        reading: `${name} is reading…`,
        thinking: `${name} is thinking…`,
        sent: `${name} answered`,
        idle: "",
        saying: "",
    };
    return words[move.activity];
}

/**
 * One machine's cursor.
 * @param props its seat, its latest move, and its place among the cursors.
 * @returns the element, or nothing until it has somewhere to be.
 */
function Cursor(props: { seat: Seat; move: SeatMove; index: number }): ReactElement | null {
    const { seat, move, index } = props;
    const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
    const [now, setNow] = useState<number>(Date.now());
    useLayoutEffect(() => { setPoint(targetOf(seat, move.activity, index)); }, [seat, move, index]);
    useEffect(() => {
        const timer: number = window.setInterval(() => {
            setPoint(targetOf(seat, move.activity, index));
            setNow(Date.now());
        }, REPOSITION_MILLISECONDS);
        return (): void => { window.clearInterval(timer); };
    }, [seat, move, index]);
    if (point === null) {
        return null;
    }
    const limit: number | undefined = LABEL_MILLISECONDS[move.activity];
    const showing: boolean = limit === undefined || now - move.at < limit;
    const label: string = showing === true ? labelOf(seat.name.replace(/ the AI$/, ""), move) : "";
    const speaking: boolean = move.line !== "" && now - move.lineAt < LINE_MILLISECONDS;
    return (
        <div className={`agent-cursor ${move.activity}`} style={{ transform: `translate(${point.x}px, ${point.y}px)`, color: seat.colour }} aria-hidden={speaking === false}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 2 L21 11 L12 13.5 L8.5 22 Z" fill="currentColor" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" /></svg>
            {move.activity === "sent" ? <i key={move.at} className="agent-click" /> : null}
            {speaking === true ? <span className="agent-bubble">{move.line}</span> : null}
            {speaking === false && label !== "" ? <span className="agent-label">{label}</span> : null}
        </div>
    );
}

/**
 * Every machine's cursor at the table.
 * @param props the seats, and each machine's latest move.
 * @returns the elements.
 */
export function AgentCursors(props: { seats: Seat[]; moves: Record<string, SeatMove> }): ReactElement {
    const machines: Seat[] = props.seats.filter((seat: Seat) => seat.guest === true && props.moves[seat.playerId] !== undefined);
    return <div className="agent-cursors">{machines.map((seat: Seat, index: number) => <Cursor key={seat.playerId} seat={seat} move={props.moves[seat.playerId] as SeatMove} index={index} />)}</div>;
}
