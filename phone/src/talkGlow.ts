// The bands of lamplight that grow while someone talks. The voice's loudness jumps with every
// syllable, so the bands follow a smoothed version of it: they rise fairly quickly and fall slowly.
// The values can be tried on a phone at /phone/?tune=1, and that phone keeps what was chosen.

import type { CSSProperties } from "react";

/** How the bands respond to a voice. */
export interface TalkTuning {
    /** How far the bands grow at full voice, as a share of the largest circle. */
    size: number;
    /** Time to rise toward a louder voice, in milliseconds. */
    rise: number;
    /** Time to fall toward a quieter voice, in milliseconds. */
    fall: number;
    /** How solid the bands look, from 0 to 1. */
    strength: number;
}

/** The values everyone gets until they've tuned their own phone. */
export const DEFAULT_TALK_TUNING: TalkTuning = { size: 0.3, rise: 140, fall: 500, strength: 0.85 };

/** Where a phone keeps its own values. */
const STORAGE_KEY: string = "funhouse-talk-tuning";

/** The level the bands hold when someone has asked their device for less motion. */
const STILL_LEVEL: number = 0.4;

/**
 * Reads the values this phone has chosen.
 * @returns the saved values, or the defaults when there are none or storage is blocked.
 */
export function loadTalkTuning(): TalkTuning {
    try {
        const saved: Partial<TalkTuning> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<TalkTuning>;
        return { ...DEFAULT_TALK_TUNING, ...saved };
    } catch {
        return DEFAULT_TALK_TUNING;
    }
}

/**
 * Keeps the values on this phone.
 * @param tuning the values to keep.
 */
export function saveTalkTuning(tuning: TalkTuning): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
    } catch {
        // Blocked storage only means the choice lasts until the page closes.
    }
}

/**
 * The style a surface needs so its bands use these values.
 * @param tuning the values to use.
 * @returns CSS variables for the surface.
 */
export function talkGlowStyle(tuning: TalkTuning): CSSProperties {
    return { "--glow-size": tuning.size, "--glow-strength": tuning.strength } as CSSProperties;
}

/**
 * Moves the bands with a voice until stopped. The bands keep their last size when it stops, so they
 * fade out where they are without snapping back.
 * @param surface the element that holds the bands.
 * @param readLevel returns the loudness right now, from 0 to about 1.
 * @param tuning how the bands respond.
 * @returns a function that stops following.
 */
export function followVoice(surface: HTMLElement, readLevel: () => number, tuning: TalkTuning): () => void {
    const still: boolean = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let level: number = 0;
    let last: number = performance.now();
    let frame: number = 0;
    const step = (now: number): void => {
        const target: number = still === true ? STILL_LEVEL : readLevel();
        const time: number = target > level ? tuning.rise : tuning.fall;
        level += (target - level) * (1 - Math.exp(-(now - last) / time));
        last = now;
        surface.style.setProperty("--level", level.toFixed(3));
        frame = requestAnimationFrame(step);
    };
    surface.style.setProperty("--level", "0");
    frame = requestAnimationFrame(step);
    return (): void => { cancelAnimationFrame(frame); };
}
