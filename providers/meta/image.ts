// Draws one picture with Muse Image. A picture takes about 9 s and costs about a cent, so games
// ask ahead of when they will need it. Nothing here knows about games or rooms.

import { charge, mayCharge, PRICES } from "../meter.ts";
import { postJson } from "./client.ts";

/** Model identifier for Muse Image. */
export const IMAGE_MODEL: string = "muse-image-1.0";

/** Longest wait for one picture. */
const IMAGE_TIME_LIMIT_MILLISECONDS: number = 60000;

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
 * Draws a picture.
 * @param prompt what to draw.
 * @returns the picture.
 * @throws Error when the API fails or returns no picture.
 */
export async function drawImage(prompt: string): Promise<Drawing> {
    if (mayCharge("image") === false) {
        throw new Error("The spending limit has been reached.");
    }
    charge("image", PRICES.imagePerPicture);
    const body: Record<string, unknown> = { model: IMAGE_MODEL, prompt, n: 1, size: "1024x1024" };
    const response: Response = await postJson("/images/generations", body, AbortSignal.timeout(IMAGE_TIME_LIMIT_MILLISECONDS));
    const parsed: ImageResponse = await response.json() as ImageResponse;
    const encoded: string | undefined = parsed.data?.[0]?.b64_json;
    if (encoded === undefined) {
        throw new Error("Muse Image returned no picture.");
    }
    return { bytes: Buffer.from(encoded, "base64"), mediaType: `image/${parsed.output_format ?? "webp"}` };
}
