// Tests for roomOptions: tap-to-talk and the lively host are the defaults, and the address can turn them off.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { roomOptions } from "./room-options.ts";

describe("roomOptions", () => {
    it("turns on tap-to-talk and the lively host with no parameters, on the usual model", () => {
        assert.deepEqual(roomOptions(new URLSearchParams("")), { lively: true, tapToTalk: true, fastReplies: false });
    });

    it("keeps old links working", () => {
        assert.deepEqual(roomOptions(new URLSearchParams("lively=1&tap=1&fast=1")), { lively: true, tapToTalk: true, fastReplies: true });
    });

    it("lets the address turn each one off", () => {
        assert.equal(roomOptions(new URLSearchParams("tap=0")).tapToTalk, false);
        assert.equal(roomOptions(new URLSearchParams("hold=1")).tapToTalk, false);
        assert.equal(roomOptions(new URLSearchParams("lively=0")).lively, false);
    });
});
