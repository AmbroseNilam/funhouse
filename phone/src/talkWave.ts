// The dictation waveform in tap-to-talk rooms: thin rounded bars scrolling right to left, each as
// tall as the voice was when it was drawn, over a steady faint line that is all there is in silence.

/** Width of one bar and the gap after it, in CSS pixels. */
const BAR_PIXELS: number = 3;
const GAP_PIXELS: number = 3;

/** How often a new bar arrives. */
const BAR_MILLISECONDS: number = 70;

/** The height of the resting line, in CSS pixels. */
const QUIET_PIXELS: number = 2;

/** How faint the resting line is. */
const QUIET_OPACITY: number = 0.4;

/** A level below this draws no bar, so background hiss doesn't speckle the line. */
const SILENT_LEVEL: number = 0.01;

/**
 * Draws the waveform until stopped.
 * @param canvas where to draw.
 * @param readLevel how loud the microphone is now, from 0 to about 1.
 * @returns a function that stops it.
 */
export function drawWave(canvas: HTMLCanvasElement, readLevel: () => number): () => void {
    const context: CanvasRenderingContext2D | null = canvas.getContext("2d");
    if (context === null) {
        return (): void => { /* nothing was started */ };
    }
    const still: boolean = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scale: number = window.devicePixelRatio;
    const width: number = canvas.clientWidth;
    const height: number = canvas.clientHeight;
    canvas.width = width * scale;
    canvas.height = height * scale;
    context.scale(scale, scale);
    context.fillStyle = getComputedStyle(canvas).color;
    const barCount: number = Math.ceil(width / (BAR_PIXELS + GAP_PIXELS));
    const levels: number[] = new Array<number>(barCount).fill(0);
    let peak: number = 0;
    let lastBarAt: number = performance.now();
    let frame: number = 0;
    const step = (now: number): void => {
        peak = Math.max(peak, readLevel());
        if (now - lastBarAt >= BAR_MILLISECONDS) {
            lastBarAt = now;
            levels.push(peak);
            levels.shift();
            peak = 0;
        }
        const drift: number = still === true ? 0 : ((now - lastBarAt) / BAR_MILLISECONDS) * (BAR_PIXELS + GAP_PIXELS);
        context.clearRect(0, 0, width, height);
        context.globalAlpha = QUIET_OPACITY;
        context.fillRect(0, (height - QUIET_PIXELS) / 2, width, QUIET_PIXELS);
        context.globalAlpha = 1;
        levels.forEach((level: number, index: number) => {
            if (level < SILENT_LEVEL) {
                return;
            }
            const barHeight: number = Math.max(QUIET_PIXELS, Math.sqrt(Math.min(1, level)) * height);
            context.beginPath();
            context.roundRect(index * (BAR_PIXELS + GAP_PIXELS) - drift, (height - barHeight) / 2, BAR_PIXELS, barHeight, BAR_PIXELS / 2);
            context.fill();
        });
        frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return (): void => { cancelAnimationFrame(frame); };
}
