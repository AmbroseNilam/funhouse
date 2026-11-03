// The bands of lamplight that grow while someone talks. The voice's loudness jumps with every
// syllable, so the bands follow a smoothed version of it: they rise fairly quickly and fall slowly.

/** Time to rise toward a louder voice, in milliseconds. */
const RISE_MILLISECONDS: number = 140;

/** Time to fall toward a quieter voice, in milliseconds. */
const FALL_MILLISECONDS: number = 500;

/** The level the bands hold when someone has asked their device for less motion. */
const STILL_LEVEL: number = 0.4;

/**
 * Moves the bands with a voice until stopped. The bands keep their last size when it stops, so they
 * fade out where they are without snapping back.
 * @param surface the element that holds the bands.
 * @param readLevel returns the loudness right now, from 0 to about 1.
 * @returns a function that stops following.
 */
export function followVoice(surface: HTMLElement, readLevel: () => number): () => void {
    const still: boolean = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let level: number = 0;
    let last: number = performance.now();
    let frame: number = 0;
    const step = (now: number): void => {
        const target: number = still === true ? STILL_LEVEL : readLevel();
        const time: number = target > level ? RISE_MILLISECONDS : FALL_MILLISECONDS;
        level += (target - level) * (1 - Math.exp(-(now - last) / time));
        last = now;
        surface.style.setProperty("--level", level.toFixed(3));
        frame = requestAnimationFrame(step);
    };
    surface.style.setProperty("--level", "0");
    frame = requestAnimationFrame(step);
    return (): void => { cancelAnimationFrame(frame); };
}
