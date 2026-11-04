// The clock both the TV and phones show: a bar that drains, and warms for the last few seconds. Each
// screen runs it from CSS, so it needs no ticking. A screen can stop showing the bar during a pause
// and pick it up after, so this remembers how far each clock had got.

/** How long before the end the bar warms and the small nudges happen. */
export const DRAIN_WARM_SECONDS: number = 10;

/** When each clock began on this screen, and when it was last taken off the screen. */
const CLOCKS: Map<string, { startedAt: number; hiddenAt: number | null }> = new Map();

/**
 * How far a clock has run on this screen, not counting time it was off the screen.
 * @param key which clock.
 * @returns seconds gone.
 */
export function drainShown(key: string): number {
    const now: number = Date.now();
    const clock: { startedAt: number; hiddenAt: number | null } = CLOCKS.get(key) ?? { startedAt: now, hiddenAt: null };
    const startedAt: number = clock.hiddenAt === null ? clock.startedAt : clock.startedAt + (now - clock.hiddenAt);
    CLOCKS.set(key, { startedAt, hiddenAt: null });
    return (now - startedAt) / 1000;
}

/**
 * Notes that a clock has gone off the screen, so the time away isn't counted.
 * @param key which clock.
 */
export function drainHidden(key: string): void {
    const clock = CLOCKS.get(key);
    if (clock !== undefined) {
        CLOCKS.set(key, { ...clock, hiddenAt: Date.now() });
    }
}
