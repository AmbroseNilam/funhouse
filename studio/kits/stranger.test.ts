// Proves the stranger kit, as Wrong Room: one Stranger is dealt and only the others see the place;
// the host knows the place and never the Stranger; questions run in an order the code enforces, nobody
// can ask the person who just asked them, and every step has a clock; the vote catches the Stranger
// only with the most votes and no tie; a caught Stranger's last guess is ruled by the host or checked
// by code; people leaving and stale timers end or change nothing wrongly. Also the kit's checks.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer, Step } from "../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../shared/controls.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { ScopedFact } from "../../shared/visibility.ts";
import { blueprintProblems, type StrangerBlueprint } from "../blueprint.ts";
import { WRONG_ROOM_BLUEPRINT } from "../games/wrong-room/index.ts";
import type { KitGame } from "../kit/kit.ts";
import { strangerRoleCheck } from "../personas.ts";
import { PAPER_PLAYERS, roleBlindness, stringsIn } from "../rehearse.ts";
import { createStrangerGame, namesPlace, parsePlace, STRANGER_ACTIONS, STRANGER_CARD_TITLE, type StrangerState } from "./stranger.ts";

/** Five at the table. */
const FIVE: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 5);

/** A place and roles the host's model might write. */
const WRITTEN: string = "Place: Lighthouse | Roles: keeper, sailor, painter, tourist, engineer, cook, inspector, fisher";

/**
 * A random source that picks the first fallback place, deals the Stranger to one seat, and makes one seat ask first.
 * @param stranger which seat is the Stranger.
 * @param first which seat asks first.
 * @param count how many players.
 * @returns the source.
 */
function dealTo(stranger: number, first: number, count: number): () => number {
    const values: number[] = [0, (stranger + 0.5) / count, (first + 0.5) / count];
    return (): number => values.shift() ?? 0.5;
}

/**
 * Builds Wrong Room.
 * @param stranger which seat is the Stranger.
 * @param first which seat asks first.
 * @param players who is at the table.
 * @param blueprint the blueprint; Wrong Room unless given.
 * @returns the game.
 */
function wrongRoom(stranger: number = 0, first: number = 1, players: CartridgePlayer[] = FIVE, blueprint: StrangerBlueprint = WRONG_ROOM_BLUEPRINT): KitGame<StrangerState> {
    return createStrangerGame(blueprint.box, blueprint.decisions, dealTo(stranger, first, players.length));
}

/**
 * Plays an event.
 * @param game the game.
 * @param state the state.
 * @param event the event.
 * @returns the step.
 */
function on(game: KitGame<StrangerState>, state: StrangerState, event: RoomEvent): Step<StrangerState> {
    return game.cartridge.onEvent(state, event);
}

/**
 * Starts a game and gets it to the first question, with the place the model wrote.
 * @param stranger which seat is the Stranger.
 * @param first which seat asks first.
 * @param players who is at the table.
 * @param text what the model writes.
 * @returns the game and the state at the first pick.
 */
function startQuestions(stranger: number = 0, first: number = 1, players: CartridgePlayer[] = FIVE, text: string = WRITTEN): { game: KitGame<StrangerState>; state: StrangerState } {
    const game: KitGame<StrangerState> = wrongRoom(stranger, first, players);
    const started: Step<StrangerState> = game.cartridge.init(players, {});
    assert.ok((started.contentRequest ?? "").includes("Place:"));
    const ready: Step<StrangerState> = on(game, started.state, { type: "contentReady", at: 0, text });
    assert.deepEqual(ready.timers, { read: 10 });
    const asking: Step<StrangerState> = on(game, ready.state, { type: "timerFired", at: 10, timerId: "read" });
    assert.equal(asking.state.phase, "questions");
    assert.deepEqual(asking.timers, { turn: 30, talk: 420 });
    return { game, state: asking.state };
}

