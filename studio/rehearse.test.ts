// Proves the structural rehearsal on both kits, then proves it catches what the review found the
// old one missing. Healthy games: every rehearsal ends, every phase is reached, every ending the
// game has is reached, nothing is found. Planted faults: a secret in a roster badge, a tally
// label, on every phone, spaced out or reversed, as the count label; a ruling that silently stops
// working; state changed in place; rules that throw; a game that never ends; a fact with no
// decision; the Plant's card on every phone; and a host told who the Plant is.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Cartridge, CartridgePlayer, Step } from "../shared/cartridge.ts";
import type { Control } from "../shared/controls.ts";
import type { Scene } from "../shared/scene.ts";
import type { RoomEvent } from "../shared/timeline.ts";
import type { Scope, ScopedFact } from "../shared/visibility.ts";
import type { GuessingBlueprint } from "./blueprint.ts";
import { LEADING_QUESTIONS_BLUEPRINT } from "./games/leading-questions.ts";
import { TWENTY_DOORS_BLUEPRINT } from "./games/twenty-doors.ts";
import type { KitGame } from "./kit/kit.ts";
import { seededRandom } from "./kit/primitives.ts";
import { createGuessingGame, type GuessingState } from "./kits/guessing.ts";
import { createPlantGame, type PlantState } from "./kits/plant.ts";
import { guessingPersonas, plantPersonas } from "./personas.ts";
import { PAPER_PLAYERS, rehearse, rehearseMany, roleBlindness, type Persona, type Rehearsal, type Tally, type TraceEntry } from "./rehearse.ts";

/** Seeds for a set of rehearsals. */
const SEEDS: number[] = [1, 2, 3, 4, 5];

/**
 * Twenty Doors from a blueprint.
 * @param seed the seed.
 * @param blueprint the blueprint; Twenty Doors unless given.
 * @returns the game.
 */
function twentyDoors(seed: number, blueprint: GuessingBlueprint = TWENTY_DOORS_BLUEPRINT): KitGame<GuessingState> {
    return createGuessingGame(blueprint.box, blueprint.decisions, seededRandom(seed));
}

/**
 * Leading Questions.
 * @param seed the seed.
 * @returns the game.
 */
function leadingQuestions(seed: number): KitGame<PlantState> {
    return createPlantGame(LEADING_QUESTIONS_BLUEPRINT.box, LEADING_QUESTIONS_BLUEPRINT.decisions, seededRandom(seed));
}

/**
 * The same game with some rules replaced.
 * @param game the healthy game.
 * @param patch the replaced rules, given the healthy ones.
 * @returns the faulty game.
 */
function faulty<State>(game: KitGame<State>, patch: (healthy: Cartridge<State>) => Partial<Cartridge<State>>): KitGame<State> {
    return { cartridge: { ...game.cartridge, ...patch(game.cartridge) }, hidden: (state: State) => game.hidden(state) };
}

/**
 * Rehearses one game with every Twenty Doors persona and gathers the problems.
 * @param game builds the game.
 * @returns every problem.
 */
function twentyDoorsProblems(game: (seed: number) => KitGame<GuessingState>): string {
    return rehearseMany(game, guessingPersonas(TWENTY_DOORS_BLUEPRINT.decisions), [1, 2]).problems.join("\n");
}

