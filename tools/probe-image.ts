// Measures Muse Image: how long one picture takes, how long a batch asked for at once takes, how
// many fail, and the cost at the published price. It spends real money (about a cent a picture),
// so it asks for exactly the pictures it is told to and no more.
// Usage: npm run probe:image                (3 alone, then 6 at once)
//        node --env-file-if-exists=.env tools/probe-image.ts 5 12     (5 alone, then 12 at once)
// It prints timings and sizes only, never the key and never the pictures.

import { drawImage } from "../providers/meta/image.ts";
import { paintPrompt } from "../studio/kit/painting.ts";

/** Published price of one picture, in dollars. Failed or filtered pictures are not billed. */
const DOLLARS_PER_PICTURE: number = 0.01;

/** What the probe asks for. Plain scenes, in the house style, with nothing a filter would mind. */
const SCENES: string[] = [
    "a lighthouse made of teacups",
    "a goat teaching a class of ducks",
    "a very small train crossing a very large bridge",
    "an umbrella shop on the moon",
    "a tortoise running late for a wedding",
    "a kitchen where the pots cook themselves",
];

/** The outcome of one request. */
interface Timing {
    ok: boolean;
    seconds: number;
    kilobytes: number;
}

/**
 * Draws one picture and times it.
 * @param index which scene.
 * @returns the timing.
 */
async function timed(index: number): Promise<Timing> {
    const startedAt: number = performance.now();
    try {
        const drawing = await drawImage(paintPrompt(SCENES[index % SCENES.length] as string));
        return { ok: true, seconds: (performance.now() - startedAt) / 1000, kilobytes: Math.round(drawing.bytes.length / 1024) };
    } catch {
        return { ok: false, seconds: (performance.now() - startedAt) / 1000, kilobytes: 0 };
    }
}

/**
 * The value at a fraction of the way through a sorted list.
 * @param sorted ascending numbers.
 * @param fraction 0 to 1.
 * @returns the value, or 0 when empty.
 */
function at(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

/**
 * Prints a summary of a set of timings.
 * @param label what was run.
 * @param timings the results.
 * @param wall seconds from the first request to the last answer.
 */
function report(label: string, timings: Timing[], wall: number): void {
    const done: Timing[] = timings.filter((timing: Timing) => timing.ok === true);
    const seconds: number[] = done.map((timing: Timing) => timing.seconds).sort((first: number, second: number) => first - second);
    const kilobytes: number = done.reduce((sum: number, timing: Timing) => sum + timing.kilobytes, 0) / Math.max(1, done.length);
    console.log(`${label}: ${done.length} of ${timings.length} drawn, ${timings.length - done.length} failed`);
    const range: string = `fastest ${at(seconds, 0).toFixed(1)} s, median ${at(seconds, 0.5).toFixed(1)} s, slowest ${at(seconds, 0.999).toFixed(1)} s`;
    console.log(`  each: ${range}; whole batch ${wall.toFixed(1)} s`);
    console.log(`  size: about ${Math.round(kilobytes)} KB each; cost about $${(done.length * DOLLARS_PER_PICTURE).toFixed(2)}`);
}

const alone: number = Number(process.argv[2] ?? 3);
const together: number = Number(process.argv[3] ?? 6);
const one: Timing[] = [];
const oneStarted: number = performance.now();
for (let index = 0; index < alone; index += 1) {
    one.push(await timed(index));
}
report("one at a time", one, (performance.now() - oneStarted) / 1000);
const batchStarted: number = performance.now();
const batch: Timing[] = await Promise.all(Array.from({ length: together }, (_unused: unknown, index: number) => timed(index)));
report("all at once", batch, (performance.now() - batchStarted) / 1000);
