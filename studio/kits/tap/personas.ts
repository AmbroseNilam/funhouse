// The paper players for the tap kit (games played by tapping phones, in three styles). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import type { TapBlueprint } from "./index.ts";
import { createFitsGame, FITS_PREFIX, type FitsDecisions, type FitsState } from "./tap-fits.ts";
import { createPushGame, PUSH_PREFIX, type PushDecisions, type PushState } from "./tap-push.ts";
import { BACK_ACTION, CHALLENGE_ACTION, createDiceGame, FACE_PREFIX, QUANTITY_PREFIX, type DiceDecisions, type DiceState } from "./tap-dice.ts";
import type { Box, KitGame } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import type { Glimpse, Move, Persona, RoleCheck, TraceEvent } from "../../rehearse.ts";
import { firstAction } from "../../persona-support.ts";

/**
 * Who Fits' personas: a table that taps at once, one where someone never taps so the clock runs
 * out, one where someone leaves mid-round, and one where nobody taps at all.
 * @returns the personas.
 */
export function fitsPersonas(): Persona<FitsState>[] {
    /**
     * The next tapper who hasn't tapped, tapping their first choice, or a wait for the clock.
     * @param glimpse what the persona sees.
     * @param skip tappers who never tap.
     * @returns the move.
     */
    const tapNext = (glimpse: Glimpse<FitsState>, skip: readonly string[] = []): Move => {
        const tapper: string | undefined = glimpse.state.tappers.find((id: string) => glimpse.state.taps[id] === undefined && skip.includes(id) === false);
        const action: string | null = tapper === undefined ? null : firstAction(glimpse, tapper);
        return tapper === undefined || action === null ? { kind: "wait", seconds: 10 } : { kind: "press", playerId: tapper, actionId: action };
    };
    return [
        { name: "the quick table", move: (glimpse: Glimpse<FitsState>): Move => (glimpse.phase === "tapping" ? tapNext(glimpse) : { kind: "wait", seconds: 10 }) },
        { name: "the one who never taps", move: (glimpse: Glimpse<FitsState>): Move => (glimpse.phase === "tapping" ? tapNext(glimpse, [glimpse.players[0]?.playerId ?? ""]) : { kind: "wait", seconds: 10 }) },
        {
            name: "the one who leaves",
            move(glimpse: Glimpse<FitsState>): Move {
                const leaver: string | undefined = glimpse.players[1]?.playerId;
                if (glimpse.phase === "tapping" && glimpse.state.round === 1 && leaver !== undefined && glimpse.players.length > 3) {
                    return { kind: "leave", playerId: leaver };
                }
                return glimpse.phase === "tapping" ? tapNext(glimpse) : { kind: "wait", seconds: 10 };
            },
        },
        { name: "the table that never taps", move: (): Move => ({ kind: "wait", seconds: 15 }) },
    ];
}

/**
 * Who Fits' secrecy check: the same taps are played, except that one player taps someone else,
 * and nothing anyone else sees may change before the counts are shown. Only two people tap, so the
 * round stays open at any table size.
 * @param blueprint the game.
 * @returns the check.
 */
export function fitsTapCheck(blueprint: TapBlueprint<FitsDecisions>): RoleCheck<FitsState> {
    const script: TraceEvent[] = [
        { type: "contentReady", at: 0, text: "" },
        { type: "input", playerId: "paper1", actionId: `${FITS_PREFIX}paper2` },
        { type: "input", playerId: "paper2", actionId: `${FITS_PREFIX}paper3` },
    ];
    return {
        deal(seat: number, players: readonly CartridgePlayer[]): KitGame<FitsState> {
            const game: KitGame<FitsState> = createFitsGame(blueprint.box, blueprint.decisions);
            const changer: string | undefined = players[seat]?.playerId;
            /**
             * The changed player's tap, aimed at someone else.
             * @param state the state.
             * @param playerId who tapped.
             * @param actionId what they tapped.
             * @returns the tap to play.
             */
            const changed = (state: FitsState, playerId: string, actionId: string): string => {
                if (playerId !== changer) {
                    return actionId;
                }
                const other: CartridgePlayer | undefined = state.players.find((player: CartridgePlayer) => {
                    return player.playerId !== playerId && `${FITS_PREFIX}${player.playerId}` !== actionId;
                });
                return other === undefined ? actionId : `${FITS_PREFIX}${other.playerId}`;
            };
            return {
                cartridge: {
                    ...game.cartridge,
                    apply: (state: FitsState, playerId: string, actionId: string) => game.cartridge.apply(state, playerId, changed(state, playerId, actionId)),
                },
                hidden: (state: FitsState) => game.hidden(state),
            };
        },
        script,
    };
}

