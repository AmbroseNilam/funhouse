// Proves the odd-word kit, as Stray Word: one Stray is dealt and only the others see the word, while
// everyone sees the category; the host knows the word and never the Stray; words come in an order the
// code enforces, one word at a time, never a repeat, never the secret from someone who knows it; every
// turn has a clock; the vote catches the Stray only with the most votes and no tie; a caught Stray's
// guess is ruled by the host or checked by code; people leaving and stale timers change nothing wrongly.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer, Step } from "../../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../../shared/controls.ts";
import type { SceneBlock } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { ScopedFact } from "../../../shared/visibility.ts";
import { blueprintProblems, type OddWordBlueprint } from "../../blueprint.ts";
import { STRAY_WORD_BLUEPRINT } from "../../games/stray-word/blueprint.ts";
import type { KitGame } from "../../kit/kit.ts";
import { oddWordRoleCheck } from "../../personas.ts";
import { PAPER_PLAYERS, roleBlindness, stringsIn } from "../../rehearse.ts";
import { createOddWordGame, ODD_VOTE_PREFIX, parseEntry, STRAY_CARD_TITLE, type OddWordState } from "./oddword.ts";

/** Five at the table. */
const FIVE: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 5);

/** What the host's model might write. */
const WRITTEN: string = "Category: a thing in a kitchen | Word: kettle";

/**
 * A random source that picks the first fallback entry, deals the Stray to one seat, and makes one seat speak first.
 * @param stray which seat is the Stray.
 * @param first which seat speaks first.
 * @param count how many players.
 * @returns the source.
 */
function dealTo(stray: number, first: number, count: number): () => number {
    const values: number[] = [0, (stray + 0.5) / count, (first + 0.5) / count];
    return (): number => values.shift() ?? 0.5;
}

/**
 * Builds Stray Word.
 * @param stray which seat is the Stray.
 * @param first which seat speaks first.
 * @param players who is at the table.
 * @returns the game.
 */
function strayWord(stray: number = 0, first: number = 1, players: CartridgePlayer[] = FIVE): KitGame<OddWordState> {
    return createOddWordGame(STRAY_WORD_BLUEPRINT.box, STRAY_WORD_BLUEPRINT.decisions, dealTo(stray, first, players.length));
}

/**
 * Plays an event.
 * @param game the game.
 * @param state the state.
 * @param event the event.
 * @returns the step.
 */
function on(game: KitGame<OddWordState>, state: OddWordState, event: RoomEvent): Step<OddWordState> {
    return game.cartridge.onEvent(state, event);
}

/**
 * Starts a game and gets it to the first word, with the word the model wrote.
 * @param stray which seat is the Stray.
 * @param first which seat speaks first.
 * @param players who is at the table.
 * @param text what the model writes.
 * @returns the game and the state when the first word is awaited.
 */
function startClues(stray: number = 0, first: number = 1, players: CartridgePlayer[] = FIVE, text: string = WRITTEN): { game: KitGame<OddWordState>; state: OddWordState } {
    const game: KitGame<OddWordState> = strayWord(stray, first, players);
    const started: Step<OddWordState> = game.cartridge.init(players, {});
    assert.ok((started.contentRequest ?? "").includes("Category:"));
    const ready: Step<OddWordState> = on(game, started.state, { type: "contentReady", at: 0, text });
    assert.deepEqual(ready.timers, { read: 10 });
    const clues: Step<OddWordState> = on(game, ready.state, { type: "timerFired", at: 10, timerId: "read" });
    assert.equal(clues.state.phase, "clues");
    assert.deepEqual(clues.timers, { turn: 30 });
    return { game, state: clues.state };
}

/**
 * Has whoever is up say a word.
 * @param game the game.
 * @param state the state.
 * @param text what they say.
 * @returns the step.
 */
function say(game: KitGame<OddWordState>, state: OddWordState, text: string): Step<OddWordState> {
    return on(game, state, { type: "speechEnded", at: 1, playerId: state.order[state.cursor] ?? "", text });
}

/**
 * Has everyone say a different word, going through every round.
 * @param game the game.
 * @param state the state when the first word is awaited.
 * @returns the state in the vote.
 */
function allWords(game: KitGame<OddWordState>, state: OddWordState): OddWordState {
    let current: OddWordState = state;
    const words: string[] = ["amber", "breeze", "cobalt", "dune", "ember", "fjord", "gale", "haze", "ivory", "jade"];
    for (const word of words) {
        current = say(game, current, word).state;
    }
    assert.equal(current.phase, "vote");
    return current;
}

