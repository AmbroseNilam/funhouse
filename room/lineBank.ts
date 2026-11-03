// Pre-recorded lines, shared by every room. The same words in the same voice sound the same in any
// room, so each is rendered once while the server runs instead of again for every room.

import { BUDGET } from "./limits.ts";

/** Lines rendered or being rendered, by voice, style and words. */
const LINES: Map<string, Promise<Uint8Array>> = new Map();

/**
 * Gets a pre-recorded line, rendering it the first time anyone asks. A render that fails is
 * forgotten, so the next room tries again.
 * @param key what identifies the recording: its voice, style and words.
 * @param render makes the recording.
 * @returns the audio, or null when the day's budget for new recordings has run out.
 */
export async function recordedLine(key: string, render: () => Promise<Uint8Array>): Promise<Uint8Array | null> {
    const existing: Promise<Uint8Array> | undefined = LINES.get(key);
    if (existing !== undefined) {
        return existing;
    }
    if (BUDGET.spend("bank") === false) {
        return null;
    }
    const rendering: Promise<Uint8Array> = render();
    LINES.set(key, rendering);
    rendering.catch(() => { LINES.delete(key); });
    return rendering;
}
