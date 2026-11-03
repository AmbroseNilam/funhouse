// Proves the Twenty Doors blueprint plays as the hand-written game does: the secret is
// host-only, every ruled answer opens a door, the last door loses, a correct guess wins, giving
// up loses, chat opens nothing, and the screen shows what the scenario script expects to see.
// Also the guessing kit's checks, and that a game never shares objects with its blueprint.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InstalledGame } from "../../cartridges/index.ts";
import type { PhaseSpec, Step } from "../../shared/cartridge.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { canSee, hostMaySee, type ScopedFact } from "../../shared/visibility.ts";
import { blueprintProblems, type GuessingBlueprint } from "../blueprint.ts";
import { TWENTY_DOORS_BLUEPRINT } from "../games/twenty-doors.ts";
import type { KitGame } from "../kit/kit.ts";
import { BECAUSE_KIND } from "../kit/primitives.ts";
import { PAPER_PLAYERS } from "../rehearse.ts";
import { installBlueprint } from "../shelf.ts";
import { createGuessingGame, GIVE_UP_ACTION, type GuessingState } from "./guessing.ts";

/** A predictable random source: always the first category. */
const FIRST = (): number => 0;

/**
 * Builds Twenty Doors from its blueprint.
 * @param blueprint the blueprint; Twenty Doors unless given.
 * @returns the game.
 */
function twentyDoors(blueprint: GuessingBlueprint = TWENTY_DOORS_BLUEPRINT): KitGame<GuessingState> {
    return createGuessingGame(blueprint.box, blueprint.decisions, FIRST);
}

/**
 * Starts a game and lets the model fail, so the fallback secret is used.
 * @returns the game and its state in the asking phase.
 */
function startAsking(): { game: KitGame<GuessingState>; state: GuessingState } {
    const game: KitGame<GuessingState> = twentyDoors();
    const started: Step<GuessingState> = game.cartridge.init([...PAPER_PLAYERS], {});
    const ready: Step<GuessingState> = game.cartridge.onEvent(started.state, { type: "contentReady", at: 0, text: "" });
    return { game, state: ready.state };
}

/**
 * Says a line and has the judge rule on it.
 * @param game the game.
 * @param state the state.
 * @param ruling the ruling.
 * @returns the step after the ruling.
 */
function ruled(game: KitGame<GuessingState>, state: GuessingState, ruling: string): Step<GuessingState> {
    const heard: Step<GuessingState> = game.cartridge.onEvent(state, { type: "speechEnded", at: 1, playerId: "paper1", text: "Is it alive?" });
    return game.cartridge.onEvent(heard.state, { type: "hostRuled", at: 2, ruling, detail: "", playerId: "paper1" });
}

