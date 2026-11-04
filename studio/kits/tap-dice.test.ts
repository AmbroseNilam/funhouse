// Proves Under the Cup: dice are rolled once and shown only on their owner's phone, bids must beat
// the last, a challenge counts the cups and takes a die from whoever was wrong, players with no dice
// are out, a stale or idle clock is handled, a leaver voids the round, nobody's dice reach the TV,
// the host or another phone before the cups are lifted, and the default check catches a TV that
// shows a die.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Cartridge, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../shared/scene.ts";
import type { ScopedFact } from "../../shared/visibility.ts";
import { blueprintProblems } from "../blueprint.ts";
import { checkBlueprint } from "../check.ts";
import { UNDER_THE_CUP_BLUEPRINT } from "../games/under-the-cup.ts";
import type { KitGame } from "../kit/kit.ts";
import { dicePersonas, diceSecrecyCheck } from "../personas.ts";
import { PAPER_PLAYERS, rehearseMany, stringsIn, type RoleCheck } from "../rehearse.ts";
import { BACK_ACTION, CHALLENGE_ACTION, createDiceGame, FACE_PREFIX, HIGHER_ACTION, LOWER_ACTION, QUANTITY_PREFIX, type DiceDecisions, type DiceState } from "./tap-dice.ts";

/** Four at the table. */
const FOUR: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);

/** Under the Cup's decisions. */
const DECISIONS: DiceDecisions = UNDER_THE_CUP_BLUEPRINT.decisions;

/**
 * A random source that rolls exactly the given faces in order, then 1s.
 * @param faces the faces to roll.
 * @returns the source.
 */
function rolling(faces: readonly number[]): () => number {
    let index: number = 0;
    return (): number => {
        const face: number = faces[index] ?? 1;
        index += 1;
        return (face - 1) / 6 + 0.01;
    };
}

/** Round one's dice: Teacup 1 1 4, Spoon 4 4 6, Candle 2 3 5, Saucer 6 6 3, so there are five fours counting ones. */
const ROUND_ONE: number[] = [1, 1, 4, 4, 4, 6, 2, 3, 5, 6, 6, 3];

/**
 * Builds the game and plays to the open bidding of round one.
 * @param faces the faces to roll, in order.
 * @param decisions the decisions.
 * @returns the game and the state while bidding.
 */
function start(faces: readonly number[] = ROUND_ONE, decisions: DiceDecisions = DECISIONS): { game: KitGame<DiceState>; state: DiceState } {
    const game: KitGame<DiceState> = createDiceGame(UNDER_THE_CUP_BLUEPRINT.box, decisions, rolling(faces));
    const looking: DiceState = game.cartridge.init(FOUR, {}).state;
    return { game, state: game.cartridge.onEvent(looking, { type: "timerFired", at: 8, timerId: `look${looking.serial}` }).state };
}

/**
 * Plays actions in order for the given players.
 * @param game the game.
 * @param state the state.
 * @param moves each as [player id, action id].
 * @returns the last step.
 */
function play(game: KitGame<DiceState>, state: DiceState, moves: readonly [string, string][]): Step<DiceState> {
    let step: Step<DiceState> = { state, facts: [] };
    for (const [playerId, actionId] of moves) {
        step = game.cartridge.apply(step.state, playerId, actionId);
    }
    return step;
}

/**
 * Makes a bid for a player, paging the quantity list up as far as the quantity needs.
 * @param playerId who.
 * @param quantity how many.
 * @param face which face.
 * @param lowest the lowest quantity the first page offers, 1 for an opening bid.
 * @returns the actions.
 */
function bid(playerId: string, quantity: number, face: number, lowest: number = 1): [string, string][] {
    const paging: [string, string][] = Array.from({ length: Math.floor((quantity - lowest) / 5) }, (): [string, string] => [playerId, HIGHER_ACTION]);
    return [...paging, [playerId, `${QUANTITY_PREFIX}${quantity}`], [playerId, `${FACE_PREFIX}${face}`]];
}

