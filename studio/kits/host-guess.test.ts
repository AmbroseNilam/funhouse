// Proves the host-guess kit, as Cold Read: the category vote and its ties, the secret phase, a
// question that is opened by the host's ruling and counted from the phones (most taps wins, a tie
// is Sometimes, nobody is Nothing), the budget that runs out and forces a final guess, wrong
// guesses that cost a question, duplicates and nonsense that are turned back, the clocks and the
// nudge that ends a silent host, someone leaving at each step, a stale clock, and what the TV and
// the other phones can see. Also the kit's checks and the default rehearsal.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import type { ScopedFact } from "../../shared/visibility.ts";
import { blueprintProblems, type HostGuessBlueprint } from "../blueprint.ts";
import { checkBlueprint } from "../check.ts";
import { COLD_READ_BLUEPRINT } from "../games/cold-read.ts";
import type { KitGame } from "../kit/kit.ts";
import { PAPER_PLAYERS, stringsIn } from "../rehearse.ts";
import { cleanHostText, createHostGuessGame, HOST_GUESS_IDS, hostGuessProblems, type HostGuessDecisions, type HostGuessState } from "./host-guess.ts";

/** Four at the table. */
const FOUR: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);

/** The game's decisions. */
const DECISIONS: HostGuessDecisions = COLD_READ_BLUEPRINT.decisions;

/**
 * Builds Cold Read.
 * @param players who is at the table.
 * @param random the random source, for breaking a tied category vote.
 * @returns the game.
 */
function coldRead(players: CartridgePlayer[] = FOUR, random: () => number = () => 0): { game: KitGame<HostGuessState>; start: Step<HostGuessState> } {
    const game: KitGame<HostGuessState> = createHostGuessGame(COLD_READ_BLUEPRINT.box, DECISIONS, random);
    return { game, start: game.cartridge.init(players, {}) };
}

/**
 * Has every listed player press the same thing.
 * @param game the game.
 * @param state the state.
 * @param playerIds who presses.
 * @param actionId what they press.
 * @returns the last step.
 */
function pressAll(game: KitGame<HostGuessState>, state: HostGuessState, playerIds: string[], actionId: string): Step<HostGuessState> {
    let step: Step<HostGuessState> = { state, facts: [] };
    for (const playerId of playerIds) {
        step = game.cartridge.apply(step.state, playerId, actionId);
    }
    return step;
}

/**
 * Plays a game to the start of the questions.
 * @param players who is at the table.
 * @returns the game and the state, with the host to move.
 */
function startAsking(players: CartridgePlayer[] = FOUR): { game: KitGame<HostGuessState>; state: HostGuessState } {
    const { game, start } = coldRead(players);
    const ids: string[] = players.map((player: CartridgePlayer) => player.playerId);
    const secret: Step<HostGuessState> = pressAll(game, start.state, ids, `${HOST_GUESS_IDS.category}1`);
    assert.equal(secret.state.phase, "secret");
    assert.equal(secret.state.category, "a place");
    const asking: Step<HostGuessState> = pressAll(game, secret.state, ids, HOST_GUESS_IDS.ready);
    assert.equal(asking.state.phase, "asking");
    return { game, state: asking.state };
}

/**
 * The host asks a question.
 * @param game the game.
 * @param state the state.
 * @param question what it asks.
 * @returns the step.
 */
function hostAsks(game: KitGame<HostGuessState>, state: HostGuessState, question: string): Step<HostGuessState> {
    return game.cartridge.onEvent(state, { type: "hostRuled", at: 1, ruling: "ask", detail: question, playerId: null });
}

/**
 * The host guesses.
 * @param game the game.
 * @param state the state.
 * @param guess what it names.
 * @returns the step.
 */
function hostGuesses(game: KitGame<HostGuessState>, state: HostGuessState, guess: string): Step<HostGuessState> {
    return game.cartridge.onEvent(state, { type: "hostRuled", at: 1, ruling: "guess", detail: guess, playerId: null });
}

/**
 * Has players answer an open question, in seat order.
 * @param game the game.
 * @param state the state with a question open.
 * @param answers the answers, one per player from the first seat.
 * @returns the last step.
 */
