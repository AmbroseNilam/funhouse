// Tests for sourceName: only a site the search really returned may reach the TV.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sourceName } from "./sources.ts";

describe("sourceName", () => {
    const found: string[] = ["https://www.usgs.gov/volcanoes/mauna-loa", "http://en.wikipedia.org/wiki/Krakatoa"];

    it("gives the site's name for a page the search returned, even a different page on it", () => {
        assert.equal(sourceName("https://usgs.gov/other", found), "usgs.gov");
        assert.equal(sourceName(" https://en.wikipedia.org/wiki/Etna ", found), "en.wikipedia.org");
    });

    it("drops a site the search didn't return, a name that isn't an address, and other schemes", () => {
        assert.equal(sourceName("https://made-up.example/page", found), "");
        assert.equal(sourceName("Britannica", found), "");
        assert.equal(sourceName("javascript:alert(1)", found), "");
        assert.equal(sourceName("https://usgs.gov/", []), "");
    });
});
