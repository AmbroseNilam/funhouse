// The host: a small brass lantern with a face behind the glass. It sleeps until the sound comes
// on, leans toward what you're looking at, and its mouth follows the loudest voice in the room.
// Loudness changes many times a second, so it writes CSS variables rather than re-rendering.

import { useEffect, useRef, type ReactElement, type RefObject } from "react";
import type { HostSpeaker } from "./speaker.ts";

/** How recent a microphone reading must be to count as someone talking. */
const MIC_FRESH_MILLISECONDS: number = 300;

/** How long the host may think before it visibly looks like thinking. */
const THINKING_DELAY_MILLISECONDS: number = 300;

/** Share of the distance to the target covered each animation frame. */
const SMOOTHING: number = 0.35;

/** What the lantern needs from the screen. */
interface LanternProps {
    micRef: RefObject<{ level: number; at: number }>;
    speakerRef: RefObject<HostSpeaker | null>;
    awake: boolean;
    thinking: boolean;
    speaking: boolean;
    /** Where it's looking, from -1 (left) to 1 (right). */
    look: number;
}

/** The lantern. */
export function Lantern(props: LanternProps): ReactElement {
    const rootRef = useRef<SVGSVGElement | null>(null);
    const thinkingSinceRef = useRef<number>(0);
    const { micRef, speakerRef, awake, thinking, speaking, look } = props;
    if (thinking === false) {
        thinkingSinceRef.current = 0;
    }
    if (thinking === true && thinkingSinceRef.current === 0) {
        thinkingSinceRef.current = performance.now();
    }

    useEffect(() => {
        let frame: number = 0;
        let mouth: number = 0;
        const step = (): void => {
            const now: number = performance.now();
            const listening: boolean = now - micRef.current.at < MIC_FRESH_MILLISECONDS;
            const target: number = speaking === true ? Math.min(1, (speakerRef.current?.level() ?? 0) * 2.2) : 0;
            mouth += (target - mouth) * SMOOTHING;
            const root: SVGSVGElement | null = rootRef.current;
            if (root !== null) {
                root.style.setProperty("--mouth", mouth.toFixed(3));
                const pondering: boolean = thinking === true && now - thinkingSinceRef.current > THINKING_DELAY_MILLISECONDS;
                root.dataset.state = awake === false ? "asleep" : listening === true ? "listening" : speaking === true ? "speaking" : pondering === true ? "thinking" : "idle";
            }
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return (): void => { cancelAnimationFrame(frame); };
    }, [micRef, speakerRef, awake, thinking, speaking]);

    return (
        <svg ref={rootRef} className="lantern" data-state="asleep" viewBox="0 0 200 290" style={{ "--look": look } as React.CSSProperties} aria-hidden="true">
            <path className="lantern-shadow" d="M38 280 q62 -14 128 -1 q4 6 -6 8 q-58 7 -118 1 q-10 -3 -4 -8z" />
            <g className="lantern-body">
                <path className="brass-dark" d="M100 8 c-26 1 -40 20 -38 42 l9 -1 c-1 -17 11 -32 29 -32 c18 0 30 15 29 32 l9 1 c2 -22 -12 -41 -38 -42z" />
                <path className="brass" d="M58 52 l84 -1 l16 26 l-115 2z" />
                <rect className="glass" x="46" y="78" width="108" height="150" rx="5" />
                <g className="face">
                    <ellipse className="eye eye-left" cx="79" cy="130" rx="9" ry="12" />
                    <ellipse className="eye eye-right" cx="121" cy="129" rx="9" ry="12" />
                    <path className="sleep-eyes" d="M68 132 q11 8 22 0 M110 131 q11 8 22 0" />
                    <ellipse className="mouth" cx="100" cy="178" rx="15" ry="11" />
                    <path className="smile" d="M84 172 q16 13 33 -1" />
                </g>
                <path className="brass-dark" d="M46 78 l0 150 l8 0 l0 -150z M146 78 l0 150 l8 0 l0 -150z M95 78 l0 22 l10 0 l0 -22z" />
                <path className="brass" d="M36 226 l128 1 l6 24 q-68 8 -140 0z" />
                <path className="brass-dark" d="M30 251 q70 8 140 0 l3 14 q-73 9 -146 0z" />
            </g>
        </svg>
    );
}
