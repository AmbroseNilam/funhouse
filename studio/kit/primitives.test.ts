// Proves the kit primitives: a seeded source replays, dealing picks one seated player, a budget
// warns and runs out exactly once, a tally orders and finds ties, and a frozen copy shares
// nothing with what it was copied from. Also the shared checks: reserved ruling names, whole
// numbers, short text, and remarks that would give away a secret.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer } from "../../shared/cartridge.ts";
import { boxProblems, isShortText, isWholeIn, rulingNameProblem, squash, type Box } from "./kit.ts";
import { dealOne, frozenCopy, seededRandom, spend, tally, type Budget, type Spent, type Tally } from "./primitives.ts";

/** A box that passes every check. */
const BOX: Box = { id: "testGame", name: "Test game", pitch: "", howToPlay: [], remarks: ["Go on, then."], art: "", minPlayers: 2, maxPlayers: 6, keywords: [] };

describe("kit primitives", () => {
    it("replays a seeded source and deals one seated player", () => {
        const first: () => number = seededRandom(42);
        const second: () => number = seededRandom(42);
        assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
        const players: CartridgePlayer[] = [{ playerId: "a", name: "A" }, { playerId: "b", name: "B" }, { playerId: "c", name: "C" }];
        assert.ok(["a", "b", "c"].includes(dealOne(players, seededRandom(7))));
        assert.equal(dealOne(players, () => 0.99), "c");
    });

    it("warns at the chosen counts and runs out once", () => {
        let budget: Budget = { used: 0, max: 3, warnAt: [1] };
        const results: Spent[] = [];
        for (let index = 0; index < 3; index += 1) {
            const spent: Spent = spend(budget);
            results.push(spent);
            budget = spent.budget;
        }
        assert.deepEqual(results.map((spent: Spent) => [spent.left, spent.warn, spent.exhausted]), [[2, false, false], [1, true, false], [0, false, true]]);
    });

    it("counts a vote, ignores votes for non-candidates, and reports ties", () => {
        const counted: Tally = tally({ a: "b", b: "c", c: "b", d: "nobody" }, ["a", "b", "c", "d"]);
        assert.deepEqual(counted.leaders, ["b"]);
        assert.equal(counted.tied, false);
        assert.equal(counted.rows[0]?.votes, 2);
        const tied: Tally = tally({ a: "b", b: "a" }, ["a", "b", "c"]);
        assert.deepEqual(tied.leaders, ["a", "b"]);
        assert.equal(tied.tied, true);
        assert.deepEqual(tally({}, ["a"]).leaders, []);
    });

    it("makes a frozen copy that shares nothing", () => {
        const original: { list: string[] } = { list: ["x"] };
        const copy: { list: string[] } = frozenCopy(original);
        original.list.push("y");
        assert.deepEqual(copy.list, ["x"]);
        assert.throws(() => { copy.list.push("z"); });
    });
});

describe("shared checks", () => {
    it("rejects ruling names the room reserves, and anything but letters", () => {
        assert.notEqual(rulingNameProblem("quit"), null);
        assert.notEqual(rulingNameProblem("Start"), null);
        assert.notEqual(rulingNameProblem("mood"), null);
        assert.notEqual(rulingNameProblem("sort of"), null);
        assert.equal(rulingNameProblem("sortof"), null);
    });

    it("accepts only finite whole numbers in range", () => {
        assert.equal(isWholeIn(Number.NaN, 1, 10), false);
        assert.equal(isWholeIn(Number.POSITIVE_INFINITY, 1, 10), false);
        assert.equal(isWholeIn(2.5, 1, 10), false);
        assert.equal(isWholeIn(10, 1, 10), true);
    });

    it("accepts short plain text and nothing that could open a ruling", () => {
        assert.equal(isShortText("something in a kitchen"), true);
        assert.equal(isShortText("[[quit]]"), false);
        assert.equal(isShortText("x".repeat(41)), false);
        assert.equal(squash("P l-a.t Y"), "platy");
    });

    it("refuses a remark that gives away a secret, however it is spaced, and a long or shouting one", () => {
        assert.deepEqual(boxProblems(BOX, ["platypus"]), []);
        assert.equal(boxProblems({ ...BOX, remarks: ["It's a p-l-a-t-y-p-u-s."] }, ["platypus"]).length, 1);
        assert.match(boxProblems({ ...BOX, pitch: "Guess the platypus." }, ["platypus"]).join(" "), /pitch gives away/);
        assert.match(boxProblems({ ...BOX, howToPlay: ["It's a whisk."] }, ["whisk"]).join(" "), /how to play gives away/);
        assert.match(boxProblems({ ...BOX, keywords: ["yes", "ox"] }, ["ox"]).join(" "), /keyword gives away/);
        assert.match(boxProblems({ ...BOX, name: "Whisk Off" }, ["whisk"]).join(" "), /name gives away/);
        assert.equal(boxProblems({ ...BOX, remarks: ["One two three four five six seven eight nine."] }, []).length, 1);
        assert.equal(boxProblems({ ...BOX, remarks: ["Go!"] }, []).length, 1);
        assert.equal(boxProblems({ ...BOX, minPlayers: Number.NaN }, []).length, 1);
        assert.equal(boxProblems({ ...BOX, id: "two words" }, []).length, 1);
    });
});
