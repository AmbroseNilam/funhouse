// Checks who the location rules turn away, and that nobody can fake their way into or out of them.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { regionRule } from "./geo.ts";

beforeEach(() => { process.env.GEO_RULES = "1"; });
afterEach(() => { delete process.env.GEO_RULES; });

test("refuses restricted countries and regions, and keeps paintings off in India", () => {
    assert.equal(regionRule({ "cf-ipcountry": "IR" }, "127.0.0.1").rule, "refused");
    assert.equal(regionRule({ "cf-ipcountry": "hk" }, "127.0.0.1").rule, "refused");
    assert.equal(regionRule({ "cf-ipcountry": "UA", "cf-region-code": "43" }, "::1").rule, "refused");
    assert.equal(regionRule({ "cf-ipcountry": "UA", "cf-region-code": "30" }, "::1").rule, "open");
    assert.equal(regionRule({ "cf-ipcountry": "IN" }, "127.0.0.1").rule, "noPaintings");
    assert.equal(regionRule({ "cf-ipcountry": "CA" }, "127.0.0.1").rule, "open");
    assert.equal(regionRule({}, "127.0.0.1").rule, "open");
});

test("refuses anything that didn't come through the tunnel, whatever its headers say", () => {
    assert.equal(regionRule({ "cf-ipcountry": "CA" }, "203.0.113.4").rule, "refused");
});

test("does nothing unless switched on", () => {
    delete process.env.GEO_RULES;
    assert.equal(regionRule({ "cf-ipcountry": "IR" }, "127.0.0.1").rule, "open");
});