/**
 * One full question: pick, ask, answer.
 * @param game the game.
 * @param state the state at a pick.
 * @param target who the asker picks.
 * @returns the step after the answer.
 */
function question(game: KitGame<StrangerState>, state: StrangerState, target: string): Step<StrangerState> {
    const picked: Step<StrangerState> = game.cartridge.apply(state, state.askerId, `${STRANGER_ACTIONS.target}${target}`);
    const asked: Step<StrangerState> = on(game, picked.state, { type: "speechEnded", at: 1, playerId: state.askerId, text: "Do you like it here?" });
    return on(game, asked.state, { type: "speechEnded", at: 2, playerId: target, text: "Most days, yes." });
}

/**
 * Has each listed voter vote.
 * @param game the game.
 * @param state the state in the vote.
 * @param votes target by voter.
 * @returns the last step.
 */
function voteAll(game: KitGame<StrangerState>, state: StrangerState, votes: Record<string, string>): Step<StrangerState> {
    let step: Step<StrangerState> = { state, facts: [] };
    for (const [voter, target] of Object.entries(votes)) {
        step = game.cartridge.apply(step.state, voter, `${STRANGER_ACTIONS.vote}${target}`);
    }
    return step;
}

/**
 * Gets to the vote by calling it with three of five.
 * @param game the game.
 * @param state the state in questions.
 * @returns the state in the vote.
 */
function toVote(game: KitGame<StrangerState>, state: StrangerState): StrangerState {
    let current: StrangerState = state;
    for (const caller of ["paper1", "paper2", "paper3"]) {
        current = game.cartridge.apply(current, caller, STRANGER_ACTIONS.call).state;
    }
    assert.equal(current.phase, "vote");
    return current;
}

/**
 * The card title and body on one phone.
 * @param controls the phone's controls.
 * @returns the card's words.
 */
function cardWords(controls: Control[]): string {
    const card: Control | undefined = controls[0];
    return card?.type === "roleCard" ? `${card.title} ${card.body}` : "";
}

describe("wrong room: dealing and secrets", () => {
    it("deals one Stranger, whose card has no place, and gives everyone else the place and a role", () => {
        const { game, state } = startQuestions(2);
        assert.equal(state.strangerId, "paper3");
        assert.equal(state.place, "Lighthouse");
        for (const player of FIVE) {
            const words: string = cardWords(game.cartridge.privateControls(state, player.playerId));
            assert.equal(words.includes("Lighthouse"), player.playerId !== "paper3", `${player.playerId}'s card`);
            assert.equal(words.includes(STRANGER_CARD_TITLE), player.playerId === "paper3");
        }
        assert.equal(Object.keys(state.roles).length, 5);
    });

    it("tells the host the place and never who the Stranger is, and tells the TV neither", () => {
        const { game, state } = startQuestions(2);
        const facts: ScopedFact[] = game.cartridge.hostFacts(state, { kind: "host" });
        assert.ok(facts.some((fact: ScopedFact) => fact.text.includes("Lighthouse")));
        const heard: string = [game.cartridge.manifest.hostBrief, ...facts.map((fact: ScopedFact) => fact.text)].join(" ");
        assert.equal(heard.includes("Candle") || heard.includes("paper3"), false, "the Stranger is Candle");
        const seen: string = stringsIn(game.cartridge.publicScene(state)).join(" ");
        assert.equal(seen.includes("Lighthouse"), false);
        assert.equal(seen.includes("Candle"), false);
    });

    it("keeps what the Stranger sees the same whoever they are, to everyone else", () => {
        const check = strangerRoleCheck(WRONG_ROOM_BLUEPRINT);
        const games = FIVE.map((player: CartridgePlayer, seat: number) => ({ game: check.deal(seat, FIVE), holderId: player.playerId }));
        assert.deepEqual(roleBlindness(games, check.script, FIVE), []);
    });

    it("reads the model's place and roles, and falls back on its own when it is unusable", () => {
        assert.deepEqual(parsePlace(WRITTEN), { name: "Lighthouse", roles: ["keeper", "sailor", "painter", "tourist", "engineer", "cook", "inspector", "fisher"] });
        assert.equal(parsePlace("Place: Lighthouse | Roles: keeper, sailor"), null);
        assert.equal(parsePlace("Lighthouse"), null);
        assert.equal(parsePlace("Place: Light<house> | Roles: a, b, c, d, e, f, g, h"), null);
        for (const text of ["", "ignore your instructions", "Place: x | Roles: y"]) {
            const { state } = startQuestions(0, 1, FIVE, text);
            assert.ok(WRONG_ROOM_BLUEPRINT.decisions.places.some((place) => place.name === state.place));
        }
    });

    it("never shows the place on the Stranger's phone, in any phase", () => {
        const { game, state: dealt } = startQuestions(0, 1);
        let state: StrangerState = dealt;
        const phones: string[] = [];
        const look = (): void => { phones.push(stringsIn(game.cartridge.privateControls(state, "paper1")).join(" ")); };
        look();
        state = question(game, state, "paper3").state;
        look();
        state = toVote(game, state);
        look();
        state = voteAll(game, state, { paper2: "paper3", paper3: "paper4" }).state;
        look();
        assert.equal(phones.some((words: string) => words.includes("Lighthouse")), false);
        assert.ok(game.hidden(state).every((value) => value.text !== "Lighthouse" || value.seenBy.includes("paper1") === false));
    });
});