describe("rehearsing healthy games", () => {
    it("rehearses twenty doors: every rehearsal ends, reaches every phase, and finds nothing", () => {
        const startedAt: number = Date.now();
        const tally: Tally = rehearseMany(twentyDoors, guessingPersonas(TWENTY_DOORS_BLUEPRINT.decisions), SEEDS);
        assert.equal(tally.rehearsals, 20);
        assert.equal(tally.ended, 20);
        assert.deepEqual(tally.phasesNeverReached, []);
        assert.deepEqual(tally.problems, []);
        assert.ok(Date.now() - startedAt < 2000, "twenty rehearsals run in under two seconds");
    });

    it("rehearses leading questions and reaches every ending it has, with the model failing and succeeding", () => {
        for (const content of ["", "teapot"]) {
            const tally: Tally = rehearseMany(leadingQuestions, plantPersonas(), SEEDS, { content });
            assert.equal(tally.ended, tally.rehearsals);
            assert.deepEqual(tally.phasesNeverReached, []);
            assert.deepEqual(tally.problems, []);
            const endings: string = Object.keys(tally.outcomes).join(" | ");
            assert.match(endings, /The room caught/);
            assert.match(endings, /got away with it/);
            assert.match(endings, /The word was/);
        }
    });

    it("rehearses leading questions at four and at eight", () => {
        const eight: CartridgePlayer[] = ["Teacup", "Spoon", "Candle", "Saucer", "Matchbox", "Kettle", "Napkin", "Fork"].map((name: string, index: number) => ({ playerId: `paper${index + 1}`, name }));
        for (const players of [PAPER_PLAYERS.slice(0, 4), eight]) {
            assert.deepEqual(rehearseMany(leadingQuestions, plantPersonas(), SEEDS, { players }).problems, []);
        }
    });

    it("keeps a trace that names the decision behind the ending", () => {
        const finder: Persona<GuessingState> | undefined = guessingPersonas(TWENTY_DOORS_BLUEPRINT.decisions)[0];
        assert.ok(finder !== undefined);
        const rehearsal: Rehearsal<GuessingState> = rehearse(twentyDoors(7), finder, 7);
        const last: TraceEntry<GuessingState> | undefined = rehearsal.trace.at(-1);
        assert.ok(last !== undefined);
        assert.equal(last.event.type, "hostRuled");
        assert.equal(last.step.facts[1]?.text, "answers.correct");
    });

    it("finds that who is the Plant changes nothing the TV, the host or anyone else can see", () => {
        const players: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);
        const games: { game: KitGame<PlantState>; holderId: string }[] = players.map((player: CartridgePlayer, seat: number) => {
            const values: number[] = [0, (seat + 0.5) / players.length];
            return { game: createPlantGame(LEADING_QUESTIONS_BLUEPRINT.box, LEADING_QUESTIONS_BLUEPRINT.decisions, () => values.shift() ?? 0), holderId: player.playerId };
        });
        assert.deepEqual(roleBlindness(games, blindScript(), players), []);
    });
});

/**
 * A script played the same way whoever is the Plant: the word comes, reading ends, two questions,
 * a find, and two votes.
 * @returns the events.
 */
function blindScript(): RoomEvent[] {
    return [
        { type: "contentReady", at: 0, text: "teapot" },
        { type: "timerFired", at: 10, timerId: "read" },
        { type: "speechEnded", at: 12, playerId: "paper1", text: "Is it metal?" },
        { type: "hostRuled", at: 13, ruling: "no", detail: "", playerId: "paper1" },
        { type: "speechEnded", at: 15, playerId: "paper2", text: "Is it in a kitchen?" },
        { type: "hostRuled", at: 16, ruling: "yes", detail: "", playerId: "paper2" },
    ];
}

