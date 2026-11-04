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
        state = game.onEvent(state, { type: "speechStarted", at: 0, playerId: "a" }).state;
        state = game.onEvent(state, { type: "speechEnded", at: 0, playerId: "a", text: "A0" }).state;
        state = game.onEvent(state, { type: "hostRuled", at: 0, ruling: "right", detail: "", playerId: "a" }).state;
        state = game.onEvent(state, { type: "hostRuled", at: 0, ruling: "wrong", detail: "", playerId: "b" }).state;
        for (let index = 0; index < QUESTION_COUNT * 2 && game.phaseOf(state) !== "end"; index += 1) {
            state = game.onEvent(state, { type: "timerFired", at: 0, timerId: `question-${state.index}` }).state;
        }
        assert.equal(game.phaseOf(state), "end");
        const words: string[] = wordsOn(game.publicScene(state));
        assert.equal(words.includes("Sam wins"), true, words.join(" | "));
        assert.equal(words.some((line: string) => line.startsWith(`2 out of ${QUESTION_COUNT * 2}.`) && line.includes("points")), true, words.join(" | "));
    });
});

describe("Twenty Doors' own topic", () => {
    const players = [{ playerId: "a", name: "Sam" }];
    type Doors = ReturnType<typeof createTwentyDoors>;
    const toChoosing = (): { game: Doors; started: ReturnType<Doors["init"]>; choosing: ReturnType<Doors["onEvent"]> } => {
        const game = createTwentyDoors(() => 0, "own");
        const started = game.init(players, {});
        const choosing = game.onEvent(started.state, { type: "hostRuled", at: 0, ruling: "topic", detail: "Canadian lakes", playerId: "a" });
        return { game, started, choosing };
    };

    it("asks the model on the topic and never shows the secret before the reveal", () => {
        const { game, choosing } = toChoosing();
        assert.equal(game.phaseOf(choosing.state), "choosing");
        assert.match(choosing.contentRequest ?? "", /Canadian lakes/);
        const asking = game.onEvent(choosing.state, { type: "contentReady", at: 0, text: '{"secret": "Lake Louise"}' });
        assert.equal(game.phaseOf(asking.state), "asking");
        assert.equal(asking.state.secret, "Lake Louise");
        assert.equal(JSON.stringify(game.publicScene(asking.state)).includes("Louise"), false);
        assert.equal(JSON.stringify(game.privateControls(asking.state, "a")).includes("Louise"), false);
        assert.match(asking.draws?.[0]?.prompt ?? "", /Lake Louise/);
    });

    for (const [name, text] of [["a refusal", '{"refused": true}'], ["nonsense", "no idea"], ["nothing", ""], ["the topic back", '{"secret": "canadian lakes"}'], ["host markup", '{"secret": "[[quit]]"}']] as const) {
        it(`falls back on the list after ${name}, with a joke`, () => {
            const { game, choosing } = toChoosing();
            const next = game.onEvent(choosing.state, { type: "contentReady", at: 0, text });
            assert.equal(game.phaseOf(next.state), "asking");
            assert.match(JSON.stringify(next.facts), /joke/);
            assert.notEqual(next.state.secret, "");
        });
    }

    it("doesn't wait long after someone says a topic the host won't rule", () => {
        const game = createTwentyDoors(() => 0, "own");
        const started = game.init(players, {});
        const spoken = game.onEvent(started.state, { type: "speechEnded", at: 0, playerId: "a", text: "something rude" });
        assert.notEqual(spoken.timers?.["topic-heard"], undefined);
        assert.equal(game.phaseOf(game.onEvent(spoken.state, { type: "timerFired", at: 0, timerId: "topic-heard" }).state), "asking");
    });

    it("never stalls: no topic named, or the model too slow, falls back too", () => {
        const { game, started, choosing } = toChoosing();
        assert.equal(game.phaseOf(game.onEvent(started.state, { type: "timerFired", at: 0, timerId: "topic-time" }).state), "asking");
        const slow = game.onEvent(choosing.state, { type: "timerFired", at: 0, timerId: "choosing-time" });
        assert.equal(game.phaseOf(slow.state), "asking");
        const late = game.onEvent(slow.state, { type: "contentReady", at: 0, text: '{"secret": "Too late"}' });
        assert.notEqual(late.state.secret, "Too late");
    });
});

