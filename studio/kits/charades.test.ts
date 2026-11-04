// Proves the charades kit, as Say Nothing: the prompt reaches only the performer's phone and never
// the TV, other phones or the host; guesses are ruled in code, including synonyms, near misses and
// a performer's own words; both the guesser and the performer score, quicker is worth more, and the
// performer rotates; stale timers, leavers and the pause menu end things cleanly. Also the list:
// plenty of prompts, every one answerable, none refused by the content filter.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer, PhaseSpec, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { ScopedFact } from "../../shared/visibility.ts";
import { localCategory } from "../../room/content-filter.ts";
import { blueprintProblems, type CharadesBlueprint } from "../blueprint.ts";
import { SAY_NOTHING_BLUEPRINT } from "../games/say-nothing.ts";
import type { KitGame } from "../kit/kit.ts";
import { ruleGuess } from "../kit/matching.ts";
import { BECAUSE_KIND } from "../kit/primitives.ts";
import { checkBlueprint } from "../check.ts";
import { findLeaks, linesIn, PAPER_PLAYERS, stringsIn, viewsOf } from "../rehearse.ts";
import { CHARADES_GIVE_UP_ACTION, createCharadesGame, GO_ACTION, LEVEL_PREFIX, LEVELS, PROMPT_KINDS, SWAP_ACTION, type CharadesDecisions, type CharadesState, type Level, type Prompt } from "./charades.ts";

/** Four at the table. */
const FOUR: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);

/** The decisions of the shipped game. */
const DECISIONS: CharadesDecisions = SAY_NOTHING_BLUEPRINT.decisions;

/**
 * Say Nothing with the first player going first and the first unused prompt of each level coming up.
 * @param blueprint the blueprint; Say Nothing unless given.
 * @returns the game.
 */
function sayNothing(blueprint: CharadesBlueprint = SAY_NOTHING_BLUEPRINT): KitGame<CharadesState> {
    return createCharadesGame(blueprint.box, blueprint.decisions, () => 0);
}

/**
 * A game in its first pick, and what each step does from there.
 * @param players who is at the table.
 * @returns the game and the first state.
 */
function begin(players: CartridgePlayer[] = FOUR): { game: KitGame<CharadesState>; state: CharadesState } {
    const game: KitGame<CharadesState> = sayNothing();
    return { game, state: game.cartridge.init(players, {}).state };
}

/**
 * Plays an event.
 * @param game the game.
 * @param state the state.
 * @param event the event.
 * @returns the step.
 */
function on(game: KitGame<CharadesState>, state: CharadesState, event: RoomEvent): Step<CharadesState> {
    return game.cartridge.onEvent(state, event);
}

/**
 * Fires a timer.
 * @param game the game.
 * @param state the state.
 * @param timerId the timer.
 * @returns the step.
 */
function fire(game: KitGame<CharadesState>, state: CharadesState, timerId: string): Step<CharadesState> {
    return on(game, state, { type: "timerFired", at: 0, timerId });
}

/**
 * Has someone say something.
 * @param game the game.
 * @param state the state.
 * @param playerId who.
 * @param text what.
 * @returns the step.
 */
function hear(game: KitGame<CharadesState>, state: CharadesState, playerId: string, text: string): Step<CharadesState> {
    return on(game, state, { type: "speechEnded", at: 0, playerId, text });
}

/**
 * Gets a turn to the clock running at a level.
 * @param level the level the performer chooses.
 * @param players who is at the table.
 * @returns the game, the state, and the answer being acted.
 */
function acting(level: Level = "medium", players: CartridgePlayer[] = FOUR): { game: KitGame<CharadesState>; state: CharadesState; answer: Prompt } {
    const { game, state } = begin(players);
    const chosen: Step<CharadesState> = game.cartridge.apply(state, state.performerId, `${LEVEL_PREFIX}${level}`);
    const started: Step<CharadesState> = game.cartridge.apply(chosen.state, chosen.state.performerId, GO_ACTION);
    const answer: Prompt | undefined = DECISIONS.prompts[started.state.promptIndex ?? -1];
    assert.ok(answer !== undefined);
    return { game, state: started.state, answer };
}

