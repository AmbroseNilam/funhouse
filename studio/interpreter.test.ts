// Proves the Twenty Doors blueprint plays as the hand-written game does: the secret is
// host-only, every ruled answer opens a door, the last door loses, a correct guess wins, giving
// up loses, chat opens nothing, and the screen shows what the scenario script expects to see.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Step } from "../shared/cartridge.ts";
import { canSee, hostMaySee, type ScopedFact } from "../shared/visibility.ts";
import { blueprintProblems } from "./blueprint.ts";
import { TWENTY_DOORS_BLUEPRINT } from "./games/twenty-doors.ts";
import { BECAUSE_KIND, createBlueprintGame, type BlueprintGame, type BlueprintState } from "./interpreter.ts";
import { PAPER_PLAYERS } from "./rehearse.ts";

/** A predictable random source: always the first category. */
const FIRST = (): number => 0;

/**
 * Starts a game and lets the model fail, so the fallback secret is used.
 * @returns the game and its state in the asking phase.
 */
function startAsking(): { game: BlueprintGame; state: BlueprintState } {
    const game: BlueprintGame = createBlueprintGame(TWENTY_DOORS_BLUEPRINT, FIRST);
    const started: Step<BlueprintState> = game.cartridge.init(PAPER_PLAYERS, {});
    const ready: Step<BlueprintState> = game.cartridge.onEvent(started.state, { type: "contentReady", at: 0, text: "" });
    return { game, state: ready.state };
}

/**
 * Says a line and has the judge rule on it.
 * @param game the game.
 * @param state the state.
 * @param ruling the ruling.
 * @returns the step after the ruling.
 */
function ruled(game: BlueprintGame, state: BlueprintState, ruling: string): Step<BlueprintState> {
    const heard: Step<BlueprintState> = game.cartridge.onEvent(state, { type: "speechEnded", at: 1, playerId: "paper1", text: "Is it alive?" });
    return game.cartridge.onEvent(heard.state, { type: "hostRuled", at: 2, ruling, detail: "", playerId: "paper1" });
}

describe("the twenty doors blueprint", () => {
    it("is runnable and makes the same manifest shape as the hand-written game", () => {
        assert.deepEqual(blueprintProblems(TWENTY_DOORS_BLUEPRINT), []);
        const game: BlueprintGame = createBlueprintGame(TWENTY_DOORS_BLUEPRINT, FIRST);
        assert.equal(game.cartridge.manifest.id, "twentyDoors");
        assert.deepEqual(game.cartridge.manifest.phases.map((phase) => phase.id), ["choosing", "asking", "end"]);
        assert.deepEqual(Object.keys(game.cartridge.manifest.phases[1]?.hostRulings ?? {}), ["yes", "no", "sortof", "wrong", "correct", "giveup"]);
    });

    it("asks the model for a secret, falls back when it fails, and tells only the host", () => {
        const game: BlueprintGame = createBlueprintGame(TWENTY_DOORS_BLUEPRINT, FIRST);
        const started: Step<BlueprintState> = game.cartridge.init(PAPER_PLAYERS, {});
        assert.match(started.contentRequest ?? "", /an animal/);
        const { state } = startAsking();
        assert.equal(state.secret, "Platypus");
        assert.equal(state.phase, "asking");
        const facts = game.cartridge.hostFacts(state, { kind: "host" });
        const secret = facts.find((fact) => fact.kind === "secret");
        assert.ok(secret !== undefined);
        assert.equal(hostMaySee(secret.scope, { kind: "host" }), true);
        assert.equal(canSee(secret.scope, null, new Set()), false);
        assert.deepEqual(game.cartridge.hostFacts(state, { kind: "public" }), []);
    });

    it("opens a door per ruled answer and names the decision behind every fact", () => {
        const { game, state } = startAsking();
        const yes: Step<BlueprintState> = ruled(game, state, "yes");
        assert.equal(yes.state.spent, 1);
        assert.equal(yes.state.said[0]?.answer, "Yes");
        const chat: Step<BlueprintState> = ruled(game, yes.state, "nothing");
        assert.equal(chat.state.spent, 1, "an unknown ruling opens nothing");
        let current: BlueprintState = yes.state;
        while (current.spent < 14) {
            current = ruled(game, current, "no").state;
        }
        const warned: Step<BlueprintState> = ruled(game, current, "no");
        assert.equal(warned.state.spent, 15, "five doors left");
        assert.equal(warned.facts[0]?.kind, "count-left");
        const explanation: ScopedFact | undefined = warned.facts[1];
        assert.ok(explanation !== undefined);
        assert.equal(explanation.kind, BECAUSE_KIND);
        assert.equal(explanation.text, "count.warnAt");
        assert.equal(explanation.scope.kind, "system");
    });

    it("loses on the last door and tells the host the secret", () => {
        const { game, state } = startAsking();
        let current: BlueprintState = state;
        while (game.cartridge.outcome(current) === null) {
            current = ruled(game, current, "wrong").state;
        }
        assert.equal(current.spent, 20);
        assert.equal(current.won, false);
        assert.equal(game.cartridge.outcome(current), "The secret was Platypus.");
        assert.equal(game.cartridge.publicScene(current).blocks[0]?.type, "title");
    });

    it("wins on a correct guess and loses on giving up, by ruling or by button", () => {
        const { game, state } = startAsking();
        const won: Step<BlueprintState> = ruled(game, state, "correct");
        assert.equal(won.state.won, true);
        assert.equal(game.cartridge.outcome(won.state), "Teacup found Platypus.");
        assert.equal(won.facts[1]?.text, "judge.rulings.correct");
        const gaveUp: Step<BlueprintState> = game.cartridge.onEvent(state, { type: "hostRuled", at: 3, ruling: "giveup", detail: "", playerId: null });
        assert.equal(gaveUp.state.phase, "end");
        assert.deepEqual(game.cartridge.legalActions(state, "paper2"), [{ actionId: "giveup", label: "We give up" }]);
        const pressed: Step<BlueprintState> = game.cartridge.apply(state, "paper2", "giveup");
        assert.equal(pressed.state.phase, "end");
        assert.equal(pressed.facts[1]?.text, "giveUp");
        const ignored: Step<BlueprintState> = game.cartridge.apply(state, "paper2", "shout");
        assert.equal(ignored.state, state);
        assert.equal(ignored.facts.length, 0);
    });

    it("shows the screen the scenario script waits for", () => {
        const { game, state } = startAsking();
        const asking = game.cartridge.publicScene(state);
        assert.equal(asking.blocks[0]?.type === "title" ? asking.blocks[0].text : "", "It's an animal");
        const progress = asking.blocks.find((block) => block.type === "progress");
        assert.ok(progress !== undefined && progress.max === 20);
        assert.equal(game.cartridge.privateControls(state, "paper1")[0]?.type, "waiting");
    });
});
