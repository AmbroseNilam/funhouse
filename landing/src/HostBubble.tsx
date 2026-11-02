// The host's voice on the page: one line in a speech bubble that changes with what the visitor
// does. The lines are written ahead of time in the host's own manner, so the page spends
// nothing and answers at once. A live region, so screen readers hear the host too.

import { type ReactElement } from "react";

/** What the visitor has just done. */
export type HostMoment = "arrived" | "hoverStart" | "focusCode" | "typing" | "codeReady" | "turnedAway";

/** The host's name, as the app says it. */
const HOST_NAME: string = "Marlowe";

/** One line per moment. */
const LINES: Record<HostMoment, string> = {
    arrived: "Four of you? Perfect. Nobody has to host.",
    hoverStart: "Put me on the TV. I'll take it from there.",
    focusCode: "It's the four letters on the TV. Big ones.",
    typing: "Keep going.",
    codeReady: "That's a room. In you go.",
    turnedAway: "That room's not open. Check the TV and try again.",
};

/** The speech bubble. */
export function HostBubble(props: { moment: HostMoment; code: string }): ReactElement {
    return (
        <div className="bubble" aria-live="polite">
            <span className="bubble-who">{HOST_NAME}</span>
            <p>{props.moment === "typing" ? `${props.code}… keep going.` : LINES[props.moment]}</p>
        </div>
    );
}