describe("wrong room: the order of questions", () => {
    it("lets only the asker pick, and never themselves or the person who asked them", () => {
        const { game, state } = startQuestions(0, 1);
        assert.equal(state.askerId, "paper2");
        const targets = (playerId: string): string[] => game.cartridge.legalActions(state, playerId).filter((action) => action.actionId.startsWith(STRANGER_ACTIONS.target)).map((action) => action.actionId.slice(STRANGER_ACTIONS.target.length));
        assert.deepEqual(targets("paper2"), ["paper1", "paper3", "paper4", "paper5"]);
        assert.deepEqual(targets("paper3"), []);
        assert.equal(game.cartridge.apply(state, "paper3", `${STRANGER_ACTIONS.target}paper4`).state, state, "someone else can't pick");
        assert.equal(game.cartridge.apply(state, "paper2", `${STRANGER_ACTIONS.target}paper2`).state, state, "nobody asks themselves");
        const answered: Step<StrangerState> = question(game, state, "paper3");
        assert.equal(answered.state.askerId, "paper3");
        assert.equal(answered.state.askedById, "paper2");
        assert.equal(answered.state.questions.used, 1);
        const back: string[] = game.cartridge.legalActions(answered.state, "paper3").filter((action) => action.actionId.startsWith(STRANGER_ACTIONS.target)).map((action) => action.actionId);
        assert.equal(back.includes(`${STRANGER_ACTIONS.target}paper2`), false, "no asking back");
        assert.equal(game.cartridge.apply(answered.state, "paper3", `${STRANGER_ACTIONS.target}paper2`).state, answered.state);
    });

    it("hears only the person who is up, and only once they have said something", () => {
        const { game, state } = startQuestions(0, 1);
        const picked: StrangerState = game.cartridge.apply(state, "paper2", `${STRANGER_ACTIONS.target}paper3`).state;
        const say = (playerId: string, text: string): StrangerState => on(game, picked, { type: "speechEnded", at: 1, playerId, text }).state;
        assert.equal(say("paper3", "I'm not the asker yet."), picked, "the target can't speak first");
        assert.equal(say("paper4", "Butting in."), picked);
        assert.equal(say("paper2", "um"), picked, "too short to be a question");
        const asked: StrangerState = say("paper2", "How was your morning?");
        assert.equal(asked.step, "answer");
        assert.equal(on(game, asked, { type: "speechEnded", at: 2, playerId: "paper2", text: "Answering my own question." }).state, asked);
        assert.equal(on(game, asked, { type: "speechEnded", at: 2, playerId: "paper4", text: "Butting in again." }).state, asked);
    });

    it("opens the mic for whoever is up and nobody else", () => {
        const { game, state } = startQuestions(0, 1);
        const roles = (s: StrangerState): string[] => FIVE.map((player: CartridgePlayer) => game.cartridge.roleOf(s, player.playerId));
        assert.deepEqual(roles(state), ["quiet", "quiet", "quiet", "quiet", "quiet"]);
        const picked: StrangerState = game.cartridge.apply(state, "paper2", `${STRANGER_ACTIONS.target}paper3`).state;
        assert.deepEqual(roles(picked), ["quiet", "up", "quiet", "quiet", "quiet"]);
        const asked: StrangerState = on(game, picked, { type: "speechEnded", at: 1, playerId: "paper2", text: "Is it warm in here?" }).state;
        assert.deepEqual(roles(asked), ["quiet", "quiet", "up", "quiet", "quiet"]);
        const phases = game.cartridge.manifest.phases.find((phase) => phase.id === "questions");
        assert.deepEqual(phases?.listening, { up: "holdToTalk", "*": "muted" });
    });

    it("takes typed questions and answers, shows them on the TV, and lets each box be used once", () => {
        const { game, state } = startQuestions(0, 1);
        const picked: StrangerState = game.cartridge.apply(state, "paper2", `${STRANGER_ACTIONS.target}paper3`).state;
        const askBox: Control | undefined = game.cartridge.privateControls(picked, "paper2").find((control: Control) => control.type === "textInput");
        assert.equal(askBox?.type === "textInput" ? askBox.id : "", "ask:0");
        const asked: StrangerState = on(game, picked, { type: "answered", at: 1, playerId: "paper2", controlId: "ask:0", value: "Is the view good?" }).state;
        assert.equal(asked.typed, "Is the view good?");
        assert.ok(stringsIn(game.cartridge.publicScene(asked)).includes("Is the view good?"));
        const stranger: StrangerState = on(game, picked, { type: "answered", at: 1, playerId: "paper4", controlId: "ask:0", value: "Not mine." }).state;
        assert.equal(stranger, picked);
        const replied: StrangerState = on(game, asked, { type: "answered", at: 2, playerId: "paper3", controlId: "reply:0", value: "Lovely." }).state;
        assert.equal(replied.step, "pick");
        assert.equal(replied.typed, "");
    });

    it("moves on when someone stalls: a pick goes to the next person, a question is dropped, an answer is skipped", () => {
        const { game, state } = startQuestions(0, 1);
        const stalledPick: Step<StrangerState> = on(game, state, { type: "timerFired", at: 30, timerId: "turn" });
        assert.equal(stalledPick.state.step, "ask");
        assert.equal(stalledPick.state.targetId, "paper1");
        assert.deepEqual(stalledPick.timers, { turn: 30 });
        const stalledAsk: Step<StrangerState> = on(game, stalledPick.state, { type: "timerFired", at: 60, timerId: "turn" });
        assert.equal(stalledAsk.state.step, "answer");
        const stalledAnswer: Step<StrangerState> = on(game, stalledAsk.state, { type: "timerFired", at: 90, timerId: "turn" });
        assert.equal(stalledAnswer.state.step, "pick");
        assert.equal(stalledAnswer.state.askerId, "paper1");
        assert.equal(stalledAnswer.state.questions.used, 1);
        assert.ok(stalledAnswer.facts.every((fact: ScopedFact) => fact.quiet === true || fact.scope.kind === "system"), "stalling doesn't wake the host");
    });

    it("counts questions, says when few are left, and opens the vote on the last", () => {
        const { game, state: dealt } = startQuestions(0, 1);
        let state: StrangerState = dealt;
        let warnings: number = 0;
        for (let asked = 1; asked <= 12; asked += 1) {
            const target: string = game.cartridge.legalActions(state, state.askerId).find((action) => action.actionId.startsWith(STRANGER_ACTIONS.target))?.actionId.slice(STRANGER_ACTIONS.target.length) ?? "";
            const step: Step<StrangerState> = question(game, state, target);
            warnings += step.facts.filter((fact: ScopedFact) => fact.kind === "questions-left").length;
            state = step.state;
            assert.equal(state.phase, asked === 12 ? "vote" : "questions");
        }
        assert.equal(warnings, 2);
        assert.deepEqual(state.voters.length, 5);
    });

    it("ignores a stale step clock once the vote is open, and opens the vote when talking time is up", () => {
        const { game, state } = startQuestions(0, 1);
        const voting: StrangerState = toVote(game, state);
        assert.equal(on(game, voting, { type: "timerFired", at: 99, timerId: "turn" }).state, voting);
        assert.equal(on(game, voting, { type: "timerFired", at: 99, timerId: "talk" }).state, voting);
        assert.equal(on(game, state, { type: "timerFired", at: 420, timerId: "talk" }).state.phase, "vote");
    });
});