describe("rehearsal catches planted faults", () => {
    it("a secret in a roster badge, a tally label, or on every phone", () => {
        const badge = (seed: number): KitGame<GuessingState> => faulty(twentyDoors(seed), (healthy: Cartridge<GuessingState>) => ({
            publicScene: (state: GuessingState): Scene => ({ ...healthy.publicScene(state), blocks: [...healthy.publicScene(state).blocks, { type: "roster", players: [{ playerId: "x", name: "x", speaking: false, muted: false, badge: state.secret }] }] }),
        }));
        assert.match(twentyDoorsProblems(badge), /the secret reached the screen/);
        const label = (seed: number): KitGame<GuessingState> => faulty(twentyDoors(seed), (healthy: Cartridge<GuessingState>) => ({
            publicScene: (state: GuessingState): Scene => ({ ...healthy.publicScene(state), blocks: [{ type: "tally", title: "Scores", rows: [{ label: state.secret, count: 1 }] }] }),
        }));
        assert.match(twentyDoorsProblems(label), /the secret reached the screen/);
        const phones = (seed: number): KitGame<GuessingState> => faulty(twentyDoors(seed), (healthy: Cartridge<GuessingState>) => ({
            privateControls: (state: GuessingState, playerId: string): Control[] => [...healthy.privateControls(state, playerId), { type: "notice", text: `Psst: ${state.secret}`, tone: "secret" }],
        }));
        assert.match(twentyDoorsProblems(phones), /the secret reached phone paper1/);
    });

    it("a secret spelled out with spaces, reversed, or used as the count label", () => {
        const spaced = (seed: number): KitGame<GuessingState> => faulty(twentyDoors(seed), (healthy: Cartridge<GuessingState>) => ({
            publicScene: (state: GuessingState): Scene => ({ ...healthy.publicScene(state), blocks: [{ type: "text", text: state.secret.split("").join(" ") }] }),
        }));
        assert.match(twentyDoorsProblems(spaced), /the secret reached the screen/);
        const reversed = (seed: number): KitGame<GuessingState> => faulty(twentyDoors(seed), (healthy: Cartridge<GuessingState>) => ({
            publicScene: (state: GuessingState): Scene => ({ ...healthy.publicScene(state), blocks: [{ type: "text", text: [...state.secret].reverse().join("") }] }),
        }));
        assert.match(twentyDoorsProblems(reversed), /the secret reached the screen/);
        const named: GuessingBlueprint = structuredClone(TWENTY_DOORS_BLUEPRINT);
        named.decisions.categories = [{ name: "an animal", fallback: "platypus" }];
        named.decisions.count.label = "Platypus";
        assert.match(twentyDoorsProblems((seed: number) => twentyDoors(seed, named)), /the secret reached the screen/);
    });

    it("a ruling that silently stops working", () => {
        const deaf = (seed: number): KitGame<GuessingState> => faulty(twentyDoors(seed), (healthy: Cartridge<GuessingState>) => ({
            onEvent: (state: GuessingState, event: RoomEvent): Step<GuessingState> => (event.type === "hostRuled" && event.ruling === "no" ? { state, facts: [] } : healthy.onEvent(state, event)),
        }));
        assert.match(twentyDoorsProblems(deaf), /The ruling "no" was allowed but did nothing/);
    });

    it("state changed in place, and rules that throw, without crashing the rehearsal", () => {
        const mutating = (seed: number): KitGame<GuessingState> => faulty(twentyDoors(seed), (healthy: Cartridge<GuessingState>) => ({
            onEvent: (state: GuessingState, event: RoomEvent): Step<GuessingState> => {
                if (event.type === "speechEnded") {
                    state.said.push({ speaker: "x", text: event.text, answer: "" });
                }
                return healthy.onEvent(state, event);
            },
        }));
        assert.match(twentyDoorsProblems(mutating), /The rules threw during speechEnded/);
        const throwing = (seed: number): KitGame<GuessingState> => faulty(twentyDoors(seed), () => ({
            publicScene: (): Scene => {
                throw new Error("broken screen");
            },
        }));
        assert.match(twentyDoorsProblems(throwing), /broken screen/);
    });

    it("a game that never ends, and a fact with no decision", () => {
        const endless: GuessingBlueprint = structuredClone(TWENTY_DOORS_BLUEPRINT);
        for (const answer of Object.values(endless.decisions.answers)) {
            answer.spends = false;
        }
        assert.match(twentyDoorsProblems((seed: number) => twentyDoors(seed, endless)), /never ended/);
        const unexplained = (seed: number): KitGame<GuessingState> => faulty(twentyDoors(seed), (healthy: Cartridge<GuessingState>) => ({
            onEvent: (state: GuessingState, event: RoomEvent): Step<GuessingState> => {
                const step: Step<GuessingState> = healthy.onEvent(state, event);
                return { ...step, facts: step.facts.filter((fact: ScopedFact) => fact.scope.kind !== "system") };
            },
        }));
        assert.match(twentyDoorsProblems(unexplained), /names no decision/);
    });

    it("the Plant's card on every phone, and a host told who the Plant is", () => {
        const cards = (seed: number): KitGame<PlantState> => faulty(leadingQuestions(seed), (healthy: Cartridge<PlantState>) => ({
            privateControls: (state: PlantState): Control[] => healthy.privateControls(state, state.plantId),
        }));
        const problems: string = rehearseMany(cards, plantPersonas(), [1]).problems.join("\n");
        assert.match(problems, /the word reached phone/);
        assert.match(problems, /the Plant's card reached phone/);
        const players: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);
        const told: { game: KitGame<PlantState>; holderId: string }[] = players.map((player: CartridgePlayer, seat: number) => {
            const values: number[] = [0, (seat + 0.5) / players.length];
            const game: KitGame<PlantState> = createPlantGame(LEADING_QUESTIONS_BLUEPRINT.box, LEADING_QUESTIONS_BLUEPRINT.decisions, () => values.shift() ?? 0);
            const leaky: KitGame<PlantState> = faulty(game, (healthy: Cartridge<PlantState>) => ({
                hostFacts: (state: PlantState, scope: Scope): ScopedFact[] => [...healthy.hostFacts(state, scope), { scope: { kind: "host" }, kind: "plant", text: `The Plant is ${state.plantId}.` }],
            }));
            return { game: leaky, holderId: player.playerId };
        });
        assert.match(roleBlindness(told, blindScript(), players).join("\n"), /host could tell/);
    });
});