/**
 * Has each listed voter vote.
 * @param game the game.
 * @param state the state in the vote.
 * @param votes target by voter.
 * @returns the last step.
 */
function voteAll(game: KitGame<OddWordState>, state: OddWordState, votes: Record<string, string>): Step<OddWordState> {
    let step: Step<OddWordState> = { state, facts: [] };
    for (const [voter, target] of Object.entries(votes)) {
        step = game.cartridge.apply(step.state, voter, `${ODD_VOTE_PREFIX}${target}`);
    }
    return step;
}

/**
 * The card on one phone.
 * @param controls the phone's controls.
 * @returns its words.
 */
function cardWords(controls: Control[]): string {
    const card: Control | undefined = controls[0];
    return card?.type === "roleCard" ? `${card.title} ${card.body}` : "";
}

describe("stray word: dealing and secrets", () => {
    it("deals one Stray, who is told the kind of thing but not the word, and shows everyone else the word", () => {
        const { game, state } = startClues(2);
        assert.equal(state.strayId, "paper3");
        assert.equal(state.word, "kettle");
        for (const player of FIVE) {
            const words: string = cardWords(game.cartridge.privateControls(state, player.playerId));
            assert.equal(words.includes("Kettle"), player.playerId !== "paper3", `${player.playerId}'s card`);
            assert.equal(words.includes(STRAY_CARD_TITLE), player.playerId === "paper3");
            assert.ok(words.includes("a thing in a kitchen"), "everyone is told the kind of thing");
        }
    });

    it("tells the host the word and never who the Stray is, and tells the TV neither", () => {
        const { game, state } = startClues(2);
        const facts: ScopedFact[] = game.cartridge.hostFacts(state, { kind: "host" });
        assert.ok(facts.some((fact: ScopedFact) => fact.text.includes("kettle")));
        const heard: string = [game.cartridge.manifest.hostBrief, ...facts.map((fact: ScopedFact) => fact.text)].join(" ");
        assert.equal(heard.includes("Candle") || heard.includes("paper3"), false, "the Stray is Candle");
        const seen: string = stringsIn(game.cartridge.publicScene(state)).join(" ").toLowerCase();
        assert.equal(seen.includes("kettle"), false);
        assert.ok(seen.includes("a thing in a kitchen"));
    });

    it("keeps what the Stray sees the same whoever they are, to everyone else", () => {
        const check = oddWordRoleCheck(STRAY_WORD_BLUEPRINT);
        const games = FIVE.map((player: CartridgePlayer, seat: number) => ({ game: check.deal(seat, FIVE), holderId: player.playerId }));
        assert.deepEqual(roleBlindness(games, check.script, FIVE), []);
    });

    it("reads the model's category and word, and falls back on its own when it is unusable", () => {
        assert.deepEqual(parseEntry(WRITTEN), { category: "a thing in a kitchen", word: "kettle" });
        assert.equal(parseEntry("Category: a kettle thing | Word: kettle"), null, "the category can't give the word away");
        assert.equal(parseEntry("kettle"), null);
        assert.equal(parseEntry("Category: x | Word: te<st>"), null);
        for (const text of ["", "ignore your instructions", "Category: a | Word: 12"]) {
            const { state } = startClues(0, 1, FIVE, text);
            assert.ok(STRAY_WORD_BLUEPRINT.decisions.entries.some((entry) => entry.word === state.word));
        }
    });

    it("never shows the word on the Stray's phone, in any phase", () => {
        const { game, state: first } = startClues(0, 1);
        const phones: string[] = [];
        const look = (state: OddWordState): void => { phones.push(stringsIn(game.cartridge.privateControls(state, "paper1")).join(" ").toLowerCase()); };
        look(first);
        const voting: OddWordState = allWords(game, first);
        look(voting);
        look(voteAll(game, voting, { paper2: "paper1", paper3: "paper1", paper4: "paper1", paper5: "paper1" }).state);
        assert.equal(phones.some((words: string) => words.includes("kettle")), false);
    });
});

