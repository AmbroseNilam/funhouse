// Tests for what the TV and phones say when Twenty Doors and Quizmaster end: who won and why, in plain words.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createQuizmaster, QUESTION_COUNT, REVEAL_BUILD_SECONDS } from "./quizmaster/rules.ts";
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
        let state = game.onEvent(game.apply(started.state, "a", "setup-start").state, { type: "contentReady", at: 0, text: JSON.stringify(items) }).state;
        state = game.onEvent(state, { type: "speechStarted", at: 0, playerId: "a" }).state;
        state = game.onEvent(state, { type: "speechEnded", at: 0, playerId: "a", text: "A0" }).state;
        state = game.onEvent(state, { type: "hostRuled", at: 0, ruling: "right", detail: "", playerId: "a" }).state;
        state = game.onEvent(state, { type: "hostRuled", at: 0, ruling: "wrong", detail: "", playerId: "b" }).state;
        for (let index = 0; index < QUESTION_COUNT * 4 && game.phaseOf(state) !== "end"; index += 1) {
            const timerId: string = state.phase === "lockedIn" ? "reveal-build" : state.phase === "reveal" ? "reveal-next" : `question-${state.index}`;
            state = game.onEvent(state, { type: "timerFired", at: 0, timerId }).state;
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

    it("never runs out the clock on someone naming a topic, however long it takes", () => {
        const game = createTwentyDoors(() => 0, "own");
        const started = game.init(players, {});
        assert.deepEqual(started.timers ?? {}, {}, "no countdown");
        const said = game.onEvent(started.state, { type: "speechEnded", at: 0, playerId: "a", text: "programming languages" });
        assert.deepEqual(said.timers ?? {}, {}, "nor one after someone speaks");
        const ruled = game.onEvent(said.state, { type: "hostRuled", at: 0, ruling: "topic", detail: "programming languages", playerId: "a" });
        assert.equal(game.phaseOf(ruled.state), "choosing");
        assert.match(ruled.contentRequest ?? "", /programming languages/);
    });

    it("lets them change their mind with a plain button", () => {
        const game = createTwentyDoors(() => 0, "own");
        const started = game.init(players, {});
        const buttons: string = JSON.stringify(game.privateControls(started.state, "a"));
        assert.match(buttons, /Surprise me instead/);
        const surprised = game.apply(started.state, "a", "surprise");
        assert.equal(game.phaseOf(surprised.state), "asking");
        assert.notEqual(surprised.state.secret, "");
    });

    it("doesn't stall if the model is slow, and ignores it if it answers late", () => {
        const { game, choosing } = toChoosing();
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
        return { game, state: game.onEvent(game.apply(started.state, "a", "setup-start").state, { type: "contentReady", at: 0, text: JSON.stringify(items) }).state };
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
        assert.equal(game.phaseOf(second.state), "lockedIn");
        assert.equal(second.state.scores.a, undefined, "the drumroll gives nothing away");
        assert.deepEqual(second.facts, [], "and the host stays quiet through it");
        assert.equal(JSON.stringify(game.publicScene(second.state)).includes('"right"'), false);
        assert.equal(second.timers?.["reveal-build"], REVEAL_BUILD_SECONDS);
        const lit = game.onEvent(second.state, { type: "timerFired", at: 0, timerId: "reveal-build" });
        assert.equal(game.phaseOf(lit.state), "reveal");
        assert.equal(lit.state.scores.a, 2);
        assert.deepEqual(lit.facts, [], "the screen goes first");
        assert.match(JSON.stringify(game.publicScene(lit.state)), new RegExp(`"right":${right}`));
        assert.match(JSON.stringify(game.privateControls(lit.state, "a")), /You got it! \+2/);
        assert.match(JSON.stringify(game.privateControls(lit.state, "b")), /Not this time/);
        const stale = game.apply(lit.state, "a", `answer:0:${right}`);
        assert.equal(stale.state, lit.state, "a tap during the reveal does nothing");
        const reaction = game.onEvent(lit.state, { type: "timerFired", at: 0, timerId: "reveal-react" });
        assert.match(JSON.stringify(reaction.facts), /Sam got it/);
        assert.match(JSON.stringify(reaction.facts), /Right0/);
        const moved = game.onEvent(reaction.state, { type: "timerFired", at: 0, timerId: "reveal-next" });
        assert.equal(moved.state.index, 1);
        assert.equal(game.phaseOf(moved.state), "question");
        assert.equal(JSON.stringify(moved.facts).includes("Right0"), false, "the answer isn't told twice");
        assert.deepEqual(moved.state.answered, []);
    });

    it("ignores a tap off the list, and shuffles the right answer's place", () => {
        const { game, state } = inQuestion();
        assert.equal(game.apply(state, "a", "answer:0:9").state, state);
        const spots: Set<number> = new Set();
        for (let attempt = 0; attempt < 40; attempt += 1) {
            const mixed = createQuizmaster("Movies");
            const after = mixed.onEvent(mixed.apply(mixed.init(players, {}).state, "a", "setup-start").state, { type: "contentReady", at: 0, text: JSON.stringify(items) }).state;
            spots.add(after.questions[0]?.choices?.indexOf("Right0") ?? -1);
        }
        assert.equal(spots.size, 4);
    });

    it("doesn't take speech begun on the last question as an answer to this one", () => {
        const { game, state } = inQuestion();
        const talking = game.onEvent(state, { type: "speechStarted", at: 0, playerId: "a" }).state;
        const right: number = state.questions[0]?.choices?.indexOf("Right0") ?? -1;
        const tapped = game.apply(talking, "a", `answer:0:${right}`).state;
        const locked = game.apply(tapped, "b", `answer:0:${right}`).state;
        const lit = game.onEvent(locked, { type: "timerFired", at: 0, timerId: "reveal-build" }).state;
        const moved = game.onEvent(lit, { type: "timerFired", at: 0, timerId: "reveal-next" }).state;
        assert.equal(moved.index, 1);
        const heardLate = game.onEvent(moved, { type: "speechEnded", at: 0, playerId: "a", text: "Paris" });
        assert.deepEqual(heardLate.state.heard, []);
        const heardNext = game.onEvent(heardLate.state, { type: "speechEnded", at: 0, playerId: "a", text: "Right1" });
        assert.deepEqual(heardNext.state.heard, ["a"], "the next thing they say counts");
    });

    it("asks the setup questions, and they change the game", () => {
        const game = createQuizmaster("Movies", () => 0.4);
        const thinking = game.init(players, {});
        assert.equal(game.phaseOf(thinking.state), "thinking");
        assert.match(thinking.followUpRequest?.prompt ?? "", /Movies/);
        const asked = game.onEvent(thinking.state, { type: "followUpReady", at: 0, id: "x", text: '{"question": "Old films or new?", "options": ["Old", "New"]}' }).state;
        assert.match(JSON.stringify(game.privateControls(asked, "a")), /Old films or new\?/);
        assert.match(JSON.stringify(game.privateControls(asked, "a")), /Just start/);
        let state = asked;
        for (const tap of ["setup:follow-up:1", "setup:level:hard", "setup:count:10", "setup:time:quick"]) {
            state = game.apply(state, "b", tap).state;
        }
        assert.equal(game.phaseOf(state), "preparing");
        assert.equal(state.count, 10);
        const writing = game.apply(game.apply(game.apply(game.apply(asked, "b", "setup:follow-up:1").state, "b", "setup:level:hard").state, "b", "setup:count:10").state, "b", "setup:time:quick");
        assert.match(writing.contentRequest ?? "", /Write 12 trivia questions about the topic "Movies: New"/);
        assert.match(writing.contentRequest ?? "", /Make most of them hard/);
        const items = Array.from({ length: 12 }, (_unused: unknown, index: number) => ({ question: `Q${index} what?`, answer: `Right${index}`, wrong: [`Bad${index}a`, `Bad${index}b`, `Bad${index}c`] }));
        const begun = game.onEvent(state, { type: "contentReady", at: 0, text: JSON.stringify(items) });
        assert.equal(begun.state.questions.length, 10);
        assert.equal(begun.timers?.["question-0"], 15);
    });

    it("skips a poor or late follow-up, and Just start skips everything", () => {
        const game = createQuizmaster("Movies", () => 0.4);
        const thinking = game.init(players, {}).state;
        for (const bad of ["", "not json", '{"question": "No question mark", "options": ["A", "B"]}', '{"question": "One?", "options": ["A"]}', '{"question": "Long?", "options": ["A", "This answer is far too long for a button"]}', '{"question": "<b>Odd</b>?", "options": ["A", "B"]}']) {
            const after = game.onEvent(thinking, { type: "followUpReady", at: 0, id: "x", text: bad }).state;
            assert.equal(after.setup?.questions[0]?.id, "level", bad);
        }
        const timedOut = game.onEvent(thinking, { type: "timerFired", at: 0, timerId: "setup-wait" }).state;
        assert.equal(timedOut.setup?.questions[0]?.id, "level");
        assert.equal(game.onEvent(timedOut, { type: "followUpReady", at: 0, id: "x", text: '{"question": "Late?", "options": ["A", "B"]}' }).state, timedOut);
        const started = game.apply(thinking, "a", "setup-start");
        assert.equal(game.phaseOf(started.state), "preparing");
        assert.equal(started.state.count, QUESTION_COUNT);
        assert.equal(started.state.questionSeconds, 30);
    });

    it("shows the clock, nudges near the end, and says when time ran out", () => {
        const { game, state } = inQuestion();
        assert.match(JSON.stringify(game.publicScene(state)), /"drain"/);
        assert.match(JSON.stringify(game.privateControls(state, "a")), /"drain"/);
        const nudge = game.onEvent(state, { type: "timerFired", at: 0, timerId: "hurry-0" });
        assert.match(JSON.stringify(nudge.facts), /seconds left/);
        const talking = game.onEvent(state, { type: "speechStarted", at: 0, playerId: "a" }).state;
        assert.deepEqual(game.onEvent(talking, { type: "timerFired", at: 0, timerId: "hurry-0" }).facts, [], "it doesn't talk over anyone");
        const right: number = state.questions[0]?.choices?.indexOf("Right0") ?? -1;
        const tapped = game.apply(state, "a", `answer:0:${right}`).state;
        const late = game.onEvent(tapped, { type: "timerFired", at: 0, timerId: "question-0" }).state;
        const lit = game.onEvent(late, { type: "timerFired", at: 0, timerId: "reveal-build" }).state;
        assert.match(JSON.stringify(game.publicScene(lit)), /Sam got it! Alex ran out of time\./);
        assert.match(JSON.stringify(game.privateControls(lit, "b")), /Time ran out\./);
        const nobody = game.onEvent(game.onEvent(state, { type: "timerFired", at: 0, timerId: "question-0" }).state, { type: "timerFired", at: 0, timerId: "reveal-build" }).state;
        assert.match(JSON.stringify(game.publicScene(nobody)), /Time ran out\./);
    });

    it("with No timer, waits for everyone and offers Reveal now", () => {
        const game = createQuizmaster("Movies", () => 0.4);
        const setup = game.onEvent(game.init(players, {}).state, { type: "timerFired", at: 0, timerId: "setup-wait" }).state;
        const writing = game.apply(setup, "a", "setup:time:none");
        assert.equal(writing.state, setup, "only the current question counts");
        let state = setup;
        for (const tap of ["setup:level:easy", "setup:count:5", "setup:time:none"]) {
            state = game.apply(state, "a", tap).state;
        }
        const items = Array.from({ length: 7 }, (_unused: unknown, index: number) => ({ question: `Q${index} what?`, answer: `Right${index}`, wrong: [`Bad${index}a`, `Bad${index}b`, `Bad${index}c`] }));
        const begun = game.onEvent(state, { type: "contentReady", at: 0, text: JSON.stringify(items) });
        assert.deepEqual(begun.timers ?? {}, {});
        assert.equal(JSON.stringify(game.publicScene(begun.state)).includes('"drain"'), false);
        assert.match(JSON.stringify(game.privateControls(begun.state, "a")), /Reveal now/);
        assert.equal(game.phaseOf(game.apply(begun.state, "a", "reveal-now").state), "lockedIn");
        const left = game.onEvent(game.apply(begun.state, "a", "answer:0:0").state, { type: "playerLeft", at: 0, playerId: "b" });
        assert.equal(game.phaseOf(left.state), "lockedIn", "nobody waits on someone who left");
    });

    it("waits for a topic with no countdown, and takes Surprise me instead", () => {
        const game = createQuizmaster("own", () => 0);
        const started = game.init(players, {});
        assert.deepEqual(started.timers ?? {}, {});
        assert.match(JSON.stringify(game.privateControls(started.state, "b")), /Surprise me instead/);
        const surprised = game.apply(started.state, "b", "surprise");
        assert.equal(game.phaseOf(surprised.state), "preparing");
    });

    it("goes back to answers out loud with the switch off", () => {
        const game = createQuizmaster("Movies", Math.random, false);
        const started = game.init(players, {});
        const state = game.onEvent(game.apply(started.state, "a", "setup-start").state, { type: "contentReady", at: 0, text: JSON.stringify(items) }).state;
        assert.equal(state.questions[0]?.choices, undefined);
        assert.equal(JSON.stringify(game.privateControls(state, "a")).includes("Right0"), false);
    });
});
