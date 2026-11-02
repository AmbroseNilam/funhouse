// Drawn mock-ups of the two screens, built from the same blocks the real stages use, so they
// look like the product and weigh nothing. The TV shows a Werewolf vote; the phone shows the
// seer's private card. The listening demo is the page's one animation: a player speaks, the
// caption appears, and the tally on the TV ticks up.

import { type ReactElement } from "react";

/** The room code every mock-up shows. */
const DEMO_CODE: string = "KPTR";

/** The players in every mock-up. */
const PLAYERS: string[] = ["Sam", "Priya", "Jo", "Dana", "Leo"];

/** A decorative QR-like pattern; it encodes nothing. */
const QR_CELLS: number[] = [
    1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1,
    1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1,
    1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1,
    1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1,
    1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1,
    1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1,
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0,
    0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1,
    1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0, 1,
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0,
    1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1,
    1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1,
    1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0,
    1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1,
];

/** Cells per side of the pattern. */
const QR_SIDE: number = 17;

/**
 * The decorative QR pattern.
 * @returns the element.
 */
function QrPattern(): ReactElement {
    return (
        <svg className="qr" viewBox={`0 0 ${QR_SIDE} ${QR_SIDE}`} aria-hidden="true">
            {QR_CELLS.map((cell: number, index: number) => (cell === 1 ? <rect key={index} x={index % QR_SIDE} y={Math.floor(index / QR_SIDE)} width="1" height="1" /> : null))}
        </svg>
    );
}

/**
 * The TV during a Werewolf vote: title, roster, tally, and the join panel with the code.
 * @param props compact drops the join panel, for the secrets section.
 * @returns the element.
 */
export function TvFrame(props: { compact?: boolean }): ReactElement {
    return (
        <div className={`tv ${props.compact === true ? "compact" : ""}`}>
            <div className="tv-blocks">
                <p className="tv-kicker">Day 2</p>
                <p className="tv-title">Who is the werewolf?</p>
                <ul className="tv-roster">
                    {PLAYERS.map((name: string) => <li key={name} className={name === "Sam" ? "out" : ""}>{name}{name === "Sam" ? <small>out</small> : null}</li>)}
                </ul>
                <div className="tv-tally">
                    <div><span>Priya</span><i style={{ width: "60%" }} /><b>3</b></div>
                    <div><span>Jo</span><i style={{ width: "20%" }} /><b>1</b></div>
                </div>
            </div>
            {props.compact === true ? null : (
                <aside className="tv-join">
                    <QrPattern />
                    <span className="tv-code">{DEMO_CODE}</span>
                    <span className="tv-orb" />
                    <small>Marlowe</small>
                </aside>
            )}
        </div>
    );
}

/**
 * One phone during the same moment: the seer's private card and the talk button.
 * @returns the element.
 */
export function PhoneFrame(): ReactElement {
    return (
        <div className="phone">
            <div className="phone-bar"><strong>Dana</strong><span>Room {DEMO_CODE}</span></div>
            <div className="phone-card">
                <strong>You are the seer</strong>
                <p>Each night, learn whether one player is a werewolf. Share wisely.</p>
            </div>
            <p className="phone-secret">Priya is a werewolf.</p>
            <span className="phone-talk">Hold to talk</span>
        </div>
    );
}

/**
 * The listening demo: Jo speaks, the TV captions it, and Priya's tally ticks up. Pure CSS
 * animation on a loop; reduced motion shows the final frame.
 * @returns the element.
 */
export function ListeningDemo(): ReactElement {
    return (
        <div className="demo" aria-label="A player says a name out loud and the vote on the TV changes" role="img">
            <div className="demo-phone">
                <span className="demo-talk" />
                <span className="demo-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
            </div>
            <div className="tv demo-tv">
                <div className="tv-blocks">
                    <p className="tv-kicker">Day 2</p>
                    <p className="tv-title">Who is the werewolf?</p>
                    <div className="tv-tally">
                        <div><span>Priya</span><i className="demo-bar" /><b className="demo-count" /></div>
                        <div><span>Jo</span><i style={{ width: "20%" }} /><b>1</b></div>
                    </div>
                    <p className="tv-caption"><strong>Jo</strong> <span className="demo-words">I think it's Priya, honestly.</span></p>
                    <p className="tv-caption demo-reply"><strong>Marlowe</strong> <span>Noted. That's three on Priya.</span></p>
                </div>
            </div>
        </div>
    );
}