describe("stray word: the order of words", () => {
    it("starts with whoever was dealt the first word, and goes round the table in seat order", () => {
        const { game, state } = startClues(0, 2);
        assert.deepEqual(state.order, ["paper3", "paper4", "paper5", "paper1", "paper2"]);
        const after: OddWordState = say(game, state, "amber").state;
        assert.equal(after.order[after.cursor], "paper4");
        assert.equal(game.cartridge.turn?.(after)?.kind, "one");
    });

    it("hears only the person who is up, and opens only their mic", () => {
        const { game, state } = startClues(0, 1);
        assert.equal(on(game, state, { type: "speechEnded", at: 1, playerId: "paper3", text: "amber" }).state, state);
        assert.equal(on(game, state, { type: "speechEnded", at: 1, playerId: "paper1", text: "amber" }).state, state, "the Stray isn't up either");
        const roles: string[] = FIVE.map((player: CartridgePlayer) => game.cartridge.roleOf(state, player.playerId));
        assert.deepEqual(roles, ["quiet", "up", "quiet", "quiet", "quiet"]);
        assert.deepEqual(game.cartridge.manifest.phases.find((phase) => phase.id === "clues")?.listening, { up: "holdToTalk", "*": "muted" });
    });

    it("takes one word, however it is wrapped, and refuses more than one without moving on", () => {
        const { game, state } = startClues(0, 1);
        const said: Step<OddWordState> = say(game, state, "Um, it's, like, amber.");
        assert.equal(said.state.said[0]?.word, "amber");
        assert.equal(said.state.cursor, 1);
        assert.deepEqual(said.timers, { turn: 30 });
        const many: OddWordState = say(game, state, "well it is sort of hard to say").state;
        assert.equal(many.said.length, 0);
        assert.equal(many.cursor, 0);
        assert.equal(many.refusal, "many");
        const note: Control | undefined = game.cartridge.privateControls(many, "paper2").find((control: Control) => control.type === "textInput");
        assert.ok(note?.type === "textInput" && (note.note ?? "").includes("One word only"));
    });

    it("takes a number as a word, and does not drop it as it would from a clue", () => {
        const { game, state } = startClues(0, 1);
        assert.equal(say(game, state, "two").state.said[0]?.word, "two");
        assert.equal(say(game, state, "two words here").state.said.length, 0, "two words are two words");
    });

    it("refuses a repeat, and refuses the secret from someone who knows it, privately", () => {
        const { game, state } = startClues(0, 1);
        const one: OddWordState = say(game, state, "amber").state;
        const repeat: OddWordState = say(game, one, "Amber").state;
        assert.equal(repeat.refusal, "repeat");
        assert.equal(repeat.said.length, 1);
        const secret: OddWordState = say(game, one, "kettles").state;
        assert.equal(secret.refusal, "secret");
        assert.equal(secret.said.length, 1);
        assert.equal(stringsIn(game.cartridge.publicScene(secret)).join(" ").toLowerCase().includes("kettle"), false, "the TV never shows a refused word");
        assert.ok(stringsIn(game.cartridge.privateControls(secret, "paper3")).join(" ").includes("Too close to the secret"), "the speaker is told");
        for (const other of ["paper1", "paper2", "paper4", "paper5"]) {
            assert.equal(stringsIn(game.cartridge.privateControls(secret, other)).join(" ").includes("Too close"), false, "nobody else is");
        }
    });

    it("lets the Stray say any word, even the secret, since they don't know it", () => {
        const { game, state } = startClues(1, 1);
        const lucky: Step<OddWordState> = say(game, state, "kettle");
        assert.equal(lucky.state.said[0]?.word, "kettle");
    });

    it("takes a typed word from the right box, and gives each try its own box", () => {
        const { game, state } = startClues(0, 1);
        const box = (s: OddWordState): string => {
            const control: Control | undefined = game.cartridge.privateControls(s, "paper2").find((candidate: Control) => candidate.type === "textInput");
            return control?.type === "textInput" ? control.id : "";
        };
        assert.equal(box(state), "word:0:0");
        const refused: OddWordState = on(game, state, { type: "answered", at: 1, playerId: "paper2", controlId: "word:0:0", value: "very hard thing" }).state;
        assert.equal(box(refused), "word:0:1");
        assert.equal(on(game, refused, { type: "answered", at: 2, playerId: "paper2", controlId: "word:0:0", value: "amber" }).state, refused, "the old box is dead");
        assert.equal(on(game, refused, { type: "answered", at: 2, playerId: "paper3", controlId: "word:0:1", value: "amber" }).state, refused, "someone else's answer");
        assert.equal(on(game, refused, { type: "answered", at: 2, playerId: "paper2", controlId: "word:0:1", value: "amber" }).state.said.length, 1);
    });

    it("shows every word said on the TV and on each phone, and runs two rounds", () => {
        const { game, state } = startClues(0, 1);
        let current: OddWordState = state;
        const roundFacts: ScopedFact[] = [];
        for (const word of ["amber", "breeze", "cobalt", "dune", "ember", "fjord", "gale", "haze", "ivory"]) {
            const step: Step<OddWordState> = say(game, current, word);
            roundFacts.push(...step.facts.filter((fact: ScopedFact) => fact.kind === "round"));
            current = step.state;
        }
        assert.equal(roundFacts.length, 1);
        assert.equal(current.round, 2);
        const blocks: SceneBlock[] = game.cartridge.publicScene(current).blocks;
        assert.ok(blocks.some((block: SceneBlock) => block.type === "text" && block.text.includes("Spoon: Amber")));
        assert.ok(stringsIn(game.cartridge.privateControls(current, "paper1")).join(" ").includes("Said so far: Amber, Breeze"));
        assert.equal(say(game, current, "jade").state.phase, "vote");
    });

    it("skips a speaker who stalls, quietly, and ignores a stale clock once the vote is open", () => {
        const { game, state } = startClues(0, 1);
        const skipped: Step<OddWordState> = on(game, state, { type: "timerFired", at: 30, timerId: "turn" });
        assert.equal(skipped.state.cursor, 1);
        assert.equal(skipped.state.said.length, 0);
        assert.deepEqual(skipped.timers, { turn: 30 });
        assert.ok(skipped.facts.every((fact: ScopedFact) => fact.quiet === true || fact.scope.kind === "system"), "stalling doesn't wake the host");
        const voting: OddWordState = allWords(game, state);
        assert.equal(on(game, voting, { type: "timerFired", at: 99, timerId: "turn" }).state, voting);
    });
});