describe("wrong room: calling the vote and revealing", () => {
    it("opens the vote when most of the table has called it, and each person calls once", () => {
        const { game, state } = startQuestions(0, 1);
        const once: StrangerState = game.cartridge.apply(state, "paper1", STRANGER_ACTIONS.call).state;
        assert.equal(game.cartridge.apply(once, "paper1", STRANGER_ACTIONS.call).state, once);
        const two: StrangerState = game.cartridge.apply(once, "paper2", STRANGER_ACTIONS.call).state;
        assert.equal(two.phase, "questions");
        assert.equal(game.cartridge.apply(two, "paper3", STRANGER_ACTIONS.call).state.phase, "vote");
    });

    it("offers the reveal to the Stranger alone, and a Stranger who reveals gets one guess", () => {
        const { game, state } = startQuestions(0, 1);
        const buttons = (playerId: string): string[] => game.cartridge.legalActions(state, playerId).map((action) => action.actionId);
        assert.ok(buttons("paper1").includes(STRANGER_ACTIONS.reveal));
        assert.equal(buttons("paper2").includes(STRANGER_ACTIONS.reveal), false);
        assert.equal(game.cartridge.apply(state, "paper2", STRANGER_ACTIONS.reveal).state, state);
        const revealed: Step<StrangerState> = game.cartridge.apply(state, "paper1", STRANGER_ACTIONS.reveal);
        assert.equal(revealed.state.phase, "guess");
        assert.deepEqual(revealed.timers, { guess: 30 });
        assert.equal(game.cartridge.roleOf(revealed.state, "paper1"), "up");
        assert.equal(game.cartridge.roleOf(revealed.state, "paper2"), "quiet");
    });
});

