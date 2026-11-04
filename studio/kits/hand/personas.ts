// The paper players for the hand kit (dealt cards and a rotating judge). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import type { HandState } from "./hand.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";
import { QUIET_SECONDS } from "../../persona-support.ts";

/**
 * The hand kit's personas, between them reaching every ending: a full table in each tone, a table
 * that never acts, one lone player, a judge who dithers, half a table, and people walking out
 * until the game can't go on.
 * @returns the personas.
 */
export function handPersonas(): Persona<HandState>[] {
    /**
     * The first player who may still do something, pressing their first option, or a wait.
     * @param glimpse what the persona sees.
     * @param only limits who may act, or leaves everyone.
     * @param prefer picks among a player's options by id; the first option when it finds none.
     * @returns the move.
     */
    const act = (glimpse: Glimpse<HandState>, only: (playerId: string) => boolean = () => true, prefer: string = ""): Move => {
        for (const player of glimpse.players) {
            const actions: LegalAction[] = only(player.playerId) === true ? glimpse.legal(player.playerId) : [];
            const chosen: LegalAction | undefined = actions.find((action: LegalAction) => prefer !== "" && action.actionId.endsWith(prefer) === true) ?? actions[glimpse.turn % Math.max(1, actions.length)];
            if (chosen !== undefined) {
                return { kind: "press", playerId: player.playerId, actionId: chosen.actionId };
            }
        }
        return { kind: "wait", seconds: 5 };
    };
    const full = (name: string, tone: string): Persona<HandState> => ({ name, move: (glimpse: Glimpse<HandState>): Move => act(glimpse, () => true, tone) });
    return [
        full("the party table", "party"),
        full("the family table", "family"),
        { name: "the dawdlers", move: (): Move => ({ kind: "wait", seconds: QUIET_SECONDS }) },
        {
            name: "the lone player",
            move(glimpse: Glimpse<HandState>): Move {
                const first: string = glimpse.players.find((player: CartridgePlayer) => player.playerId !== glimpse.state.judgeId)?.playerId ?? "";
                return glimpse.phase === "playing" ? act(glimpse, (playerId: string) => playerId === first) : act(glimpse);
            },
        },
        {
            name: "the half table",
            move(glimpse: Glimpse<HandState>): Move {
                const others: CartridgePlayer[] = glimpse.players.filter((player: CartridgePlayer) => player.playerId !== glimpse.state.judgeId);
                const idle: string[] = others.slice(2).map((player: CartridgePlayer) => player.playerId);
                return glimpse.phase === "playing" ? act(glimpse, (playerId: string) => idle.includes(playerId) === false) : act(glimpse);
            },
        },
        {
            name: "the dithering judge",
            move: (glimpse: Glimpse<HandState>): Move => (glimpse.phase === "judging" ? { kind: "wait", seconds: QUIET_SECONDS } : act(glimpse)),
        },
        {
            name: "the walkout",
            move(glimpse: Glimpse<HandState>): Move {
                if (glimpse.state.round === 2 && glimpse.state.phase === "playing" && glimpse.state.plays.length === 0) {
                    return { kind: "leave", playerId: glimpse.state.judgeId };
                }
                if (glimpse.state.round >= 3 && glimpse.phase === "playing") {
                    const other: CartridgePlayer | undefined = glimpse.players.find((player: CartridgePlayer) => player.playerId !== glimpse.state.judgeId);
                    return other === undefined ? { kind: "wait", seconds: 5 } : { kind: "leave", playerId: other.playerId };
                }
                return act(glimpse);
            },
        },
        {
            name: "the leaver before the first card",
            move(glimpse: Glimpse<HandState>): Move {
                const chooser: string = glimpse.state.chooserId;
                return glimpse.phase === "tone" && glimpse.players.some((player: CartridgePlayer) => player.playerId === chooser) === true && glimpse.turn === 1 ? { kind: "leave", playerId: chooser } : act(glimpse);
            },
        },
    ];
}