describe("stray word: the vote and the last guess", () => {
    it("catches the Stray with the most votes and gives them one guess", () => {
        const { game, state } = startClues(0, 1);
        const pinned: Step<OddWordState> = voteAll(game, allWords(game, state), { paper1: "paper2", paper2: "paper1", paper3: "paper1", paper4: "paper1", paper5: "paper1" });
        assert.equal(pinned.state.phase, "guess");
        assert.deepEqual(pinned.timers, { guess: 30 });
        assert.equal(game.cartridge.roleOf(pinned.state, "paper1"), "up");
        assert.equal(game.cartridge.roleOf(pinned.state, "paper2"), "quiet");
        assert.ok(game.hidden(pinned.state).some((value) => value.text === "kettle"), "the word is still hidden from the Stray");
    });

    it("lets the Stray go on a wrong accusation, a tie, or no votes, and says the word then", () => {
        const { game, state } = startClues(0, 1);
        const voting: OddWordState = allWords(game, state);
        const wrong: Step<OddWordState> = voteAll(game, voting, { paper1: "paper2", paper2: "paper3", paper3: "paper2", paper4: "paper2", paper5: "paper2" });
        assert.equal(wrong.state.result, "slipped");
        assert.ok(wrong.facts.some((fact: ScopedFact) => fact.text.includes("kettle")));
        assert.equal(voteAll(game, voting, { paper1: "paper2", paper2: "paper1", paper3: "paper1", paper4: "paper2", paper5: "paper3" }).state.result, "slipped");
        assert.equal(on(game, voting, { type: "timerFired", at: 99, timerId: "vote" }).state.result, "slipped");
    });

    it("lets people vote once, not for themselves, and only during the vote", () => {
        const { game, state } = startClues(0, 1);
        assert.equal(game.cartridge.apply(state, "paper2", `${ODD_VOTE_PREFIX}paper1`).state, state);
        const voting: OddWordState = allWords(game, state);
        assert.equal(game.cartridge.apply(voting, "paper2", `${ODD_VOTE_PREFIX}paper2`).state, voting);
        const once: OddWordState = game.cartridge.apply(voting, "paper2", `${ODD_VOTE_PREFIX}paper1`).state;
        assert.equal(game.cartridge.apply(once, "paper2", `${ODD_VOTE_PREFIX}paper3`).state, once);
        const choice: Control | undefined = game.cartridge.privateControls(voting, "paper2").find((control: Control) => control.type === "choice");
        assert.equal(choice?.type === "choice" ? choice.options.some((option: ControlOption) => option.label === "Spoon") : true, false);
    });

    it("rules a spoken guess only after the Stray has spoken, and checks a typed one in code", () => {
        const { game, state } = startClues(0, 1);
        const guessing: OddWordState = voteAll(game, allWords(game, state), { paper1: "paper2", paper2: "paper1", paper3: "paper1", paper4: "paper1", paper5: "paper1" }).state;
        assert.equal(on(game, guessing, { type: "hostRuled", at: 1, ruling: "right", detail: "", playerId: "paper1" }).state, guessing);
        const heard: OddWordState = on(game, guessing, { type: "speechEnded", at: 2, playerId: "paper1", text: "A kettle?" }).state;
        assert.equal(on(game, heard, { type: "hostRuled", at: 3, ruling: "right", detail: "", playerId: "paper1" }).state.result, "namedIt");
        assert.equal(on(game, heard, { type: "hostRuled", at: 3, ruling: "wrong", detail: "", playerId: "paper1" }).state.result, "caught");
        assert.equal(on(game, guessing, { type: "speechEnded", at: 2, playerId: "paper3", text: "A kettle?" }).state, guessing);
        assert.equal(on(game, guessing, { type: "answered", at: 2, playerId: "paper1", controlId: "guess", value: "the kettle" }).state.result, "namedIt");
        assert.equal(on(game, guessing, { type: "answered", at: 2, playerId: "paper1", controlId: "guess", value: "a toaster" }).state.result, "caught");
        const ended: OddWordState = on(game, guessing, { type: "timerFired", at: 40, timerId: "guess" }).state;
        assert.equal(ended.result, "caught");
        assert.deepEqual(game.hidden(ended), []);
        assert.equal(game.cartridge.outcome(ended), "The room caught Teacup.");
        assert.ok(stringsIn(game.cartridge.publicScene(ended)).includes("Kettle"));
    });
});