/**
 * The strings a viewer reads, for finding a leak.
 * @param game the game.
 * @param state the state.
 * @param viewer who: "screen", "host" or a player id.
 * @param facts what the last step emitted.
 * @returns the strings.
 */
function seenBy(game: KitGame<CharadesState>, state: CharadesState, viewer: string, facts: ScopedFact[] = []): string[] {
    return stringsIn(viewsOf(game.cartridge, state, FOUR, facts).get(viewer) ?? []);
}

describe("the list", () => {
    it("has at least 120 prompts, in every kind and level, and passes its checks", () => {
        assert.ok(DECISIONS.prompts.length >= 120);
        for (const kind of PROMPT_KINDS) {
            for (const level of LEVELS) {
                assert.ok(DECISIONS.prompts.filter((prompt: Prompt) => prompt.kind === kind && prompt.level === level).length >= 8, `${kind} ${level}`);
            }
        }
        assert.deepEqual(blueprintProblems(SAY_NOTHING_BLUEPRINT), []);
    });

    it("can be answered: every answer and every listed synonym rules as a match", () => {
        for (const prompt of DECISIONS.prompts) {
            for (const form of [prompt.answer, ...prompt.also]) {
                assert.equal(ruleGuess(form, prompt.answer, prompt.also), "match", `${form} for ${prompt.answer}`);
            }
        }
    });

    it("is not refused by the content filter the host's own words pass", () => {
        for (const prompt of DECISIONS.prompts) {
            for (const form of [prompt.answer, ...prompt.also]) {
                assert.equal(localCategory(form), null, form);
            }
        }
    });

    it("does not give one prompt twice", () => {
        const answers: string[] = DECISIONS.prompts.map((prompt: Prompt) => prompt.answer.toLowerCase());
        assert.equal(new Set(answers).size, answers.length);
    });

    it("refuses a list that is too short or has an answer with no key word", () => {
        const short: CharadesBlueprint = { ...SAY_NOTHING_BLUEPRINT, decisions: { ...DECISIONS, prompts: DECISIONS.prompts.slice(0, 20) } };
        assert.ok(blueprintProblems(short).length > 0);
        const empty: CharadesBlueprint = { ...SAY_NOTHING_BLUEPRINT, decisions: { ...DECISIONS, prompts: [...DECISIONS.prompts, { kind: "action", level: "easy", answer: "The A", also: [] }] } };
        assert.ok(blueprintProblems(empty).some((problem: string) => problem.includes("no key word")));
    });
});

