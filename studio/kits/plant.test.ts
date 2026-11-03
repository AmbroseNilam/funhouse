// Proves the plant kit, as Leading Questions: one Plant is dealt and only their phone shows the
// word; the host knows the word and never the Plant; questions are counted in code and run out;
// "correct" opens a vote; the vote catches the Plant only with the most votes and no tie; the
// clocks and someone leaving end things cleanly; and a stale timer from an earlier phase is
// ignored. Also the kit's checks.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { ScopedFact } from "../../shared/visibility.ts";
import { blueprintProblems, type PlantBlueprint } from "../blueprint.ts";
import { LEADING_QUESTIONS_BLUEPRINT } from "../games/leading-questions.ts";
import type { KitGame } from "../kit/kit.ts";
import { PAPER_PLAYERS, stringsIn } from "../rehearse.ts";
import { ASKER_CARD_TITLE, createPlantGame, PLANT_CARD_TITLE, PLANT_GIVE_UP_ACTION, VOTE_PREFIX, type PlantState } from "./plant.ts";

/** Four at the table. */
const FOUR: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);

/**
 * A random source that picks the first category, then deals the Plant to one seat.
 * @param seat which of the players is the Plant.
 * @param count how many players.
 * @returns the source.
 */
function dealTo(seat: number, count: number): () => number {
    const values: number[] = [0, (seat + 0.5) / count];
    return (): number => values.shift() ?? 0;
}

/**
 * Builds Leading Questions.
 * @param seat which seat gets the Plant.
 * @param players who is at the table.
 * @param blueprint the blueprint; Leading Questions unless given.
 * @returns the game.
 */
function leadingQuestions(seat: number = 0, players: CartridgePlayer[] = FOUR, blueprint: PlantBlueprint = LEADING_QUESTIONS_BLUEPRINT): KitGame<PlantState> {
    return createPlantGame(blueprint.box, blueprint.decisions, dealTo(seat, players.length));
}

/**
 * Plays an event.
 * @param game the game.
 * @param state the state.
 * @param event the event.
 * @returns the step.
 */
function on(game: KitGame<PlantState>, state: PlantState, event: RoomEvent): Step<PlantState> {
    return game.cartridge.onEvent(state, event);
}

/**
 * Starts a game and gets it to asking: the model fails, so the fallback word is used.
 * @param seat which seat gets the Plant.
 * @param players who is at the table.
 * @returns the game and the state in asking.
 */
function startAsking(seat: number = 0, players: CartridgePlayer[] = FOUR): { game: KitGame<PlantState>; state: PlantState } {
    const game: KitGame<PlantState> = leadingQuestions(seat, players);
    const started: Step<PlantState> = game.cartridge.init(players, {});
    const ready: Step<PlantState> = on(game, started.state, { type: "contentReady", at: 0, text: "" });
    assert.deepEqual(ready.timers, { read: 10 });
    const asking: Step<PlantState> = on(game, ready.state, { type: "timerFired", at: 10, timerId: "read" });
    assert.equal(asking.state.phase, "asking");
    assert.deepEqual(asking.timers, { asking: 240 });
    return { game, state: asking.state };
}

/**
 * Has a player ask, and the judge rule.
 * @param game the game.
 * @param state the state.
 * @param playerId who asks.
 * @param ruling the ruling.
 * @returns the step after the ruling.
 */
function ask(game: KitGame<PlantState>, state: PlantState, playerId: string, ruling: string): Step<PlantState> {
    const heard: Step<PlantState> = on(game, state, { type: "speechEnded", at: 1, playerId, text: "Is it bigger than a bread bin?" });
    return on(game, heard.state, { type: "hostRuled", at: 2, ruling, detail: "", playerId });
}

/**
 * Has each listed voter vote.
 * @param game the game.
 * @param state the state in the vote.
 * @param votes target by voter.
 * @returns the last step.
 */
function voteAll(game: KitGame<PlantState>, state: PlantState, votes: Record<string, string>): Step<PlantState> {
    let step: Step<PlantState> = { state, facts: [] };
    for (const [voter, target] of Object.entries(votes)) {
        step = game.cartridge.apply(step.state, voter, `${VOTE_PREFIX}${target}`);
    }
    return step;
}

/**
 * The card title on one phone.
 * @param controls the phone's controls.
 * @returns the title, or an empty string.
 */
function cardTitle(controls: Control[]): string {
    const card: Control | undefined = controls[0];
    return card?.type === "roleCard" ? card.title : "";
}