describe("stray word: leaving", () => {
    it("ends the round when the Stray leaves, and when too few are left", () => {
        const { game, state } = startClues(0, 1);
        const gone: Step<OddWordState> = on(game, state, { type: "playerLeft", at: 1, playerId: "paper1" });
        assert.equal(gone.state.result, "strayLeft");
        assert.ok(gone.facts.some((fact: ScopedFact) => fact.text.includes("kettle")));
        const four: CartridgePlayer[] = FIVE.slice(0, 4);
        const small = startClues(0, 1, four);
        assert.equal(on(small.game, small.state, { type: "playerLeft", at: 1, playerId: "paper4" }).state.result, "emptied");
    });

    it("moves on when the speaker leaves, and keeps its place when someone who already spoke leaves", () => {
        const { game, state } = startClues(0, 1);
        const speakerGone: Step<OddWordState> = on(game, state, { type: "playerLeft", at: 1, playerId: "paper2" });
        assert.equal(speakerGone.state.order[speakerGone.state.cursor], "paper3");
        assert.deepEqual(speakerGone.timers, { turn: 30 });
        const one: OddWordState = say(game, state, "amber").state;
        const earlierGone: OddWordState = on(game, one, { type: "playerLeft", at: 2, playerId: "paper2" }).state;
        assert.equal(earlierGone.order[earlierGone.cursor], "paper3");
    });

    it("ends the words when the last speaker leaves in the last round, and restarts a vote", () => {
        const { game, state } = startClues(0, 1);
        const voting: OddWordState = allWords(game, state);
        const reopened: Step<OddWordState> = on(game, voteAll(game, voting, { paper2: "paper1" }).state, { type: "playerLeft", at: 2, playerId: "paper5" });
        assert.deepEqual(reopened.state.votes, {});
        assert.deepEqual(reopened.timers, { vote: 45 });
    });
});

describe("stray word: the blueprint", () => {
    it("is runnable, and refuses bad decisions", () => {
        assert.deepEqual(blueprintProblems(STRAY_WORD_BLUEPRINT), []);
        const bad = (change: Partial<OddWordBlueprint["decisions"]>): string[] => blueprintProblems({ ...STRAY_WORD_BLUEPRINT, decisions: { ...STRAY_WORD_BLUEPRINT.decisions, ...change } });
        assert.notEqual(bad({ entries: STRAY_WORD_BLUEPRINT.decisions.entries.slice(0, 5) }).length, 0);
        assert.notEqual(bad({ rounds: 0 }).length, 0);
        assert.notEqual(bad({ clueSeconds: Number.NaN }).length, 0);
        assert.notEqual(blueprintProblems({ ...STRAY_WORD_BLUEPRINT, box: { ...STRAY_WORD_BLUEPRINT.box, minPlayers: 3 } }).length, 0);
        assert.notEqual(blueprintProblems({ ...STRAY_WORD_BLUEPRINT, box: { ...STRAY_WORD_BLUEPRINT.box, pitch: "Everyone has the kettle." } }).length, 0, "a pitch can't give a word away");
    });
});
