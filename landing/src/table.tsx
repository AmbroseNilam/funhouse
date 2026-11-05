// The pieces of the table the page shows: the TV's lantern with a slip of plain help, and
// pictures below the first screen that wait until they're nearly in view.

import { useEffect, useRef, useState, type ReactElement } from "react";
import { HOST_NAME } from "../../shared/brand.ts";
import { Lantern } from "../../screen/src/Lantern.tsx";
import type { HostSpeaker } from "../../screen/src/speaker.ts";

/** What the visitor has just done. */
export type Moment = "arrived" | "atStart" | "atCode" | "typing" | "codeReady" | "turnedAway" | "roomFull";

/** One line of help per moment. The host only speaks in the game demos. */
const LINES: Record<Moment, string> = {
    arrived: `This is ${HOST_NAME}, your host.`,
    atStart: `${HOST_NAME} appears on the TV when you start a room.`,
    atCode: "The code is the four letters on the TV.",
    typing: "Enter all four letters.",
    codeReady: "Select Join to enter the room.",
    turnedAway: "That room can't be joined. Check the code on the TV.",
    roomFull: "That room is full. Start a new one on another TV or laptop.",
};

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