describe("leading questions: dealing and secrets", () => {
    it("deals one Plant and shows the word only on their phone, on a card shaped like everyone else's", () => {
        const { game, state } = startAsking(2);
        assert.equal(state.plantId, "paper3");
        assert.equal(state.word, "Colander");
        const titles: string[] = FOUR.map((player: CartridgePlayer) => cardTitle(game.cartridge.privateControls(state, player.playerId)));
        assert.deepEqual(titles, [ASKER_CARD_TITLE, ASKER_CARD_TITLE, PLANT_CARD_TITLE, ASKER_CARD_TITLE]);
        for (const player of FOUR) {
            const seen: string = stringsIn(game.cartridge.privateControls(state, player.playerId)).join(" ");
            assert.equal(seen.includes("Colander"), player.playerId === "paper3");
            assert.equal(game.cartridge.privateControls(state, player.playerId)[0]?.type, "roleCard");
        }
        assert.equal(stringsIn(game.cartridge.publicScene(state)).join(" ").includes("Colander"), false);
        assert.deepEqual(game.cartridge.turn?.(game.cartridge.init(FOUR, {}).state), { kind: "secret", label: "Look at your phone" });
    });

    it("tells the host the word and never who the Plant is", () => {
        const { game, state } = startAsking(1);
        const brief: string = [game.cartridge.manifest.hostBrief, ...game.cartridge.hostFacts(state, { kind: "host" }).map((fact: ScopedFact) => fact.text)].join(" ");
        assert.match(brief, /The word is: Colander/);
        assert.equal(brief.includes("Spoon"), false);
        assert.equal(brief.includes("paper2"), false);
    });

    it("uses the model's word when it is one or two plain words, and the fallback otherwise", () => {
        const game: KitGame<PlantState> = leadingQuestions();
        const started: PlantState = game.cartridge.init(FOUR, {}).state;
        assert.equal(on(game, started, { type: "contentReady", at: 0, text: "teapot." }).state.word, "Teapot");
        assert.equal(on(game, started, { type: "contentReady", at: 0, text: "a very long answer from the model" }).state.word, "Colander");
        assert.equal(on(game, started, { type: "contentReady", at: 0, text: "[[correct]]" }).state.word, "Colander");
    });
});

describe("leading questions: asking", () => {
    it("counts questions in code, warns, and ends with the reveal when they run out", () => {
        const started: { game: KitGame<PlantState>; state: PlantState } = startAsking(0);
        const game: KitGame<PlantState> = started.game;
        let state: PlantState = started.state;
        let warned: number = 0;
        while (state.phase === "asking") {
            const step: Step<PlantState> = ask(game, state, "paper2", "no");
            warned += step.facts.filter((fact: ScopedFact) => fact.kind === "questions-left").length;
            state = step.state;
        }
        assert.equal(warned, 2);
        assert.equal(state.result, "questions");
        assert.equal(state.questions.used, 20);
        assert.equal(game.cartridge.outcome(state), "The word was Colander.");
        const text: string = stringsIn(game.cartridge.publicScene(state)).join(" ");
        assert.match(text, /Teacup was the Plant/);
    });

    it("ignores chat with no ruling, rulings with nothing heard, and rulings it doesn't know", () => {
        const { game, state } = startAsking(0);
        const chat: Step<PlantState> = on(game, state, { type: "speechEnded", at: 1, playerId: "paper2", text: "Who wants tea?" });
        assert.equal(chat.state.questions.used, 0);
        assert.equal(on(game, state, { type: "hostRuled", at: 2, ruling: "yes", detail: "", playerId: null }).state, state);
        assert.equal(ask(game, state, "paper2", "maybe").state.questions.used, 0);
    });

    it("ends when the clock runs out or the table gives up, and ignores a stale timer", () => {
        const { game, state } = startAsking(0);
        assert.equal(on(game, state, { type: "timerFired", at: 250, timerId: "asking" }).state.result, "clock");
        assert.equal(game.cartridge.apply(state, "paper2", PLANT_GIVE_UP_ACTION).state.result, "gaveUp");
        assert.equal(on(game, state, { type: "hostRuled", at: 3, ruling: "giveup", detail: "", playerId: null }).state.result, "gaveUp");
        const voting: PlantState = ask(game, state, "paper2", "correct").state;
        assert.equal(on(game, voting, { type: "timerFired", at: 260, timerId: "asking" }).state, voting);
        assert.equal(on(game, voting, { type: "timerFired", at: 260, timerId: "read" }).state, voting);
    });
});