/**
 * Fires a timer the way the room would.
 * @param game the game.
 * @param state the state.
 * @param timerId the timer.
 * @returns the step.
 */
function fire(game: KitGame<DiceState>, state: DiceState, timerId: string): Step<DiceState> {
    return game.cartridge.onEvent(state, { type: "timerFired", at: 0, timerId });
}

/**
 * Everything the TV and the host are shown, as one string.
 * @param game the game.
 * @param step the latest step.
 * @returns the text.
 */
function publicText(game: KitGame<DiceState>, step: Step<DiceState>): string {
    const facts: string[] = step.facts.filter((fact: ScopedFact) => fact.scope.kind === "public").map((fact: ScopedFact) => fact.text);
    const told: string[] = game.cartridge.hostFacts(step.state, { kind: "host" }).map((fact: ScopedFact) => fact.text);
    return [...stringsIn(game.cartridge.publicScene(step.state)), ...facts, ...told, game.cartridge.manifest.hostBrief].join("\n");
}

/**
 * The secret card on a phone.
 * @param game the game.
 * @param state the state.
 * @param playerId whose phone.
 * @returns the card's body, or null.
 */
function cardOf(game: KitGame<DiceState>, state: DiceState, playerId: string): string | null {
    const card: Control | undefined = game.cartridge.privateControls(state, playerId).find((control: Control) => control.type === "roleCard");
    return card?.type === "roleCard" && card.secret === true ? card.body : null;
}

/**
 * Who is out of the game.
 * @param game the game.
 * @param state the state.
 * @returns their ids.
 */
function outOf(game: KitGame<DiceState>, state: DiceState): string[] {
    return game.cartridge.outOf?.(state) ?? [];
}

/**
 * Makes the biggest bid the first page of buttons offers: five dice showing sixes, or every die if fewer.
 * @param state the state while bidding, with nothing standing.
 * @returns the two actions.
 */
function biggest(state: DiceState): [string, string][] {
    const total: number = Object.values(state.diceLeft).reduce((sum: number, count: number) => sum + count, 0);
    return bid(state.bidderId ?? "", Math.min(total, 5), 6);
}

/**
 * Plays a challenge on a bid and lifts the cups.
 * @param game the game.
 * @param state the state while bidding with a bid standing.
 * @returns the step that shows the result.
 */
function callIt(game: KitGame<DiceState>, state: DiceState): Step<DiceState> {
    const lifting: Step<DiceState> = game.cartridge.apply(state, state.bidderId ?? "", CHALLENGE_ACTION);
    return fire(game, lifting.state, `lift${lifting.state.serial}`);
}

