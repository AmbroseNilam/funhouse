// Proves Magpie Pockets: the deck, the free first card, simultaneous draw or stay, repeats busting
// and staying banking, stale clocks, leavers, the win rule, what the TV and phones show, the
// secrecy check catching a TV that shows a choice, and the hidden-card check catching the next card.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Cartridge, CartridgePlayer, Step } from "../../../shared/cartridge.ts";
import type { Control } from "../../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../../shared/scene.ts";
import { blueprintProblems } from "../../blueprint.ts";
import { checkBlueprint } from "../../check.ts";
import { MAGPIE_POCKETS_BLUEPRINT } from "../../games/magpie-pockets/blueprint.ts";
import type { HiddenValue, KitGame } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { pushChoiceCheck, pushPersonas } from "../../personas.ts";
import { PAPER_PLAYERS, rehearse, rehearseMany, stringsIn, type RoleCheck } from "../../rehearse.ts";
import { createPushGame, PUSH_PREFIX, pushProblems, type PushDecisions, type PushState } from "./tap-push.ts";

/** Four at the table. */
const FOUR: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);

/** The game's decisions. */
const DECISIONS: PushDecisions = MAGPIE_POCKETS_BLUEPRINT.decisions;

/** Card indexes, by name. */
const [BUTTON, TEASPOON, KEY, MARBLE, THIMBLE] = [0, 1, 2, 3, 4];

/**
 * Builds the game and opens the first round with the fallback lines.
 * @param seed the shuffle seed.
 * @returns the game and the state while choosing.
 */
function start(seed: number = 3): { game: KitGame<PushState>; state: PushState } {
    const game: KitGame<PushState> = createPushGame(MAGPIE_POCKETS_BLUEPRINT.box, DECISIONS, seededRandom(seed));
    const begun: Step<PushState> = game.cartridge.init(FOUR, {});
    const opened: Step<PushState> = game.cartridge.onEvent(begun.state, { type: "contentReady", at: 0, text: "" });
    return { game, state: opened.state };
}

/**
 * The state with a chosen deck and pockets, so a flip is known.
 * @param state a state while choosing.
 * @param deck the next cards, next first.
 * @param hands pockets by player id; anyone not named keeps a Button.
 * @returns the state.
 */
function staged(state: PushState, deck: number[], hands: Record<string, number[]>): PushState {
    const filled: Record<string, number[]> = Object.fromEntries(
        state.players.map((player: CartridgePlayer): [string, number[]] => [player.playerId, hands[player.playerId] ?? [BUTTON]]),
    );
    return { ...state, deck, hands: filled, seen: [...new Set(Object.values(filled).flat())] };
}

/**
 * Everyone chooses.
 * @param game the game.
 * @param state the state.
 * @param choices draw or stay by player id.
 * @returns the last step.
 */
function chooseAll(game: KitGame<PushState>, state: PushState, choices: Record<string, "draw" | "stay">): Step<PushState> {
    let step: Step<PushState> = { state, facts: [] };
    for (const [playerId, choice] of Object.entries(choices)) {
        step = game.cartridge.apply(step.state, playerId, `${PUSH_PREFIX}${choice}`);
    }
    return step;
}

