// Proves the hand kit, as Blank Verdict: hands are dealt to the right phone and no other, the tone
// filters the deck, the judge rotates, plays are shuffled and anonymous until the reveal, the pick
// is gated while the host reads, scores are kept in code, clocks and people leaving end things
// cleanly, every card passes the room's language filter, and the leak check really catches a hand
// shown to the wrong phone. Also the kit's checks.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer, Step } from "../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../shared/controls.ts";
import { localCategory } from "../../room/content-filter.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { ScopedFact } from "../../shared/visibility.ts";
import { blueprintProblems, type HandBlueprint } from "../blueprint.ts";
import { checkBlueprint } from "../check.ts";
import { BLANK_VERDICT_BLUEPRINT } from "../games/blank-verdict.ts";
import type { KitGame } from "../kit/kit.ts";
import { seededRandom } from "../kit/primitives.ts";
import { handPersonas } from "../personas.ts";
import { PAPER_PLAYERS, rehearse, stringsIn } from "../rehearse.ts";
import { BEAT_SECONDS, createHandGame, GAP, PICK_PREFIX, PLAY_PREFIX, TONE_PREFIX, type AnswerCard, type HandState, type Play, type PromptCard } from "./hand.ts";

/** Four at the table. */
const FOUR: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);

/** Five at the table. */
const FIVE: CartridgePlayer[] = [...PAPER_PLAYERS];

/**
 * Builds Blank Verdict.
 * @param seed the random seed.
 * @param blueprint the blueprint; Blank Verdict unless given.
 * @returns the game.
 */
function blankVerdict(seed: number = 1, blueprint: HandBlueprint = BLANK_VERDICT_BLUEPRINT): KitGame<HandState> {
    return createHandGame(blueprint.box, blueprint.decisions, seededRandom(seed));
}

/**
 * Plays an event.
 * @param game the game.
 * @param state the state.
 * @param event the event.
 * @returns the step.
 */
function on(game: KitGame<HandState>, state: HandState, event: RoomEvent): Step<HandState> {
    return game.cartridge.onEvent(state, event);
}

/**
 * Fires a timer.
 * @param game the game.
 * @param state the state.
 * @param timerId the timer.
 * @returns the step.
 */
function fire(game: KitGame<HandState>, state: HandState, timerId: string): Step<HandState> {
    return on(game, state, { type: "timerFired", at: 0, timerId });
}

/**
 * Starts a game and has the first player choose a tone, which starts round one.
 * @param tone the tone.
 * @param players who is at the table.
 * @param seed the random seed.
 * @returns the game and the state in the first round's playing phase.
 */
function started(tone: "family" | "party" = "family", players: CartridgePlayer[] = FIVE, seed: number = 1): { game: KitGame<HandState>; state: HandState } {
    const game: KitGame<HandState> = blankVerdict(seed);
    const first: HandState = game.cartridge.init(players, {}).state;
    return { game, state: game.cartridge.apply(first, first.chooserId, `${TONE_PREFIX}${tone}`).state };
}

/**
 * Has every player but the judge play their first card.
 * @param game the game.
 * @param state a state in playing.
 * @param only limits who plays, or everyone.
 * @returns the step after the last play.
 */
function playAll(game: KitGame<HandState>, state: HandState, only: number = 99): Step<HandState> {
    let step: Step<HandState> = { state, facts: [] };
    for (const player of state.players.filter((candidate: CartridgePlayer) => candidate.playerId !== state.judgeId).slice(0, only)) {
        const action: string = game.cartridge.legalActions(step.state, player.playerId)[0]?.actionId ?? "";
        step = game.cartridge.apply(step.state, player.playerId, action);
    }
    return step;
}

/**
 * The texts on a phone's option buttons.
 * @param controls a phone's controls.
 * @returns the labels.
 */
function labels(controls: Control[]): string[] {
    return controls.flatMap((control: Control) => (control.type === "choice" || control.type === "buttons" ? control.options.map((option: ControlOption) => option.label) : []));
}

/**
 * Plays whole rounds: everyone plays, the judge waits out the reading and picks the first play.
 * @param game the game.
 * @param start the first state in playing.
 * @returns every state at the start of a round, and the final one.
 */
function playGame(game: KitGame<HandState>, start: HandState): { rounds: HandState[]; last: HandState } {
    const rounds: HandState[] = [];
    let state: HandState = start;
    while (state.phase !== "end") {
        rounds.push(state);
        state = playAll(game, state).state;
        state = fire(game, state, "read").state;
        state = game.cartridge.apply(state, state.judgeId, `${PICK_PREFIX}0`).state;
        state = fire(game, state, "beat").state;
        state = fire(game, state, "reveal").state;
    }
    return { rounds, last: state };
}

