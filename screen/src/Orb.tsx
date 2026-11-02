// Marlowe's orb on the big screen: it follows whoever is talking, so the room can see it is
// being heard. It moves with the player's microphone while listening, with the host's own
// voice while speaking, and breathes while thinking. Loudness changes many times a second,
// so it writes a CSS variable directly rather than re-rendering through React.

import { useEffect, useRef, type ReactElement, type RefObject } from "react";
import type { HostSpeaker } from "./speaker.ts";

/** How recent a microphone reading must be to count as someone talking. */
const MIC_FRESH_MILLISECONDS: number = 300;

/** Share of the distance to the target covered each animation frame; smooths the motion. */
const SMOOTHING: number = 0.3;

/** What the orb needs from the screen. */
interface OrbProps {
    micRef: RefObject<{ level: number; at: number }>;
    speakerRef: RefObject<HostSpeaker | null>;
    thinking: boolean;
    speaking: boolean;
}

/** The orb. */
export function Orb(props: OrbProps): ReactElement {
    const orbRef = useRef<HTMLDivElement | null>(null);
    const { micRef, speakerRef, thinking, speaking } = props;

    useEffect(() => {
        let frame: number = 0;
        let shown: number = 0;

        /** Moves the orb one step toward the current loudness. */
        const step = (): void => {
            const micFresh: boolean = performance.now() - micRef.current.at < MIC_FRESH_MILLISECONDS;
            let target: number = 0;
            if (speaking === true) {
                target = speakerRef.current?.level() ?? 0;
            }
            if (micFresh === true) {
                target = micRef.current.level;
            }
            shown += (target - shown) * SMOOTHING;
            const orb: HTMLDivElement | null = orbRef.current;
            if (orb !== null) {
                orb.style.setProperty("--level", shown.toFixed(3));
                orb.dataset.state = micFresh === true ? "listening" : speaking === true ? "speaking" : thinking === true ? "thinking" : "idle";
            }
            frame = requestAnimationFrame(step);
        };

        frame = requestAnimationFrame(step);
        return (): void => { cancelAnimationFrame(frame); };
    }, [micRef, speakerRef, thinking, speaking]);

    return <div ref={orbRef} className="orb" data-state="idle" aria-hidden="true" />;
}
