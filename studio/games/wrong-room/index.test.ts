// Proves Wrong Room passes the default check for any blueprint: rehearsed with every paper persona on
// five seeds, it always ends, reaches every phase, never lets the place reach the Stranger's phone or
// the TV, never lets who the Stranger is reach anyone else before the vote names them, and looks the
// same to everyone but the Stranger whoever the Stranger is.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blueprintProblems } from "../../blueprint.ts";
import { checkBlueprint } from "../../check.ts";
import { WRONG_ROOM_BLUEPRINT } from "./blueprint.ts";

describe("wrong room: the check every blueprint passes", () => {
    it("is a runnable blueprint", () => {
        assert.deepEqual(blueprintProblems(WRONG_ROOM_BLUEPRINT), []);
    });

    it("rehearses clean: every game ends, every phase is reached, nothing leaks", () => {
        const tally = checkBlueprint(WRONG_ROOM_BLUEPRINT);
        assert.deepEqual(tally.problems, []);
        assert.equal(tally.ended, tally.rehearsals);
        assert.deepEqual(tally.phasesNeverReached, []);
    });

    it("rehearses clean with four at the table, the fewest it allows", () => {
        const four = ["paper1", "paper2", "paper3", "paper4"].map((playerId: string, index: number) => ({ playerId, name: ["Teacup", "Spoon", "Candle", "Saucer"][index] ?? playerId }));
        const tally = checkBlueprint(WRONG_ROOM_BLUEPRINT, { players: four });
        assert.deepEqual(tally.problems.filter((problem: string) => problem.startsWith("role check") === false), []);
        assert.equal(tally.ended, tally.rehearsals);
    });
});