/**
 * Under the Cup's personas: a careful table that challenges after two bids, a table that challenges
 * the moment a bid stands, a table that always bids as high as it can until nobody can raise, a
 * table that never touches a phone so the clock plays, one where a player walks out mid-round, and
 * one where everyone but one walks out.
 * @param decisions the game's decisions.
 * @returns the personas.
 */
export function dicePersonas(decisions: DiceDecisions): Persona<DiceState>[] {
    const pause: Move = { kind: "wait", seconds: Math.max(decisions.lookSeconds, decisions.liftSeconds, decisions.revealSeconds) + 1 };
    /**
     * The bidder's move: challenge when the persona wants to and may, else press the lowest or the
     * highest quantity, then the lowest or the highest face.
     * @param glimpse what the persona sees.
     * @param challengeAfter bids that must stand before the persona challenges.
     * @param high whether to raise as high as the buttons allow.
     * @returns the move, or a wait when it is nobody's turn to bid.
     */
    const bid = (glimpse: Glimpse<DiceState>, challengeAfter: number, high: boolean): Move => {
        const bidderId: string | null = glimpse.state.bidderId;
        if (glimpse.phase !== "bidding" || bidderId === null) {
            return pause;
        }
        const actions: string[] = glimpse.legal(bidderId).map((action: LegalAction) => action.actionId);
        const raises: string[] = actions.filter((actionId: string) => actionId.startsWith(glimpse.state.draft === null ? QUANTITY_PREFIX : FACE_PREFIX) === true);
        const canChallenge: boolean = actions.includes(CHALLENGE_ACTION);
        const raise: string | undefined = high === true ? raises.at(-1) : raises[0];
        const fallback: string | undefined = canChallenge === true ? CHALLENGE_ACTION : actions.find((actionId: string) => actionId !== BACK_ACTION);
        const chosen: string | undefined = glimpse.state.bids.length >= challengeAfter && canChallenge === true ? CHALLENGE_ACTION : raise ?? fallback;
        return chosen === undefined ? pause : { kind: "press", playerId: bidderId, actionId: chosen };
    };
    return [
        { name: "the careful table", move: (glimpse: Glimpse<DiceState>): Move => bid(glimpse, 2, false) },
        { name: "the quick callers", move: (glimpse: Glimpse<DiceState>): Move => bid(glimpse, 1, false) },
        { name: "the high rollers", move: (glimpse: Glimpse<DiceState>): Move => bid(glimpse, 99, true) },
        { name: "the table that never taps", move: (): Move => ({ kind: "wait", seconds: decisions.bidSeconds + 1 }) },
        {
            name: "the one who walks out",
            move(glimpse: Glimpse<DiceState>): Move {
                const leaver: string | undefined = glimpse.players[1]?.playerId;
                if (glimpse.phase === "bidding" && glimpse.state.challenges === 1 && leaver !== undefined && glimpse.players.length > 3) {
                    return { kind: "leave", playerId: leaver };
                }
                return bid(glimpse, 2, false);
            },
        },
        {
            name: "the emptying table",
            move(glimpse: Glimpse<DiceState>): Move {
                const others: CartridgePlayer[] = glimpse.players.filter((player: CartridgePlayer) => player.playerId !== glimpse.state.bidderId);
                const leaver: string | undefined = others.find((player: CartridgePlayer) => (glimpse.state.diceLeft[player.playerId] ?? 0) > 0)?.playerId;
                return glimpse.phase === "bidding" && glimpse.state.bids.length >= 1 && leaver !== undefined ? { kind: "leave", playerId: leaver } : bid(glimpse, 3, false);
            },
        },
    ];
}

/**
 * Under the Cup's secrecy check: the same bids are played at the same table, except that one
 * player's dice are different in each game. Nothing the TV, the host's brief or any other phone
 * shows may change before the cups are lifted, through the opening bids and the challenge itself.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the check.
 */
export function diceSecrecyCheck(box: Box, decisions: DiceDecisions): RoleCheck<DiceState> {
    const script: TraceEvent[] = [
        { type: "timerFired", at: 8, timerId: "look1" },
        { type: "input", playerId: "paper1", actionId: `${QUANTITY_PREFIX}1` },
        { type: "input", playerId: "paper1", actionId: `${FACE_PREFIX}2` },
        { type: "input", playerId: "paper2", actionId: `${QUANTITY_PREFIX}1` },
        { type: "input", playerId: "paper2", actionId: `${FACE_PREFIX}3` },
        { type: "input", playerId: "paper3", actionId: CHALLENGE_ACTION },
    ];
    return {
        deal(seat: number): KitGame<DiceState> {
            const base: () => number = seededRandom(11);
            let drawn: number = 0;
            /**
             * The next draw, shifted by half a turn when it rolls a die of the seat being changed, so
             * every one of that player's dice shows a different face.
             * @returns a number in [0, 1).
             */
            const draw = (): number => {
                const value: number = base();
                const owner: number = Math.floor(drawn / decisions.startingDice);
                drawn += 1;
                return owner === seat ? (value + 0.5) % 1 : value;
            };
            return createDiceGame(box, decisions, draw);
        },
        script,
    };
}