describe("the cards", () => {
    const decisions = BLANK_VERDICT_BLUEPRINT.decisions;
    it("number at least 120 answers and 30 prompts, in two tones", () => {
        assert.ok(decisions.answers.length >= 120);
        assert.ok(decisions.prompts.length >= 30);
        assert.ok(decisions.answers.filter((card: AnswerCard) => card.tone === "family").length >= 100);
        assert.ok(decisions.answers.filter((card: AnswerCard) => card.tone === "party").length >= 20);
        assert.ok(decisions.prompts.filter((card: PromptCard) => card.tone === "family").length >= 24);
    });
    it("all pass the room's language filter, alone and in every sentence a prompt makes", () => {
        const texts: string[] = [...decisions.answers.map((card: AnswerCard) => card.text), ...decisions.prompts.map((card: PromptCard) => card.text)];
        assert.deepEqual(texts.filter((text: string) => localCategory(text) !== null), []);
        const sentences: string[] = decisions.prompts.flatMap((prompt: PromptCard) => decisions.answers.map((answer: AnswerCard) => prompt.text.split(GAP).join(answer.text)));
        assert.deepEqual(sentences.filter((text: string) => localCategory(text) !== null), []);
    });
    it("are unique, and none sits inside another", () => {
        const texts: string[] = decisions.answers.map((card: AnswerCard) => card.text.toLowerCase());
        assert.equal(new Set(texts).size, texts.length);
        assert.deepEqual(blueprintProblems(BLANK_VERDICT_BLUEPRINT), []);
    });
    it("every prompt has exactly one gap and the host can say it", () => {
        for (const prompt of decisions.prompts) {
            assert.equal(prompt.text.split(GAP).length, 2, prompt.text);
        }
    });
});

describe("dealing", () => {
    it("deals every player a full hand of different cards, and none of them twice", () => {
        const { state } = started("family");
        const all: string[] = Object.values(state.hands).flat();
        assert.equal(all.length, FIVE.length * BLANK_VERDICT_BLUEPRINT.decisions.handSize);
        assert.equal(new Set(all).size, all.length);
        assert.equal(state.phase, "playing");
    });
    it("keeps party cards out of a family room, and lets a party room have them", () => {
        const party = (cardId: string): boolean => BLANK_VERDICT_BLUEPRINT.decisions.answers.find((card: AnswerCard) => card.id === cardId)?.tone === "party";
        let sawParty: boolean = false;
        for (let seed = 1; seed <= 20; seed += 1) {
            const family = started("family", FIVE, seed);
            assert.equal([...Object.values(family.state.hands).flat(), ...family.state.drawPile].some(party), false);
            sawParty = sawParty || Object.values(started("party", FIVE, seed).state.hands).flat().some(party);
        }
        assert.equal(sawParty, true);
        assert.equal(started("family").state.prompt?.tone, "family");
    });
    it("is the same game from the same seed, and not changed by editing the blueprint afterwards", () => {
        const first = started("party", FIVE, 7).state;
        assert.deepEqual(started("party", FIVE, 7).state, first);
        const edited: HandBlueprint = structuredClone(BLANK_VERDICT_BLUEPRINT);
        const game: KitGame<HandState> = blankVerdict(7, edited);
        edited.decisions.answers.length = 0;
        edited.decisions.handSize = 1;
        const state: HandState = game.cartridge.init(FIVE, {}).state;
        assert.equal(game.cartridge.apply(state, state.chooserId, `${TONE_PREFIX}party`).state.hands[FIVE[0]?.playerId ?? ""]?.length, BLANK_VERDICT_BLUEPRINT.decisions.handSize);
    });
});

