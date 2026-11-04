// Proves Tin Can Telephone passes the default check for any blueprint: rehearsed with every paper
// persona on five seeds, it always ends, reaches every phase, and never lets the key reach a phone,
// the TV or the host that may not have it.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blueprintProblems } from "../../blueprint.ts";
import { checkBlueprint } from "../../check.ts";
import { clueBoardContent } from "../../kits/clueboard/personas.ts";
import { TIN_CAN_TELEPHONE_BLUEPRINT } from "./blueprint.ts";

describe("tin can telephone: the check every blueprint passes", () => {
    it("is a runnable blueprint", () => {
        assert.deepEqual(blueprintProblems(TIN_CAN_TELEPHONE_BLUEPRINT), []);
    });

    it("rehearses clean: every game ends, every phase is reached, nothing leaks", () => {
        const tally = checkBlueprint(TIN_CAN_TELEPHONE_BLUEPRINT);
        assert.deepEqual(tally.problems, []);
        assert.equal(tally.ended, tally.rehearsals);
        assert.deepEqual(tally.phasesNeverReached, []);
    });

    it("also rehearses clean with three at the table, where the host gives one side's clues", () => {
        const three = ["paper1", "paper2", "paper3"].map((playerId: string, index: number) => ({ playerId, name: ["Teacup", "Spoon", "Candle"][index] ?? playerId }));
        const tally = checkBlueprint(TIN_CAN_TELEPHONE_BLUEPRINT, { players: three, contentFor: clueBoardContent });
        assert.deepEqual(tally.problems, []);
        assert.equal(tally.ended, tally.rehearsals);
    });
});