describe("the prompt stays private", () => {
    it("reaches only the performer's phone, for every prompt in the game", () => {
        const { game, state } = acting();
        for (const [index, prompt] of DECISIONS.prompts.entries()) {
            const here: CharadesState = { ...state, promptIndex: index };
            const hidden = game.hidden(here);
            for (const viewer of ["screen", "host", ...FOUR.map((player: CartridgePlayer) => player.playerId)]) {
                const views: unknown[] = viewsOf(game.cartridge, here, FOUR, []).get(viewer) ?? [];
                assert.deepEqual(findLeaks(viewer, stringsIn(views), hidden, linesIn(views)), [], `${prompt.answer} to ${viewer}`);
            }
        }
    });

    it("is on the performer's phone as a plain card they can read at a glance", () => {
        const { game, state, answer } = acting();
        const controls: Control[] = game.cartridge.privateControls(state, state.performerId);
        const card: Control | undefined = controls.find((control: Control) => control.type === "roleCard");
        assert.ok(card?.type === "roleCard");
        assert.equal(card.title, answer.answer);
        assert.equal(card.secret, false);
        assert.ok(controls.some((control: Control) => control.type === "waiting" && control.text === "Act it out. No words."));
    });

    it("tells the room the kind and the number of words, and no more", () => {
        const { game, state, answer } = acting();
        const shown: string = seenBy(game, state, "paper2").join(" ");
        assert.ok(shown.includes(`${answer.answer.split(" ").length} word`));
        assert.equal(seenBy(game, state, "screen").some((text: string) => text.includes(answer.answer)), false);
    });

    it("never tells the host the prompt until the turn is over", () => {
        const { game, state, answer } = acting();
        assert.equal(JSON.stringify([game.cartridge.manifest.hostBrief, game.cartridge.hostFacts(state, { kind: "host" })]).includes(answer.answer), false);
        const guessed: Step<CharadesState> = hear(game, state, "paper2", answer.answer);
        assert.ok(guessed.facts.some((fact: ScopedFact) => fact.text.includes(answer.answer)));
    });

    it("gives the host no rulings at all, since code rules every guess", () => {
        const phases: PhaseSpec[] = sayNothing().cartridge.manifest.phases;
        assert.equal(phases.some((phase: PhaseSpec) => phase.hostRulings !== undefined), false);
    });

    it("mutes the performer's microphone while guessers hold to talk", () => {
        const acts: PhaseSpec | undefined = sayNothing().cartridge.manifest.phases.find((phase: PhaseSpec) => phase.id === "acting");
        assert.ok(acts !== undefined);
        assert.equal(acts.listening["performer"], "muted");
        assert.equal(acts.listening["*"], "holdToTalk");
        const { game, state } = acting();
        assert.equal(game.cartridge.roleOf(state, state.performerId), "performer");
        assert.equal(game.cartridge.roleOf(state, "paper2"), "guesser");
    });
});

describe("a turn", () => {
    it("starts with the first performer choosing how hard, with a clock on the choice", () => {
        const { game, state } = begin();
        assert.equal(state.phase, "pick");
        assert.deepEqual(game.cartridge.turn?.(state), { kind: "one", playerId: "paper1", label: "Choosing:" });
        const buttons: Control | undefined = game.cartridge.privateControls(state, "paper1").find((control: Control) => control.type === "buttons");
        assert.ok(buttons?.type === "buttons");
        assert.equal(buttons.options.length, 3);
        assert.equal(game.cartridge.privateControls(state, "paper2").some((control: Control) => control.type === "buttons"), false);
        assert.equal(game.cartridge.apply(state, "paper2", `${LEVEL_PREFIX}hard`).state, state);
    });

    it("chooses the middle level for a performer who does not choose", () => {
        const { game, state } = begin();
        const chosen: Step<CharadesState> = fire(game, state, "pick");
        assert.equal(chosen.state.phase, "ready");
        assert.equal(chosen.state.level, "medium");
    });

    it("starts the clock by itself when the performer does not", () => {
        const { game, state } = begin();
        const ready: CharadesState = fire(game, state, "pick").state;
        const started: Step<CharadesState> = fire(game, ready, "ready");
        assert.equal(started.state.phase, "acting");
        assert.deepEqual(started.timers, { acting: 75, half: 37, hurry: 65 });
    });

    it("names each timer after the phase it runs in, so the TV counts down the real time", () => {
        const { game, state } = begin();
        const ready: Step<CharadesState> = game.cartridge.apply(state, "paper1", `${LEVEL_PREFIX}easy`);
        assert.ok(ready.timers !== undefined && "ready" in ready.timers);
        const started: Step<CharadesState> = game.cartridge.apply(ready.state, "paper1", GO_ACTION);
        assert.ok(started.timers !== undefined && "acting" in started.timers);
        assert.ok(game.cartridge.manifest.phases.some((phase: PhaseSpec) => phase.id === "acting"));
    });

    it("lets the performer swap the prompt once, for another of the same level", () => {
        const { game, state } = begin();
        const ready: CharadesState = game.cartridge.apply(state, "paper1", `${LEVEL_PREFIX}hard`).state;
        const swapped: CharadesState = game.cartridge.apply(ready, "paper1", SWAP_ACTION).state;
        assert.notEqual(swapped.promptIndex, ready.promptIndex);
        assert.equal(DECISIONS.prompts[swapped.promptIndex ?? 0]?.level, "hard");
        assert.equal(game.cartridge.apply(swapped, "paper1", SWAP_ACTION).state, swapped);
        assert.equal(game.cartridge.legalActions(swapped, "paper1").some((action) => action.actionId === SWAP_ACTION), false);
    });

    it("lets only the performer start the clock", () => {
        const { game, state } = begin();
        const ready: CharadesState = game.cartridge.apply(state, "paper1", `${LEVEL_PREFIX}easy`).state;
        assert.equal(game.cartridge.apply(ready, "paper2", GO_ACTION).state, ready);
    });
});