describe("the twenty doors blueprint", () => {
    it("is runnable and makes the same manifest shape as the hand-written game", () => {
        assert.deepEqual(blueprintProblems(TWENTY_DOORS_BLUEPRINT), []);
        const game: KitGame<GuessingState> = twentyDoors();
        assert.equal(game.cartridge.manifest.id, "twentyDoors");
        assert.deepEqual(game.cartridge.manifest.phases.map((phase: PhaseSpec) => phase.id), ["choosing", "asking", "end"]);
        assert.deepEqual(Object.keys(game.cartridge.manifest.phases[1]?.hostRulings ?? {}), ["yes", "no", "sortof", "wrong", "correct", "giveup"]);
        assert.match(game.cartridge.manifest.phases[1]?.hostBrief ?? "", /uses no door\. Don't count doors/);
    });

    it("asks the model for a secret, falls back when it fails, and tells only the host", () => {
        const game: KitGame<GuessingState> = twentyDoors();
        const started: Step<GuessingState> = game.cartridge.init([...PAPER_PLAYERS], {});
        assert.match(started.contentRequest ?? "", /an animal/);
        const { state } = startAsking();
        assert.equal(state.secret, "Platypus");
        assert.equal(state.phase, "asking");
        const secret: ScopedFact | undefined = game.cartridge.hostFacts(state, { kind: "host" }).find((fact: ScopedFact) => fact.kind === "secret");
        assert.ok(secret !== undefined);
        assert.equal(hostMaySee(secret.scope, { kind: "host" }), true);
        assert.equal(canSee(secret.scope, null, new Set()), false);
        assert.deepEqual(game.cartridge.hostFacts(state, { kind: "public" }), []);
    });

    it("opens a door per ruled answer and names the decision behind every fact", () => {
        const { game, state } = startAsking();
        const yes: Step<GuessingState> = ruled(game, state, "yes");
        assert.equal(yes.state.count.used, 1);
        assert.equal(yes.state.said[0]?.answer, "Yes");
        assert.equal(ruled(game, yes.state, "nothing").state.count.used, 1, "an unknown ruling opens nothing");
        let current: GuessingState = yes.state;
        while (current.count.used < 14) {
            current = ruled(game, current, "no").state;
        }
        const warned: Step<GuessingState> = ruled(game, current, "no");
        assert.equal(warned.state.count.used, 15, "five doors left");
        assert.equal(warned.facts[0]?.kind, "count-left");
        const explanation: ScopedFact | undefined = warned.facts[1];
        assert.ok(explanation !== undefined);
        assert.equal(explanation.kind, BECAUSE_KIND);
        assert.equal(explanation.text, "count.warnAt");
        assert.equal(explanation.scope.kind, "system");
    });

    it("loses on the last door and tells the host the secret", () => {
        const { game, state } = startAsking();
        let current: GuessingState = state;
        while (game.cartridge.outcome(current) === null) {
            current = ruled(game, current, "wrong").state;
        }
        assert.equal(current.count.used, 20);
        assert.equal(current.won, false);
        assert.equal(game.cartridge.outcome(current), "The secret was Platypus.");
    });

    it("wins on a correct guess and loses on giving up, by ruling or by button", () => {
        const { game, state } = startAsking();
        const won: Step<GuessingState> = ruled(game, state, "correct");
        assert.equal(won.state.won, true);
        assert.equal(game.cartridge.outcome(won.state), "Teacup found Platypus.");
        assert.equal(won.facts[1]?.text, "answers.correct");
        assert.equal(game.cartridge.onEvent(state, { type: "hostRuled", at: 3, ruling: "giveup", detail: "", playerId: null }).state.phase, "end");
        assert.deepEqual(game.cartridge.legalActions(state, "paper2"), [{ actionId: GIVE_UP_ACTION, label: "We give up" }]);
        const pressed: Step<GuessingState> = game.cartridge.apply(state, "paper2", GIVE_UP_ACTION);
        assert.equal(pressed.state.phase, "end");
        assert.equal(pressed.facts[1]?.text, "giveUpButton");
        const ignored: Step<GuessingState> = game.cartridge.apply(state, "paper2", "shout");
        assert.equal(ignored.state, state);
        assert.equal(ignored.facts.length, 0);
    });

    it("matches each ruling to the person it answers, so overlapping replies keep a correct guess", () => {
        const { game, state } = startAsking();
        let current: GuessingState = game.cartridge.onEvent(state, { type: "speechEnded", at: 1, playerId: "paper1", text: "Is it alive?" }).state;
        current = game.cartridge.onEvent(current, { type: "speechEnded", at: 2, playerId: "paper2", text: "Is it a platypus?" }).state;
        const late: Step<GuessingState> = game.cartridge.onEvent(current, { type: "hostRuled", at: 3, ruling: "yes", detail: "", playerId: "paper1" });
        assert.equal(late.state.said.at(-1)?.text, "Is it alive?");
        const found: Step<GuessingState> = game.cartridge.onEvent(late.state, { type: "hostRuled", at: 4, ruling: "correct", detail: "", playerId: "paper2" });
        assert.equal(found.state.won, true);
        assert.equal(found.state.finder, "Spoon");
        const unnamed: Step<GuessingState> = game.cartridge.onEvent(current, { type: "hostRuled", at: 5, ruling: "no", detail: "", playerId: "paper4" });
        assert.equal(unnamed.state.said.at(-1)?.text, "Is it alive?", "a ruling for someone with nothing waiting takes the oldest line");
        assert.equal(game.cartridge.onEvent(state, { type: "hostRuled", at: 6, ruling: "no", detail: "", playerId: "paper1" }).state, state, "nothing waiting, nothing ruled");
    });

    it("records a free answer without spending, so the ruling still visibly works", () => {
        const free: GuessingBlueprint = structuredClone(TWENTY_DOORS_BLUEPRINT);
        free.decisions.answers.sortof.spends = false;
        const game: KitGame<GuessingState> = twentyDoors(free);
        const ready: GuessingState = game.cartridge.onEvent(game.cartridge.init([...PAPER_PLAYERS], {}).state, { type: "contentReady", at: 0, text: "" }).state;
        const after: Step<GuessingState> = ruled(game, ready, "sortof");
        assert.equal(after.state.count.used, 0);
        assert.equal(after.state.said.length, 1);
    });

    it("shows the screen the scenario script waits for", () => {
        const { game, state } = startAsking();
        const blocks: SceneBlock[] = game.cartridge.publicScene(state).blocks;
        assert.equal(blocks[0]?.type === "title" ? blocks[0].text : "", "It's an animal");
        const progress: SceneBlock | undefined = blocks.find((block: SceneBlock) => block.type === "progress");
        assert.ok(progress !== undefined && progress.max === 20);
        assert.equal(game.cartridge.privateControls(state, "paper1")[0]?.type, "waiting");
        assert.deepEqual(game.cartridge.turn?.(state), { kind: "anyone", label: "Anyone can ask" });
    });
});

describe("guessing checks and copying", () => {
    it("rejects counts and warnings that aren't finite whole numbers", () => {
        const broken: GuessingBlueprint = structuredClone(TWENTY_DOORS_BLUEPRINT);
        broken.decisions.count.budget = Number.NaN;
        assert.notDeepEqual(blueprintProblems(broken), []);
        const warning: GuessingBlueprint = structuredClone(TWENTY_DOORS_BLUEPRINT);
        warning.decisions.count.warnAt = [Number.POSITIVE_INFINITY];
        assert.notDeepEqual(blueprintProblems(warning), []);
        const everythingFree: GuessingBlueprint = structuredClone(TWENTY_DOORS_BLUEPRINT);
        for (const answer of Object.values(everythingFree.decisions.answers)) {
            answer.spends = false;
        }
        assert.match(blueprintProblems(everythingFree).join(" "), /No answer spends/);
    });

    it("refuses a remark that gives away a fallback secret", () => {
        const leaky: GuessingBlueprint = structuredClone(TWENTY_DOORS_BLUEPRINT);
        leaky.box.remarks = ["It's not a whisk. Or is it."];
        assert.match(blueprintProblems(leaky).join(" "), /gives away a secret/);
    });

    it("keeps an installed game and a running game apart from the blueprint they came from", () => {
        const blueprint: GuessingBlueprint = structuredClone(TWENTY_DOORS_BLUEPRINT);
        const installed: InstalledGame = installBlueprint(blueprint);
        const game: KitGame<GuessingState> = twentyDoors(blueprint);
        blueprint.box.name = "Changed";
        blueprint.box.howToPlay.push("Changed");
        blueprint.decisions.count.budget = 1;
        assert.equal(installed.manifest.name, "Twenty Doors");
        assert.equal(installed.howToPlay.length, 3);
        assert.equal(game.cartridge.manifest.name, "Twenty Doors");
        assert.equal(game.cartridge.init([...PAPER_PLAYERS], {}).state.count.max, 20);
    });
});
