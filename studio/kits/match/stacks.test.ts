// Proves the pure parts of Same Page: the local check merges what is plainly the same answer and
// keeps near-misses apart, the pairs it cannot settle are found, joining only ever adds merges, and
// the scoring and the hat follow the rules. Ambiguous words are pinned here: the same word typed
// twice is one answer whatever its sense, and a word beside a longer phrase is a question, not a match.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doubtedTexts, doubtsAmong, hatAfter, joinStacks, looksAlike, scoreStacks, stackCards, standIn, type Card, type Stack } from "./stacks.ts";

/**
 * Cards from answers, one player each.
 * @param texts the answers.
 * @returns the cards.
 */
function cards(...texts: string[]): Card[] {
    return texts.map((text: string, place: number): Card => ({ playerId: `p${place + 1}`, text }));
}

/**
 * The stacks the local check makes, as lists of seat numbers.
 * @param texts the answers.
 * @returns the stacks.
 */
function seats(...texts: string[]): string[] {
    return stackCards(cards(...texts)).map((stack: Stack) => stack.map((id: string) => id.slice(1)).join("+"));
}

describe("the local check", () => {
    it("merges case, plurals, punctuation, spelling variants and a missing space", () => {
        assert.deepEqual(seats("Pizza", "pizzas", "PIZZA!", "tacos"), ["1+2+3", "4"]);
        assert.deepEqual(seats("ice cream", "Ice-Cream", "icecream"), ["1+2+3"]);
        assert.deepEqual(seats("colour", "color"), ["1+2"]);
    });

    it("keeps near-misses apart", () => {
        for (const pair of [["bat", "bait"], ["bat", "cat"], ["bat", "bar"], ["tea", "team"], ["sun", "son"], ["ice", "rice"], ["beer", "bear"], ["ham", "hamster"], ["pen", "pencil"], ["mist", "mint"]]) {
            assert.deepEqual(seats(pair[0] ?? "", pair[1] ?? ""), ["1", "2"], `${pair.join(" and ")} must stay apart`);
        }
    });

    it("treats the same word as one answer whatever its sense, and a word beside a phrase as a doubt", () => {
        assert.deepEqual(seats("bat", "Bat", "bats"), ["1+2+3"], "an animal and a club are both just bat on a card");
        assert.deepEqual(seats("bat", "baseball bat"), ["1", "2"]);
        assert.equal(looksAlike("bat", "baseball bat"), true);
        assert.equal(looksAlike("bat", "bait"), false);
        assert.equal(looksAlike("couch", "sofa"), false);
        const stacks: Stack[] = stackCards(cards("bat", "baseball bat", "bait"));
        const texts = (stack: Stack): string[] => stack.map((id: string) => ["bat", "baseball bat", "bait"][Number(id.slice(1)) - 1] ?? "");
        assert.deepEqual(doubtsAmong(stacks, texts), [[0, 1]]);
    });

    it("never chains: two cards only join if the check says so directly", () => {
        assert.deepEqual(seats("moon", "moonlight", "light"), ["1", "2", "3"]);
    });
});

describe("naming a stack", () => {
    it("stands a stack in by its shortest card without trailing punctuation, whatever the seat order", () => {
        assert.equal(standIn(["Pizza!", "pizzas", "pizza"]), "Pizza");
        assert.equal(standIn(["bats", "bat"]), "bat");
        assert.equal(standIn([]), "");
    });

    it("finds the exact pair that raised a doubt, whichever card comes first", () => {
        assert.deepEqual(doubtedTexts(["bats", "bat"], ["baseball bat"]), ["bats", "baseball bat"]);
        assert.equal(doubtedTexts(["bat"], ["bait"]), null);
    });
});

describe("joining and scoring", () => {
    it("joins what a model said and nothing else", () => {
        const stacks: Stack[] = [["p1"], ["p2"], ["p3", "p4"]];
        assert.deepEqual(joinStacks(stacks, [[0, 2]]), [["p1", "p3", "p4"], ["p2"]]);
        assert.deepEqual(joinStacks(stacks, []), stacks);
        assert.deepEqual(joinStacks(stacks, [[0, 9]]), stacks);
    });

    it("scores one per other card, two each for exactly two, nothing for a lone card", () => {
        const points: Record<string, number> = scoreStacks([["a", "b", "c", "d"], ["e", "f", "g"], ["h", "i"], ["j"]], 2);
        assert.deepEqual(points, { a: 3, b: 3, c: 3, d: 3, e: 2, f: 2, g: 2, h: 2, i: 2, j: 0 });
    });
});

describe("the hat", () => {
    it("moves to the only lone card", () => {
        assert.equal(hatAfter(null, [["a", "b"], ["c"]]), "c");
        assert.equal(hatAfter("a", [["b", "c"], ["d"]]), "d");
    });

    it("stays put when two lone cards tie or none sits alone", () => {
        assert.equal(hatAfter("a", [["b", "c"], ["d"], ["e"]]), "a");
        assert.equal(hatAfter(null, [["b", "c"], ["d"], ["e"]]), null);
        assert.equal(hatAfter("a", [["b", "c", "d"]]), "a");
    });

    it("does not move for a round with fewer than two cards", () => {
        assert.equal(hatAfter("a", [["b"]]), "a");
        assert.equal(hatAfter(null, []), null);
    });
});
