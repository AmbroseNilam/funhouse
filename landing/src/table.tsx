// The pieces of the table the page shows: the TV's lantern with a slip of plain help, a
// phone as it really looks mid-game, and the vote that really happens in Werewolf, played once
// the visitor scrolls to it. Pictures below the first screen wait until they're nearly in view.

import { useEffect, useRef, useState, type ReactElement } from "react";
import { HOST_NAME } from "../../shared/brand.ts";
import { Lantern } from "../../screen/src/Lantern.tsx";
import type { HostSpeaker } from "../../screen/src/speaker.ts";

/** What the visitor has just done. */
export type Moment = "arrived" | "atStart" | "atCode" | "typing" | "codeReady" | "turnedAway";

/** One line of help per moment. The host only speaks in the game demos. */
const LINES: Record<Moment, string> = {
    arrived: `This is ${HOST_NAME}, your host.`,
    atStart: `${HOST_NAME} appears on the TV when you start a room.`,
    atCode: "The code is the four letters on the TV.",
    typing: "Enter all four letters.",
    codeReady: "Select Join to enter the room.",
    turnedAway: "That room can't be joined. Check the code on the TV.",
};

/** The names used in the demos, drawn from a list rather than made up on the spot. */
export const NAMES: { owner: string; speaker: string; accused: string; third: string } = { owner: "Vanessa", speaker: "Steph", accused: "Kevin", third: "Carlos" };

/** How far below the viewport a picture may be before it starts loading. */
const LOAD_AHEAD: string = "600px 0px";

/**
 * The host on the page: the lantern, awake and looking where the visitor is, with a slip of plain
 * help. The slip is a live region so screen readers hear it too.
 * @param props the moment, the typed code, and where to look (-1 left, 1 right).
 * @returns the element.
 */
export function HostAtTable(props: { moment: Moment; code: string; look: number }): ReactElement {
    const micRef = useRef<{ level: number; at: number }>({ level: 0, at: 0 });
    const speakerRef = useRef<HostSpeaker | null>(null);
    return (
        <div className="host-at-table">
            <Lantern micRef={micRef} speakerRef={speakerRef} awake={true} thinking={false} speaking={false} look={props.look} />
            <p className="slip from-host" aria-live="polite">{LINES[props.moment]}</p>
        </div>
    );
}

/**
 * Reports whether an element has come within reach of the viewport, once.
 * @param rootMargin how far outside the viewport counts as near.
 * @returns a ref to attach and whether it has been near.
 */
function useNear<Element extends HTMLElement>(rootMargin: string): { ref: React.RefObject<Element | null>; near: boolean } {
    const ref = useRef<Element | null>(null);
    const [near, setNear] = useState<boolean>(false);
    useEffect(() => {
        const element: Element | null = ref.current;
        if (element === null || near === true) {
            return;
        }
        if ("IntersectionObserver" in window === false) {
            setNear(true);
            return;
        }
        const observer: IntersectionObserver = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
            if (entries.some((entry: IntersectionObserverEntry) => entry.isIntersecting === true) === true) {
                setNear(true);
                observer.disconnect();
            }
        }, { rootMargin });
        observer.observe(element);
        return (): void => { observer.disconnect(); };
    }, [near, rootMargin]);
    return { ref, near };
}

/**
 * A picture that starts loading only when it's nearly on screen, so the first screen isn't
 * waiting behind it.
 * @param props the picture's source, alt text and size.
 * @returns the element.
 */
export function LatePicture(props: { src: string; alt: string; width: number; height: number; className?: string }): ReactElement {
    const { ref, near } = useNear<HTMLImageElement>(LOAD_AHEAD);
    return <img ref={ref} className={props.className ?? ""} src={near === true ? props.src : undefined} alt={props.alt} width={props.width} height={props.height} />;
}

/**
 * A phone in the middle of Werewolf, as it really looks: the name at the top, a secret dealt face
 * down that shows only while pressed, and the talk line on the surface below.
 * @returns the element.
 */
export function PhoneCard(): ReactElement {
    return (
        <div className="phone">
            <div className="phone-top"><span /><strong>{NAMES.owner}</strong><span>···</span></div>
            <div className="peek"><em>Press and hold to peek</em></div>
            <div className="touch-surface"><span>Press and hold to talk</span></div>
        </div>
    );
}

/**
 * What happens at a Werewolf vote: someone says they're ready, the host calls it, the phones
 * vote, the tally fills, and the host says who's out. Plays once, when it comes into view.
 * @returns the element.
 */
export function VoteDemo(): ReactElement {
    const { ref, near } = useNear<HTMLDivElement>("-80px 0px");
    const label: string = `${NAMES.speaker} says the table is ready to vote; ${HOST_NAME} calls it; the phones vote and ${NAMES.accused} is out`;
    return (
        <div ref={ref} className={`exchange ${near === true ? "playing" : ""}`} role="img" aria-label={label}>
            <p className="slip step-1"><strong>{NAMES.speaker}</strong>{HOST_NAME}, we're ready to vote.</p>
            <p className="slip from-host step-2"><strong>{HOST_NAME}</strong>Alright. Phones up.</p>
            <div className="ballot step-3">
                <span className="ballot-note">Everyone votes on their phone.</span>
                <div className="tally-row"><span>{NAMES.accused}</span><i className="bar bar-accused" /><b className="count count-accused" /></div>
                <div className="tally-row"><span>{NAMES.third}</span><i className="bar bar-third" /><b className="count count-third" /></div>
            </div>
            <p className="slip from-host step-4"><strong>{HOST_NAME}</strong>{NAMES.accused} is out.</p>
        </div>
    );
}
