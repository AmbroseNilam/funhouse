// What every picture game shares: how a line a player typed is tidied before it goes near an image
// prompt, how a prompt is built so the house style and the no-faces, no-text rule always close it,
// and a check that a picture address is one the room made. The room's content filter has already
// passed anything typed by the time a kit sees it; this is the second wall, so a kit never builds
// a prompt out of raw text.

/** The house rule every painting prompt closes with: the same no-faces, no-text promise the other games' prompts carry. */
export const HOUSE_RULE: string = "Painted paper and card, rich color, no faces, no text or letters, no logos.";

/** Longest line, in characters, that may reach a prompt. */
export const PROMPT_LINE_LIMIT: number = 120;

/** Where the room serves the pictures it draws. */
const DRAWING_PATH: RegExp = /^\/drawings\/[A-Z]+\/[0-9a-f]+$/;

/**
 * Tidies a typed line for a prompt: one line of letters, digits, spaces and plain punctuation.
 * Brackets, quotes, slashes, colons and control characters are dropped, so a line can't open a
 * ruling, close a quotation or look like an instruction block.
 * @param text what a player typed.
 * @param limit the most characters to keep.
 * @returns the tidied line; empty when nothing usable was left.
 */
export function cleanLine(text: string, limit: number = PROMPT_LINE_LIMIT): string {
    const kept: string = text.replace(/[^\p{L}\p{N} '’,.?!-]+/gu, " ").replace(/\s+/g, " ").trim();
    return kept.slice(0, limit).trim();
}

/**
 * Builds a picture prompt around a scene. The scene goes in as plain description, and the house
 * style always follows it.
 * @param scene what to paint, from a kit's own vocabulary or a tidied player line.
 * @returns the prompt.
 */
export function paintPrompt(scene: string): string {
    return `A warm storybook painting of this scene: ${scene.trim().replace(/[.!?]+$/, "")}. ${HOUSE_RULE}`;
}

/**
 * Whether an address is one the room made for a drawing, so a scene never points at anything else.
 * @param src the address.
 * @returns true when it is.
 */
export function isDrawingAddress(src: string): boolean {
    return DRAWING_PATH.test(src) === true;
}