/**
 * The push-your-luck personas: a table that always stays, one that always draws until it busts,
 * one that draws to a different number each, one where somebody never chooses, one where
 * someone leaves mid-round, and one where nobody ever chooses.
 * @returns the personas.
 */
export function pushPersonas(): Persona<PushState>[] {
    /**
     * The next chooser who hasn't chosen, choosing by their rule, or a wait for the clock.
     * @param glimpse what the persona sees.
     * @param wants decides, from the cards in a chooser's pocket and their seat,, whether to draw.
     * @param skip choosers who never choose.
     * @returns the move.
     */
    const chooseNext = (glimpse: Glimpse<PushState>, wants: (cards: number, seat: number) => boolean, skip: readonly string[] = []): Move => {
        if (glimpse.phase !== "choosing") {
            return { kind: "wait", seconds: 10 };
        }
        const chooser: CartridgePlayer | undefined = glimpse.players.find((player: CartridgePlayer) => {
            return glimpse.legal(player.playerId).length > 0 && skip.includes(player.playerId) === false;
        });
        if (chooser === undefined) {
            return { kind: "wait", seconds: 10 };
        }
        const cards: number = (glimpse.state.hands[chooser.playerId] ?? []).length;
        const seat: number = glimpse.players.indexOf(chooser);
        const wanted: string = `${PUSH_PREFIX}${wants(cards, seat) === true ? "draw" : "stay"}`;
        const action: LegalAction | undefined = glimpse.legal(chooser.playerId).find((candidate: LegalAction) => candidate.actionId === wanted);
        return { kind: "press", playerId: chooser.playerId, actionId: action?.actionId ?? wanted };
    };
    return [
        { name: "the cautious table", move: (glimpse: Glimpse<PushState>): Move => chooseNext(glimpse, (): boolean => false) },
        { name: "the greedy table", move: (glimpse: Glimpse<PushState>): Move => chooseNext(glimpse, (): boolean => true) },
        { name: "the mixed table", move: (glimpse: Glimpse<PushState>): Move => chooseNext(glimpse, (cards: number, seat: number): boolean => cards < 2 + (seat % 3)) },
        { name: "the one who never chooses", move: (glimpse: Glimpse<PushState>): Move => chooseNext(glimpse, (cards: number): boolean => cards < 3, [glimpse.players[0]?.playerId ?? ""]) },
        {
            name: "the one who leaves",
            move(glimpse: Glimpse<PushState>): Move {
                const leaver: string | undefined = glimpse.players[1]?.playerId;
                if (glimpse.phase === "choosing" && glimpse.state.round === 1 && leaver !== undefined && glimpse.players.length > 3) {
                    return { kind: "leave", playerId: leaver };
                }
                return chooseNext(glimpse, (cards: number): boolean => cards < 3);
            },
        },
        { name: "the table that never chooses", move: (): Move => ({ kind: "wait", seconds: 15 }) },
    ];
}

/**
 * The push-your-luck secrecy check: the same script is played with one player's choice reversed,
 * and nothing anyone else sees may change before the flip. Only two players choose, so the beat
 * stays open at any table size.
 * @param blueprint the game.
 * @returns the check.
 */
export function pushChoiceCheck(blueprint: TapBlueprint<PushDecisions>): RoleCheck<PushState> {
    const script: TraceEvent[] = [
        { type: "contentReady", at: 0, text: "" },
        { type: "input", playerId: "paper1", actionId: `${PUSH_PREFIX}draw` },
        { type: "input", playerId: "paper2", actionId: `${PUSH_PREFIX}stay` },
    ];
    return {
        deal(seat: number, players: readonly CartridgePlayer[]): KitGame<PushState> {
            const game: KitGame<PushState> = createPushGame(blueprint.box, blueprint.decisions, seededRandom(7));
            const changer: string | undefined = players[seat]?.playerId;
            /**
             * The changed player's choice, reversed.
             * @param playerId who chose.
             * @param actionId what they chose.
             * @returns the choice to play.
             */
            const changed = (playerId: string, actionId: string): string => {
                if (playerId !== changer) {
                    return actionId;
                }
                return actionId === `${PUSH_PREFIX}draw` ? `${PUSH_PREFIX}stay` : `${PUSH_PREFIX}draw`;
            };
            return {
                cartridge: {
                    ...game.cartridge,
                    apply: (state: PushState, playerId: string, actionId: string) => game.cartridge.apply(state, playerId, changed(playerId, actionId)),
                },
                hidden: (state: PushState) => game.hidden(state),
            };
        },
        script,
    };
}
