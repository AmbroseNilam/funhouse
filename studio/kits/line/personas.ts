// The paper players for the line kit (a row of dated cards and a gap to place a new one). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer } from "../../../shared/cartridge.ts";
import { LINE_GIVE_UP_ACTION, SLOT_PREFIX, slotFor, type LineDecisions, type LineState } from "./line.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";


/**
 * The line kit's personas, between them reaching every ending: a table that always has the right gap, one
 * that is a gap out, one that always picks the start of the row, a table that says nothing, one that gives up,
 * and people leaving while picking.
 * @param decisions the game's decisions, for the cards.
 * @returns the personas.
 */
export function linePersonas(decisions: LineDecisions): Persona<LineState>[] {
    /**
     * The gap the current card belongs in.
     * @param state the state.
     * @returns the gap.
     */
    const rightSlot = (state: LineState): number => {
        const index: number = state.order[decisions.startCards + state.round] ?? 0;
        return slotFor(state.row.map((cardIndex: number) => decisions.cards[cardIndex]?.year ?? 0), decisions.cards[index]?.year ?? 0);
    };
    /**
     * The next player to pick does so with a chosen gap.
     * @param glimpse what the persona sees.
     * @param choose picks the gap from the right one and how many gaps there are.
     * @returns the move, or a wait when everyone has picked.
     */
    const pickGap = (glimpse: Glimpse<LineState>, choose: (right: number, gaps: number, seat: number) => number): Move => {
        const seat: number = glimpse.players.findIndex((player: CartridgePlayer) => glimpse.state.picks[player.playerId] === undefined);
        const player: CartridgePlayer | undefined = glimpse.players[seat];
        if (player === undefined) {
            return { kind: "wait", seconds: 10 };
        }
        const gaps: number = glimpse.state.row.length + 1;
        return { kind: "press", playerId: player.playerId, actionId: `${SLOT_PREFIX}${choose(rightSlot(glimpse.state), gaps, seat)}` };
    };
    const rest: Move = { kind: "wait", seconds: 20 };
    return [
        { name: "the table that knows", move: (glimpse: Glimpse<LineState>): Move => (glimpse.phase === "place" ? pickGap(glimpse, (right: number) => right) : rest) },
        {
            name: "the table a gap out",
            move: (glimpse: Glimpse<LineState>): Move => (glimpse.phase === "place" ? pickGap(glimpse, (right: number, gaps: number) => (right + 1 < gaps ? right + 1 : right - 1)) : rest),
        },
        { name: "the table that always says the start", move: (glimpse: Glimpse<LineState>): Move => (glimpse.phase === "place" ? pickGap(glimpse, () => 0) : rest) },
        { name: "the quiet table", move: (): Move => ({ kind: "wait", seconds: 40 }) },
        {
            name: "the giver-up",
            move(glimpse: Glimpse<LineState>): Move {
                const playerId: string = glimpse.players[0]?.playerId ?? "";
                if (glimpse.phase === "place" && glimpse.state.round >= 1) {
                    return { kind: "press", playerId, actionId: LINE_GIVE_UP_ACTION };
                }
                return glimpse.phase === "place" ? pickGap(glimpse, (right: number) => right) : rest;
            },
        },
        {
            name: "the one who leaves mid-pick",
            move(glimpse: Glimpse<LineState>): Move {
                const early: CartridgePlayer | undefined = glimpse.players[1];
                if (glimpse.phase === "place" && glimpse.state.round === 0 && early !== undefined && glimpse.state.picks[early.playerId] !== undefined && glimpse.players.length > 2) {
                    return { kind: "leave", playerId: early.playerId };
                }
                return glimpse.phase === "place" ? pickGap(glimpse, (right: number, gaps: number, seat: number) => (seat === 0 ? right : gaps - 1)) : rest;
            },
        },
        {
            name: "the table that all leaves",
            move: (glimpse: Glimpse<LineState>): Move => ({ kind: "leave", playerId: glimpse.players[0]?.playerId ?? "nobody" }),
        },
    ];
}
