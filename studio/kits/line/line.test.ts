// Tests for the line kit: where a card belongs, how picks are scored, what each viewer can see before
// the reveal, bad picks, and people leaving.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer, Step } from "../../../shared/cartridge.ts";
import { MIND_THE_GAP_BLUEPRINT } from "../../games/mind-the-gap/blueprint.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { createLineGame, inSentence, lineProblems, scorePicks, slotFor, slotLabel, SLOT_PREFIX, type LineDecisions, type LineState } from "./line.ts";

const PLAYERS: CartridgePlayer[] = [{ playerId: "a", name: "Ash" }, { playerId: "b", name: "Bay" }, { playerId: "c", name: "Cove" }];
const POINTS = { exact: 2, adjacent: 1 };
const cards = MIND_THE_GAP_BLUEPRINT.decisions.cards;

/**
 * A game on a seed and its first step.
 * @returns the game and the step.
 */
function started(): { game: ReturnType<typeof createLineGame>; step: Step<LineState> } {
    const game = createLineGame(MIND_THE_GAP_BLUEPRINT.box, MIND_THE_GAP_BLUEPRINT.decisions, seededRandom(5));
    return { game, step: game.cartridge.init(PLAYERS, {}) };
}

describe("placing a card", () => {
    it("finds the gap a year belongs in", () => {
        assert.equal(slotFor([1800, 1900, 2000], 1700), 0);
        assert.equal(slotFor([1800, 1900, 2000], 1850), 1);
        assert.equal(slotFor([1800, 1900, 2000], 1950), 2);
        assert.equal(slotFor([1800, 1900, 2000], 2010), 3);
        assert.equal(slotFor([], 1950), 0);
    });

    it("pays the right gap and a neighbour, and nobody else", () => {
        const result = scorePicks({ a: 2, b: 1, c: 3, d: 0 }, 2, POINTS);
        assert.deepEqual(result.exact, ["a"]);
        assert.deepEqual(result.adjacent, ["b", "c"]);
        assert.deepEqual(result.gains, { a: 2, b: 1, c: 1 });
    });

    it("pays nothing for a neighbour when the game says so", () => {
        assert.deepEqual(scorePicks({ a: 1 }, 2, { exact: 2, adjacent: 0 }).gains, {});
    });

    it("names a gap with the years either side", () => {
        const row: number[] = [cards.findIndex((card) => card.id === "telephone"), cards.findIndex((card) => card.id === "moon")];
        assert.equal(slotLabel(row, cards, 0), "Before the telephone (1876)");
        assert.equal(slotLabel(row, cards, 1), "Between the telephone (1876) and the first Moon landing (1969)");
        assert.equal(slotLabel(row, cards, 2), "After the first Moon landing (1969)");
        assert.equal(inSentence("Between Newton's Principia (1687) and X"), "between Newton's Principia (1687) and X");
    });
});

