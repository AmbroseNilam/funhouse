// Tests for what the TV and phones say when Twenty Doors and Quizmaster end: who won and why, in plain words.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GamePick } from "../shared/cartridge.ts";
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
        const thinking = game.onEvent(started.state, { type: "hostRuled", at: 0, ruling: "topic", detail: "Canadian lakes", playerId: "a" });
        const choosing = game.apply(thinking.state, "a", "setup-start");
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
        const thinking = game.onEvent(said.state, { type: "hostRuled", at: 0, ruling: "topic", detail: "programming languages", playerId: "a" });
        const ruled = game.apply(thinking.state, "a", "setup-start");
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

/**
 * What a quiz has on the TV's picker.
 * @param game the game.
 * @param state its state.
 * @returns the pick, if there is one.
 */
function pickOf(game: ReturnType<typeof createQuizmaster>, state: ReturnType<ReturnType<typeof createQuizmaster>["init"]>["state"]): GamePick | null {
    return game.setupPick?.(state) ?? null;
}

describe("Twenty Doors' setup", () => {
    const players = [{ playerId: "a", name: "Sam" }, { playerId: "b", name: "Alex" }];
    type Doors = ReturnType<typeof createTwentyDoors>;
    const pickOn = (game: Doors, state: ReturnType<Doors["init"]>["state"]): GamePick | null => game.setupPick?.(state) ?? null;
    const toThinking = (): { game: Doors; thinking: ReturnType<Doors["onEvent"]> } => {
        const game = createTwentyDoors(() => 0, "own");
        const thinking = game.onEvent(game.init(players, {}).state, { type: "hostRuled", at: 0, ruling: "topic", detail: "Canadian lakes", playerId: "a" });
        return { game, thinking };
    };
    const reply: string = JSON.stringify({ questions: [{ question: "East or west?", options: ["East", "West"] }, { question: "Big or small?", options: ["Big", "Small"] }, { question: "A third?", options: ["A", "B"] }] });

    it("asks at most two of the model's questions before any secret exists, then how hard", () => {
        const { game, thinking } = toThinking();
        assert.equal(thinking.state.secret, "", "nothing to leak yet");
        assert.match(thinking.followUpRequest?.prompt ?? "", /Canadian lakes/);
        const asked = game.onEvent(thinking.state, { type: "followUpReady", at: 0, id: "x", text: reply }).state;
        assert.equal(asked.secret, "");
        assert.deepEqual(asked.setup?.questions.map((question) => question.prompt), ["East or west?", "Big or small?", "How hard?"]);
        assert.deepEqual(pickOn(game, asked)?.choices.map((choice) => choice.label), ["East", "West", "Add your own", "Just start"]);
        let state = game.apply(asked, "b", "setup:model-0:1").state;
        state = game.apply(state, "b", "setup-own").state;
        const box = game.privateControls(state, "a").find((control) => control.type === "textInput");
        assert.equal(box?.type, "textInput");
        state = game.onEvent(state, { type: "answered", at: 0, playerId: "a", controlId: box.id, value: "Deep ones" }).state;
        assert.equal(pickOn(game, state)?.prompt, "How hard?");
        const choosing = game.apply(state, "b", "setup:level:hard");
        assert.equal(game.phaseOf(choosing.state), "choosing");
        assert.match(choosing.contentRequest ?? "", /East or west\? West Big or small\? Deep ones/);
        assert.match(choosing.contentRequest ?? "", /less obvious/);
        const playing = game.onEvent(choosing.state, { type: "contentReady", at: 0, text: '{"secret": "Lake Louise"}' });
        assert.equal(game.phaseOf(playing.state), "asking");
        assert.equal(pickOn(game, playing.state), null);
        assert.equal(JSON.stringify(game.publicScene(playing.state)).includes("Lake Louise"), false);
    });

    it("says so kindly if the reveal's painting fails, and takes a late one anyway", () => {
        const game = createTwentyDoors(() => 0, "surprise");
        const playing = game.init(players, {}).state;
        const over = game.apply(playing, "a", "giveup").state;
        assert.match(JSON.stringify(game.publicScene(over)), /"painting"/);
        const failed = game.onEvent(over, { type: "drawingFailed", at: 0, id: "reveal" }).state;
        const words: string = JSON.stringify(game.publicScene(failed));
        assert.equal(words.includes('"painting"'), false);
        assert.match(words, /paint ran dry/);
    });

    it("falls back on how hard alone, and Just start always works", () => {
        const { game, thinking } = toThinking();
        for (const bad of ["", "junk", "{}"]) {
            assert.equal(game.onEvent(thinking.state, { type: "followUpReady", at: 0, id: "x", text: bad }).state.setup?.questions[0]?.id, "level", bad);
        }
        assert.equal(game.onEvent(thinking.state, { type: "timerFired", at: 0, timerId: "setup-wait" }).state.setup?.questions[0]?.id, "level");
        const started = game.apply(thinking.state, "a", "setup-start");
        assert.equal(game.phaseOf(started.state), "choosing");
        assert.match(started.contentRequest ?? "", /most adults would know/);
    });

    it("leaves Surprise me and the kinds of secret starting straight away", () => {
        for (const chosen of ["surprise", "an animal"]) {
            const game = createTwentyDoors(() => 0, chosen);
            const started = game.init(players, {});
            assert.equal(game.phaseOf(started.state), "asking", chosen);
            assert.equal(started.followUpRequest, undefined);
        }
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

    it("counts an answer said or typed the same as a tap, once the host rules on it", () => {
        const { game, state } = inQuestion();
        const started = game.onEvent(state, { type: "speechStarted", at: 0, playerId: "a" }).state;
        const heard = game.onEvent(started, { type: "speechEnded", at: 0, playerId: "a", text: "It's Right0" }).state;
        const ruled = game.onEvent(heard, { type: "hostRuled", at: 0, ruling: "right", detail: "", playerId: "a" }).state;
        assert.deepEqual(ruled.answered, ["a"]);
        const turn = game.turn?.(ruled);
        assert.equal(turn?.kind === "everyone" ? turn.doneIds.includes("a") : false, true, "the TV's tick comes from this");
        assert.equal(turn?.label, "Still answering: Alex");
        const wrong: number = state.questions[0]?.choices?.indexOf("Bad0a") ?? -1;
        const locked = game.apply(ruled, "b", `answer:0:${wrong}`).state;
        const lit = game.onEvent(locked, { type: "timerFired", at: 0, timerId: "reveal-build" }).state;
        assert.equal(lit.scores.a, 2, "the points land at the reveal");
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

    it("asks the model's questions, then the fixed ones, and the answers change the game", () => {
        const game = createQuizmaster("Movies", () => 0.4);
        const thinking = game.init(players, {});
        assert.equal(game.phaseOf(thinking.state), "thinking");
        assert.match(thinking.followUpRequest?.prompt ?? "", /Movies/);
        assert.deepEqual(pickOf(game, thinking.state)?.choices.map((choice) => choice.label), ["Just start"]);
        const reply: string = JSON.stringify({ questions: [{ question: "Old films or new?", options: ["Old", "New"] }, { question: "Which genre?", options: ["Comedy", "Horror", "Drama"] }] });
        const asked = game.onEvent(thinking.state, { type: "followUpReady", at: 0, id: "x", text: reply }).state;
        assert.deepEqual(pickOf(game, asked)?.choices.map((choice) => choice.label), ["Old", "New", "Add your own", "Just start"]);
        let state = game.apply(asked, "b", "setup:model-0:1").state;
        assert.equal(pickOf(game, state)?.prompt, "Which genre?");
        state = game.apply(state, "b", "setup-own").state;
        assert.equal(pickOf(game, state), null, "the TV shows the question while the phones take the answer");
        const box = game.privateControls(state, "a").find((control) => control.type === "textInput");
        assert.equal(box?.type, "textInput");
        state = game.onEvent(state, { type: "answered", at: 0, playerId: "a", controlId: box.id, value: "Westerns" }).state;
        assert.equal(pickOf(game, state)?.prompt, "How hard?");
        assert.equal(pickOf(game, state)?.choices.some((choice) => choice.label === "Add your own"), false);
        state = game.onEvent(state, { type: "hostRuled", at: 0, ruling: "own", detail: "Hard", playerId: "a" }).state;
        assert.equal(pickOf(game, state)?.prompt, "How many questions?");
        assert.equal(game.onEvent(state, { type: "hostRuled", at: 0, ruling: "own", detail: "lots", playerId: "a" }).state, state, "a fixed question only takes what it offers");
        const counted = game.apply(state, "b", "setup:count:10").state;
        const writing = game.apply(counted, "b", "setup:time:quick");
        assert.equal(game.phaseOf(writing.state), "preparing");
        assert.equal(writing.state.count, 10);
        assert.match(writing.contentRequest ?? "", /Write 12 trivia questions about the topic "Movies"/);
        assert.match(writing.contentRequest ?? "", /Old films or new\? New Which genre\? Westerns/);
        const items = Array.from({ length: 12 }, (_unused: unknown, index: number) => ({ question: `Q${index} what?`, answer: `Right${index}`, wrong: [`Bad${index}a`, `Bad${index}b`, `Bad${index}c`] }));
        const begun = game.onEvent(writing.state, { type: "contentReady", at: 0, text: JSON.stringify(items) });
        assert.equal(begun.state.questions.length, 10);
        assert.equal(begun.timers?.["question-0"], 15);
        assert.equal(pickOf(game, begun.state), null);
    });

    it("drops poor model questions, carries on if it's slow, and Just start skips everything", () => {
        const game = createQuizmaster("Movies", () => 0.4);
        const thinking = game.init(players, {}).state;
        const one = (question: unknown, options: unknown): string => JSON.stringify({ questions: [{ question, options }] });
        for (const bad of ["", "not json", "{}", one("No question mark", ["A", "B"]), one("One?", ["A"]), one("Five?", ["A", "B", "C", "D", "E"]), one("Long?", ["A", "This answer is far too long for a row"]), one("<b>Odd</b>?", ["A", "B"]), one("How hard should it be?", ["A", "B"]), one("Same?", ["A", "a"]), one(7, ["A", "B"])]) {
            const after = game.onEvent(thinking, { type: "followUpReady", at: 0, id: "x", text: bad }).state;
            assert.equal(after.setup?.questions[0]?.id, "level", bad);
        }
        const mixed = game.onEvent(thinking, { type: "followUpReady", at: 0, id: "x", text: JSON.stringify({ questions: [{ question: "Bad", options: [] }, { question: "Good?", options: ["A", "B"] }, { question: "2?", options: ["A", "B"] }, { question: "3?", options: ["A", "B"] }, { question: "4?", options: ["A", "B"] }] }) }).state;
        assert.equal(mixed.setup?.questions.filter((question) => question.custom === true).length, 2, "the first three, less the bad one");
        const timedOut = game.onEvent(thinking, { type: "timerFired", at: 0, timerId: "setup-wait" }).state;
        assert.equal(timedOut.setup?.questions[0]?.id, "level");
        assert.equal(game.onEvent(timedOut, { type: "followUpReady", at: 0, id: "x", text: one("Late?", ["A", "B"]) }).state, timedOut);
        const started = game.apply(thinking, "a", "setup-start");
        assert.equal(game.phaseOf(started.state), "preparing");
        assert.equal(started.state.count, QUESTION_COUNT);
        assert.equal(started.state.questionSeconds, null, "no timer unless someone asks for one");
    });

    it("shows the clock, nudges near the end, and says when time ran out", () => {
        const { game, state: untimed } = inQuestion();
        assert.equal(JSON.stringify(game.publicScene(untimed)).includes('"drain"'), false);
        const state = { ...untimed, questionSeconds: 30 };
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
        const waiting = game.apply(begun.state, "a", "answer:0:0").state;
        assert.equal(game.turn?.(waiting)?.label, "Still answering: Alex");
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
