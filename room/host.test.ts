// Tests for the host's reply limit: a line over the limit waits its turn instead of being lost,
// which matters most for the last line of a game.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Host, type HostStage } from "./host.ts";
import { RateWindow } from "./limits.ts";

/** How short a window the tests use, so they don't wait a minute. */
const WINDOW_MILLISECONDS: number = 300;

const realFetch: typeof fetch = globalThis.fetch;
const realKey: string | undefined = process.env.META_MODEL_API_KEY;

/**
 * Makes a host whose every reply is one word, with a short reply window.
 * @param said filled with what it says.
 * @returns the host.
 */
function hostSaying(said: string[]): Host {
    const stage: HostStage = new Proxy({}, {
        get: (_target: object, name: string | symbol) => {
            if (name === "say") {
                return (text: string): void => { said.push(text); };
            }
            return name === "playerNames" ? (): string[] => [] : (): string => "";
        },
    }) as HostStage;
    const host: Host = new Host(stage, { name: "Marlowe", voice: "", style: "" } as unknown as ConstructorParameters<typeof Host>[1]);
    (host as unknown as { replies: RateWindow }).replies = new RateWindow(1, WINDOW_MILLISECONDS);
    return host;
}

/**
 * Waits a while.
 * @param milliseconds how long.
 */
async function pause(milliseconds: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); });
}

describe("the host's reply limit", () => {
    beforeEach(() => {
        process.env.META_MODEL_API_KEY = "stand-in";
        globalThis.fetch = (async () => new Response('data: {"choices":[{"delta":{"content":"Noted."}}]}\n\ndata: [DONE]\n\n', { status: 200 })) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        if (realKey === undefined) {
            delete process.env.META_MODEL_API_KEY;
            return;
        }
        process.env.META_MODEL_API_KEY = realKey;
    });

    it("replies to a line over the limit once the window opens, rather than dropping it", async () => {
        const said: string[] = [];
        const host: Host = hostSaying(said);
        host.notice("(a line)", 0);
        await pause(WINDOW_MILLISECONDS / 3);
        assert.equal(said.length, 1);
        host.notice("(Game: that's the game. Announce the winner.)", 0);
        await pause(WINDOW_MILLISECONDS / 6);
        assert.equal(said.length, 1, "still over the limit");
        await pause(WINDOW_MILLISECONDS);
        assert.equal(said.length, 2);
    });
});
