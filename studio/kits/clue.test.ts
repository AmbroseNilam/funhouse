// Tests for the clue kit: the word list, the clue rules, the guess check, scoring and what each
// viewer sees, played through the cartridge directly with scripted events and no model.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { CartridgePlayer, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { Scene } from "../../shared/scene.ts";
import { checkBlueprint } from "../check.ts";
import { blueprintProblems } from "../blueprint.ts";
import { LONELY_CLUES_BLUEPRINT, LONELY_CLUES_WORDS } from "../games/lonely-clues.ts";
import { cluePersonas } from "../personas.ts";
import { findLeaks, linesIn, PAPER_PLAYERS, rehearse, stringsIn, viewsOf, type Persona } from "../rehearse.ts";
import { seededRandom } from "../kit/primitives.ts";
import { clueProblem, createClueGame, guessMatches, isFormOfWord, type ClueState } from "./clue.ts";

const PLAYERS: readonly CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);

/**
 * A game with the shipped decisions, a seeded random source, and its first step.
 * @returns the game and the step.
 */
function begin(): { game: ReturnType<typeof createClueGame>; step: Step<ClueState> } {
    const game = createClueGame(LONELY_CLUES_BLUEPRINT.box, LONELY_CLUES_BLUEPRINT.decisions, seededRandom(7));
    return { game, step: game.cartridge.init([...PLAYERS], {}) };
}

/**
 * Types a clue for a giver into whatever box their phone shows.
 * @param game the game.
 * @param step the step so far.
 * @param playerId who types.
 * @param text the clue.
 * @returns the next step.
 */
function type(game: ReturnType<typeof createClueGame>, step: Step<ClueState>, playerId: string, text: string): Step<ClueState> {
    const box: Control | undefined = game.cartridge.privateControls(step.state, playerId).find((control: Control) => control.type === "textInput");
    assert.ok(box?.type === "textInput", "the phone has a text box");
    return game.cartridge.onEvent(step.state, { type: "answered", at: 0, playerId, controlId: box.id, value: text });
}

test("the shipped list has at least 150 words, none repeated, and the blueprint is runnable", () => {
    assert.ok(LONELY_CLUES_WORDS.length >= 150);
    assert.equal(new Set(LONELY_CLUES_WORDS).size, LONELY_CLUES_WORDS.length);
    assert.deepEqual(blueprintProblems(LONELY_CLUES_BLUEPRINT), []);
});

test("clues that give the word away are refused, and unrelated ones are not", () => {
    assert.equal(isFormOfWord("teapots", "teapot"), true);
    assert.equal(isFormOfWord("Tea-Pot", "teapot"), true);
    assert.equal(isFormOfWord("sandcastles", "sandcastle"), true);
    assert.equal(isFormOfWord("castle", "sandcastle"), true);
    assert.equal(isFormOfWord("baker", "bakery"), true);
    assert.equal(isFormOfWord("tea", "teapot"), false);
    assert.equal(isFormOfWord("sleep", "pillow"), false);
    assert.equal(clueProblem("two words", "pillow"), "shape");
    assert.equal(clueProblem("a1", "pillow"), "shape");
    assert.equal(clueProblem("s", "pillow"), "shape");
    assert.equal(clueProblem("pillows", "pillow"), "word");
    assert.equal(clueProblem("sleep", "pillow"), null);
});

test("a guess is right when it names the word or a plain variant, in a sentence or alone", () => {
    assert.equal(guessMatches("a teapot", "teapot"), true);
    assert.equal(guessMatches("Teapots?", "teapot"), true);
    assert.equal(guessMatches("I think it's the tea pot", "teapot"), true);
    assert.equal(guessMatches("kettle", "teapot"), false);
    assert.equal(guessMatches("", "teapot"), false);
});

test("duplicates cancel, are hidden from the guesser, and come out after the guess", () => {
    const { game, step: opened } = begin();
    const guesser: string = opened.state.guesserId;
    const givers: string[] = PLAYERS.map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== guesser);
    let step: Step<ClueState> = opened;
    step = type(game, step, givers[0] ?? "", "Cheese");
    step = type(game, step, givers[1] ?? "", "cheeses");
    step = type(game, step, givers[2] ?? "", "sleep");
    assert.equal(step.state.phase, "reveal");
    assert.deepEqual(step.state.survivors.map((clue) => clue.text), ["sleep"]);
    const seen: string[] = [...viewsOf(game.cartridge, step.state, PLAYERS, step.facts).get(guesser) ?? []].flatMap(stringsIn);
    assert.equal(seen.join(" ").toLowerCase().includes("cheese"), false);
    assert.equal(seen.join(" ").includes(step.state.word), false);
    const hostSees: string = JSON.stringify(viewsOf(game.cartridge, step.state, PLAYERS, step.facts).get("host"));
    assert.equal(hostSees.toLowerCase().includes("cheese"), false);
    assert.equal(hostSees.includes(step.state.word), false);
});

test("a refused clue costs a try and the box comes back with a note, then the giver is out", () => {
    const { game, step: opened } = begin();
    const giver: string = PLAYERS.find((player: CartridgePlayer) => player.playerId !== opened.state.guesserId)?.playerId ?? "";
    let step: Step<ClueState> = opened;
    for (const attempt of [0, 1]) {
        step = type(game, step, giver, opened.state.word);
        const box: Control | undefined = game.cartridge.privateControls(step.state, giver).find((control: Control) => control.type === "textInput");
        assert.ok(box?.type === "textInput" && box.note !== undefined && box.id.endsWith(`:${attempt + 1}`));
    }
    step = type(game, step, giver, opened.state.word);
    assert.equal(step.state.out.includes(giver), true);
    assert.equal(step.state.refused.length, 3);
});

