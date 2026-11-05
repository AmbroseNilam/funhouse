// Checks when a picture is tried again: once on a failure that could pass, never on a refusal.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { drawImage } from "./image.ts";

const realFetch: typeof fetch = globalThis.fetch;
const picture: string = JSON.stringify({ data: [{ b64_json: "aGk=" }], output_format: "webp" });

/**
 * Answers each call in turn.
 * @param answers a status for each call, or an error to throw.
 * @returns how many calls have been made so far.
 */
function answering(answers: (number | Error)[]): () => number {
    let calls: number = 0;
    process.env.META_MODEL_API_KEY = process.env.META_MODEL_API_KEY ?? "stand-in";
    globalThis.fetch = (): Promise<Response> => {
        const answer: number | Error | undefined = answers[calls];
        calls += 1;
        if (answer instanceof Error) {
            return Promise.reject(answer);
        }
        return Promise.resolve(new Response(answer === 200 ? picture : "no", { status: answer ?? 500 }));
    };
    return () => calls;
}

afterEach(() => { globalThis.fetch = realFetch; });

test("tries once more after a busy reply, a server fault or a dropped connection", async () => {
    for (const first of [429, 503, new TypeError("fetch failed")]) {
        const calls = answering([first, 200]);
        const drawing = await drawImage("a lantern", 1);
        assert.equal(drawing.mediaType, "image/webp");
        assert.equal(calls(), 2);
    }
});

test("gives up after the second try", async () => {
    const calls = answering([500, 500, 200]);
    await assert.rejects(drawImage("a lantern", 1), /responded 500/);
    assert.equal(calls(), 2);
});

test("never retries a refusal", async () => {
    for (const refused of [400, 401, 403, 422]) {
        const calls = answering([refused, 200]);
        await assert.rejects(drawImage("a lantern", 1), new RegExp(`responded ${refused}`));
        assert.equal(calls(), 1);
    }
});
