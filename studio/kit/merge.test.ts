// Tests for the local duplicate merger: what counts as the same clue, and what must stay apart.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDuplicates, sameAnswer, type Answer } from "./merge.ts";

/**
 * Answers from numbered players.
 * @param texts what each said.
 * @returns the answers.
 */
function answersOf(...texts: string[]): Answer[] {
    return texts.map((text: string, index: number) => ({ playerId: `p${index + 1}`, text }));
}

test("case, spacing, hyphens and accents do not make a clue different", () => {
    assert.equal(sameAnswer("Pizza", "pizza"), true);
    assert.equal(sameAnswer("ice-cream", "Ice Cream"), true);
    assert.equal(sameAnswer("café", "cafe"), true);
});

test("plurals, endings and doubled letters share a stem", () => {
    assert.equal(sameAnswer("cheese", "cheeses"), true);
    assert.equal(sameAnswer("run", "running"), true);
    assert.equal(sameAnswer("bake", "baked"), true);
    assert.equal(sameAnswer("berry", "berries"), true);
    assert.equal(sameAnswer("box", "boxes"), true);
});

test("British and American spellings merge", () => {
    assert.equal(sameAnswer("colour", "color"), true);
    assert.equal(sameAnswer("theatre", "theater"), true);
    assert.equal(sameAnswer("traveling", "travelling"), true);
    assert.equal(sameAnswer("realise", "realize"), true);
});

test("one slipped letter in a long word merges, in a short word it does not", () => {
    assert.equal(sameAnswer("pizza", "piza"), true);
    assert.equal(sameAnswer("elephant", "elephnat"), true);
    assert.equal(sameAnswer("bread", "break"), false);
    assert.equal(sameAnswer("cat", "cut"), false);
    assert.equal(sameAnswer("bear", "beer"), false);
});

test("different clues stay apart, and blanks never merge", () => {
    assert.equal(sameAnswer("hot", "cold"), false);
    assert.equal(sameAnswer("sun", "moon"), false);
    assert.equal(sameAnswer("", ""), false);
    assert.equal(sameAnswer("!!!", "..."), false);
});

test("groups collect every twin, and loners are left out", () => {
    const groups = mergeDuplicates(answersOf("Cheese", "mouse", "cheeses", "CHEESE", "cat"));
    assert.deepEqual(groups, [{ playerIds: ["p1", "p3", "p4"] }]);
});

test("two separate pairs make two groups in order of the first answer", () => {
    const groups = mergeDuplicates(answersOf("sun", "hot", "suns", "Hot"));
    assert.deepEqual(groups, [{ playerIds: ["p1", "p3"] }, { playerIds: ["p2", "p4"] }]);
});

test("nobody matching gives no groups", () => {
    assert.deepEqual(mergeDuplicates(answersOf("a", "b", "c")), []);
    assert.deepEqual(mergeDuplicates([]), []);
});
