// Proves the structural rehearsal does its job: twenty rehearsals of the Twenty Doors
// blueprint end, reach every phase and leak nothing, a secret planted on the screen is caught,
// an unexplained fact is caught, and a blueprint that can never end is reported as such.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Blueprint } from "./blueprint.ts";
import { TWENTY_DOORS_BLUEPRINT } from "./games/twenty-doors.ts";
import { createBlueprintGame, type BlueprintGame } from "./interpreter.ts";
import { findLeaks, findUnexplained, guessingPersonas, rehearse, rehearseMany, seededRandom, type Rehearsal, type Tally, type TraceEntry } from "./rehearse.ts";

/** Seeds for a set of rehearsals. */
const SEEDS: number[] = [1, 2, 3, 4, 5];

describe("rehearsing twenty doors", () => {
    it("ends every rehearsal, reaches every phase, and finds no problems", () => {
        const startedAt: number = Date.now();
        const tally: Tally = rehearseMany((seed: number) => createBlueprintGame(TWENTY_DOORS_BLUEPRINT, seededRandom(seed)), guessingPersonas(), SEEDS);
        assert.equal(tally.rehearsals, 20);
        assert.equal(tally.ended, 20);
        assert.equal(tally.won, 5, "only the finder wins");
        assert.deepEqual(tally.phasesNeverReached, []);
        assert.deepEqual(tally.problems, []);
        assert.ok(Date.now() - startedAt < 1000, "twenty rehearsals run in under a second");
    });

    it("keeps a trace that says what caused each moment", () => {
        const game: BlueprintGame = createBlueprintGame(TWENTY_DOORS_BLUEPRINT, seededRandom(7));
        const finder = guessingPersonas()[0];
        assert.ok(finder !== undefined);
        const rehearsal: Rehearsal = rehearse(game, finder, 7);
        assert.equal(rehearsal.ended, true);
        assert.equal(rehearsal.won, true);
        const last: TraceEntry | undefined = rehearsal.trace.at(-1);
        assert.ok(last !== undefined);
        assert.equal(last.event.type, "hostRuled");
        assert.equal(last.step.facts[1]?.text, "judge.rulings.correct");
    });

    it("reports a game that never ends", () => {
        const free: { when: string; effect: { kind: "free" } } = { when: "costs nothing.", effect: { kind: "free" } };
        const endless: Blueprint = { ...TWENTY_DOORS_BLUEPRINT, judge: { rulings: { ...TWENTY_DOORS_BLUEPRINT.judge.rulings, no: free, wrong: free } } };
        const game: BlueprintGame = createBlueprintGame(endless, seededRandom(1));
        const stubborn = guessingPersonas()[2];
        assert.ok(stubborn !== undefined);
        const rehearsal: Rehearsal = rehearse(game, stubborn, 1);
        assert.equal(rehearsal.ended, false);
        assert.match(rehearsal.problems.join(" "), /never ended/);
    });

    it("catches a secret on the screen or in a public fact, and a fact with no decision", () => {
        const leaks: string[] = findLeaks(["Platypus"], [{ scope: { kind: "public" }, kind: "slip", text: "It's a platypus, obviously." }], { mood: "neutral", transition: "cut", blocks: [{ type: "title", text: "Platypus" }] });
        assert.equal(leaks.length, 2);
        assert.deepEqual(findLeaks(["Platypus"], [{ scope: { kind: "host" }, kind: "secret", text: "The secret is: Platypus." }], { mood: "neutral", transition: "cut", blocks: [] }), []);
        assert.deepEqual(findUnexplained([{ scope: { kind: "public" }, kind: "ready", text: "Go." }]), ['The fact "ready" names no decision.']);
    });
});
