// A diagnostic for slow hardware, on only with ?fps=1 on the screen's address. Once a second it
// logs how many frames were drawn and the longest gap between them, for reading from a device's
// console log when there's no inspector.

/** Starts logging frame rate. Runs until the page closes. */
export function startFrameMeter(): void {
    let frames: number = 0;
    let longest: number = 0;
    let last: number = performance.now();
    let windowStart: number = last;
    const step = (now: number): void => {
        frames += 1;
        longest = Math.max(longest, now - last);
        last = now;
        if (now - windowStart >= 1000) {
            console.warn(`frames: ${frames} fps, longest ${Math.round(longest)} ms`);
            frames = 0;
            longest = 0;
            windowStart = now;
        }
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}
