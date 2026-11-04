// Content written with web search for a game that asks for it. It gets a few seconds and throws on
// anything else, so the caller falls back on what the model writes without searching. Good replies
// are remembered for a while when the game says they can be, such as a quiz on a topic.

import type { ContentGrounding } from "../shared/cartridge.ts";
import { searchSpark, type SearchedText } from "../providers/meta/search.ts";

/** How long a search may take. A quiz's took 5 to 6 s when measured, and the host has already said it is writing them. */
const SEARCH_TIME_LIMIT_MILLISECONDS: number = 7000;

/** How long a good reply is remembered. */
const REMEMBER_MILLISECONDS: number = 3600000;

/** How many replies are remembered; the oldest goes first. */
const REMEMBERED_REPLIES: number = 200;

const remembered: Map<string, { at: number; reply: SearchedText }> = new Map();

/**
 * Writes content with web search.
 * @param system what the model is doing.
 * @param prompt what to write.
 * @param grounding how the game judges and keeps the reply.
 * @param mayReuse false to search again even if this was asked before, for a room playing it twice.
 * @returns the text and the pages found.
 * @throws Error when the search fails, runs out of time or writes something the game can't use.
 */
export async function groundedContent(system: string, prompt: string, grounding: ContentGrounding, mayReuse: boolean): Promise<SearchedText> {
    const key: string = prompt.toLowerCase();
    const known = remembered.get(key);
    if (mayReuse === true && grounding.cacheable === true && known !== undefined && Date.now() - known.at < REMEMBER_MILLISECONDS) {
        return known.reply;
    }
    const reply: SearchedText = await searchSpark(system, prompt, AbortSignal.timeout(SEARCH_TIME_LIMIT_MILLISECONDS));
    if (reply.sources.length === 0) {
        throw new Error("the model answered without searching");
    }
    if (grounding.usable(reply.text) === false) {
        throw new Error("the search wrote nothing usable");
    }
    if (grounding.cacheable === true) {
        remembered.delete(key);
        remembered.set(key, { at: Date.now(), reply });
        const oldest: string | undefined = remembered.keys().next().value;
        if (remembered.size > REMEMBERED_REPLIES && oldest !== undefined) {
            remembered.delete(oldest);
        }
    }
    return reply;
}