describe("the tone", () => {
    it("is the first player's to choose, and nobody else's", () => {
        const game: KitGame<HandState> = blankVerdict();
        const state: HandState = game.cartridge.init(FIVE, {}).state;
        assert.equal(game.cartridge.legalActions(state, state.chooserId).length, 2);
        assert.equal(game.cartridge.legalActions(state, "paper2").length, 0);
        assert.equal(game.cartridge.apply(state, "paper2", `${TONE_PREFIX}party`).state, state);
        assert.deepEqual(game.cartridge.turn?.(state), { kind: "one", playerId: "paper1", label: "Choosing the tone:" });
    });
    it("falls back to family when the clock runs out", () => {
        const game: KitGame<HandState> = blankVerdict();
        const state: HandState = fire(game, game.cartridge.init(FIVE, {}).state, "tone").state;
        assert.equal(state.tone, "family");
        assert.equal(state.phase, "playing");
    });
    it("passes to the next player if the chooser leaves", () => {
        const game: KitGame<HandState> = blankVerdict();
        const state: HandState = game.cartridge.init(FIVE, {}).state;
        const after: HandState = on(game, state, { type: "playerLeft", at: 0, playerId: "paper1" }).state;
        assert.equal(after.chooserId, "paper2");
        assert.equal(game.cartridge.legalActions(after, "paper2").length, 2);
    });
});

describe("a round", () => {
    it("shows each player only their own hand, on their own phone", () => {
        const { game, state } = started("party");
        for (const player of FIVE) {
            if (player.playerId === state.judgeId) {
                continue;
            }
            const own: string[] = labels(game.cartridge.privateControls(state, player.playerId));
            assert.equal(own.length, BLANK_VERDICT_BLUEPRINT.decisions.handSize);
            for (const other of FIVE.filter((candidate: CartridgePlayer) => candidate.playerId !== player.playerId)) {
                const theirs: string[] = labels(game.cartridge.privateControls(state, other.playerId));
                assert.deepEqual(own.filter((label: string) => theirs.includes(label) === true), []);
            }
        }
        const everyoneElse: string[] = [...stringsIn(game.cartridge.publicScene(state)), ...stringsIn(game.cartridge.hostFacts(state, { kind: "host" })), game.cartridge.manifest.hostBrief];
        const hand: string[] = Object.values(state.hands).flat().map((id: string) => BLANK_VERDICT_BLUEPRINT.decisions.answers.find((card: AnswerCard) => card.id === id)?.text ?? "");
        assert.deepEqual(hand.filter((text: string) => everyoneElse.some((line: string) => line.includes(text) === true)), []);
    });
    it("lets the judge see nothing to play, and refuses a card from a hand that isn't theirs", () => {
        const { game, state } = started();
        assert.deepEqual(game.cartridge.legalActions(state, state.judgeId), []);
        const other: string = FIVE.find((player: CartridgePlayer) => player.playerId !== state.judgeId && player.playerId !== "paper2")?.playerId ?? "";
        const stolen: string = state.hands[other]?.[0] ?? "";
        const step: Step<HandState> = game.cartridge.apply(state, "paper2", `${PLAY_PREFIX}${stolen}`);
        assert.equal(step.state, state);
        assert.equal(game.cartridge.apply(state, state.judgeId, `${PLAY_PREFIX}${stolen}`).state, state);
    });
    it("plays a card once per player, and moves on when everyone has played", () => {
        const { game, state } = started();
        const player: string = FIVE.find((candidate: CartridgePlayer) => candidate.playerId !== state.judgeId)?.playerId ?? "";
        const action: string = game.cartridge.legalActions(state, player)[0]?.actionId ?? "";
        const once: HandState = game.cartridge.apply(state, player, action).state;
        assert.equal(once.plays.length, 1);
        assert.deepEqual(game.cartridge.legalActions(once, player), []);
        assert.equal(game.cartridge.apply(once, player, action).state, once);
        assert.equal(once.phase, "playing");
        const all: HandState = playAll(game, state).state;
        assert.equal(all.phase, "judging");
        assert.equal(all.plays.length, FIVE.length - 1);
    });
    it("keeps the judge from choosing while the host reads, then lets them", () => {
        const { game, state } = started();
        const judging: HandState = playAll(game, state).state;
        assert.deepEqual(game.cartridge.legalActions(judging, judging.judgeId), []);
        assert.equal(game.cartridge.apply(judging, judging.judgeId, `${PICK_PREFIX}0`).state, judging);
        const options: ControlOption[] = (game.cartridge.privateControls(judging, judging.judgeId)[0] as Extract<Control, { type: "choice" }>).options;
        assert.equal(options.every((option: ControlOption) => option.disabled === true), true);
        const ready: HandState = fire(game, judging, "read").state;
        assert.equal(game.cartridge.legalActions(ready, ready.judgeId).length, FIVE.length - 1);
    });
    it("keeps the pick secret through the beat, then reveals it with the right winner and score", () => {
        const { game, state } = started();
        const ready: HandState = fire(game, playAll(game, state).state, "read").state;
        const chosen: Step<HandState> = game.cartridge.apply(ready, ready.judgeId, `${PICK_PREFIX}2`);
        const winner: Play | undefined = ready.plays[2];
        assert.equal(chosen.state.phase, "reveal");
        assert.equal(chosen.state.revealed, false);
        assert.deepEqual(chosen.state.scores, ready.scores);
        assert.deepEqual(chosen.facts.map((fact: ScopedFact) => fact.text).filter((text: string) => text.includes(winner?.name ?? "?") === true), []);
        const scene: string = JSON.stringify(game.cartridge.publicScene(chosen.state));
        assert.equal(scene.includes("takes the round"), false);
        assert.equal(JSON.stringify(game.cartridge.publicScene(chosen.state)).includes("highlight"), false);
        assert.deepEqual(chosen.timers, { beat: BEAT_SECONDS });
        const shown: Step<HandState> = fire(game, chosen.state, "beat");
        assert.equal(shown.state.scores[winner?.playerId ?? ""], 1);
        assert.equal(Object.values(shown.state.scores).reduce((sum: number, score: number) => sum + score, 0), 1);
        assert.match(shown.facts.map((fact: ScopedFact) => fact.text).join(" "), new RegExp(`played by ${winner?.name ?? "?"}`));
        assert.match(JSON.stringify(game.cartridge.publicScene(shown.state)), /takes the round/);
    });
    it("shuffles the plays, so the order tells nothing about who played what", () => {
        let firstIsSeatOne: number = 0;
        for (let seed = 1; seed <= 60; seed += 1) {
            const { game, state } = started("family", FIVE, seed);
            const judging: HandState = playAll(game, state).state;
            const seatOrder: string[] = FIVE.map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== state.judgeId);
            if (judging.plays[0]?.playerId === seatOrder[0]) {
                firstIsSeatOne += 1;
            }
        }
        assert.ok(firstIsSeatOne > 5 && firstIsSeatOne < 25, `the first seat's play led ${firstIsSeatOne} times in 60`);
    });
    it("shows the same screen, host and judge whoever played which card", () => {
        const { game, state } = started("party", FOUR, 3);
        const players: string[] = FOUR.map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== state.judgeId);
        const [first, second, third] = players;
        const cardOf = (id: string | undefined): string => state.hands[id ?? ""]?.[0] ?? "";
        const run = (order: [string | undefined, string | undefined, string | undefined]): HandState => {
            let step: Step<HandState> = { state, facts: [] };
            for (const id of order) {
                step = game.cartridge.apply(step.state, id ?? "", `${PLAY_PREFIX}${cardOf(id)}`);
            }
            return step.state;
        };
        const straight: HandState = run([first, second, third]);
        const swapped: HandState = run([third, first, second]);
        assert.equal(straight.phase, "judging");
        const sorted = (judging: HandState): string[] => game.cartridge.publicScene(judging).blocks.map((block) => JSON.stringify(block).replace(/"\d+\. /, '"')).sort();
        assert.deepEqual(sorted(straight), sorted(swapped));
        const judgeSees = (judging: HandState): string[] => labels(game.cartridge.privateControls(judging, state.judgeId)).map((label: string) => label.replace(/^\d+\. /, "")).sort();
        assert.deepEqual(judgeSees(straight), judgeSees(swapped));
        const names: CartridgePlayer[] = FOUR.filter((player: CartridgePlayer) => player.playerId !== state.judgeId);
        assert.equal(stringsIn(game.cartridge.publicScene(straight)).some((line: string) => names.some((player: CartridgePlayer) => line.includes(player.name))), false);
    });
});

