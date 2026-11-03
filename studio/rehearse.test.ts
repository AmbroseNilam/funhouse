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
import type { Turn } from "../shared/turn.ts";
import type { Scope, ScopedFact } from "../shared/visibility.ts";
import type { GuessingBlueprint } from "./blueprint.ts";
import { LEADING_QUESTIONS_BLUEPRINT } from "./games/leading-questions.ts";
import { TWENTY_DOORS_BLUEPRINT } from "./games/twenty-doors.ts";
import type { HiddenValue, KitGame } from "./kit/kit.ts";
import { seededRandom } from "./kit/primitives.ts";
import { createGuessingGame, type GuessingState } from "./kits/guessing.ts";
import { createPlantGame, type PlantDecisions, type PlantState } from "./kits/plant.ts";
import { checkBlueprint } from "./check.ts";
import { guessingPersonas, plantPersonas, plantRoleCheck } from "./personas.ts";
import { appears, findLeaks, PAPER_PLAYERS, stringsIn, rehearse, rehearseMany, type Glimpse, type Move, type Persona, type Rehearsal, type RoleCheck, type Tally, type TraceEntry } from "./rehearse.ts";

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
        const tally: Tally = checkBlueprint(TWENTY_DOORS_BLUEPRINT);
        assert.equal(tally.rehearsals, 20);
        assert.equal(tally.ended, 20);
        assert.deepEqual(tally.phasesNeverReached, []);
        assert.deepEqual(tally.problems, []);
        assert.ok(Date.now() - startedAt < 2000, "twenty rehearsals run in under two seconds");
    });

    it("rehearses leading questions and reaches every ending it has, with the model failing and succeeding", () => {
        for (const content of ["", "teapot"]) {
            const tally: Tally = checkBlueprint(LEADING_QUESTIONS_BLUEPRINT, { content });
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
            assert.deepEqual(checkBlueprint(LEADING_QUESTIONS_BLUEPRINT, { players }).problems, []);
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
});

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
        const named = (seed: number): KitGame<PlantState> => faulty(leadingQuestions(seed), (rules: Cartridge<PlantState>) => ({
            hostFacts: (state: PlantState, scope: Scope): ScopedFact[] => [...rules.hostFacts(state, scope), { scope: { kind: "host" }, kind: "plant", text: `The Plant is ${state.plantId}.` }],
        }));
        assert.match(rehearseMany(named, plantPersonas(), [1]).problems.join("\n"), /who the Plant is reached the host/, "caught by an ordinary rehearsal, without the role check");
        const healthy: RoleCheck<PlantState> = plantRoleCheck(LEADING_QUESTIONS_BLUEPRINT);
        const told: RoleCheck<PlantState> = {
            script: healthy.script,
            deal: (seat: number, players: readonly CartridgePlayer[]): KitGame<PlantState> => faulty(healthy.deal(seat, players), (rules: Cartridge<PlantState>) => ({
                hostFacts: (state: PlantState, scope: Scope): ScopedFact[] => [...rules.hostFacts(state, scope), { scope: { kind: "host" }, kind: "plant", text: `The Plant is ${state.plantId}.` }],
            })),
        };
        assert.match(rehearseMany(leadingQuestions, plantPersonas(), [1], { roleCheck: told }).problems.join("\n"), /role check: .*host could tell/);
        const marked: RoleCheck<PlantState> = {
            script: healthy.script,
            deal: (seat: number, players: readonly CartridgePlayer[]): KitGame<PlantState> => faulty(healthy.deal(seat, players), (rules: Cartridge<PlantState>) => ({
                publicScene: (state: PlantState): Scene => ({
                    ...rules.publicScene(state),
                    blocks: [...rules.publicScene(state).blocks, { type: "tally", title: "Seats", rows: state.players.map((player: CartridgePlayer) => ({ label: player.name, count: 0, highlight: player.playerId === state.plantId })) }],
                }),
            })),
        };
        assert.match(rehearseMany(leadingQuestions, plantPersonas(), [1], { roleCheck: marked }).problems.join("\n"), /screen could tell/);
        const voteOnly: RoleCheck<PlantState> = {
            script: healthy.script,
            deal: (seat: number, players: readonly CartridgePlayer[]): KitGame<PlantState> => faulty(healthy.deal(seat, players), (rules: Cartridge<PlantState>) => ({
                publicScene: (state: PlantState): Scene => {
                    const scene: Scene = rules.publicScene(state);
                    return state.phase === "vote" ? { ...scene, blocks: [...scene.blocks, { type: "text", text: `${state.voters.indexOf(state.plantId)}` }] } : scene;
                },
            })),
        };
        assert.match(rehearseMany(leadingQuestions, plantPersonas(), [1], { roleCheck: voteOnly }).problems.join("\n"), /screen could tell/, "a tell only in the vote is caught");
    });

    it("a word split across two strings, and a short word, without mistaking it inside another", () => {
        assert.equal(appears(["Col", "ander"], "Colander"), true);
        assert.equal(appears(["We found an ox."], "ox"), true);
        assert.equal(appears(["Badge: O K"], "ok"), true, "a short word spaced out");
        assert.equal(appears(["o-k?"], "ok"), true, "a short word punctuated");
        assert.equal(appears(["A good book."], "ok"), false);
        assert.equal(appears(["It fits in a box."], "ox"), false);
        assert.equal(appears(["xo"], "ox"), false, "short words are matched whole, not reversed");
    });

    it("a name beside the word Plant only as a whole word", () => {
        const eve: HiddenValue[] = [{ label: "who the Plant is", text: "Eve", seenBy: ["paper1"], near: "plant" }];
        assert.deepEqual(findLeaks("host", ["You never know who the Plant is."], eve), [], "not inside another word");
        assert.equal(findLeaks("host", ["The Plant is Eve."], eve).length, 1);
        assert.equal(findLeaks("host", ["The Plant is E-v-e."], eve).length, 1, "spelled out");
        const john: HiddenValue[] = [{ label: "who the Plant is", text: "John", seenBy: ["paper1"], near: "plant" }];
        assert.equal(findLeaks("host", ["The Plant is nhoJ."], john).length, 1, "reversed");
        const table: CartridgePlayer[] = ["Eve", "Spoon", "Candle", "Saucer"].map((name: string, index: number) => ({ playerId: `paper${index + 1}`, name }));
        assert.deepEqual(checkBlueprint(LEADING_QUESTIONS_BLUEPRINT, { players: table }).problems, [], "a whole game with a player named Eve finds nothing");
        const badged = (seed: number): KitGame<PlantState> => faulty(leadingQuestions(seed), (rules: Cartridge<PlantState>) => ({
            publicScene: (state: PlantState): Scene => {
                const name: string = state.players.find((player: CartridgePlayer) => player.playerId === state.plantId)?.name ?? "";
                return { ...rules.publicScene(state), blocks: [...rules.publicScene(state).blocks, { type: "roster", players: [{ playerId: state.plantId, name, speaking: false, muted: false, badge: "Plant" }] }] };
            },
        }));
        assert.match(rehearseMany(badged, plantPersonas(), [1]).problems.join("\n"), /who the Plant is reached the screen/, "a roster badge saying Plant on the Plant's name");
        const turned = (seed: number): KitGame<PlantState> => faulty(leadingQuestions(seed), (rules: Cartridge<PlantState>) => ({
            turn: (state: PlantState): Turn | null => (state.phase === "asking" ? { kind: "one", playerId: state.plantId, label: "Plant turn" } : rules.turn?.(state) ?? null),
        }));
        assert.match(rehearseMany(turned, plantPersonas(), [1]).problems.join("\n"), /who the Plant is reached the screen/, "a turn that names the Plant, shown as their name");
    });

    it("no word made by gluing a block's kind to its text", () => {
        const tent: HiddenValue[] = [{ label: "the word", text: "tent", seenBy: ["host"] }];
        const scene: Scene = { mood: "neutral", transition: "cut", blocks: [{ type: "text", text: "Ten" }] };
        assert.deepEqual(findLeaks("screen", stringsIn(scene), tent), [], "\"text\" and \"Ten\" are not \"tent\"");
        const shown: Scene = { mood: "neutral", transition: "cut", blocks: [{ type: "text", text: "A tent." }] };
        assert.equal(findLeaks("screen", stringsIn(shown), tent).length, 1);
    });

    it("a timer that is due fires before the next thing a player does", () => {
        const decisions: PlantDecisions = { ...LEADING_QUESTIONS_BLUEPRINT.decisions, askingSeconds: 60 };
        const fast = (seed: number): KitGame<PlantState> => createPlantGame(LEADING_QUESTIONS_BLUEPRINT.box, decisions, seededRandom(seed));
        let openedAt: number = -1;
        const late: Persona<PlantState> = {
            name: "the late guesser",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return { kind: "wait", seconds: 5 };
                }
                openedAt = openedAt === -1 ? glimpse.now : openedAt;
                if (glimpse.now < openedAt + 57) {
                    return { kind: "wait", seconds: openedAt + 57 - glimpse.now };
                }
                return { kind: "say", playerId: "paper1", text: `Is it a ${glimpse.state.word}?`, ruling: "correct" };
            },
        };
        const rehearsal: Rehearsal<PlantState> = rehearse(fast(1), late, 1);
        assert.deepEqual(rehearsal.problems, []);
        assert.match(rehearsal.outcome ?? "", /The word was/, "the clock ran out before the late guess was heard");
    });
});