describe("a game", () => {
    it("deals the opening row in order with no two cards in one year, and hides the new card's year", () => {
        const { game, step } = started();
        const years: number[] = step.state.row.map((index: number) => cards[index]?.year ?? 0);
        assert.deepEqual(years, [...years].sort((first: number, second: number) => first - second));
        const dealt: number[] = step.state.order.map((index: number) => cards[index]?.year ?? 0);
        assert.equal(new Set(dealt).size, dealt.length);
        const card = cards[step.state.order[2] ?? 0]!;
        const seen: string = JSON.stringify([game.cartridge.publicScene(step.state), game.cartridge.hostFacts(step.state, { kind: "host" }), step.facts, game.cartridge.privateControls(step.state, "a")]);
        assert.equal(seen.includes(String(card.year)), false);
        assert.equal(seen.includes(card.source), false);
    });

    it("offers one more gap than there are cards in the row", () => {
        const { game, step } = started();
        const options = game.cartridge.legalActions(step.state, "a").filter((action) => action.actionId.startsWith(SLOT_PREFIX));
        assert.equal(options.length, step.state.row.length + 1);
    });

    it("takes one pick per player, for a real gap, from someone seated", () => {
        const { game, step } = started();
        const once: LineState = game.cartridge.apply(step.state, "a", `${SLOT_PREFIX}0`).state;
        assert.equal(game.cartridge.apply(once, "a", `${SLOT_PREFIX}1`).state.picks.a, 0);
        for (const bad of [`${SLOT_PREFIX}9`, `${SLOT_PREFIX}-1`, `${SLOT_PREFIX}1.5`, `${SLOT_PREFIX}`, "slot:abc", "nonsense"]) {
            assert.equal(game.cartridge.apply(step.state, "b", bad).state, step.state, bad);
        }
        assert.equal(game.cartridge.apply(step.state, "z", `${SLOT_PREFIX}0`).state, step.state);
    });

    it("shows a pick only to the person who made it, and everyone's after the reveal", () => {
        const { game, step } = started();
        const picked: LineState = game.cartridge.apply(step.state, "a", `${SLOT_PREFIX}1`).state;
        assert.match(JSON.stringify(game.cartridge.privateControls(picked, "a")), /You put it/);
        assert.doesNotMatch(JSON.stringify([game.cartridge.privateControls(picked, "b"), game.cartridge.publicScene(picked)]), /You put it/);
    });

    it("places the card in the row when it is revealed, and scores the table", () => {
        const { game, step } = started();
        let state: LineState = step.state;
        const card = cards[state.order[2] ?? 0]!;
        const right: number = slotFor(state.row.map((index: number) => cards[index]?.year ?? 0), card.year);
        state = game.cartridge.apply(state, "a", `${SLOT_PREFIX}${right}`).state;
        state = game.cartridge.apply(state, "b", `${SLOT_PREFIX}${right === 0 ? 1 : right - 1}`).state;
        state = game.cartridge.onEvent(state, { type: "timerFired", at: 99, timerId: "place" }).state;
        assert.equal(state.phase, "reveal");
        assert.equal(state.row.length, 3);
        assert.equal(state.row[right], state.order[2]);
        assert.equal(state.scores.a, 2);
        assert.equal(state.scores.b, 1);
        assert.equal(state.scores.c, 0);
    });

    it("plays every round and ends with standings", () => {
        const { game, step } = started();
        let state: LineState = step.state;
        for (let round = 0; round < MIND_THE_GAP_BLUEPRINT.decisions.rounds; round += 1) {
            for (const player of PLAYERS) {
                state = game.cartridge.apply(state, player.playerId, `${SLOT_PREFIX}0`).state;
            }
            assert.equal(state.phase, "reveal");
            state = game.cartridge.onEvent(state, { type: "timerFired", at: 99, timerId: "reveal" }).state;
        }
        assert.equal(state.phase, "end");
        assert.equal(state.row.length, 2 + MIND_THE_GAP_BLUEPRINT.decisions.rounds);
        assert.notEqual(game.cartridge.outcome(state), null);
    });

    it("reveals when the last player to pick leaves", () => {
        const { game, step } = started();
        let state: LineState = game.cartridge.apply(step.state, "a", `${SLOT_PREFIX}0`).state;
        state = game.cartridge.apply(state, "b", `${SLOT_PREFIX}0`).state;
        const after: LineState = game.cartridge.onEvent(state, { type: "playerLeft", at: 3, playerId: "c" }).state;
        assert.equal(after.phase, "reveal");
    });
});

describe("checking a creator's decisions", () => {
    const shipped: LineDecisions = MIND_THE_GAP_BLUEPRINT.decisions;

    it("accepts the shipped cards", () => {
        assert.deepEqual(lineProblems(shipped), []);
    });

    it("rejects a card whose name has a digit, or whose year is not whole", () => {
        const first = shipped.cards[0]!;
        assert.ok(lineProblems({ ...shipped, cards: [{ ...first, name: "Teaching in 1096 at Oxford" }, ...shipped.cards.slice(1)] }).length > 0);
        assert.ok(lineProblems({ ...shipped, cards: [{ ...first, year: 1096.5 }, ...shipped.cards.slice(1)] }).length > 0);
        assert.ok(lineProblems({ ...shipped, cards: [{ ...first, year: Number.NaN }, ...shipped.cards.slice(1)] }).length > 0);
    });

    it("rejects a bank with too few different years for the row", () => {
        const letter = (index: number): string => String.fromCharCode(97 + index);
        const sameYear = shipped.cards.map((card, index) => ({ ...card, id: `card${letter(index % 26)}${letter(Math.floor(index / 26))}`, year: 1900 + (index % 3) }));
        assert.ok(lineProblems({ ...shipped, cards: sameYear }).some((problem: string) => problem.includes("different years")));
    });
});
