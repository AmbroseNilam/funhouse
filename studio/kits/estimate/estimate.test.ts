// Tests for the estimate kit: how a round is scored (closest, ties, backing, boldness), what the
// host and the other phones can see before the reveal, and what happens when people leave or don't answer.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer, Step } from "../../../shared/cartridge.ts";
import type { Control } from "../../../shared/controls.ts";
import { OFF_BY_A_MILE_BLUEPRINT } from "../../games/off-by-a-mile/blueprint.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { BET_PREFIX, createEstimateGame, estimateProblems, formatNumber, guessControlId, scoreRound, type EstimateDecisions, type EstimateState } from "./estimate.ts";

const PLAYERS: CartridgePlayer[] = [{ playerId: "a", name: "Ash" }, { playerId: "b", name: "Bay" }, { playerId: "c", name: "Cove" }, { playerId: "d", name: "Dale" }];
const POINTS = { closest: 3, backer: 2, bold: 1 };

/**
 * A game with the shipped questions, on a seed.
 * @returns the game and its first step.
 */
function started(): { game: ReturnType<typeof createEstimateGame>; step: Step<EstimateState> } {
    const game = createEstimateGame(OFF_BY_A_MILE_BLUEPRINT.box, OFF_BY_A_MILE_BLUEPRINT.decisions, seededRandom(3));
    return { game, step: game.cartridge.init(PLAYERS, {}) };
}

describe("scoring a round", () => {
    it("gives the closest guess its points and each backer theirs", () => {
        const result = scoreRound({ a: 90, b: 120, c: 300 }, { a: "a", b: "a", c: "c" }, 100, POINTS);
        assert.deepEqual(result.closest, ["a"]);
        assert.deepEqual(result.backers, ["a", "b"]);
        assert.deepEqual(result.bold, []);
        assert.deepEqual(result.gains, { a: 5, b: 2 });
    });

    it("shares the closest between tied guesses", () => {
        const result = scoreRound({ a: 90, b: 110, c: 300 }, { a: "a", b: "b", c: "c" }, 100, POINTS);
        assert.deepEqual(result.closest, ["a", "b"]);
        assert.equal(result.gains.a, 3 + 2);
        assert.equal(result.gains.b, 3 + 2);
        assert.equal(result.gains.c, undefined);
    });

    it("pays a bonus only to those who backed a closest guess few others backed", () => {
        const result = scoreRound({ a: 99, b: 150, c: 200, d: 300 }, { a: "b", b: "b", c: "b", d: "a" }, 100, POINTS);
        assert.deepEqual(result.bold, ["d"]);
        assert.equal(result.gains.d, 3);
        assert.equal(result.gains.a, 3);
    });

    it("scores nothing when fewer than two people guessed", () => {
        const result = scoreRound({ a: 99 }, { b: "a" }, 100, POINTS);
        assert.deepEqual(result.closest, []);
        assert.deepEqual(result.gains, {});
    });

    it("ignores a bet for someone who didn't guess", () => {
        const result = scoreRound({ a: 99, b: 150 }, { c: "z" }, 100, POINTS);
        assert.deepEqual(result.backers, []);
    });
});