describe("ruling guesses in code", () => {
    it("scores the guesser and the performer when the answer is said, with the quick bonus", () => {
        const { game, state, answer } = acting("medium");
        const guessed: Step<CharadesState> = hear(game, state, "paper2", `Is it ${answer.answer}?`);
        assert.equal(guessed.state.phase, "reveal");
        assert.equal(guessed.state.scores["paper2"], 3);
        assert.equal(guessed.state.scores["paper1"], 3);
        assert.equal(guessed.state.latest?.fast, true);
        assert.equal(guessed.nextPhaseId, "reveal");
    });

    it("pays less after the clock is half gone", () => {
        const { game, state, answer } = acting("hard");
        const late: CharadesState = fire(game, state, "half").state;
        const guessed: Step<CharadesState> = hear(game, late, "paper3", answer.answer);
        assert.equal(guessed.state.scores["paper3"], 3);
        assert.equal(guessed.state.scores["paper1"], 3);
        assert.equal(guessed.state.latest?.fast, false);
    });

    it("accepts a listed synonym", () => {
        const { game, state, answer } = acting("easy");
        const synonym: string | undefined = answer.also[answer.also.length - 1];
        assert.ok(synonym !== undefined);
        assert.equal(hear(game, state, "paper2", synonym).state.phase, "reveal");
    });

    it("keeps going on a wrong guess, and shows it on the TV without telling the host", () => {
        const { game, state } = acting();
        const wrong: Step<CharadesState> = hear(game, state, "paper2", "Is it a wardrobe?");
        assert.equal(wrong.state.phase, "acting");
        assert.deepEqual(wrong.facts, []);
        const shown: SceneBlock[] = game.cartridge.publicScene(wrong.state).blocks;
        assert.ok(shown.some((block: SceneBlock) => block.type === "text" && block.text === "Spoon: Is it a wardrobe?"));
    });

    it("tells the host about a close guess, without the answer, and not about every one", () => {
        const { game, state, answer } = acting("medium");
        assert.equal(answer.answer, "The Lighthouse Keeper's Secret");
        const first: Step<CharadesState> = hear(game, state, "paper2", "something about a lighthouse keeper");
        assert.equal(first.facts.length, 2);
        assert.equal(first.facts.some((fact: ScopedFact) => fact.text.toLowerCase().includes("lighthouse")), false);
        assert.equal(first.facts[0]?.kind, "close");
        const second: Step<CharadesState> = hear(game, first.state, "paper3", "lighthouse keeper again");
        assert.deepEqual(second.facts, []);
        assert.equal(second.state.guesses.every((guess) => guess.close === true), true);
        const shown: SceneBlock[] = game.cartridge.publicScene(second.state).blocks;
        assert.ok(shown.some((block: SceneBlock) => block.type === "text" && block.text.endsWith("(close)")));
    });

    it("ignores the performer's own words, a stranger's words, and silence", () => {
        const { game, state, answer } = acting();
        assert.equal(hear(game, state, state.performerId, answer.answer).state, state);
        assert.equal(hear(game, state, "stranger", answer.answer).state, state);
        assert.equal(hear(game, state, "paper2", "   ").state, state);
    });

    it("ignores speech before the clock starts and after the turn is over", () => {
        const { game, state } = begin();
        assert.equal(hear(game, state, "paper2", "anything").state, state);
        const acts = acting();
        const over: CharadesState = hear(acts.game, acts.state, "paper2", acts.answer.answer).state;
        assert.equal(hear(acts.game, over, "paper3", acts.answer.answer).state, over);
    });

    it("lets only the first right guess score", () => {
        const { game, state, answer } = acting("easy");
        const first: CharadesState = hear(game, state, "paper2", answer.answer).state;
        const total: number = Object.values(first.scores).reduce((sum: number, score: number) => sum + score, 0);
        const second: CharadesState = hear(game, first, "paper3", answer.answer).state;
        assert.equal(Object.values(second.scores).reduce((sum: number, score: number) => sum + score, 0), total);
    });
});