describe("leading questions: the vote", () => {
    it("opens a vote when the word is found, and catches the Plant with the most votes", () => {
        const { game, state } = startAsking(2);
        const found: Step<PlantState> = ask(game, state, "paper1", "correct");
        assert.equal(found.state.phase, "vote");
        assert.deepEqual(found.timers, { vote: 45 });
        assert.equal(found.state.finderId, "paper1");
        assert.equal(stringsIn(game.cartridge.publicScene(found.state)).join(" ").includes("Colander"), true, "the word is public once found");
        const ballot: Control | undefined = game.cartridge.privateControls(found.state, "paper1")[0];
        assert.ok(ballot !== undefined && ballot.type === "choice");
        assert.deepEqual(ballot.options.map((option) => option.label), ["Spoon", "Candle", "Saucer"], "nobody votes for themselves");
        assert.equal(game.cartridge.apply(found.state, "paper1", `${VOTE_PREFIX}paper1`).state, found.state);
        const ended: Step<PlantState> = voteAll(game, found.state, { paper1: "paper3", paper2: "paper3", paper3: "paper1", paper4: "paper3" });
        assert.equal(ended.state.result, "caught");
        assert.equal(game.cartridge.outcome(ended.state), "The room caught Candle.");
        const tallyBlock: SceneBlock | undefined = game.cartridge.publicScene(ended.state).blocks.find((block: SceneBlock) => block.type === "tally");
        assert.ok(tallyBlock?.type === "tally");
        assert.deepEqual(tallyBlock.rows.find((row) => row.highlight === true), { label: "Candle", count: 3, highlight: true });
    });

    it("lets the Plant get away with a tie, or with the most votes on someone else", () => {
        const { game, state } = startAsking(2);
        const voting: PlantState = ask(game, state, "paper1", "correct").state;
        assert.equal(voteAll(game, voting, { paper1: "paper3", paper2: "paper1", paper3: "paper1", paper4: "paper3" }).state.result, "slipped");
        assert.equal(voteAll(game, voting, { paper1: "paper2", paper2: "paper1", paper3: "paper2", paper4: "paper2" }).state.result, "slipped");
    });

    it("counts what it has when the vote clock runs out, and only once", () => {
        const { game, state } = startAsking(2);
        const voting: PlantState = voteAll(game, ask(game, state, "paper1", "correct").state, { paper1: "paper3", paper2: "paper3" }).state;
        assert.equal(voting.phase, "vote");
        const ended: Step<PlantState> = on(game, voting, { type: "timerFired", at: 300, timerId: "vote" });
        assert.equal(ended.state.result, "caught");
        assert.equal(on(game, ended.state, { type: "timerFired", at: 301, timerId: "vote" }).state, ended.state);
        assert.deepEqual(game.cartridge.turn?.(voting), { kind: "everyone", playerIds: ["paper1", "paper2", "paper3", "paper4"], doneIds: ["paper1", "paper2"], label: "Vote on your phone" });
    });
});

describe("leading questions: people leaving", () => {
    it("ends the round when the Plant leaves, naming them in the reveal", () => {
        const { game, state } = startAsking(1);
        const ended: Step<PlantState> = on(game, state, { type: "playerLeft", at: 5, playerId: "paper2" });
        assert.equal(ended.state.result, "plantLeft");
        assert.match(stringsIn(game.cartridge.publicScene(ended.state)).join(" "), /Spoon was the Plant/);
    });

    it("drops someone else from the vote, and counts at once if everyone left has voted", () => {
        const { game, state } = startAsking(2);
        const voting: PlantState = voteAll(game, ask(game, state, "paper1", "correct").state, { paper1: "paper3", paper2: "paper3", paper3: "paper1" }).state;
        const ended: Step<PlantState> = on(game, voting, { type: "playerLeft", at: 9, playerId: "paper4" });
        assert.equal(ended.state.result, "caught");
        const early: PlantState = on(game, state, { type: "playerLeft", at: 9, playerId: "paper4" }).state;
        assert.equal(early.players.length, 3);
        assert.equal(early.phase, "asking");
    });
});

describe("leading questions: checks", () => {
    it("is runnable, and refuses a table under three, broken clocks and an unusable fallback word", () => {
        assert.deepEqual(blueprintProblems(LEADING_QUESTIONS_BLUEPRINT), []);
        const small: PlantBlueprint = structuredClone(LEADING_QUESTIONS_BLUEPRINT);
        small.box.minPlayers = 2;
        assert.match(blueprintProblems(small).join(" "), /at least three/);
        const clock: PlantBlueprint = structuredClone(LEADING_QUESTIONS_BLUEPRINT);
        clock.decisions.askingSeconds = Number.NaN;
        clock.decisions.voteSeconds = 5;
        assert.equal(blueprintProblems(clock).length, 2);
        const word: PlantBlueprint = structuredClone(LEADING_QUESTIONS_BLUEPRINT);
        word.decisions.categories = [{ name: "a thing", fallback: "three whole words" }];
        assert.notDeepEqual(blueprintProblems(word), []);
    });
});