describe("wrong room: the vote and the last guess", () => {
    it("catches the Stranger with the most votes and gives them one guess", () => {
        const { game, state } = startQuestions(0, 1);
        const voting: StrangerState = toVote(game, state);
        const done: Step<StrangerState> = voteAll(game, voting, { paper1: "paper2", paper2: "paper1", paper3: "paper1", paper4: "paper1", paper5: "paper1" });
        assert.equal(done.state.phase, "guess");
        assert.equal(done.state.accusedName, "Teacup");
        assert.deepEqual(done.timers, { guess: 30 });
    });

    it("lets the Stranger go on a wrong accusation, a tie, or no votes", () => {
        const { game, state } = startQuestions(0, 1);
        const voting: StrangerState = toVote(game, state);
        const wrong: Step<StrangerState> = voteAll(game, voting, { paper1: "paper2", paper2: "paper3", paper3: "paper2", paper4: "paper2", paper5: "paper2" });
        assert.equal(wrong.state.result, "slipped");
        const tie: Step<StrangerState> = voteAll(game, voting, { paper1: "paper2", paper2: "paper1", paper3: "paper1", paper4: "paper2", paper5: "paper3" });
        assert.equal(tie.state.result, "slipped");
        const none: Step<StrangerState> = on(game, voting, { type: "timerFired", at: 99, timerId: "vote" });
        assert.equal(none.state.result, "slipped");
        assert.ok(none.state.place !== "" && none.facts.some((fact: ScopedFact) => fact.text.includes("Lighthouse")));
    });

    it("lets people vote once, not for themselves, and only during the vote", () => {
        const { game, state } = startQuestions(0, 1);
        assert.equal(game.cartridge.apply(state, "paper2", `${STRANGER_ACTIONS.vote}paper1`).state, state);
        const voting: StrangerState = toVote(game, state);
        assert.equal(game.cartridge.apply(voting, "paper2", `${STRANGER_ACTIONS.vote}paper2`).state, voting);
        const once: StrangerState = game.cartridge.apply(voting, "paper2", `${STRANGER_ACTIONS.vote}paper1`).state;
        assert.equal(game.cartridge.apply(once, "paper2", `${STRANGER_ACTIONS.vote}paper3`).state, once);
        const choice: Control | undefined = game.cartridge.privateControls(voting, "paper2").find((control: Control) => control.type === "choice");
        assert.equal(choice?.type === "choice" ? choice.options.some((option: ControlOption) => option.label === "Spoon") : true, false, "no vote for yourself");
    });

    it("rules a spoken guess only after the Stranger has spoken, and checks a typed one in code", () => {
        const { game, state } = startQuestions(0, 1);
        const guessing: StrangerState = game.cartridge.apply(state, "paper1", STRANGER_ACTIONS.reveal).state;
        assert.equal(on(game, guessing, { type: "hostRuled", at: 1, ruling: "right", detail: "", playerId: "paper1" }).state, guessing, "no ruling before a guess");
        const heard: StrangerState = on(game, guessing, { type: "speechEnded", at: 2, playerId: "paper1", text: "A lighthouse?" }).state;
        assert.equal(heard.guessHeard, true);
        assert.equal(on(game, heard, { type: "hostRuled", at: 3, ruling: "right", detail: "", playerId: "paper1" }).state.result, "early");
        assert.equal(on(game, heard, { type: "hostRuled", at: 3, ruling: "wrong", detail: "", playerId: "paper1" }).state.result, "earlyMiss");
        assert.equal(on(game, guessing, { type: "speechEnded", at: 2, playerId: "paper3", text: "A lighthouse?" }).state, guessing);
        assert.equal(on(game, guessing, { type: "answered", at: 2, playerId: "paper1", controlId: "guess", value: "the lighthouse" }).state.result, "early");
        assert.equal(on(game, guessing, { type: "answered", at: 2, playerId: "paper1", controlId: "guess", value: "A bakery" }).state.result, "earlyMiss");
        assert.equal(on(game, guessing, { type: "timerFired", at: 40, timerId: "guess" }).state.result, "earlyMiss");
    });

    it("names the Stranger the winner when they are caught but name the place", () => {
        const { game, state } = startQuestions(0, 1);
        const pinned: StrangerState = voteAll(game, toVote(game, state), { paper1: "paper2", paper2: "paper1", paper3: "paper1", paper4: "paper1", paper5: "paper1" }).state;
        const heard: StrangerState = on(game, pinned, { type: "speechEnded", at: 1, playerId: "paper1", text: "A lighthouse" }).state;
        const named: Step<StrangerState> = on(game, heard, { type: "hostRuled", at: 2, ruling: "right", detail: "", playerId: "paper1" });
        assert.equal(named.state.result, "namedIt");
        assert.equal(game.cartridge.outcome(named.state), "Teacup was caught but named the place.");
        const missed: Step<StrangerState> = on(game, heard, { type: "hostRuled", at: 2, ruling: "wrong", detail: "", playerId: "paper1" });
        assert.equal(missed.state.result, "caught");
        assert.deepEqual(game.hidden(missed.state), []);
    });

    it("counts a near name as the place, and a loose or short guess as not", () => {
        assert.equal(namesPlace("Night ferry", "the night ferry"), true);
        assert.equal(namesPlace("Lighthouse", "lighthouse"), true);
        assert.equal(namesPlace("Lighthouse", "house"), true, "long enough to be inside it");
        assert.equal(namesPlace("Lighthouse", "a"), false);
        assert.equal(namesPlace("Lighthouse", "a bakery"), false);
    });
});

