// Tests for Off by a Mile: the blueprint passes the studio checks, and every question in the bank
// has a source, a true-looking range and an aside, with the answer inside the range and no duplicates.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blueprintProblems } from "../../blueprint.ts";
import { checkBlueprint } from "../../check.ts";
import { OFF_BY_A_MILE_BLUEPRINT } from "./blueprint.ts";
import { QUESTIONS } from "./questions.ts";

describe("the Off by a Mile blueprint", () => {
    it("passes the studio checks across seeds and every kind of table", () => {
        assert.deepEqual(blueprintProblems(OFF_BY_A_MILE_BLUEPRINT), []);
        const tally = checkBlueprint(OFF_BY_A_MILE_BLUEPRINT);
        assert.deepEqual(tally.problems, []);
        assert.equal(tally.ended, tally.rehearsals);
        assert.deepEqual(tally.phasesNeverReached, []);
        assert.ok(Object.keys(tally.outcomes).length >= 3, Object.keys(tally.outcomes).join("; "));
    });

    it("has a named source and a second fact for every question, and no digits in a prompt", () => {
        assert.ok(QUESTIONS.length >= 15);
        for (const question of QUESTIONS) {
            assert.ok(question.source.length > 20, `${question.id} has no real source`);
            assert.ok(question.aside.length > 15, `${question.id} has no aside`);
            assert.equal(/\d/.test(question.prompt), false, `${question.id} has a digit in its prompt`);
            assert.equal(question.prompt.toLowerCase().includes(String(question.answer)), false);
        }
    });

    it("never writes a question's answer into another question's prompt or the box", () => {
        const shown: string = [OFF_BY_A_MILE_BLUEPRINT.box.pitch, ...OFF_BY_A_MILE_BLUEPRINT.box.howToPlay, ...OFF_BY_A_MILE_BLUEPRINT.box.remarks].join(" ");
        assert.equal(/\d/.test(shown), false);
    });
});