describe("the whole game", () => {
    it("makes every player judge once at a table of five, and then ends with the scores in code", () => {
        const { game, state } = started("party", FIVE);
        const { rounds, last } = playGame(game, state);
        assert.equal(rounds.length, 5);
        assert.deepEqual(rounds.map((round: HandState) => round.judgeId).sort(), FIVE.map((player: CartridgePlayer) => player.playerId).sort());
        assert.equal(Object.values(last.scores).reduce((sum: number, score: number) => sum + score, 0), 5);
        assert.match(game.cartridge.outcome(last) ?? "", /point/);
    });
    it("goes round the judges twice at a table of three or four", () => {
        const three = started("family", PAPER_PLAYERS.slice(0, 3));
        assert.equal(three.state.rounds, 6);
        assert.equal(started("family", FOUR).state.rounds, 8);
        assert.equal(playGame(three.game, three.state).rounds.length, 6);
    });
    it("never runs out of cards, even at eight players and sixteen rounds", () => {
        const eight: CartridgePlayer[] = ["A", "B", "C", "D", "E", "F", "G", "H"].map((name: string, index: number) => ({ playerId: `p${index}`, name }));
        const { game, state } = started("family", eight);
        const { last } = playGame(game, state);
        assert.equal(last.phase, "end");
        assert.equal(Object.values(last.scores).reduce((sum: number, score: number) => sum + score, 0), 8);
        assert.equal([...last.drawPile, ...last.discard, ...Object.values(last.hands).flat()].length, BLANK_VERDICT_BLUEPRINT.decisions.answers.filter((card: AnswerCard) => card.tone === "family").length);
    });
    it("tops every hand up after each round", () => {
        const { game, state } = started("party");
        const next: HandState = fire(game, fire(game, game.cartridge.apply(fire(game, playAll(game, state).state, "read").state, state.judgeId, `${PICK_PREFIX}0`).state, "beat").state, "reveal").state;
        for (const player of FIVE) {
            assert.equal(next.hands[player.playerId]?.length, BLANK_VERDICT_BLUEPRINT.decisions.handSize);
        }
    });
});