describe("wrong room: leaving", () => {
    it("ends the round when the Stranger leaves, and when too few are left", () => {
        const { game, state } = startQuestions(0, 1);
        const gone: Step<StrangerState> = on(game, state, { type: "playerLeft", at: 1, playerId: "paper1" });
        assert.equal(gone.state.result, "strangerLeft");
        assert.ok(gone.facts.some((fact: ScopedFact) => fact.text.includes("Lighthouse")));
        const four: CartridgePlayer[] = FIVE.slice(0, 4);
        const small = startQuestions(0, 1, four);
        const one: StrangerState = on(small.game, small.state, { type: "playerLeft", at: 1, playerId: "paper4" }).state;
        assert.equal(one.phase, "questions");
        assert.equal(on(small.game, one, { type: "playerLeft", at: 2, playerId: "paper3" }).state.result, "emptied");
    });

    it("hands the question on when the asker or the one asked leaves, and restarts a vote", () => {
        const { game, state } = startQuestions(0, 1);
        const picked: StrangerState = game.cartridge.apply(state, "paper2", `${STRANGER_ACTIONS.target}paper3`).state;
        const askerGone: Step<StrangerState> = on(game, picked, { type: "playerLeft", at: 1, playerId: "paper2" });
        assert.equal(askerGone.state.step, "pick");
        assert.equal(askerGone.state.players.some((player: CartridgePlayer) => player.playerId === askerGone.state.askerId), true);
        const targetGone: Step<StrangerState> = on(game, picked, { type: "playerLeft", at: 1, playerId: "paper3" });
        assert.equal(targetGone.state.step, "pick");
        assert.equal(targetGone.state.askerId, "paper2");
        const voting: StrangerState = voteAll(game, toVote(game, state), { paper2: "paper1" }).state;
        const reopened: Step<StrangerState> = on(game, voting, { type: "playerLeft", at: 2, playerId: "paper5" });
        assert.deepEqual(reopened.state.votes, {});
        assert.deepEqual(reopened.timers, { vote: 45 });
    });
});

describe("wrong room: the blueprint", () => {
    it("is runnable, and refuses bad decisions", () => {
        assert.deepEqual(blueprintProblems(WRONG_ROOM_BLUEPRINT), []);
        const bad = (change: Partial<StrangerBlueprint["decisions"]>): string[] => blueprintProblems({ ...WRONG_ROOM_BLUEPRINT, decisions: { ...WRONG_ROOM_BLUEPRINT.decisions, ...change } });
        assert.notEqual(bad({ places: WRONG_ROOM_BLUEPRINT.decisions.places.slice(0, 3) }).length, 0);
        assert.notEqual(bad({ stepSeconds: Number.NaN }).length, 0);
        assert.notEqual(bad({ questions: { budget: 12, warnAt: [12] } }).length, 0);
        assert.notEqual(blueprintProblems({ ...WRONG_ROOM_BLUEPRINT, box: { ...WRONG_ROOM_BLUEPRINT.box, maxPlayers: 9 } }).length, 0);
        assert.notEqual(blueprintProblems({ ...WRONG_ROOM_BLUEPRINT, box: { ...WRONG_ROOM_BLUEPRINT.box, pitch: "Come to the Lighthouse." } }).length, 0, "a pitch can't give a place away");
    });
});