describe("Quizmaster's four answers", () => {
    const players = [{ playerId: "a", name: "Sam" }, { playerId: "b", name: "Alex" }];
    const items = Array.from({ length: QUESTION_COUNT }, (_unused: unknown, index: number) => ({ question: `Q${index} what?`, answer: `Right${index}`, wrong: [`Bad${index}a`, `Bad${index}b`, `Bad${index}c`] }));
    type Quiz = ReturnType<typeof createQuizmaster>;
    const inQuestion = (): { game: Quiz; state: ReturnType<Quiz["onEvent"]>["state"] } => {
        const game = createQuizmaster("Movies", () => 0.4);
        const started = game.init(players, {});
        return { game, state: game.onEvent(started.state, { type: "contentReady", at: 0, text: JSON.stringify(items) }).state };
    };

    it("shows the same four on TV and phones, with nothing saying which is right", () => {
        const { game, state } = inQuestion();
        const phone = JSON.stringify(game.privateControls(state, "a"));
        const scene = JSON.stringify(game.publicScene(state));
        for (const option of ["Right0", "Bad0a", "Bad0b", "Bad0c"]) {
            assert.equal(phone.includes(option), true);
            assert.equal(scene.includes(option), true);
        }
        assert.equal(/answer:\d/.test(phone), true);
        assert.equal(/right|correct/i.test(phone.replace(/Right0/g, "")), false);
    });

    it("locks a tap, scores it, and waits for everyone before moving on", () => {
        const { game, state } = inQuestion();
        const right: number = state.questions[0]?.choices?.indexOf("Right0") ?? -1;
        const first = game.apply(state, "a", `answer:0:${right}`);
        assert.equal(first.state.scores.a, undefined, "the score waits for the reveal, so it can't give the answer away");
        assert.equal(JSON.stringify(game.publicScene(first.state)).includes("Sam 2"), false);
        assert.equal(first.state.index, 0, "still waiting for Alex");
        const again = game.apply(first.state, "a", "answer:0:0");
        assert.deepEqual(again.state.scores, first.state.scores, "one try");
        const wrong: number = state.questions[0]?.choices?.indexOf("Bad0a") ?? -1;
        const second = game.apply(first.state, "b", `answer:0:${wrong}`);
        assert.equal(second.state.index, 1);
        assert.equal(second.state.scores.a, 2);
        const stale = game.apply(second.state, "a", `answer:0:${right}`);
        assert.deepEqual(stale.state.answered, [], "a late tap from the last question doesn't count on this one");
        assert.match(JSON.stringify(second.facts), /Sam got it right/);
    });

    it("ignores a tap off the list, and shuffles the right answer's place", () => {
        const { game, state } = inQuestion();
        assert.equal(game.apply(state, "a", "answer:0:9").state, state);
        const spots: Set<number> = new Set();
        for (let attempt = 0; attempt < 40; attempt += 1) {
            const mixed = createQuizmaster("Movies");
            const after = mixed.onEvent(mixed.init(players, {}).state, { type: "contentReady", at: 0, text: JSON.stringify(items) }).state;
            spots.add(after.questions[0]?.choices?.indexOf("Right0") ?? -1);
        }
        assert.equal(spots.size, 4);
    });

    it("doesn't take speech begun on the last question as an answer to this one", () => {
        const { game, state } = inQuestion();
        const heardLate = game.onEvent(state, { type: "speechEnded", at: 0, playerId: "a", text: "Paris" });
        assert.deepEqual(heardLate.state.heard, []);
        const started = game.onEvent(state, { type: "speechStarted", at: 0, playerId: "a" });
        const heard = game.onEvent(started.state, { type: "speechEnded", at: 0, playerId: "a", text: "Paris" });
        assert.deepEqual(heard.state.heard, ["a"]);
    });

    it("goes back to answers out loud with the switch off", () => {
        const game = createQuizmaster("Movies", Math.random, false);
        const started = game.init(players, {});
        const state = game.onEvent(started.state, { type: "contentReady", at: 0, text: JSON.stringify(items) }).state;
        assert.equal(state.questions[0]?.choices, undefined);
        assert.equal(JSON.stringify(game.privateControls(state, "a")).includes("Right0"), false);
    });
});