describe("clocks and people leaving", () => {
    it("throws a round away when nobody plays, with no point and the next judge up", () => {
        const { game, state } = started();
        const step: Step<HandState> = fire(game, state, "playing");
        assert.equal(step.state.round, 2);
        assert.notEqual(step.state.judgeId, state.judgeId);
        assert.equal(Object.values(step.state.scores).every((score: number) => score === 0), true);
        assert.match(step.facts.map((fact: ScopedFact) => fact.text).join(" "), /Nobody played/);
    });
    it("gives the round to a lone player, without the judge", () => {
        const { game, state } = started();
        const step: Step<HandState> = fire(game, playAll(game, state, 1).state, "playing");
        assert.equal(step.state.phase, "reveal");
        assert.equal(step.state.revealed, true);
        assert.equal(Object.values(step.state.scores).reduce((sum: number, score: number) => sum + score, 0), 1);
    });
    it("moves on with those who did play when the clock runs out", () => {
        const { game, state } = started();
        const judging: HandState = fire(game, playAll(game, state, 2).state, "playing").state;
        assert.equal(judging.phase, "judging");
        assert.equal(judging.plays.length, 2);
    });
    it("picks for a judge who runs out of time", () => {
        const { game, state } = started();
        const ready: HandState = fire(game, playAll(game, state).state, "read").state;
        const step: Step<HandState> = fire(game, ready, "judging");
        assert.equal(step.state.phase, "reveal");
        assert.equal(step.state.wonBy, "clock");
        assert.equal(step.state.winnerIndex !== null, true);
    });
    it("ignores a timer that belongs to another phase", () => {
        const { game, state } = started();
        for (const timerId of ["tone", "read", "judging", "beat", "reveal"]) {
            assert.equal(fire(game, state, timerId).state, state);
        }
    });
    it("throws the round away if the judge leaves, and hands the played cards back", () => {
        const { game, state } = started();
        const played: HandState = playAll(game, state, 2).state;
        const step: Step<HandState> = on(game, played, { type: "playerLeft", at: 0, playerId: state.judgeId });
        assert.equal(step.state.round, 2);
        assert.equal(step.state.players.some((player: CartridgePlayer) => player.playerId === state.judgeId), false);
        for (const player of step.state.players) {
            assert.equal(step.state.hands[player.playerId]?.length, BLANK_VERDICT_BLUEPRINT.decisions.handSize);
        }
    });
    it("carries on when a player who hasn't played leaves, and counts the rest", () => {
        const { game, state } = started("family", FOUR);
        const waiting: HandState = playAll(game, state, 1).state;
        const last: string = FOUR.map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== state.judgeId)[2] ?? "";
        const step: Step<HandState> = on(game, playAll(game, waiting, 2).state, { type: "playerLeft", at: 0, playerId: last });
        assert.equal(step.state.phase, "judging");
    });
    it("ends the game when too few are left, naming no loser", () => {
        const { game, state } = started("family", PAPER_PLAYERS.slice(0, 3));
        const step: Step<HandState> = on(game, state, { type: "playerLeft", at: 0, playerId: state.judgeId === "paper3" ? "paper2" : "paper3" });
        assert.equal(step.state.phase, "end");
        assert.equal(step.state.endReason, "tooFew");
        assert.notEqual(game.cartridge.outcome(step.state), null);
    });
    it("reports ties as ties", () => {
        const { game, state } = started("family", FOUR);
        const tied: HandState = { ...state, phase: "end", scores: { paper1: 2, paper2: 2, paper3: 0, paper4: 0 } };
        assert.equal(game.cartridge.outcome(tied), "Teacup and Spoon tie on 2 points.");
    });
});

