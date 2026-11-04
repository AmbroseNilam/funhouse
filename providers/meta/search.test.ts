// Tests for readSearchReply: the answer is the last message that isn't commentary.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSearchReply } from "./search.ts";

describe("readSearchReply", () => {
    it("skips the narration and collects every page found", () => {
        const reply: unknown = {
            output: [
                { type: "message", phase: "commentary", content: [{ text: "Searching." }] },
                { type: "web_search_call", action: { sources: [{ url: "https://a.example" }, { type: "url" }] } },
                { type: "message", content: [{ text: "[1]" }] },
            ],
        };
        assert.deepEqual(readSearchReply(reply), { text: "[1]", sources: ["https://a.example"] });
    });

    it("gives nothing for a reply it can't read", () => {
        assert.deepEqual(readSearchReply({ output: "no" }), { text: "", sources: [] });
        assert.deepEqual(readSearchReply(null), { text: "", sources: [] });
    });
});