test("a right typed guess scores, with a bonus only when nothing was cancelled", () => {
    const { game, step: opened } = begin();
    const guesser: string = opened.state.guesserId;
    const givers: string[] = PLAYERS.map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== guesser);
    let step: Step<ClueState> = opened;
    ["amber", "brisk", "cobalt"].forEach((text: string, index: number) => { step = type(game, step, givers[index] ?? "", text); });
    for (let beat = 0; beat < 6 && step.state.phase === "reveal"; beat += 1) {
        step = game.cartridge.onEvent(step.state, { type: "timerFired", at: 0, timerId: "beat" });
    }
    assert.equal(step.state.phase, "guess");
    assert.equal(step.state.survivors.length, 3);
    const box = game.cartridge.privateControls(step.state, guesser).find((control: Control) => control.type === "textInput");
    assert.ok(box?.type === "textInput");
    step = game.cartridge.onEvent(step.state, { type: "answered", at: 0, playerId: guesser, controlId: box.id, value: step.state.word });
    assert.equal(step.state.verdict, "right");
    assert.equal(step.state.score, 3);
    const scene: Scene = game.cartridge.publicScene(step.state);
    assert.ok(stringsIn(scene).includes(step.state.word));
});

test("only the guesser can guess, and only once", () => {
    const { game, step: opened } = begin();
    const guesser: string = opened.state.guesserId;
    const givers: string[] = PLAYERS.map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== guesser);
    let step: Step<ClueState> = opened;
    ["amber", "brisk", "cobalt"].forEach((text: string, index: number) => { step = type(game, step, givers[index] ?? "", text); });
    while (step.state.phase === "reveal") {
        step = game.cartridge.onEvent(step.state, { type: "timerFired", at: 0, timerId: "beat" });
    }
    const stranger: Step<ClueState> = game.cartridge.onEvent(step.state, { type: "answered", at: 0, playerId: givers[0] ?? "", controlId: `guess:${step.state.round}`, value: step.state.word });
    assert.equal(stranger.state.phase, "guess");
    const wrong: Step<ClueState> = game.cartridge.onEvent(step.state, { type: "answered", at: 0, playerId: guesser, controlId: `guess:${step.state.round}`, value: "nonsense" });
    assert.equal(wrong.state.verdict, "wrong");
    const again: Step<ClueState> = game.cartridge.onEvent(wrong.state, { type: "answered", at: 0, playerId: guesser, controlId: `guess:${step.state.round}`, value: step.state.word });
    assert.equal(again.state.verdict, "wrong");
});

test("rehearsal: every persona ends, nothing leaks, every phase is reached", () => {
    const tally = checkBlueprint(LONELY_CLUES_BLUEPRINT);
    assert.deepEqual(tally.problems, []);
    assert.deepEqual(tally.phasesNeverReached, []);
    assert.equal(tally.ended, tally.rehearsals);
});

test("the leak check would catch the word or a cancelled clue reaching the guesser, the host or the screen", () => {
    const { game, step: opened } = begin();
    const guesser: string = opened.state.guesserId;
    const givers: string[] = PLAYERS.map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== guesser);
    let step: Step<ClueState> = opened;
    step = type(game, step, givers[0] ?? "", "Cheese");
    step = type(game, step, givers[1] ?? "", "cheese");
    step = type(game, step, givers[2] ?? "", "sleep");
    const leaking = { ...step, facts: [...step.facts, { scope: { kind: "public" as const }, kind: "oops", text: `Two wrote cheese. The word is ${step.state.word}.` }] };
    const hidden = game.hidden(leaking.state);
    assert.ok(hidden.some((value) => value.text === "Cheese") && hidden.some((value) => value.text === leaking.state.word));
    const views = viewsOf(game.cartridge, leaking.state, PLAYERS, leaking.facts);
    for (const viewer of ["screen", "host", guesser]) {
        const seen = views.get(viewer) ?? [];
        const problems: string[] = findLeaks(viewer, stringsIn(seen), hidden, linesIn(seen));
        assert.ok(problems.length >= 2, `${viewer} was not flagged`);
    }
    const giverSees = views.get(givers[0] ?? "") ?? [];
    assert.ok(findLeaks(givers[0] ?? "", stringsIn(giverSees), hidden, linesIn(giverSees)).length === 0, "a clue giver may see the word");
});

test("between them the personas reach every way a round can end", () => {
    const verdicts: Set<string> = new Set();
    const personas: Persona<ClueState>[] = cluePersonas();
    for (const persona of personas) {
        for (const seed of [1, 2, 3]) {
            const game = createClueGame(LONELY_CLUES_BLUEPRINT.box, LONELY_CLUES_BLUEPRINT.decisions, seededRandom(seed));
            for (const entry of rehearse(game, persona, seed).trace) {
                entry.step.state.record.forEach((round) => verdicts.add(round.verdict));
            }
        }
    }
    assert.deepEqual([...verdicts].sort(), ["passed", "right", "timeout", "voided", "wrong"]);
});