describe("the kit's checks", () => {
    it("pass Blank Verdict across every persona and seed", () => {
        const tally = checkBlueprint(BLANK_VERDICT_BLUEPRINT);
        assert.deepEqual(tally.problems, []);
        assert.equal(tally.ended, tally.rehearsals);
        assert.deepEqual(tally.phasesNeverReached, []);
    });
    it("catch a hand shown to every phone", () => {
        const good: KitGame<HandState> = blankVerdict(2);
        const leaky: KitGame<HandState> = {
            cartridge: {
                ...good.cartridge,
                privateControls: (state: HandState, playerId: string): Control[] => {
                    const everyone: ControlOption[] = Object.values(state.hands).flat().map((id: string) => ({ id, label: BLANK_VERDICT_BLUEPRINT.decisions.answers.find((card: AnswerCard) => card.id === id)?.text ?? "" }));
                    return [...good.cartridge.privateControls(state, playerId), { type: "choice", prompt: "Hands", options: everyone, multiple: false }];
                },
            },
            hidden: (state: HandState) => good.hidden(state),
        };
        const result = rehearse(leaky, handPersonas()[0] ?? { name: "none", move: () => ({ kind: "wait", seconds: 1 }) }, 2);
        assert.ok(result.problems.some((problem: string) => problem.includes("reached phone") === true), result.problems.join(" | "));
    });
    it("catch who played a card reaching the screen", () => {
        const good: KitGame<HandState> = blankVerdict(2);
        const leaky: KitGame<HandState> = {
            cartridge: {
                ...good.cartridge,
                publicScene: (state: HandState) => {
                    const scene = good.cartridge.publicScene(state);
                    const byline = state.plays.map((play: Play) => ({ type: "text" as const, text: `${play.name}: ${BLANK_VERDICT_BLUEPRINT.decisions.answers.find((card: AnswerCard) => card.id === play.cardId)?.text ?? ""}` }));
                    return state.phase === "judging" ? { ...scene, blocks: [...scene.blocks, ...byline] } : scene;
                },
            },
            hidden: (state: HandState) => good.hidden(state),
        };
        const result = rehearse(leaky, handPersonas()[1] ?? { name: "none", move: () => ({ kind: "wait", seconds: 1 }) }, 3);
        assert.ok(result.problems.some((problem: string) => problem.includes("who played a card reached the screen") === true), result.problems.join(" | "));
    });
    it("refuse cards that could open a ruling, a gap that isn't one, and a table of two", () => {
        const broken = (change: (blueprint: HandBlueprint) => void): string[] => {
            const blueprint: HandBlueprint = structuredClone(BLANK_VERDICT_BLUEPRINT);
            change(blueprint);
            return blueprintProblems(blueprint);
        };
        assert.ok(broken((blueprint: HandBlueprint) => { blueprint.decisions.answers[0] = { id: "zz", text: "[[quit]]", tone: "family" }; }).length > 0);
        assert.ok(broken((blueprint: HandBlueprint) => { blueprint.decisions.prompts[0] = { id: "zp", text: "No gap here.", tone: "family" }; }).length > 0);
        assert.ok(broken((blueprint: HandBlueprint) => { blueprint.decisions.prompts[0] = { id: "zp", text: "Two ___ gaps ___.", tone: "family" }; }).length > 0);
        assert.ok(broken((blueprint: HandBlueprint) => { blueprint.decisions.answers[1] = { ...blueprint.decisions.answers[0] as AnswerCard }; }).length > 0);
        assert.ok(broken((blueprint: HandBlueprint) => { blueprint.box.minPlayers = 2; }).length > 0);
        assert.ok(broken((blueprint: HandBlueprint) => { blueprint.decisions.answers = blueprint.decisions.answers.slice(0, 40); }).length > 0);
        assert.ok(broken((blueprint: HandBlueprint) => { blueprint.decisions.playSeconds = Number.NaN; }).length > 0);
        assert.ok(broken((blueprint: HandBlueprint) => { blueprint.decisions.answers[2] = { id: "zc", text: "a giant spoon of a giant spoon", tone: "family" }; }).length > 0);
    });
});
