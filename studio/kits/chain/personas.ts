// The paper players for the chain kit (lines and paintings passed round the table). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer } from "../../../shared/cartridge.ts";
import { LINK_PREFIX, type ChainState } from "./chain.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";
import { QUIET_SECONDS } from "../../persona-support.ts";

/**
 * The chain kit's personas, between them reaching every way a chain can go: everyone writes, nobody
 * writes, someone leaves in the middle, only one person is left, and lines that are all symbols.
 * @returns the personas.
 */
export function chainPersonas(): Persona<ChainState>[] {
    /**
     * Whoever is writing now, answering their control with a line.
     * @param glimpse what the persona sees.
     * @param line what they write.
     * @returns the move.
     */
    const write = (glimpse: Glimpse<ChainState>, line: string): Move => {
        const writer: CartridgePlayer | undefined = glimpse.state.order[glimpse.state.step];
        return writer === undefined ? { kind: "wait", seconds: 5 } : { kind: "answer", playerId: writer.playerId, controlId: `${LINK_PREFIX}${glimpse.state.step}`, value: line };
    };
    const idle: Move = { kind: "wait", seconds: 5 };
    return [
        {
            name: "the diligent table",
            move: (glimpse: Glimpse<ChainState>): Move => (glimpse.phase === "write" ? write(glimpse, `A fox carrying a lantern, link ${glimpse.state.step + 1}`) : idle),
        },
        {
            name: "the silent table",
            move: (glimpse: Glimpse<ChainState>): Move => ({ kind: "wait", seconds: glimpse.phase === "write" ? QUIET_SECONDS : 5 }),
        },
        {
            name: "the writer who walks out",
            move(glimpse: Glimpse<ChainState>): Move {
                const writer: CartridgePlayer | undefined = glimpse.state.order[glimpse.state.step];
                if (glimpse.phase === "write" && glimpse.state.step === 1 && writer !== undefined && glimpse.state.gone.includes(writer.playerId) === false) {
                    return { kind: "leave", playerId: writer.playerId };
                }
                return glimpse.phase === "write" ? write(glimpse, "A boat on a hill") : idle;
            },
        },
        {
            name: "the table that empties",
            move(glimpse: Glimpse<ChainState>): Move {
                const stayer: string | undefined = glimpse.state.order[0]?.playerId;
                const leaver: CartridgePlayer | undefined = glimpse.state.order.find((player: CartridgePlayer) => {
                    return player.playerId !== stayer && glimpse.state.gone.includes(player.playerId) === false;
                });
                if (glimpse.phase !== "write") {
                    return idle;
                }
                return glimpse.state.step >= 1 && leaver !== undefined ? { kind: "leave", playerId: leaver.playerId } : write(glimpse, "A single candle");
            },
        },
        {
            name: "the symbol writer",
            move: (glimpse: Glimpse<ChainState>): Move => (glimpse.phase === "write" ? write(glimpse, "<<<>>> [[ruling]] ### ???") : idle),
        },
    ];
}