describe("under the cup", () => {
    it("is runnable and rolls every cup once, three dice each", () => {
        assert.deepEqual(blueprintProblems(UNDER_THE_CUP_BLUEPRINT), []);
        const { state } = start();
        assert.equal(state.phase, "bidding");
        assert.deepEqual(state.dice.paper1, [1, 1, 4]);
        assert.deepEqual(state.dice.paper4, [6, 6, 3]);
        assert.deepEqual(state.diceLeft, { paper1: 3, paper2: 3, paper3: 3, paper4: 3 });
        assert.equal(state.bidderId, "paper1");
    });

    it("shows a player's dice on their own phone and nowhere else", () => {
        const { game, state } = start();
        assert.equal(cardOf(game, state, "paper1"), "1   1   4");
        assert.equal(cardOf(game, state, "paper2"), "4   4   6");
        const seen: string = [publicText(game, { state, facts: [] }), ...["paper2", "paper3", "paper4"].map((id: string) => JSON.stringify(game.cartridge.privateControls(state, id).filter((control: Control) => control.type !== "roleCard")))].join("\n");
        assert.equal(seen.includes("1   1   4"), false);
        assert.equal(game.hidden(state).length, 4, "the check knows every cup is secret");
        assert.deepEqual(game.hidden(state)[0]?.seenBy, ["paper1"]);
    });

    it("lets only the bidder act, in two steps, and only with a bid that beats the last", () => {
        const { game, state } = start();
        assert.equal(game.cartridge.apply(state, "paper2", `${QUANTITY_PREFIX}2`).state, state, "not your turn");
        assert.deepEqual(game.cartridge.legalActions(state, "paper2"), []);
        const openers: string[] = game.cartridge.legalActions(state, "paper1").map((action: LegalAction) => action.actionId);
        assert.deepEqual(openers, ["qty:1", "qty:2", "qty:3", "qty:4", "qty:5", HIGHER_ACTION], "no challenge before a bid");
        const chosen: DiceState = game.cartridge.apply(state, "paper1", "qty:3").state;
        assert.equal(chosen.draft, 3);
        assert.deepEqual(game.cartridge.legalActions(chosen, "paper1").map((action: LegalAction) => action.actionId), ["face:1", "face:2", "face:3", "face:4", "face:5", "face:6", BACK_ACTION]);
        assert.deepEqual(game.cartridge.privateControls(chosen, "paper1").filter((control: Control) => control.type === "buttons").map((control: Control) => (control.type === "buttons" ? control.prompt : "")), ["Three of which number?"]);
        assert.equal(game.cartridge.apply(chosen, "paper1", BACK_ACTION).state.draft, null);
        const placed: Step<DiceState> = game.cartridge.apply(chosen, "paper1", "face:4");
        assert.deepEqual(placed.state.bid, { playerId: "paper1", quantity: 3, face: 4 });
        assert.equal(placed.state.bidderId, "paper2");
        assert.equal(placed.state.draft, null);
        const next: LegalAction[] = game.cartridge.legalActions(placed.state, "paper2");
        assert.equal(next.some((action: LegalAction) => action.actionId === "qty:2"), false, "can't bid fewer");
        assert.equal(next.some((action: LegalAction) => action.actionId === CHALLENGE_ACTION), true);
        assert.equal(next.find((action: LegalAction) => action.actionId === CHALLENGE_ACTION)?.label, "Challenge Teacup");
        const again: DiceState = game.cartridge.apply(placed.state, "paper2", "qty:3").state;
        assert.deepEqual(game.cartridge.legalActions(again, "paper2").map((action: LegalAction) => action.actionId).slice(0, 2), ["face:5", "face:6"]);
        assert.equal(game.cartridge.apply(again, "paper2", "face:4").state, again, "the same bid is refused");
    });

    it("pages through quantities so any bid is reachable, and takes a page back when asked", () => {
        const { game, state } = start();
        const higher: DiceState = game.cartridge.apply(state, "paper1", HIGHER_ACTION).state;
        assert.equal(higher.page, 1);
        const ids = (current: DiceState): string[] => game.cartridge.legalActions(current, "paper1").map((action: LegalAction) => action.actionId);
        assert.deepEqual(ids(higher), ["qty:6", "qty:7", "qty:8", "qty:9", "qty:10", HIGHER_ACTION, LOWER_ACTION]);
        const top: DiceState = game.cartridge.apply(higher, "paper1", HIGHER_ACTION).state;
        assert.deepEqual(ids(top), ["qty:11", "qty:12", LOWER_ACTION]);
        assert.equal(game.cartridge.apply(top, "paper1", HIGHER_ACTION).state, top, "there is no page past the last die");
        assert.equal(game.cartridge.apply(state, "paper1", LOWER_ACTION).state, state, "nothing before the first page");
        const placed: Step<DiceState> = play(game, top, [["paper1", "qty:11"], ["paper1", "face:6"]]);
        assert.equal(placed.state.bid?.quantity, 11);
        assert.equal(placed.state.page, 0, "the next bidder starts on the first page");
        assert.equal(game.cartridge.apply(state, "paper2", HIGHER_ACTION).state, state, "only the bidder pages");
    });

    it("keeps the draft off the TV and every other phone", () => {
        const { game, state } = start();
        const before: string = JSON.stringify([game.cartridge.publicScene(state), game.cartridge.turn?.(state), game.cartridge.privateControls(state, "paper3")]);
        const drafted: DiceState = game.cartridge.apply(state, "paper1", "qty:5").state;
        const after: string = JSON.stringify([game.cartridge.publicScene(drafted), game.cartridge.turn?.(drafted), game.cartridge.privateControls(drafted, "paper3")]);
        assert.equal(after, before);
    });

    it("holds the cups down for a beat after a challenge, then counts them", () => {
        const { game, state } = start();
        const bidding: DiceState = play(game, state, bid("paper1", 5, 4)).state;
        const lifting: Step<DiceState> = game.cartridge.apply(bidding, "paper2", CHALLENGE_ACTION);
        assert.equal(lifting.state.phase, "lifting");
        assert.equal(lifting.state.challengerId, "paper2");
        assert.equal(game.hidden(lifting.state).length, 4, "still secret while the cups are down");
        assert.equal(publicText(game, lifting).includes("1 1 4"), false);
        assert.equal(cardOf(game, lifting.state, "paper1"), "1   1   4", "players can still peek until the cups lift");
        assert.deepEqual(game.cartridge.legalActions(lifting.state, "paper2"), []);
        const resolved: Step<DiceState> = fire(game, lifting.state, `lift${lifting.state.serial}`);
        assert.equal(resolved.state.phase, "reveal");
        assert.equal(resolved.state.reveal?.count, 5, "two ones and three fours, ones wild");
        assert.equal(game.hidden(resolved.state).length, 0, "nothing is secret once the cups are up");
    });

    it("takes two dice from a challenger who meets an exact bid, with the host told every die", () => {
        const { game, state } = start();
        const resolved: Step<DiceState> = callIt(game, play(game, state, [...bid("paper1", 5, 4)]).state);
        assert.equal(resolved.state.reveal?.held, true);
        assert.equal(resolved.state.reveal.loserId, "paper2");
        assert.equal(resolved.state.reveal.lost, 2);
        assert.equal(resolved.state.diceLeft.paper2, 1);
        assert.equal(resolved.state.starterId, "paper2", "the loser opens the next round");
        const told: string = resolved.facts.map((fact: ScopedFact) => fact.text).join("\n");
        assert.match(told, /Teacup 1 1 4; Spoon 4 4 6; Candle 2 3 5; Saucer 3 6 6/);
        assert.match(told, /Dead on: 5 fours, counting ones as wild/);
        assert.match(told, /Spoon loses two dice and has 1 left/);
    });

    it("takes one die from a bluffer, and a bid that is more than right costs the challenger one", () => {
        const { game, state } = start();
        const bluff: Step<DiceState> = callIt(game, play(game, state, bid("paper1", 6, 4)).state);
        assert.equal(bluff.state.reveal?.held, false);
        assert.equal(bluff.state.reveal.loserId, "paper1");
        assert.equal(bluff.state.diceLeft.paper1, 2);
        assert.equal(bluff.state.starterId, "paper1");
        const over: Step<DiceState> = callIt(game, play(game, state, bid("paper1", 4, 4)).state);
        assert.equal(over.state.reveal?.loserId, "paper2");
        assert.equal(over.state.reveal.lost, 1);
        assert.equal(over.state.diceLeft.paper2, 2);
    });

    it("scores a bid on ones as ones only, and respects the wild-ones decision", () => {
        const { game, state } = start();
        const ones: Step<DiceState> = callIt(game, play(game, state, bid("paper1", 3, 1)).state);
        assert.equal(ones.state.reveal?.count, 2, "only the two ones");
        const plain: DiceDecisions = { ...DECISIONS, wildOnes: false };
        const without = start(ROUND_ONE, plain);
        const counted: Step<DiceState> = callIt(without.game, play(without.game, without.state, bid("paper1", 5, 4)).state);
        assert.equal(counted.state.reveal?.count, 3);
        assert.equal(counted.state.reveal.loserId, "paper1");
    });

    it("rolls fresh dice for the next round and opens with the loser", () => {
        const { game, state } = start([...ROUND_ONE, 2, 2, 2, 3, 3, 3, 5, 5]);
        const result: Step<DiceState> = callIt(game, play(game, state, bid("paper1", 6, 4)).state);
        const next: Step<DiceState> = fire(game, result.state, `reveal${result.state.serial}`);
        assert.equal(next.state.phase, "looking");
        assert.equal(next.state.challenges, 1);
        assert.equal(next.state.bidderId, "paper1");
        assert.equal(next.state.dice.paper1?.length, 2, "the loser rolls one fewer");
        assert.equal(next.state.dice.paper2?.length, 3);
        assert.deepEqual(next.state.dice.paper1, [2, 2]);
        assert.match(next.facts[0]?.text ?? "", /^A new round begins, number 2, with 11 dice on the table: Teacup 2, Spoon 3, Candle 3, Saucer 3\./);
    });

    it("puts a player with no dice out, skips them, and ends with the last player standing", () => {
        const decisions: DiceDecisions = { ...DECISIONS, startingDice: 2, exactLoss: 2, maxRounds: 30 };
        const { game, state } = start([1, 1, 4, 4, 4, 6, 2, 3], decisions);
        const lost: Step<DiceState> = callIt(game, play(game, state, bid("paper1", 4, 6)).state);
        assert.equal(lost.state.diceLeft.paper1, 1);
        assert.deepEqual(outOf(game, lost.state), []);
        let current: DiceState = lost.state;
        while (game.cartridge.outcome(current) === null) {
            const timer: string = `${current.phase === "reveal" ? "reveal" : current.phase === "looking" ? "look" : "x"}${current.serial}`;
            if (current.phase === "bidding") {
                current = callIt(game, play(game, current, biggest(current)).state).state;
                continue;
            }
            current = fire(game, current, timer).state;
        }
        assert.equal(current.phase, "end");
        assert.equal(current.winnerIds.length, 1);
        const out: string[] = outOf(game, current);
        assert.equal(out.length, 3);
        assert.equal(out.includes(current.winnerIds[0] ?? ""), false);
        const lastPhone: Control[] = game.cartridge.privateControls(current, out[0] ?? "");
        assert.equal(lastPhone[0]?.type, "waiting");
    });

    it("tells an eliminated player they are out, skips them, and shows them no dice", () => {
        const decisions: DiceDecisions = { ...DECISIONS, startingDice: 2 };
        const { game, state } = start([2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3], decisions);
        const first: Step<DiceState> = callIt(game, play(game, state, bid("paper1", 2, 4)).state);
        assert.equal(first.state.diceLeft.paper1, 1, "a bluff costs one die");
        const second: Step<DiceState> = fire(game, first.state, `reveal${first.state.serial}`);
        const bidding: DiceState = fire(game, second.state, `look${second.state.serial}`).state;
        assert.equal(bidding.bidderId, "paper1", "the loser opens");
        const out: Step<DiceState> = callIt(game, play(game, bidding, bid("paper1", 2, 4)).state);
        assert.equal(out.state.diceLeft.paper1, 0);
        assert.deepEqual(outOf(game, out.state), ["paper1"]);
        assert.equal(out.state.starterId, "paper2", "the next seat with dice opens");
        assert.match(out.facts[0]?.text ?? "", /Teacup loses a die and is out of the game/);
        const next: Step<DiceState> = fire(game, out.state, `reveal${out.state.serial}`);
        assert.equal(next.state.dice.paper1, undefined);
        assert.equal(cardOf(game, next.state, "paper1"), null);
        assert.equal(game.cartridge.privateControls(next.state, "paper1")[0]?.type, "waiting");
        const afterLook: DiceState = fire(game, next.state, `look${next.state.serial}`).state;
        const called: Step<DiceState> = game.cartridge.apply(play(game, afterLook, bid("paper2", 1, 2)).state, "paper3", CHALLENGE_ACTION);
        assert.equal(called.state.challengerId, "paper3");
        const around: DiceState = play(game, afterLook, bid("paper2", 1, 2)).state;
        assert.equal(around.bidderId, "paper3");
        assert.equal(play(game, around, bid("paper4", 2, 2)).state, around, "only the bidder may act");
    });

    it("ends at the challenge limit with the most dice winning, ties shared", () => {
        const decisions: DiceDecisions = { ...DECISIONS, maxRounds: 4 };
        const { game, state } = start(ROUND_ONE, decisions);
        let current: DiceState = state;
        while (game.cartridge.outcome(current) === null) {
            if (current.phase === "bidding") {
                current = callIt(game, play(game, current, biggest(current)).state).state;
                continue;
            }
            current = fire(game, current, `${current.phase === "reveal" ? "reveal" : "look"}${current.serial}`).state;
        }
        assert.equal(current.challenges, 4);
        assert.match(current.ending, /challenge 4, the last of the night/);
        assert.ok(current.winnerIds.length >= 1);
    });

    it("lets the clock open a quiet round and call a stale one, and ignores a clock that is out of date", () => {
        const { game, state } = start();
        const timerId: string = `bid${state.serial}.0`;
        const opened: Step<DiceState> = fire(game, state, timerId);
        assert.deepEqual(opened.state.bid, { playerId: "paper1", quantity: 2, face: 2 });
        assert.match(opened.facts[0]?.text ?? "", /The clock ran out on Teacup, so a bid went in for them: two twos/);
        assert.equal(fire(game, opened.state, timerId).state, opened.state, "the first clock no longer matters");
        assert.equal(fire(game, state, `bid${state.serial + 1}.0`).state, state);
        const called: Step<DiceState> = fire(game, opened.state, `bid${state.serial}.1`);
        assert.equal(called.state.phase, "lifting");
        assert.equal(called.state.challengerId, "paper2");
        assert.match(called.facts[0]?.text ?? "", /The clock ran out on Spoon, so the call was made for them/);
    });

    it("ignores a look clock from a round that was rolled again", () => {
        const game: KitGame<DiceState> = createDiceGame(UNDER_THE_CUP_BLUEPRINT.box, DECISIONS, rolling(ROUND_ONE));
        const first: DiceState = game.cartridge.init(FOUR, {}).state;
        const voided: DiceState = game.cartridge.onEvent(first, { type: "playerLeft", at: 1, playerId: "paper4" }).state;
        assert.equal(voided.serial, first.serial + 1);
        assert.equal(fire(game, voided, `look${first.serial}`).state, voided);
    });

    it("voids a round when a player with dice leaves, and ends if only one is left", () => {
        const { game, state } = start();
        const bidding: DiceState = play(game, state, bid("paper1", 2, 3)).state;
        const voided: Step<DiceState> = game.cartridge.onEvent(bidding, { type: "playerLeft", at: 9, playerId: "paper3" });
        assert.equal(voided.state.phase, "looking");
        assert.equal(voided.state.challenges, 0, "no die is lost");
        assert.equal(voided.state.bid, null);
        assert.deepEqual(voided.state.players.map((player: CartridgePlayer) => player.playerId), ["paper1", "paper2", "paper4"]);
        assert.equal(voided.state.dice.paper3, undefined);
        assert.equal(voided.state.bidderId, "paper4", "the next seat after the leaver opens");
        assert.match(voided.facts[0]?.text ?? "", /Candle left the table, so this round is void/);
        const two: DiceState = game.cartridge.onEvent(voided.state, { type: "playerLeft", at: 10, playerId: "paper4" }).state;
        assert.equal(two.phase, "looking", "two is still a game");
        const alone: Step<DiceState> = game.cartridge.onEvent(two, { type: "playerLeft", at: 11, playerId: "paper2" });
        assert.equal(alone.state.phase, "end");
        assert.deepEqual(alone.state.winnerIds, ["paper1"]);
        assert.notEqual(game.cartridge.outcome(alone.state), null);
    });

    it("lets a result stay up when a spectator leaves, and fixes who opens if the opener leaves", () => {
        const { game, state } = start([1, 1, 4, 4, 4, 6, 2, 3, 5, 6, 6, 3, 3, 3], { ...DECISIONS, startingDice: 3 });
        const result: Step<DiceState> = callIt(game, play(game, state, bid("paper1", 6, 4)).state);
        assert.equal(result.state.starterId, "paper1");
        const after: Step<DiceState> = game.cartridge.onEvent(result.state, { type: "playerLeft", at: 3, playerId: "paper1" });
        assert.equal(after.state.phase, "reveal");
        assert.equal(after.state.starterId, "paper2");
        assert.equal(after.state.reveal?.loserName, "Teacup", "the result still names who lost");
        const next: Step<DiceState> = fire(game, after.state, `reveal${after.state.serial}`);
        assert.equal(next.state.bidderId, "paper2");
    });

    it("tells the host the bids and the odds, never a die, until the cups are up", () => {
        const { game, state } = start();
        const told: string = game.cartridge.hostFacts(state, { kind: "host" }).map((fact: ScopedFact) => fact.text).join(" ");
        assert.match(told, /12 dice on the table: Teacup 3, Spoon 3, Candle 3, Saucer 3\. Teacup is up\. No bid yet\./);
        const placed: Step<DiceState> = play(game, state, bid("paper1", 8, 3));
        assert.match(placed.facts[0]?.text ?? "", /Teacup bids eight threes, nearly impossible with 12 dice on the table \(about 2 in 100, from the dice count only\)/);
        assert.equal(placed.facts[0]?.quiet, undefined, "a bold bid is worth a remark");
        const modest: Step<DiceState> = play(game, state, bid("paper1", 3, 3));
        assert.equal(modest.facts[0]?.quiet, true, "a safe bid is noted quietly");
        assert.equal(game.cartridge.manifest.hostBrief.includes("never guess, hint or ask"), true);
        assert.equal(game.cartridge.manifest.phases.every((phase) => phase.hostRulings === undefined), true, "the host makes no rulings");
    });

    it("shows the cups on the TV only after the lift", () => {
        const { game, state } = start();
        const bidding: DiceState = play(game, state, bid("paper1", 5, 4)).state;
        const down: string = stringsIn(game.cartridge.publicScene(game.cartridge.apply(bidding, "paper2", CHALLENGE_ACTION).state)).join("\n");
        assert.equal(/Teacup: 1/.test(down), false);
        const up: Scene = game.cartridge.publicScene(callIt(game, bidding).state);
        const lines: string[] = up.blocks.flatMap((block: SceneBlock) => (block.type === "text" ? [block.text] : []));
        assert.ok(lines.includes("Teacup: 1 · 1 · 4"), "a hand to a line at a small table");
        assert.ok(lines.includes("Saucer: 3 · 6 · 6"));
        assert.ok(lines.includes("Dice left: Teacup 3, Spoon 1, Candle 3, Saucer 3"), "the exact bid cost the challenger two");
    });

    it("puts two hands on a line at a big table so the list stays above the lantern", () => {
        const eight: CartridgePlayer[] = [...PAPER_PLAYERS, { playerId: "paper6", name: "Kettle" }, { playerId: "paper7", name: "Biscuit" }, { playerId: "paper8", name: "Tray" }];
        const faces: number[] = Array.from({ length: 24 }, (_unused: unknown, index: number) => (index % 6) + 1);
        const game: KitGame<DiceState> = createDiceGame(UNDER_THE_CUP_BLUEPRINT.box, DECISIONS, rolling(faces));
        const looking: DiceState = game.cartridge.init(eight, {}).state;
        const bidding: DiceState = fire(game, looking, `look${looking.serial}`).state;
        const opened: DiceState = play(game, bidding, bid("paper1", 3, 6)).state;
        const result: Step<DiceState> = callIt(game, opened);
        const lines: string[] = game.cartridge.publicScene(result.state).blocks.flatMap((block: SceneBlock) => (block.type === "text" ? [block.text] : []));
        assert.equal(lines.filter((line: string) => line.includes("  |  ")).length, 4, "eight hands make four lines");
        assert.equal(game.cartridge.publicScene(result.state).blocks.length, 7, "a title, the verdict, four lines of hands and the dice left");
    });

    it("passes the default check at three, four and five players, and the cups stay closed", () => {
        assert.deepEqual(checkBlueprint(UNDER_THE_CUP_BLUEPRINT).problems, []);
        assert.deepEqual(checkBlueprint(UNDER_THE_CUP_BLUEPRINT, { players: PAPER_PLAYERS.slice(0, 3) }).problems, []);
        const tally = checkBlueprint(UNDER_THE_CUP_BLUEPRINT, { players: PAPER_PLAYERS.slice(0, 4) });
        assert.equal(tally.ended, tally.rehearsals);
        assert.deepEqual(tally.phasesNeverReached, []);
    });

    it("has a secrecy check that catches a TV, a host or a phone that shows someone's dice", () => {
        const healthy: RoleCheck<DiceState> = diceSecrecyCheck(UNDER_THE_CUP_BLUEPRINT.box, DECISIONS);
        const make = (seed: number): KitGame<DiceState> => createDiceGame(UNDER_THE_CUP_BLUEPRINT.box, DECISIONS, () => seed / 10);
        assert.deepEqual(rehearseMany(make, dicePersonas(DECISIONS), [1], { roleCheck: healthy }).problems.filter((problem: string) => problem.startsWith("role check")), []);
        const telling: RoleCheck<DiceState> = {
            script: healthy.script,
            deal: (seat: number, players: readonly CartridgePlayer[]): KitGame<DiceState> => {
                const game: KitGame<DiceState> = healthy.deal(seat, players);
                const rules: Cartridge<DiceState> = game.cartridge;
                const scene = (state: DiceState): Scene => ({ ...rules.publicScene(state), blocks: [...rules.publicScene(state).blocks, { type: "text", text: Object.values(state.dice).map((dice: number[]) => dice.join("")).join(",") }] });
                return { cartridge: { ...rules, publicScene: scene }, hidden: (state: DiceState) => game.hidden(state) };
            },
        };
        assert.match(rehearseMany(make, dicePersonas(DECISIONS), [1], { roleCheck: telling }).problems.join("\n"), /role check: .*screen could tell/);
        const hostLeak: RoleCheck<DiceState> = {
            script: healthy.script,
            deal: (seat: number, players: readonly CartridgePlayer[]): KitGame<DiceState> => {
                const game: KitGame<DiceState> = healthy.deal(seat, players);
                const rules: Cartridge<DiceState> = game.cartridge;
                const facts = (state: DiceState, scope: { kind: "host" } | { kind: "public" }): ScopedFact[] => [...rules.hostFacts(state, scope), { scope: { kind: "public" }, kind: "peek", text: JSON.stringify(state.dice) }];
                return { cartridge: { ...rules, hostFacts: facts }, hidden: (state: DiceState) => game.hidden(state) };
            },
        };
        assert.match(rehearseMany(make, dicePersonas(DECISIONS), [1], { roleCheck: hostLeak }).problems.join("\n"), /role check: .*host could tell/);
        const phoneLeak: RoleCheck<DiceState> = {
            script: healthy.script,
            deal: (seat: number, players: readonly CartridgePlayer[]): KitGame<DiceState> => {
                const game: KitGame<DiceState> = healthy.deal(seat, players);
                const rules: Cartridge<DiceState> = game.cartridge;
                const controls = (state: DiceState, playerId: string): Control[] => [...rules.privateControls(state, playerId), { type: "notice", text: `Spoon holds ${(state.dice.paper2 ?? []).join("")}`, tone: "info" }];
                return { cartridge: { ...rules, privateControls: controls }, hidden: (state: DiceState) => game.hidden(state) };
            },
        };
        assert.match(rehearseMany(make, dicePersonas(DECISIONS), [1], { roleCheck: phoneLeak }).problems.join("\n"), /role check: .*paper3 could tell/);
    });
});
