// Measures Muse Spark's time to first token and total time for a short host line, at minimal
// reasoning effort, which is what quick reactions in the room will use.
// Usage: npm run probe:spark

import { streamSpark } from "../providers/meta/spark.ts";

/**
 * Formats milliseconds as seconds with two decimals.
 * @param milliseconds a duration.
 * @returns a short human-readable string.
 */
function formatSeconds(milliseconds: number): string {
    return `${(milliseconds / 1000).toFixed(2)} s`;
}

/**
 * Streams one host line and prints timings.
 */
async function main(): Promise<void> {
    const startedAt: number = performance.now();
    let firstTokenAt: number = 0;
    let text: string = "";
    const stream: AsyncGenerator<string> = streamSpark([
        { role: "system", content: "You are the host of a party game night. Reply in one short, warm sentence." },
        { role: "user", content: "Ambrose just joined the room. Greet them by name." },
    ]);
    for await (const delta of stream) {
        if (firstTokenAt === 0) {
            firstTokenAt = performance.now();
        }
        text += delta;
    }
    const finishedAt: number = performance.now();
    console.log(`first token   ${formatSeconds(firstTokenAt - startedAt)}`);
    console.log(`complete      ${formatSeconds(finishedAt - startedAt)}`);
    console.log(`text          ${text.trim()}`);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
