// Tests for Mind the Gap: the blueprint passes the studio checks, every card has a source and no digit in
// its name, and every surprising card's claim about other years is true of the years in the bank.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blueprintProblems } from "../../blueprint.ts";
import { checkBlueprint } from "../../check.ts";
import { MIND_THE_GAP_BLUEPRINT } from "./blueprint.ts";
import { CARDS } from "./cards.ts";

/**
 * A card's year.
 * @param id the card's id.
 * @returns the year.
 */
function yearOf(id: string): number {
    const card = CARDS.find((candidate) => candidate.id === id);
    assert.ok(card !== undefined, `no card ${id}`);
    return card.year;
}

describe("the Mind the Gap blueprint", () => {
    it("passes the studio checks across seeds and every kind of table", () => {
        assert.deepEqual(blueprintProblems(MIND_THE_GAP_BLUEPRINT), []);
        const tally = checkBlueprint(MIND_THE_GAP_BLUEPRINT);
        assert.deepEqual(tally.problems, []);
        assert.equal(tally.ended, tally.rehearsals);
        assert.deepEqual(tally.phasesNeverReached, []);
        assert.ok(Object.keys(tally.outcomes).length >= 3, Object.keys(tally.outcomes).join("; "));
    });

    it("has a source for every card, and none about music", () => {
        assert.ok(CARDS.length >= 35);
        for (const card of CARDS) {
            assert.ok(card.source.length > 20, `${card.id} has no real source`);
            assert.equal(/music|song|album|band|guitar|piano|record player|phonograph|radio/i.test(`${card.name} ${card.short} ${card.surprise ?? ""}`), false, `${card.id} is about music`);
        }
    });

    it("keeps the claims in the surprising cards true of the years in the bank", () => {
        assert.equal(yearOf("telephone") - yearOf("fax"), 33);
        assert.equal(yearOf("zipper") - yearOf("wright"), 14);
        assert.equal(yearOf("locomotive") - yearOf("balloon"), 21);
        assert.ok(yearOf("tenochtitlan") - yearOf("oxford") > 200);
        for (const id of ["telephone", "bulb", "eiffel", "wright"]) {
            assert.ok(yearOf("bread") > yearOf(id), id);
        }
        const surprising = CARDS.filter((card) => card.surprise !== null).map((card) => card.id).sort();
        assert.deepEqual(surprising, ["balloon", "bread", "fax", "oxford", "zipper"]);
    });

    it("has several different years to deal from, with the shared ones named", () => {
        const years = CARDS.map((card) => card.year);
        assert.ok(new Set(years).size >= MIND_THE_GAP_BLUEPRINT.decisions.startCards + MIND_THE_GAP_BLUEPRINT.decisions.rounds + 10);
    });
});
