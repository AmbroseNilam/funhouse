// Tests for what the TV and phones say when Twenty Doors and Quizmaster end: who won and why, in plain words.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createQuizmaster, QUESTION_COUNT } from "./quizmaster/rules.ts";
import { createTwentyDoors } from "./twenty-doors/rules.ts";

/**
 * Collects the words on a scene.
 * @param scene the scene.
 * @returns its title and text lines.
 */
function wordsOn(scene: { blocks: { type: string; text?: string }[] }): string[] {
    return scene.blocks.flatMap((block) => (block.type === "title" || block.type === "text" ? [block.text ?? ""] : []));
}

describe("end screens", () => {
    const players = [{ playerId: "a", name: "Sam" }, { playerId: "b", name: "Alex" }];

    it("Twenty Doors says what happened when they give up", () => {
        const game = createTwentyDoors(() => 0, "a food");
        const started = game.init(players, {});
        const over = game.apply(started.state, "a", "giveup");
        const words: string[] = wordsOn(game.publicScene(over.state));
        assert.equal(words.includes("You opened 0 doors, then called it."), true, words.join(" | "));
        assert.match(JSON.stringify(game.privateControls(over.state, "b")), /It was .*called it/);
    });

    it("Quizmaster names the winner and explains the points", () => {
        const game = createQuizmaster("Movies", () => 0);
        const started = game.init(players, {});
        const items = Array.from({ length: QUESTION_COUNT }, (_unused: unknown, index: number) => ({ question: `Q${index} what?`, answer: `A${index}` }));
        let state = game.onEvent(started.state, { type: "contentReady", at: 0, text: JSON.stringify(items) }).state;
        state = game.onEvent(state, { type: "speechEnded", at: 0, playerId: "a", text: "A0" }).state;
        state = game.onEvent(state, { type: "hostRuled", at: 0, ruling: "right", detail: "", playerId: "a" }).state;
        state = game.onEvent(state, { type: "hostRuled", at: 0, ruling: "wrong", detail: "", playerId: "b" }).state;
        for (let index = 0; index < QUESTION_COUNT * 2 && game.phaseOf(state) !== "end"; index += 1) {
            state = game.onEvent(state, { type: "timerFired", at: 0, timerId: `question-${state.index}` }).state;
        }
        assert.equal(game.phaseOf(state), "end");
        const words: string[] = wordsOn(game.publicScene(state));
        assert.equal(words.includes("Sam wins"), true, words.join(" | "));
        assert.equal(words.some((line: string) => line.startsWith(`2 out of ${QUESTION_COUNT * 2}.`) && line.includes("close")), true, words.join(" | "));
    });
});