function answerAll(game: KitGame<HostGuessState>, state: HostGuessState, answers: string[]): Step<HostGuessState> {
    let step: Step<HostGuessState> = { state, facts: [] };
    answers.forEach((answer: string, seat: number) => {
        step = game.cartridge.apply(step.state, FOUR[seat]?.playerId ?? "", `${HOST_GUESS_IDS.answer}${answer}`);
    });
    return step;
}

/**
 * The text of the facts a step told the host.
 * @param step the step.
 * @returns the texts joined.
 */
function told(step: Step<HostGuessState>): string {
    return step.facts.filter((fact: ScopedFact) => fact.scope.kind !== "system").map((fact: ScopedFact) => fact.text).join(" ");
}

/**
 * Asks and answers one question the same way, to use up the budget.
 * @param game the game.
 * @param state the state with the host to move.
 * @param number which question this is.
 * @returns the state after the answers.
 */
function useOne(game: KitGame<HostGuessState>, state: HostGuessState, number: number): HostGuessState {
    const open: Step<HostGuessState> = hostAsks(game, state, `Is it the number ${number} thing?`);
    return answerAll(game, open.state, ["yes", "yes", "no", "yes"]).state;
}

describe("cold read: choosing and agreeing", () => {
    it("opens with a category vote, and tells the host to meet the table", () => {
        const { game, start } = coldRead();
        assert.equal(start.state.phase, "category");
        assert.match(told(start), /Meet the table/);
        assert.deepEqual(start.timers, { category1: 25 });
        const choices: string[] = game.cartridge.legalActions(start.state, "paper1").map((action) => action.label);
        assert.deepEqual(choices, DECISIONS.categories);
    });

    it("takes the most-tapped category, breaks a tie with the random source, and tells the host", () => {
        const { game, start } = coldRead();
        const first: Step<HostGuessState> = pressAll(game, start.state, ["paper1", "paper2"], `${HOST_GUESS_IDS.category}2`);
        const done: Step<HostGuessState> = pressAll(game, first.state, ["paper3", "paper4"], `${HOST_GUESS_IDS.category}4`);
        assert.equal(done.state.phase, "secret", "a 2 to 2 split is settled by the random source");
        assert.equal(done.state.category, "an animal", "the random source picked the first of the tied categories");
        assert.match(told(done), /They chose: an animal/);
    });

    it("lets the clock choose when nobody taps, and the secret clock start the questions", () => {
        const { game, start } = coldRead();
        const secret: Step<HostGuessState> = game.cartridge.onEvent(start.state, { type: "timerFired", at: 25, timerId: "category1" });
        assert.equal(secret.state.phase, "secret");
        assert.deepEqual(secret.timers, { secret2: 75 });
        const asking: Step<HostGuessState> = game.cartridge.onEvent(secret.state, { type: "timerFired", at: 100, timerId: "secret2" });
        assert.equal(asking.state.phase, "asking");
        assert.match(told(asking), /You have 15 questions/);
    });

    it("ignores a clock from an earlier moment", () => {
        const { game, start } = coldRead();
        const chosen: Step<HostGuessState> = pressAll(game, start.state, FOUR.map((player: CartridgePlayer) => player.playerId), `${HOST_GUESS_IDS.category}0`);
        const stale: Step<HostGuessState> = game.cartridge.onEvent(chosen.state, { type: "timerFired", at: 25, timerId: "category1" });
        assert.equal(stale.state, chosen.state);
    });

    it("lets each person tap once", () => {
        const { game, start } = coldRead();
        const once: Step<HostGuessState> = game.cartridge.apply(start.state, "paper1", `${HOST_GUESS_IDS.category}0`);
        assert.deepEqual(game.cartridge.legalActions(once.state, "paper1"), []);
        const twice: Step<HostGuessState> = game.cartridge.apply(once.state, "paper1", `${HOST_GUESS_IDS.category}3`);
        assert.equal(twice.state, once.state);
    });
});