describe("a game", () => {
    it("never shows the answer or a guess to anyone before it is meant to be seen", () => {
        const { game, step } = started();
        const state: EstimateState = step.state;
        const question = OFF_BY_A_MILE_BLUEPRINT.decisions.questions[state.order[0] ?? 0]!;
        const host: string = JSON.stringify(game.cartridge.hostFacts(state, { kind: "host" }));
        assert.equal(host.includes(formatNumber(question.answer)), false);
        assert.equal(host.includes(question.source), false);
        assert.equal(host.includes(question.aside), false);
        assert.equal(JSON.stringify(game.cartridge.publicScene(state)).includes(question.aside), false);
    });

    it("keeps each guess private until the betting opens, then shows them lowest first", () => {
        const { game, step } = started();
        let state: EstimateState = step.state;
        const id: string = guessControlId(0);
        state = game.cartridge.onEvent(state, { type: "answered", at: 1, playerId: "a", controlId: id, value: 55 }).state;
        const other: Control[] = game.cartridge.privateControls(state, "b");
        assert.equal(JSON.stringify([other, game.cartridge.publicScene(state), game.cartridge.hostFacts(state, { kind: "host" })]).includes("55"), false);
        state = game.cartridge.onEvent(state, { type: "answered", at: 1, playerId: "b", controlId: id, value: 22 }).state;
        state = game.cartridge.onEvent(state, { type: "answered", at: 1, playerId: "c", controlId: id, value: 44 }).state;
        const last: Step<EstimateState> = game.cartridge.onEvent(state, { type: "answered", at: 1, playerId: "d", controlId: id, value: 33 });
        assert.equal(last.state.phase, "bet");
        const labels: string[] = game.cartridge.legalActions(last.state, "a").map((action) => action.label);
        assert.deepEqual(labels.slice(0, 4), ["Bay", "Dale", "Cove", "Ash"]);
        assert.equal(JSON.stringify(game.cartridge.publicScene(last.state)).includes("\"count\":55"), true);
    });

    it("takes one guess per player, in range, for the current round, from someone seated", () => {
        const { game, step } = started();
        const id: string = guessControlId(0);
        const question = OFF_BY_A_MILE_BLUEPRINT.decisions.questions[step.state.order[0] ?? 0]!;
        let state: EstimateState = game.cartridge.onEvent(step.state, { type: "answered", at: 1, playerId: "a", controlId: id, value: question.min }).state;
        state = game.cartridge.onEvent(state, { type: "answered", at: 1, playerId: "a", controlId: id, value: question.max }).state;
        assert.equal(state.guesses.a, question.min);
        for (const bad of [question.max + 1, question.min - 1, Number.NaN, Number.POSITIVE_INFINITY, "12" as unknown as number]) {
            assert.equal(game.cartridge.onEvent(state, { type: "answered", at: 1, playerId: "b", controlId: id, value: bad }).state.guesses.b, undefined);
        }
        assert.equal(game.cartridge.onEvent(state, { type: "answered", at: 1, playerId: "b", controlId: guessControlId(1), value: question.min }).state.guesses.b, undefined);
        assert.equal(game.cartridge.onEvent(state, { type: "answered", at: 1, playerId: "z", controlId: id, value: question.min }).state.guesses.z, undefined);
    });

    it("takes a bet only on someone who guessed, once, and not before the betting", () => {
        const { game, step } = started();
        assert.equal(game.cartridge.apply(step.state, "a", `${BET_PREFIX}b`).state, step.state);
        let state: EstimateState = step.state;
        for (const [playerId, value] of [["a", 10], ["b", 20], ["c", 30]] as [string, number][]) {
            state = game.cartridge.onEvent(state, { type: "answered", at: 1, playerId, controlId: guessControlId(0), value }).state;
        }
        state = game.cartridge.onEvent(state, { type: "timerFired", at: 50, timerId: "guess" }).state;
        assert.equal(state.phase, "bet");
        assert.equal(game.cartridge.apply(state, "a", `${BET_PREFIX}d`).state.bets.a, undefined);
        const once: EstimateState = game.cartridge.apply(state, "a", `${BET_PREFIX}b`).state;
        assert.equal(game.cartridge.apply(once, "a", `${BET_PREFIX}c`).state.bets.a, "b");
    });

    it("voids a round that fewer than two people guessed in", () => {
        const { game, step } = started();
        const one: EstimateState = game.cartridge.onEvent(step.state, { type: "answered", at: 1, playerId: "a", controlId: guessControlId(0), value: 10 }).state;
        const timed: Step<EstimateState> = game.cartridge.onEvent(one, { type: "timerFired", at: 50, timerId: "guess" });
        assert.equal(timed.state.phase, "reveal");
        assert.deepEqual(timed.state.last?.gains, {});
    });

    it("keeps going when someone leaves, dropping bets on them", () => {
        const { game, step } = started();
        let state: EstimateState = step.state;
        for (const [playerId, value] of [["a", 10], ["b", 20], ["c", 30], ["d", 40]] as [string, number][]) {
            state = game.cartridge.onEvent(state, { type: "answered", at: 1, playerId, controlId: guessControlId(0), value }).state;
        }
        state = game.cartridge.apply(state, "a", `${BET_PREFIX}b`).state;
        const after: EstimateState = game.cartridge.onEvent(state, { type: "playerLeft", at: 2, playerId: "b" }).state;
        assert.equal(after.phase, "bet");
        assert.equal(after.bets.a, undefined);
        assert.equal(after.guesses.b, undefined);
    });

    it("plays all rounds and ends with standings and an outcome", () => {
        const { game, step } = started();
        let state: EstimateState = step.state;
        for (let round = 0; round < OFF_BY_A_MILE_BLUEPRINT.decisions.rounds; round += 1) {
            for (const [index, player] of PLAYERS.entries()) {
                state = game.cartridge.onEvent(state, { type: "answered", at: 1, playerId: player.playerId, controlId: guessControlId(round), value: 10 + index }).state;
            }
            for (const player of PLAYERS) {
                state = game.cartridge.apply(state, player.playerId, `${BET_PREFIX}a`).state;
            }
            assert.equal(state.phase, "reveal");
            state = game.cartridge.onEvent(state, { type: "timerFired", at: 99, timerId: "reveal" }).state;
        }
        assert.equal(state.phase, "end");
        assert.notEqual(game.cartridge.outcome(state), null);
    });
});

describe("checking a creator's decisions", () => {
    const shipped: EstimateDecisions = OFF_BY_A_MILE_BLUEPRINT.decisions;

    it("accepts the shipped questions", () => {
        assert.deepEqual(estimateProblems(shipped), []);
    });

    it("rejects a question whose answer is outside its range, or off its steps", () => {
        const first = shipped.questions[0]!;
        assert.ok(estimateProblems({ ...shipped, questions: [{ ...first, answer: first.max + 1 }, ...shipped.questions.slice(1)] }).length > 0);
        assert.ok(estimateProblems({ ...shipped, questions: [{ ...first, step: 7 }, ...shipped.questions.slice(1)] }).length > 0);
        assert.ok(estimateProblems({ ...shipped, questions: [{ ...first, step: Number.NaN }, ...shipped.questions.slice(1)] }).length > 0);
    });

    it("rejects a question with no source, or too few questions for the rounds", () => {
        const first = shipped.questions[0]!;
        assert.ok(estimateProblems({ ...shipped, questions: [{ ...first, source: "" }, ...shipped.questions.slice(1)] }).some((problem: string) => problem.includes("source")));
        assert.ok(estimateProblems({ ...shipped, questions: shipped.questions.slice(0, 3) }).length > 0);
    });
});
