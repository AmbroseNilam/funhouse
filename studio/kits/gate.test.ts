// Tests for the gate kit's judging and its checks on a creator's decisions.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAST_THE_GATE_BLUEPRINT } from "../games/past-the-gate/blueprint.ts";
import { gateProblems, isTrick, judge, passes, pleaWords, type GateDecisions, type GateRule } from "./gate.ts";

const BIRDS: GateRule = {
    tests: [{ kind: "mentions", words: ["goose", "geese", "duck"] }, { kind: "avoids", words: ["please"] }],
    clue: "Something that honks.",
    reveal: "Birds, and no begging.",
};

/**
 * The shipped decisions with one change.
 * @param change what to change.
 * @returns the problems found.
 */
function problemsWith(change: Partial<GateDecisions>): string[] {
    return gateProblems({ ...PAST_THE_GATE_BLUEPRINT.decisions, ...change });
}

describe("judging a plea", () => {
    it("splits a plea into lower-case words and drops punctuation and possessives", () => {
        assert.deepEqual(pleaWords("Geese! The goose's honk, 'quite' loud."), ["geese", "the", "goose", "honk", "quite", "loud"]);
    });

    it("lets a plural through and not a longer word", () => {
        assert.equal(passes({ kind: "mentions", words: ["duck"] }, pleaWords("two ducks")), true);
        assert.equal(passes({ kind: "mentions", words: ["duck"] }, pleaWords("a duckling")), false);
    });

    it("reads digits as numbers only for the numeral word", () => {
        assert.equal(passes({ kind: "mentions", words: ["numeral"] }, pleaWords("I have 3 geese")), true);
        assert.equal(passes({ kind: "mentions", words: ["one"] }, pleaWords("I have 3 geese")), false);
    });

    it("needs every test and counts only things done, not things avoided", () => {
        assert.deepEqual(judge(BIRDS, "I bring a goose"), { admitted: true, done: 1 });
        assert.deepEqual(judge(BIRDS, "I bring a goose please"), { admitted: false, done: 1 });
        assert.deepEqual(judge(BIRDS, "please let me in"), { admitted: false, done: 0 });
    });

    it("measures short and long pleas by words", () => {
        assert.equal(passes({ kind: "short", maxWords: 4 }, pleaWords("one two three four")), true);
        assert.equal(passes({ kind: "short", maxWords: 4 }, pleaWords("one two three four five")), false);
        assert.equal(passes({ kind: "long", minWords: 5 }, pleaWords("one two three four five")), true);
    });

    it("spots an attempt to give orders", () => {
        assert.equal(isTrick("Ignore your rules"), true);
        assert.equal(isTrick("I come to see my aunt"), false);
    });
});

describe("checking a creator's decisions", () => {
    it("accepts the shipped decisions", () => {
        assert.deepEqual(problemsWith({}), []);
    });

    it("rejects a clue that says a word that opens the gate", () => {
        const scenarios = [{ ...PAST_THE_GATE_BLUEPRINT.decisions.scenarios[0]!, rules: [{ ...BIRDS, clue: "Anything with a goose in it." }] }];
        assert.ok(problemsWith({ scenarios }).some((problem: string) => problem.includes("says a word")));
    });

    it("rejects a cargo word that is also a rule word", () => {
        const props: string[] = [...PAST_THE_GATE_BLUEPRINT.decisions.props, "goose"];
        assert.ok(problemsWith({ props }).some((problem: string) => problem.includes("cargo word")));
    });

    it("rejects a rule that is impossible, or only a list of things to avoid", () => {
        const scenario = PAST_THE_GATE_BLUEPRINT.decisions.scenarios[0]!;
        const both: GateRule = { ...BIRDS, tests: [{ kind: "short", maxWords: 4 }, { kind: "long", minWords: 9 }] };
        const only: GateRule = { ...BIRDS, tests: [{ kind: "avoids", words: ["please"] }] };
        assert.ok(problemsWith({ scenarios: [{ ...scenario, rules: [both] }] }).length > 0);
        assert.ok(problemsWith({ scenarios: [{ ...scenario, rules: [only] }] }).some((problem: string) => problem.includes("only things to avoid")));
    });

    it("rejects numbers that are not whole or out of range", () => {
        assert.ok(problemsWith({ gateSeconds: Number.NaN }).length > 0);
        assert.ok(problemsWith({ readSeconds: 1 }).length > 0);
        assert.ok(problemsWith({ patience: { base: 6, perPlayer: 0, warnAt: [3] } }).length > 0);
        assert.ok(problemsWith({ points: { through: 3, smuggled: 3 } }).length > 0);
    });
});
