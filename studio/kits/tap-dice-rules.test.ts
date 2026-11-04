// Proves the pure rules of Under the Cup: which bid beats which, how dice are counted with ones
// wild, the odds from the dice count alone, how bids are spoken, and who bids next.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    beats, boldness, chanceAtLeast, chancePerDie, clockOpening, countFace, faceChoices, lowestRaiseQuantity, nextWithDice, quantityChoices, rollDice, sayBid, type Bid,
} from "./tap-dice-rules.ts";

/** A standing bid of three fours. */
const THREE_FOURS: Bid = { playerId: "paper1", quantity: 3, face: 4 };

describe("under the cup rules", () => {
    it("orders bids by quantity, then by face, and rejects nonsense", () => {
        assert.equal(beats(1, 1, null), true);
        assert.equal(beats(3, 5, THREE_FOURS), true, "same number, higher face");
        assert.equal(beats(3, 4, THREE_FOURS), false, "the same bid");
        assert.equal(beats(3, 2, THREE_FOURS), false, "same number, lower face");
        assert.equal(beats(4, 1, THREE_FOURS), true, "more dice, any face");
        assert.equal(beats(2, 6, THREE_FOURS), false, "fewer dice");
        assert.equal(beats(0, 3, null), false);
        assert.equal(beats(2, 7, null), false);
        assert.equal(beats(2.5, 3, null), false);
        assert.equal(beats(Number.NaN, 3, null), false);
    });

    it("offers the lowest raise, a capped list of quantities, and only faces that beat the bid", () => {
        assert.equal(lowestRaiseQuantity(null), 1);
        assert.equal(lowestRaiseQuantity(THREE_FOURS), 3);
        assert.equal(lowestRaiseQuantity({ ...THREE_FOURS, face: 6 }), 4);
        assert.deepEqual(quantityChoices(THREE_FOURS, 12), [3, 4, 5, 6, 7, 8, 9, 10]);
        assert.deepEqual(quantityChoices(THREE_FOURS, 5), [3, 4, 5]);
        assert.deepEqual(quantityChoices({ ...THREE_FOURS, quantity: 5, face: 6 }, 5), [], "nothing left to raise to");
        assert.deepEqual(faceChoices(3, THREE_FOURS), [5, 6]);
        assert.deepEqual(faceChoices(4, THREE_FOURS), [1, 2, 3, 4, 5, 6]);
    });

    it("counts a face, with ones wild unless the bid is on ones", () => {
        const hands: number[][] = [[1, 4, 4], [2, 1, 6]];
        assert.equal(countFace(hands, 4, true), 4);
        assert.equal(countFace(hands, 4, false), 2);
        assert.equal(countFace(hands, 1, true), 2, "ones are only ones when bid on");
        assert.equal(countFace(hands, 5, true), 2, "wild ones count towards a face nobody rolled");
    });

    it("works out the odds from the number of dice alone", () => {
        assert.equal(chancePerDie(3, true), 1 / 3);
        assert.equal(chancePerDie(1, true), 1 / 6);
        assert.equal(chancePerDie(3, false), 1 / 6);
        assert.equal(chanceAtLeast(10, 1 / 6, 0), 1);
        assert.equal(chanceAtLeast(10, 1 / 6, 11), 0);
        assert.ok(Math.abs(chanceAtLeast(1, 1 / 6, 1) - 1 / 6) < 1e-9);
        assert.ok(Math.abs(chanceAtLeast(2, 0.5, 1) - 0.75) < 1e-9);
        const rarer: number = chanceAtLeast(12, 1 / 3, 8);
        assert.ok(rarer < chanceAtLeast(12, 1 / 3, 5));
        assert.equal(boldness(0.9), "safe");
        assert.equal(boldness(0.5), "fair");
        assert.equal(boldness(0.2), "stretch");
        assert.equal(boldness(0.1), "longShot");
        assert.equal(boldness(0.01), "wild");
    });

    it("speaks bids, rolls only real faces and opens modestly by the clock", () => {
        assert.equal(sayBid(1, 6), "one six");
        assert.equal(sayBid(4, 6), "four sixes");
        assert.equal(sayBid(21, 2), "21 twos");
        const faces: number[] = rollDice(500, (() => { let value = 0; return (): number => { value = (value + 0.137) % 1; return value; }; })());
        assert.ok(faces.every((face: number) => face >= 1 && face <= 6));
        assert.deepEqual(rollDice(2, () => 0.9999999), [6, 6], "never rolls a seven");
        assert.deepEqual(clockOpening(12), { quantity: 2, face: 2 });
        assert.deepEqual(clockOpening(2), { quantity: 1, face: 2 });
    });

    it("finds the next seat that still has dice", () => {
        const seats: string[] = ["a", "b", "c", "d"];
        assert.equal(nextWithDice(seats, { a: 1, b: 0, c: 2, d: 1 }, "a"), "c");
        assert.equal(nextWithDice(seats, { a: 1, b: 1, c: 1, d: 1 }, "d"), "a");
        assert.equal(nextWithDice(seats, { a: 1, b: 0, c: 0, d: 0 }, "a"), "a", "the only one left is next after themselves");
        assert.equal(nextWithDice(seats, { a: 0, b: 0, c: 0, d: 0 }, "a"), null);
        assert.equal(nextWithDice(seats, { a: 1, b: 1 }, null), "a");
        assert.equal(nextWithDice([], {}, null), null);
    });
});
