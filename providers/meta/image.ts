// Draws one picture with Muse Image. A picture takes about 9 s and costs about a cent, so games
// ask ahead of when they will need it. Nothing here knows about games or rooms.

import { charge, mayCharge, PRICES } from "../meter.ts";
import { postJson } from "./client.ts";

/** Model identifier for Muse Image. */
export const IMAGE_MODEL: string = "muse-image-1.0";

/** Longest wait for one picture. */
const IMAGE_TIME_LIMIT_MILLISECONDS: number = 60000;

/** How long to wait before trying a picture again. */
const IMAGE_RETRY_DELAY_MILLISECONDS: number = 1500;

/** A finished picture. */
export interface Drawing {
    bytes: Buffer;
    mediaType: string;
}

/** Shape of the response, as far as this file reads it. */
interface ImageResponse {
    data?: { b64_json?: string }[];
    output_format?: string;
}

/**
 * Whether a failure might go away on its own: too busy, a server fault or a dropped connection. A refusal won't.
 * @param error what went wrong.
 * @returns true when another try could work.
 */
function isTransient(error: unknown): boolean {
    if (error instanceof Error === false) {
        return false;
    }
    return /responded (429|5\d\d)\./.test(error.message) === true || error instanceof TypeError;
}

/**
 * Makes one try at a picture.
 * @param prompt what to draw.
 * @param signal stops the try.
 * @returns the picture.
 * @throws Error when the API fails or returns no picture.
 */
async function askForPicture(prompt: string, signal: AbortSignal): Promise<Drawing> {
    if (mayCharge("image") === false) {
        throw new Error("The spending limit has been reached.");
    }
    charge("image", PRICES.imagePerPicture);
    const body: Record<string, unknown> = { model: IMAGE_MODEL, prompt, n: 1, size: "1024x1024" };
    const response: Response = await postJson("/images/generations", body, signal);
    const parsed: ImageResponse = await response.json() as ImageResponse;
    const encoded: string | undefined = parsed.data?.[0]?.b64_json;
    if (encoded === undefined) {
        throw new Error("Muse Image returned no picture.");
    }
    return { bytes: Buffer.from(encoded, "base64"), mediaType: `image/${parsed.output_format ?? "webp"}` };
}

/**
 * Draws a picture, trying once more if the first try fails in a way that could pass, all within one
 * time limit. Each try counts as spend, since a provider may bill one that failed late.
 * @param prompt what to draw.
 * @param retryDelayMilliseconds how long to wait before the second try.
 * @returns the picture.
 * @throws Error when the API fails or returns no picture.
 */
export async function drawImage(prompt: string, retryDelayMilliseconds: number = IMAGE_RETRY_DELAY_MILLISECONDS): Promise<Drawing> {
    const signal: AbortSignal = AbortSignal.timeout(IMAGE_TIME_LIMIT_MILLISECONDS);
    try {
        return await askForPicture(prompt, signal);
    } catch (error: unknown) {
        if (isTransient(error) === false || signal.aborted === true) {
            throw error;
        }
    }
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, retryDelayMilliseconds); });
    return askForPicture(prompt, signal);
}
