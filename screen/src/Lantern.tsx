// The host: a small brass lantern with a face behind the glass. It sleeps until the sound comes
// on, leans toward what you're looking at, and its mouth and the pool of light under it follow
// its voice. Loudness changes many times a second, so it writes CSS variables, not React state.

import { useEffect, useRef, type CSSProperties, type ReactElement, type RefObject } from "react";
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
        <svg ref={rootRef} className="lantern" data-state="asleep" viewBox="0 0 200 290" style={{ "--look": look } as CSSProperties} aria-hidden="true">
            <path className="light-pool" d="M-70 284 L28 262 L172 262 L270 284 L190 296 L10 296 Z" />
            <g className="lantern-body">
                <path className="brass-dark" d="M100 6 c-27 1 -42 21 -39 44 l10 -1 c-2 -18 11 -33 29 -33 c18 0 31 15 29 33 l10 1 c3 -23 -12 -43 -39 -44z" />
                <path className="brass" d="M64 50 l72 -1 l26 34 l-124 1z" />
                <path className="glass" d="M62 84 L138 84 L160 118 L160 204 L140 234 L60 234 L40 204 L40 118 Z" />
                <g className="face">
                    <path className="brow brow-left" d="M64 118 q13 -8 27 -2" />
                    <path className="brow brow-right" d="M109 116 q14 -6 27 2" />
                    <ellipse className="eye" cx="79" cy="139" rx="11" ry="14" />
                    <ellipse className="eye" cx="121" cy="138" rx="11" ry="14" />
                    <path className="sleep-eyes" d="M66 141 q13 9 26 0 M108 140 q13 9 26 0" />
                    <ellipse className="mouth" cx="100" cy="186" rx="17" ry="13" />
                    <path className="smile" d="M83 180 q17 15 35 -1" />
                </g>
                <path className="cage" d="M62 84 L40 118 L40 204 L60 234 M138 84 L160 118 L160 204 L140 234 M42 206 L158 206" />
                <path className="brass" d="M50 232 L150 232 L172 256 Q100 266 28 256 Z" />
                <path className="brass-dark" d="M26 256 Q100 266 174 256 L178 272 Q100 284 22 272 Z" />
            </g>
        </svg>
    );
}
