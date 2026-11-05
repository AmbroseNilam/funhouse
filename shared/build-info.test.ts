// Tests for the build stamp: how it's read, worded and compared.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInfoFrom, isOutOfDate } from "./build-info.ts";

describe("the build stamp", () => {
    it("reads a stamp, and calls a missing one dev", () => {
        assert.deepEqual(buildInfoFrom({ BUILD_COMMIT: "9920b0c", BUILD_TIME: "2026-11-04T17:34:00Z" }), { commit: "9920b0c", builtAt: "2026-11-04T17:34:00Z" });
        assert.deepEqual(buildInfoFrom({}), { commit: "dev", builtAt: "" });
    });

    it("only calls a page out of date when both sides are stamped and differ", () => {
        const server = { commit: "bbbbbbb", builtAt: "" };
        assert.equal(isOutOfDate({ commit: "aaaaaaa", builtAt: "" }, server), true);
        assert.equal(isOutOfDate({ commit: "bbbbbbb", builtAt: "" }, server), false);
        assert.equal(isOutOfDate({ commit: "dev", builtAt: "" }, server), false);
        assert.equal(isOutOfDate({ commit: "aaaaaaa", builtAt: "" }, { commit: "dev", builtAt: "" }), false);
    });
});
