// Proves the one decision behind the phone's mic and hold-to-talk control: only the modes that listen allow
// it, so a game that declares "muted" (a tap-only game) shows neither.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listeningAllowsTalk } from "./controls.ts";

describe("listeningAllowsTalk", () => {
    it("allows holding to talk only when the game listens", () => {
        assert.equal(listeningAllowsTalk("holdToTalk"), true);
        assert.equal(listeningAllowsTalk("openFloor"), true);
        assert.equal(listeningAllowsTalk("muted"), false);
        assert.equal(listeningAllowsTalk("hostSpeaking"), false);
    });
});