describe("clocks", () => {
    it("ends a turn nobody guessed with a point for the performer's effort", () => {
        const { game, state } = acting();
        const over: Step<CharadesState> = fire(game, state, "acting");
        assert.equal(over.state.phase, "reveal");
        assert.equal(over.state.latest?.ending, "timeUp");
        assert.equal(over.state.scores["paper1"], 1);
        assert.equal(over.state.scores["paper2"], 0);
        assert.ok(over.facts.some((fact: ScopedFact) => fact.text.includes(over.state.latest?.answer ?? "?")));
    });

    it("nudges the room with ten seconds left, only while acting", () => {
        const { game, state } = acting();
        assert.equal(fire(game, state, "hurry").facts[0]?.kind, "hurry");
        const over: CharadesState = fire(game, state, "acting").state;
        assert.deepEqual(fire(game, over, "hurry").facts, []);
    });

    it("ignores a timer left over from an earlier phase", () => {
        const { game, state } = begin();
        assert.equal(fire(game, state, "acting").state, state);
        assert.equal(fire(game, state, "reveal").state, state);
        const ready: CharadesState = game.cartridge.apply(state, "paper1", `${LEVEL_PREFIX}easy`).state;
        assert.equal(fire(game, ready, "pick").state, ready);
        const acts = acting();
        assert.equal(fire(acts.game, acts.state, "ready").state, acts.state);
    });
});

describe("a whole game", () => {
    it("gives everyone a turn as performer, in seat order, then ends with the scores", () => {
        const { game, state: first } = begin();
        let state: CharadesState = first;
        const performers: string[] = [];
        for (let turn = 0; turn < FOUR.length; turn += 1) {
            performers.push(state.performerId);
            state = game.cartridge.apply(state, state.performerId, `${LEVEL_PREFIX}easy`).state;
            state = game.cartridge.apply(state, state.performerId, GO_ACTION).state;
            state = fire(game, state, "acting").state;
            assert.equal(state.phase, "reveal");
            state = fire(game, state, "reveal").state;
        }
        assert.deepEqual(performers, ["paper1", "paper2", "paper3", "paper4"]);
        assert.equal(state.phase, "end");
        assert.ok(game.cartridge.outcome(state) !== null);
        assert.deepEqual(game.hidden(state), []);
    });

    it("starts with a different performer when the draw says so, and covers every seat", () => {
        const game: KitGame<CharadesState> = createCharadesGame(SAY_NOTHING_BLUEPRINT.box, DECISIONS, () => 0.6);
        const state: CharadesState = game.cartridge.init(FOUR, {}).state;
        assert.equal(state.performerId, "paper3");
        assert.deepEqual([state.performerId, ...state.upcoming].sort(), ["paper1", "paper2", "paper3", "paper4"]);
    });

    it("does not repeat a prompt while others of its level are left", () => {
        const { game, state: first } = begin();
        let state: CharadesState = first;
        const seen: number[] = [];
        for (let turn = 0; turn < FOUR.length; turn += 1) {
            state = game.cartridge.apply(state, state.performerId, `${LEVEL_PREFIX}easy`).state;
            seen.push(state.promptIndex ?? -1);
            state = game.cartridge.apply(state, state.performerId, GO_ACTION).state;
            state = fire(game, fire(game, state, "acting").state, "reveal").state;
        }
        assert.equal(new Set(seen).size, seen.length);
    });

    it("ends early from the pause menu, from any phase, and keeps the scores", () => {
        const { game, state, answer } = acting();
        const scored: CharadesState = hear(game, state, "paper2", answer.answer).state;
        const ended: Step<CharadesState> = game.cartridge.apply(scored, "paper3", CHARADES_GIVE_UP_ACTION);
        assert.equal(ended.state.phase, "end");
        assert.equal(ended.state.result, "gaveUp");
        assert.equal(ended.state.scores["paper2"], 3);
        assert.equal(game.cartridge.apply(ended.state, "paper3", CHARADES_GIVE_UP_ACTION).state, ended.state);
    });

    it("explains every fact with the decision behind it", () => {
        const { game, state } = begin();
        const steps: Step<CharadesState>[] = [game.cartridge.init(FOUR, {}), game.cartridge.apply(state, "paper1", `${LEVEL_PREFIX}easy`), fire(game, state, "pick")];
        for (const step of steps) {
            step.facts.forEach((fact: ScopedFact, index: number) => {
                assert.ok(fact.scope.kind === "system" || step.facts[index + 1]?.kind === BECAUSE_KIND);
            });
        }
    });
});