describe("cold read: questions", () => {
    it("opens a question from the ask ruling and shows it on the TV and every phone", () => {
        const { game, state } = startAsking();
        const open: Step<HostGuessState> = hostAsks(game, state, "Is it alive?");
        assert.equal(open.state.pending?.question, "Is it alive?");
        assert.deepEqual(open.timers, { answer4: 25 });
        const title: SceneBlock | undefined = game.cartridge.publicScene(open.state).blocks[0];
        assert.equal(title?.type === "title" ? title.text : "", "Is it alive?");
        for (const player of FOUR) {
            const controls: Control[] = game.cartridge.privateControls(open.state, player.playerId);
            assert.equal(controls[0]?.type === "buttons" ? controls[0].options.map((option) => option.label).join("/") : "", "Yes/No/Sometimes");
        }
    });

    it("adds a question mark, strips brackets, and turns back nonsense with a note to the host", () => {
        const { game, state } = startAsking();
        assert.equal(hostAsks(game, state, "Is it [[alive]]").state.pending?.question, "Is it alive?");
        const short: Step<HostGuessState> = hostAsks(game, state, "hm");
        assert.equal(short.state.pending, null);
        assert.match(told(short), /couldn't be used/);
        assert.equal(cleanHostText("x".repeat(200), { least: 8, most: 140 }), null);
    });

    it("counts the most taps, calls a tie Sometimes, and reports nobody as no answer", () => {
        const { game, state } = startAsking();
        const win: Step<HostGuessState> = answerAll(game, hostAsks(game, state, "Is it alive?").state, ["yes", "yes", "no", "sometimes"]);
        assert.equal(win.state.asked[0]?.answer, "yes");
        assert.match(told(win), /The answer is Yes \(2 yes, 1 no, 1 sometimes\)/);
        const tie: Step<HostGuessState> = answerAll(game, hostAsks(game, win.state, "Is it big?").state, ["yes", "yes", "no", "no"]);
        assert.equal(tie.state.asked[1]?.answer, "sometimes");
        assert.match(told(tie), /split evenly, so it counts as Sometimes/);
        const open: Step<HostGuessState> = hostAsks(game, tie.state, "Is it old?");
        const none: Step<HostGuessState> = game.cartridge.onEvent(open.state, { type: "timerFired", at: 99, timerId: open.state.armed });
        assert.equal(none.state.asked[2]?.answer, "none");
        assert.match(told(none), /Nobody answered/);
    });

    it("counts the answer clock with only those who answered, and spends a question for it", () => {
        const { game, state } = startAsking();
        const open: Step<HostGuessState> = hostAsks(game, state, "Is it alive?");
        const partway: Step<HostGuessState> = pressAll(game, open.state, ["paper1", "paper2"], `${HOST_GUESS_IDS.answer}no`);
        assert.equal(partway.state.pending !== null, true);
        const done: Step<HostGuessState> = game.cartridge.onEvent(partway.state, { type: "timerFired", at: 99, timerId: partway.state.armed });
        assert.equal(done.state.asked[0]?.answer, "no");
        assert.equal(done.state.count.used, 1);
    });

    it("never shows how anyone answered, to the TV, the other phones or the host, while it is open", () => {
        const { game, state } = startAsking();
        const open: Step<HostGuessState> = hostAsks(game, state, "Is it alive?");
        const one: Step<HostGuessState> = game.cartridge.apply(open.state, "paper1", `${HOST_GUESS_IDS.answer}sometimes`);
        assert.deepEqual(game.cartridge.publicScene(one.state), game.cartridge.publicScene(open.state), "a tap changes nothing on the TV");
        assert.equal(JSON.stringify(game.cartridge.privateControls(one.state, "paper2")).includes("paper1"), false);
        const hostSees: string = game.cartridge.hostFacts(one.state, { kind: "host" }).map((fact: ScopedFact) => fact.text).join(" ");
        assert.match(hostSees, /A question is open/);
        assert.equal(hostSees.includes("sometimes"), false);
        assert.equal(game.cartridge.turn?.(one.state)?.kind, "everyone");
    });

    it("ignores a second question while one is open, and a duplicate or an extra after the budget", () => {
        const { game, state } = startAsking();
        const open: Step<HostGuessState> = hostAsks(game, state, "Is it alive?");
        assert.equal(hostAsks(game, open.state, "Is it big?").state, open.state);
        const next: HostGuessState = answerAll(game, open.state, ["yes", "yes", "yes", "yes"]).state;
        const repeat: Step<HostGuessState> = hostAsks(game, next, "is it ALIVE");
        assert.equal(repeat.state.pending, null);
        assert.match(told(repeat), /already asked that one/);
    });

    it("keeps the board in code and gives it to the host in order, with the count", () => {
        const { game, state } = startAsking();
        const after: HostGuessState = useOne(game, useOne(game, state, 1), 2);
        const seen: string = game.cartridge.hostFacts(after, { kind: "host" }).map((fact: ScopedFact) => fact.text).join("\n");
        assert.match(seen, /Questions used: 2 of 15/);
        assert.match(seen, /1\. Is it the number 1 thing\? Yes \(3 yes, 1 no, 0 sometimes\)/);
        assert.match(seen, /2\. Is it the number 2 thing\?/);
        assert.match(seen, /Guesses left: 3/);
    });

    it("warns at the configured counts and says when the last question is gone", () => {
        const { game, state } = startAsking();
        let current: HostGuessState = state;
        let warned: string[] = [];
        for (let number = 1; number <= 15; number += 1) {
            const open: Step<HostGuessState> = hostAsks(game, current, `Is it the number ${number} thing?`);
            const done: Step<HostGuessState> = answerAll(game, open.state, ["yes", "yes", "no", "yes"]);
            current = done.state;
            if (/out loud that only/.test(told(done)) === true) {
                warned = [...warned, `${15 - number}`];
            }
        }
        assert.deepEqual(warned, ["5", "2", "1"]);
        assert.equal(current.count.used, 15);
        assert.equal(current.phase, "asking");
        const refused: Step<HostGuessState> = hostAsks(game, current, "One more?");
        assert.equal(refused.state.pending, null);
        assert.match(told(refused), /no questions left/);
    });
});

describe("cold read: guesses", () => {
    it("judges a guess on the phones, and a right one ends the round with the host's win", () => {
        const { game, state } = startAsking();
        const guessed: Step<HostGuessState> = hostGuesses(game, useOne(game, state, 1), "Lighthouse");
        assert.equal(guessed.state.phase, "guess");
        assert.equal(guessed.state.count.used, 2, "a guess before the last costs a question");
        const verdict: Step<HostGuessState> = pressAll(game, guessed.state, FOUR.map((player: CartridgePlayer) => player.playerId), `${HOST_GUESS_IDS.verdict}right`);
        assert.equal(verdict.state.phase, "end");
        assert.equal(verdict.state.won, true);
        assert.match(told(verdict), /You got it after 2 questions\./);
        assert.equal(game.cartridge.outcome(verdict.state), "The host guessed it after 2 questions.");
    });

    it("sends a wrong guess back to the questions, remembers it, and refuses it a second time", () => {
        const { game, state } = startAsking();
        const guessed: Step<HostGuessState> = hostGuesses(game, state, "Lighthouse");
        const wrong: Step<HostGuessState> = pressAll(game, guessed.state, ["paper1", "paper2", "paper3", "paper4"], `${HOST_GUESS_IDS.verdict}wrong`);
        assert.equal(wrong.state.phase, "asking");
        assert.deepEqual(wrong.state.wrongGuesses, ["Lighthouse"]);
        assert.match(told(wrong), /Lighthouse is wrong\. 14 questions left/);
        const again: Step<HostGuessState> = hostGuesses(game, wrong.state, "lighthouse");
        assert.equal(again.state.phase, "asking");
        assert.match(told(again), /already guessed that/);
    });

    it("calls a tied judging wrong", () => {
        const { game, state } = startAsking();
        const guessed: Step<HostGuessState> = hostGuesses(game, state, "Lighthouse");
        const half: Step<HostGuessState> = pressAll(game, guessed.state, ["paper1", "paper2"], `${HOST_GUESS_IDS.verdict}right`);
        const done: Step<HostGuessState> = pressAll(game, half.state, ["paper3", "paper4"], `${HOST_GUESS_IDS.verdict}wrong`);
        assert.equal(done.state.phase, "asking");
    });

    it("makes the last guess final, shows it on the reveal, and ends the round either way", () => {
        const { game, state } = startAsking();
        let current: HostGuessState = state;
        for (const name of ["Alpha", "Beta"]) {
            const guessed: Step<HostGuessState> = hostGuesses(game, current, name);
            current = pressAll(game, guessed.state, ["paper1", "paper2", "paper3", "paper4"], `${HOST_GUESS_IDS.verdict}wrong`).state;
        }
        assert.match(told({ state: current, facts: game.cartridge.hostFacts(current, { kind: "host" }) }), /it is your final one/);
        const last: Step<HostGuessState> = hostGuesses(game, current, "Gamma");
        assert.equal(last.state.phase, "reveal");
        assert.equal(last.state.judging?.final, true);
        assert.equal(last.state.count.used, current.count.used, "the final guess costs nothing");
        const text: string = stringsIn(game.cartridge.publicScene(last.state)).join(" ");
        assert.match(text, /say what it was/);
        assert.match(JSON.stringify(game.cartridge.privateControls(last.state, "paper1")), /The host was right/);
        const lost: Step<HostGuessState> = pressAll(game, last.state, ["paper1", "paper2", "paper3", "paper4"], `${HOST_GUESS_IDS.verdict}wrong`);
        assert.equal(lost.state.phase, "end");
        assert.equal(lost.state.won, false);
        assert.match(told(lost), /you're stumped/);
    });

    it("makes the first guess after the budget is spent final", () => {
        const { game, state } = startAsking();
        let current: HostGuessState = state;
        for (let number = 1; number <= 15; number += 1) {
            current = useOne(game, current, number);
        }
        assert.equal(hostGuesses(game, current, "Anything").state.phase, "reveal");
    });

    it("won't take a guess while a question is open", () => {
        const { game, state } = startAsking();
        const open: Step<HostGuessState> = hostAsks(game, state, "Is it alive?");
        assert.equal(hostGuesses(game, open.state, "A cat").state, open.state);
    });
});

describe("cold read: a host that goes quiet, and people who leave", () => {
    it("nudges a silent host and then calls the round off", () => {
        const { game, state } = startAsking();
        let current: HostGuessState = state;
        const nudges: string[] = [];
        for (let nudge = 0; nudge < 3; nudge += 1) {
            const step: Step<HostGuessState> = game.cartridge.onEvent(current, { type: "timerFired", at: 99, timerId: current.armed });
            assert.equal(step.state.phase, "asking");
            nudges.push(told(step));
            current = step.state;
        }
        assert.equal(nudges.every((text: string) => /The table is waiting/.test(text)), true);
        const over: Step<HostGuessState> = game.cartridge.onEvent(current, { type: "timerFired", at: 99, timerId: current.armed });
        assert.equal(over.state.phase, "end");
        assert.equal(game.cartridge.outcome(over.state), "The host never made its final guess.");
    });

    it("answers a question without a person who left, as soon as everyone left has answered", () => {
        const { game, state } = startAsking();
        const open: Step<HostGuessState> = hostAsks(game, state, "Is it alive?");
        const three: Step<HostGuessState> = pressAll(game, open.state, ["paper1", "paper2", "paper3"], `${HOST_GUESS_IDS.answer}yes`);
        assert.equal(three.state.pending !== null, true);
        const gone: Step<HostGuessState> = game.cartridge.onEvent(three.state, { type: "playerLeft", at: 9, playerId: "paper4" });
        assert.equal(gone.state.asked[0]?.answer, "yes");
        assert.equal(gone.state.players.length, 3);
    });

    it("moves on when the last person to tap leaves the category vote", () => {
        const { game, start } = coldRead();
        const three: Step<HostGuessState> = pressAll(game, start.state, ["paper1", "paper2", "paper3"], `${HOST_GUESS_IDS.category}0`);
        const gone: Step<HostGuessState> = game.cartridge.onEvent(three.state, { type: "playerLeft", at: 9, playerId: "paper4" });
        assert.equal(gone.state.phase, "secret");
    });

    it("works for two players, and a tie there is Sometimes", () => {
        const two: CartridgePlayer[] = FOUR.slice(0, 2);
        const { game, state } = startAsking(two);
        const open: Step<HostGuessState> = hostAsks(game, state, "Is it alive?");
        const done: Step<HostGuessState> = pressAll(game, game.cartridge.apply(open.state, "paper1", `${HOST_GUESS_IDS.answer}yes`).state, ["paper2"], `${HOST_GUESS_IDS.answer}no`);
        assert.equal(done.state.asked[0]?.answer, "sometimes");
    });
});

describe("cold read: the box and the checks", () => {
    it("states the host's strategy and never claims to know the thing", () => {
        const { game } = coldRead();
        const brief: string = game.cartridge.manifest.hostBrief;
        assert.match(brief, /cut what's left roughly in half/);
        assert.match(brief, /never pretend you do/);
        assert.match(brief, /Sometimes means the question was fuzzy/);
        assert.deepEqual(Object.keys(game.cartridge.manifest.phases.find((phase) => phase.id === "asking")?.hostRulings ?? {}), ["ask", "guess"]);
        assert.deepEqual(game.hidden(coldRead().start.state), []);
    });

    it("rejects decisions that cannot run", () => {
        const bad = (patch: Partial<HostGuessDecisions>): string[] => hostGuessProblems({ ...DECISIONS, ...patch });
        assert.deepEqual(bad({}), []);
        assert.equal(bad({ questions: Number.NaN }).length > 0, true);
        assert.equal(bad({ guesses: 0 }).length > 0, true);
        assert.equal(bad({ warnAt: [15] }).length > 0, true);
        assert.equal(bad({ categories: ["one"] }).length > 0, true);
        assert.equal(bad({ categories: ["A thing", "a thing"] }).length > 0, true);
        assert.equal(bad({ categories: ["fine", "bad [[ruling]]"] }).length > 0, true);
        assert.equal(bad({ answerSeconds: 0 }).length > 0, true);
        const alone: HostGuessBlueprint = { ...COLD_READ_BLUEPRINT, box: { ...COLD_READ_BLUEPRINT.box, minPlayers: 1 } };
        assert.equal(blueprintProblems(alone).length > 0, true);
        assert.deepEqual(blueprintProblems(COLD_READ_BLUEPRINT), []);
    });

    it("copies the blueprint, so changing it afterwards can't reach a running game", () => {
        const decisions: HostGuessDecisions = structuredClone(DECISIONS);
        const game: KitGame<HostGuessState> = createHostGuessGame(COLD_READ_BLUEPRINT.box, decisions);
        decisions.questions = 1;
        decisions.categories.length = 0;
        assert.equal(game.cartridge.init(FOUR, {}).state.count.max, 15);
    });

    it("passes the default check at two, four and five players", () => {
        for (const count of [2, 4, 5]) {
            const tally = checkBlueprint(COLD_READ_BLUEPRINT, { players: PAPER_PLAYERS.slice(0, count) });
            assert.deepEqual(tally.problems, [], `${count} players`);
            assert.equal(tally.ended, tally.rehearsals);
            assert.deepEqual(tally.phasesNeverReached, []);
        }
    });

    it("reaches every ending the game has", () => {
        const tally = checkBlueprint(COLD_READ_BLUEPRINT);
        assert.equal(Object.keys(tally.outcomes).length >= 3, true, JSON.stringify(tally.outcomes));
        assert.equal(tally.outcomes["The host never made its final guess."] !== undefined, true);
        assert.equal(Object.keys(tally.outcomes).some((outcome: string) => /was stumped/.test(outcome)), true);
        assert.equal(Object.keys(tally.outcomes).some((outcome: string) => /guessed it/.test(outcome)), true);
    });
});