describe("magpie pockets", () => {
    it("is runnable, asks the model for lines, and flips a free first card for everyone", () => {
        assert.deepEqual(blueprintProblems(MAGPIE_POCKETS_BLUEPRINT), []);
        const game: KitGame<PushState> = createPushGame(MAGPIE_POCKETS_BLUEPRINT.box, DECISIONS, seededRandom(1));
        assert.match(game.cartridge.init(FOUR, {}).contentRequest ?? "", /JSON array/);
        const { state } = start();
        assert.equal(state.phase, "choosing");
        assert.equal(state.deck.length, 29);
        const first: number[] = state.hands.paper1 ?? [];
        assert.equal(first.length, 1);
        for (const player of FOUR) {
            assert.deepEqual(state.hands[player.playerId], first);
        }
        const written: Step<PushState> = game.cartridge.onEvent(game.cartridge.init(FOUR, {}).state, { type: "contentReady", at: 0, text: '["Greed has a sound, and it is quiet.","Too loud!"]' });
        assert.equal(written.state.lines[0], "Greed has a sound, and it is quiet.");
        assert.equal(written.state.lines.includes("Too loud!"), false, "no shouting");
    });

    it("flips one shared card: repeats bust and score nothing, new cards join the pocket, stayers bank", () => {
        const { game, state } = start();
        const set: PushState = staged(state, [KEY, THIMBLE], { paper1: [KEY, BUTTON], paper2: [MARBLE], paper3: [TEASPOON, MARBLE], paper4: [BUTTON] });
        const revealed: Step<PushState> = chooseAll(game, set, { paper1: "draw", paper2: "draw", paper3: "stay", paper4: "stay" });
        assert.equal(revealed.state.phase, "reveal");
        assert.equal(revealed.state.flipped, KEY);
        assert.equal(revealed.state.standing.paper1, "bust");
        assert.deepEqual(revealed.state.hands.paper1, []);
        assert.equal(revealed.state.lost.paper1, 3);
        assert.deepEqual(revealed.state.hands.paper2, [MARBLE, KEY]);
        assert.equal(revealed.state.standing.paper3, "stayed");
        assert.equal(revealed.state.banked.paper3, 3);
        assert.equal(revealed.state.banked.paper4, 1);
        assert.equal(revealed.state.banked.paper1, undefined, "a bust banks nothing");
        assert.equal(revealed.state.deck[0], THIMBLE);
        assert.equal(revealed.state.roundOver, false);
        assert.match(revealed.facts[0]?.text ?? "", /Teacup busted and lost 3.*Candle stayed and banked 3/);
        assert.match(revealed.facts[0]?.text ?? "", /Spoon holds 4 with a 0 percent chance of a repeat/, "the host is given the odds, from code");
        assert.match(revealed.facts[0]?.text ?? "", /Still choosing: Spoon\./, "someone who stayed is not still choosing");
    });

    it("ends the round when everyone has stayed or busted, banks only what stayed, and opens the next round", () => {
        const { game, state } = start();
        const set: PushState = staged(state, [KEY, THIMBLE], { paper1: [KEY], paper2: [BUTTON, MARBLE], paper3: [BUTTON], paper4: [BUTTON] });
        const done: Step<PushState> = chooseAll(game, set, { paper1: "draw", paper2: "stay", paper3: "stay", paper4: "stay" });
        assert.equal(done.state.roundOver, true);
        assert.deepEqual(done.state.banked, { paper2: 3, paper3: 1, paper4: 1 });
        const next: Step<PushState> = game.cartridge.onEvent(done.state, { type: "timerFired", at: 9, timerId: `reveal${done.state.beat}` });
        assert.equal(next.state.phase, "choosing");
        assert.equal(next.state.round, 1);
        assert.equal(next.state.deck.length, 29, "a fresh deck");
        assert.deepEqual(next.state.banked, { paper2: 3, paper3: 1, paper4: 1 }, "banked points carry over");
        assert.deepEqual(next.state.choices, {});
    });

    it("lets a player choose once a beat, only while in, and shows no choice before the flip", () => {
        const { game, state } = start();
        assert.equal(game.cartridge.legalActions(state, "paper1").length, 2);
        const drew: PushState = game.cartridge.apply(state, "paper1", `${PUSH_PREFIX}draw`).state;
        assert.equal(game.cartridge.apply(drew, "paper1", `${PUSH_PREFIX}stay`).state, drew, "only once");
        assert.equal(game.cartridge.apply(drew, "paper2", "push:fold").state, drew, "unknown actions are ignored");
        assert.equal(game.cartridge.legalActions(drew, "paper1").length, 0);
        assert.equal(game.cartridge.turn?.(drew)?.kind, "everyone");
        assert.deepEqual(game.cartridge.publicScene(drew), game.cartridge.publicScene(state), "the TV is the same after a choice");
        assert.deepEqual(game.cartridge.privateControls(drew, "paper2"), game.cartridge.privateControls(state, "paper2"), "so is every other phone");
        assert.match(stringsIn(game.cartridge.privateControls(drew, "paper1")).join(" "), /Locked in/);
        assert.equal(game.cartridge.hostFacts(drew, { kind: "host" })[0]?.text, "1 of 4 have chosen.");
    });

    it("settles at the clock treating a missing choice as stay, and ignores a stale clock", () => {
        const { game, state } = start();
        const partial: PushState = game.cartridge.apply(staged(state, [KEY], {}), "paper1", `${PUSH_PREFIX}draw`).state;
        assert.equal(game.cartridge.onEvent(partial, { type: "timerFired", at: 3, timerId: "choose999" }).state, partial);
        const timedOut: Step<PushState> = game.cartridge.onEvent(partial, { type: "timerFired", at: 10, timerId: `choose${partial.beat}` });
        assert.equal(timedOut.state.phase, "reveal");
        assert.deepEqual(timedOut.state.banked, { paper2: 1, paper3: 1, paper4: 1 });
        assert.equal(timedOut.state.standing.paper1, "in");
        assert.equal(game.cartridge.onEvent(timedOut.state, { type: "timerFired", at: 11, timerId: `choose${partial.beat}` }).state, timedOut.state);
        const resumed: Step<PushState> = game.cartridge.onEvent(timedOut.state, { type: "timerFired", at: 14, timerId: `reveal${timedOut.state.beat}` });
        assert.equal(resumed.state.phase, "choosing");
        assert.equal(resumed.state.round, 0, "the same round goes on for whoever is still in");
        assert.equal(game.cartridge.turn?.(resumed.state) !== null && (game.cartridge.turn?.(resumed.state) as { playerIds: string[] }).playerIds.join(), "paper1");
    });

    it("ends after the round that reaches the target, with the highest banked winning, and shares a tie", () => {
        const { game, state } = start();
        const late: PushState = { ...staged(state, [KEY], { paper1: [KEY] }), banked: { paper1: 29, paper2: 29, paper3: 28 } };
        const done: Step<PushState> = chooseAll(game, late, { paper1: "stay", paper2: "stay", paper3: "stay", paper4: "stay" });
        const over: Step<PushState> = game.cartridge.onEvent(done.state, { type: "timerFired", at: 0, timerId: `reveal${done.state.beat}` });
        assert.equal(over.state.phase, "end");
        assert.equal(game.cartridge.outcome(over.state), "Someone reached the target.");
        assert.match(over.facts[0]?.text ?? "", /Teacup wins with 31 banked|wins with/);
        const title: SceneBlock | undefined = game.cartridge.publicScene(over.state).blocks[0];
        assert.ok(title?.type === "title");
        assert.equal(title.text, "Teacup takes the pocket");
        const tied: PushState = { ...over.state, banked: { paper1: 31, paper2: 31, paper3: 5 } };
        const tiedTitle: SceneBlock | undefined = game.cartridge.publicScene(tied).blocks[0];
        assert.ok(tiedTitle?.type === "title");
        assert.equal(tiedTitle.text, "Teacup and Spoon take the pocket");
    });

    it("ends when the rounds run out, even with nobody at the target, and handles an all-bust game", () => {
        const { game, state } = start();
        const last: PushState = { ...staged(state, [KEY], { paper1: [KEY], paper2: [KEY], paper3: [KEY], paper4: [KEY] }), round: DECISIONS.maxRounds - 1 };
        const done: Step<PushState> = chooseAll(game, last, { paper1: "draw", paper2: "draw", paper3: "draw", paper4: "draw" });
        assert.equal(done.state.roundOver, true);
        const over: Step<PushState> = game.cartridge.onEvent(done.state, { type: "timerFired", at: 0, timerId: `reveal${done.state.beat}` });
        assert.equal(game.cartridge.outcome(over.state), "Nobody banked a point.");
    });

    it("drops a leaver's pocket and settles the beat at once if everyone left has chosen", () => {
        const { game, state } = start();
        const chosen: PushState = chooseAll(game, staged(state, [THIMBLE], {}), { paper1: "stay", paper2: "stay", paper3: "stay" }).state;
        assert.equal(chosen.phase, "choosing");
        const after: Step<PushState> = game.cartridge.onEvent(chosen, { type: "playerLeft", at: 2, playerId: "paper4" });
        assert.equal(after.state.phase, "reveal");
        assert.equal(after.state.players.length, 3);
        assert.equal(after.state.hands.paper4, undefined);
        assert.equal(after.state.roundOver, true);
    });

    it("shows pockets, odds and a clock to the phones and the TV, and results after the flip", () => {
        const { game, state } = start();
        const set: PushState = staged(state, [KEY, KEY, THIMBLE], { paper1: [KEY, BUTTON] });
        const controls: Control[] = game.cartridge.privateControls(set, "paper1");
        assert.equal(controls[0]?.type, "roleCard");
        assert.match(stringsIn(controls[0]).join(" "), /Your pocket: 3.*2 of the 3 cards left would bust you/);
        const buttons: Control | undefined = controls[1];
        assert.deepEqual(buttons?.type === "buttons" ? buttons.options.map((option) => option.label) : [], ["Draw a card", "Stay and bank 3"]);
        const scene: Scene = game.cartridge.publicScene(set);
        assert.equal(scene.blocks.some((block: SceneBlock) => block.type === "timer"), true);
        const pockets: SceneBlock | undefined = scene.blocks.find((block: SceneBlock) => block.type === "roster");
        assert.equal(pockets?.type === "roster" ? pockets.players[0]?.badge : "", "Brass key, Button (3)");
        assert.match(stringsIn(scene).join(" "), /Nobody has banked yet\. First to 30 wins/);
        const flipped: Step<PushState> = chooseAll(game, set, { paper1: "draw", paper2: "stay", paper3: "stay", paper4: "stay" });
        assert.match(game.cartridge.privateControls(flipped.state, "paper1").map((control) => stringsIn(control).join(" ")).join(" "), /Bust You lost 3/);
        assert.match(game.cartridge.privateControls(flipped.state, "paper2").map((control) => stringsIn(control).join(" ")).join(" "), /Banked 1/);
    });

    it("rejects bad decisions: too few kinds, a duplicate name, a non-finite number, a shouting line", () => {
        assert.notDeepEqual(pushProblems({ ...DECISIONS, cards: DECISIONS.cards.slice(0, 4) }), []);
        assert.notDeepEqual(pushProblems({ ...DECISIONS, cards: [...DECISIONS.cards.slice(0, 9), { name: "button", value: 2, copies: 3 }] }), []);
        assert.notDeepEqual(pushProblems({ ...DECISIONS, chooseSeconds: Number.NaN }), []);
        assert.notDeepEqual(pushProblems({ ...DECISIONS, target: Number.POSITIVE_INFINITY }), []);
        assert.notDeepEqual(pushProblems({ ...DECISIONS, lines: DECISIONS.lines.map((line: string) => `${line}!`) }), []);
        assert.deepEqual(pushProblems(DECISIONS), []);
    });

    it("never changes the decisions it was given", () => {
        const given: PushDecisions = structuredClone(DECISIONS);
        const game: KitGame<PushState> = createPushGame(MAGPIE_POCKETS_BLUEPRINT.box, given, seededRandom(5));
        given.cards[0] = { name: "Changed", value: 9, copies: 4 };
        const state: PushState = game.cartridge.onEvent(game.cartridge.init(FOUR, {}).state, { type: "contentReady", at: 0, text: "" }).state;
        assert.equal(state.deck.length, 29);
        assert.equal(stringsIn(game.cartridge.publicScene(state)).join(" ").includes("Changed"), false);
    });

    it("passes the default check at three and five players, with the model failing and succeeding", () => {
        assert.deepEqual(checkBlueprint(MAGPIE_POCKETS_BLUEPRINT).problems, []);
        assert.deepEqual(checkBlueprint(MAGPIE_POCKETS_BLUEPRINT, { players: PAPER_PLAYERS.slice(0, 3), content: '["Greed has a sound, and it is quiet."]' }).problems, []);
        const tally = checkBlueprint(MAGPIE_POCKETS_BLUEPRINT);
        assert.equal(tally.ended, tally.rehearsals);
        assert.deepEqual(tally.phasesNeverReached, []);
    });

    it("catches a TV that shows a choice before the flip, and a screen that names the next card", () => {
        const healthy: RoleCheck<PushState> = pushChoiceCheck(MAGPIE_POCKETS_BLUEPRINT);
        const telling: RoleCheck<PushState> = {
            script: healthy.script,
            deal: (seat: number, players: readonly CartridgePlayer[]): KitGame<PushState> => {
                const game: KitGame<PushState> = healthy.deal(seat, players);
                const rules: Cartridge<PushState> = game.cartridge;
                const scene = (state: PushState): Scene => ({ ...rules.publicScene(state), blocks: [...rules.publicScene(state).blocks, { type: "text", text: Object.values(state.choices).join(",") }] });
                return { cartridge: { ...rules, publicScene: scene }, hidden: (state: PushState) => game.hidden(state) };
            },
        };
        const make = (seed: number): KitGame<PushState> => createPushGame(MAGPIE_POCKETS_BLUEPRINT.box, DECISIONS, seededRandom(seed));
        assert.match(rehearseMany(make, pushPersonas(), [1], { roleCheck: telling }).problems.join("\n"), /role check: .*screen could tell/);
        const peeking = (seed: number): KitGame<PushState> => {
            const game: KitGame<PushState> = make(seed);
            const rules: Cartridge<PushState> = game.cartridge;
            const scene = (state: PushState): Scene => ({
                ...rules.publicScene(state),
                blocks: [...rules.publicScene(state).blocks, { type: "text", text: `Up next: ${DECISIONS.cards[state.deck[0] ?? 0]?.name ?? ""}` }],
            });
            return { cartridge: { ...rules, publicScene: scene }, hidden: (state: PushState) => game.hidden(state) };
        };
        const peeked = rehearse(peeking(2), pushPersonas()[0] ?? { name: "none", move: () => ({ kind: "wait", seconds: 1 }) }, 2);
        assert.match(peeked.problems.join("\n"), /the next card reached the screen/);
        const hidden: HiddenValue[] = make(1).hidden(start().state);
        assert.equal(hidden.every((value: HiddenValue) => value.seenBy.length === 0), true);
    });
});