describe("people leaving", () => {
    it("ends a turn with no points when the performer leaves, and moves on", () => {
        const { game, state } = acting();
        const gone: Step<CharadesState> = on(game, state, { type: "playerLeft", at: 0, playerId: "paper1" });
        assert.equal(gone.state.phase, "reveal");
        assert.equal(gone.state.latest?.ending, "left");
        assert.equal(gone.state.players.length, 3);
        assert.equal(fire(game, gone.state, "reveal").state.performerId, "paper2");
    });

    it("moves on from a performer who leaves before they have a prompt", () => {
        const { game, state } = begin();
        const gone: Step<CharadesState> = on(game, state, { type: "playerLeft", at: 0, playerId: "paper1" });
        assert.equal(gone.state.phase, "pick");
        assert.equal(gone.state.performerId, "paper2");
    });

    it("takes a guesser who leaves out of the turns to come, and keeps the game going", () => {
        const { game, state } = acting();
        const gone: CharadesState = on(game, state, { type: "playerLeft", at: 0, playerId: "paper3" }).state;
        assert.equal(gone.phase, "acting");
        assert.deepEqual(gone.upcoming, ["paper2", "paper4"]);
        assert.equal(hear(game, gone, "paper3", "anything").state, gone);
    });

    it("ends the game when fewer than two people are left", () => {
        const { game, state } = acting("medium", FOUR.slice(0, 3));
        const one: CharadesState = on(game, state, { type: "playerLeft", at: 0, playerId: "paper3" }).state;
        const none: Step<CharadesState> = on(game, one, { type: "playerLeft", at: 0, playerId: "paper2" });
        assert.equal(none.state.phase, "end");
        assert.equal(none.state.result, "tooFew");
    });
});

describe("the whole thing, rehearsed", () => {
    it("ends every rehearsal, reaches every phase and finds nothing wrong", () => {
        const tally = checkBlueprint(SAY_NOTHING_BLUEPRINT);
        assert.deepEqual(tally.problems, []);
        assert.equal(tally.ended, tally.rehearsals);
        assert.deepEqual(tally.phasesNeverReached, []);
    });

    it("catches the answer being put on the TV", () => {
        const game: KitGame<CharadesState> = sayNothing();
        const leaky: KitGame<CharadesState> = {
            cartridge: {
                ...game.cartridge,
                publicScene: (state: CharadesState) => {
                    const scene = game.cartridge.publicScene(state);
                    const prompt: Prompt | undefined = DECISIONS.prompts[state.promptIndex ?? -1];
                    return prompt === undefined || state.phase === "reveal" ? scene : { ...scene, blocks: [...scene.blocks, { type: "text", text: prompt.answer }] };
                },
            },
            hidden: (state: CharadesState) => game.hidden(state),
        };
        const { state } = acting();
        const views = viewsOf(leaky.cartridge, state, FOUR, []).get("screen") ?? [];
        assert.ok(findLeaks("screen", stringsIn(views), leaky.hidden(state), linesIn(views)).length > 0);
    });
});
