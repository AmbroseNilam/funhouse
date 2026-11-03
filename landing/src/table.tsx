// The pieces of the table the page shows: the TV's lantern with a slip of what it just said, a
// paper role card as a phone shows it, and the exchange where a player speaks and the vote on
// the TV changes. All drawn from the same card, paper and hard shadows as the TV itself.

import { useRef, type ReactElement } from "react";
import { HOST_NAME } from "../../shared/brand.ts";
import { Lantern } from "../../screen/src/Lantern.tsx";
import type { HostSpeaker } from "../../screen/src/speaker.ts";

/** What the visitor has just done. */
export type Moment = "arrived" | "atHost" | "atCode" | "typing" | "codeReady" | "turnedAway";

/** One line per moment, in the host's voice. */
const LINES: Record<Moment, string> = {
    arrived: "Evening. I've got the rules, the timer and the secrets. You've got the snacks.",
    atHost: "Put me on the TV. I'll take it from there.",
    atCode: "It's the four big letters on the TV.",
    typing: "Keep going.",
    codeReady: "That's a room. In you go.",
    turnedAway: "That room's not open. Check the TV and try again.",
};

/**
 * The host on the page: the lantern, awake and looking where the visitor is, with a slip of what
 * it just said. The slip is a live region so screen readers hear the host too.
 * @param props the moment, the typed code, and where to look (-1 left, 1 right).
 * @returns the element.
 */
export function HostAtTable(props: { moment: Moment; code: string; look: number }): ReactElement {
    const micRef = useRef<{ level: number; at: number }>({ level: 0, at: 0 });
    const speakerRef = useRef<HostSpeaker | null>(null);
    const line: string = props.moment === "typing" ? `${props.code}… keep going.` : LINES[props.moment];
    return (
        <div className="host-at-table">
            <Lantern micRef={micRef} speakerRef={speakerRef} awake={true} thinking={false} speaking={false} look={props.look} />
            <p className="slip from-host" aria-live="polite"><strong>{HOST_NAME}</strong>{line}</p>
        </div>
    );
}

/**
 * A phone in the middle of Werewolf: the seer's paper card, and the touch surface under it.
 * @returns the element.
 */
export function PhoneCard(): ReactElement {
    return (
        <div className="phone">
            <div className="phone-top"><span>Dana</span><span>KPTR</span></div>
            <div className="paper role-card">
                <strong>You're the seer</strong>
                <p>Each night, pick one player and learn whether they're a werewolf. Share it wisely, or don't.</p>
                <small>Priya is a werewolf.</small>
            </div>
            <div className="touch-surface"><span>Rest a thumb here to talk</span></div>
        </div>
    );
}

/**
 * Someone speaks, the TV writes it down, the tally moves, the host answers. The page's one piece
 * of motion: the slips arrive in order, then it rests.
 * @returns the element.
 */
export function Exchange(): ReactElement {
    return (
        <div className="exchange" role="img" aria-label="A player says a name out loud; the vote on the TV changes and the host answers">
            <p className="slip step-1"><strong>Jo</strong>I think it's Priya, honestly.</p>
            <table className="tally step-2">
                <tbody>
                    <tr className="moved"><td>Priya</td><td className="count" /></tr>
                    <tr><td>Jo</td><td>1</td></tr>
                    <tr><td>Leo</td><td>1</td></tr>
                </tbody>
            </table>
            <p className="slip from-host step-3"><strong>{HOST_NAME}</strong>Noted. That's three on Priya.</p>
        </div>
    );
}
