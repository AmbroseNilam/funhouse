// The short closed list of moods the host can pick from for a line. A mood changes how a line is
// said and how the lantern looks, and never what's true.

/** The moods, as the host writes them. */
export const HOST_MOODS = ["easy", "smug", "suspicious", "delighted", "teasing", "impressed"] as const;

/** One mood. */
export type HostMood = (typeof HOST_MOODS)[number];

/**
 * Checks a word the host wrote against the list.
 * @param word the word.
 * @returns true when it's one of the moods.
 */
export function isHostMood(word: string): word is HostMood {
    return (HOST_MOODS as readonly string[]).includes(word);
}
