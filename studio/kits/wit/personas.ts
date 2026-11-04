// The paper players for the wit kit (two players answer one prompt in secret and the room votes). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import type { WitState } from "./wit.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";
import { QUIET_SECONDS, PAPER_ANSWERS, HOSTILE_TEXT, nextWriter, nextPresser } from "../../personas-text.ts";

/**
 * The wit kit's personas, between them reaching every ending: a full game, a writer who stays
 * silent, a table that stays silent, two identical answers, a vote nobody casts, a tied vote, a
 * hostile box, a writer who walks out, a voter who walks out, and a table that shrinks to two.
 * @returns the personas.
 */
export function witPersonas(): Persona<WitState>[] {
    const answerText = (glimpse: Glimpse<WitState>, playerId: string): string => PAPER_ANSWERS[(glimpse.state.round * 3 + Number(playerId.slice(-1))) % PAPER_ANSWERS.length] ?? "";
    const writeAll = (glimpse: Glimpse<WitState>, skip: readonly string[] = []): Move | null => {
        const writer: { playerId: string; controlId: string } | null = nextWriter(glimpse, skip);
        return writer === null ? null : { kind: "answer", playerId: writer.playerId, controlId: writer.controlId, value: answerText(glimpse, writer.playerId) };
    };
    const voteFirst = (glimpse: Glimpse<WitState>, skip: readonly string[] = []): Move => nextPresser(glimpse, (options: LegalAction[]) => options[0], skip);
    const voteSplit = (glimpse: Glimpse<WitState>): Move => nextPresser(glimpse, (options: LegalAction[], place: number) => options[place % options.length]);
    const quiet: Move = { kind: "wait", seconds: QUIET_SECONDS };
    const matchupOf = (glimpse: Glimpse<WitState>): string[] => glimpse.state.schedule[glimpse.state.round] ?? [];
    return [
        {
            name: "the full table",
            move: (glimpse: Glimpse<WitState>): Move => (glimpse.phase === "writing" ? writeAll(glimpse) ?? quiet : glimpse.phase === "voting" ? voteFirst(glimpse) : quiet),
        },
        {
            name: "the split table",
            move: (glimpse: Glimpse<WitState>): Move => (glimpse.phase === "writing" ? writeAll(glimpse) ?? quiet : glimpse.phase === "voting" ? voteSplit(glimpse) : quiet),
        },
        {
            name: "the lone writer",
            move(glimpse: Glimpse<WitState>): Move {
                const second: string | undefined = matchupOf(glimpse)[1];
                return glimpse.phase === "writing" ? writeAll(glimpse, second === undefined ? [] : [second]) ?? quiet : glimpse.phase === "voting" ? voteFirst(glimpse) : quiet;
            },
        },
        {
            name: "the silent table",
            move: (): Move => quiet,
        },
        {
            name: "the twins",
            move(glimpse: Glimpse<WitState>): Move {
                const writer: { playerId: string; controlId: string } | null = glimpse.phase === "writing" ? nextWriter(glimpse) : null;
                if (writer !== null) {
                    return { kind: "answer", playerId: writer.playerId, controlId: writer.controlId, value: PAPER_ANSWERS[glimpse.state.round % PAPER_ANSWERS.length] ?? "" };
                }
                return glimpse.phase === "voting" ? voteFirst(glimpse) : quiet;
            },
        },
        {
            name: "the empty ballot",
            move: (glimpse: Glimpse<WitState>): Move => (glimpse.phase === "writing" ? writeAll(glimpse) ?? quiet : quiet),
        },
        {
            name: "the hostile box",
            move(glimpse: Glimpse<WitState>): Move {
                const writer: { playerId: string; controlId: string } | null = glimpse.phase === "writing" ? nextWriter(glimpse) : null;
                if (writer !== null) {
                    const refused: boolean = (glimpse.state.attempts[writer.playerId] ?? 0) > 0;
                    return { kind: "answer", playerId: writer.playerId, controlId: writer.controlId, value: refused === true ? answerText(glimpse, writer.playerId) : HOSTILE_TEXT };
                }
                return glimpse.phase === "voting" ? voteFirst(glimpse) : quiet;
            },
        },
        {
            name: "the writer who walks out",
            move(glimpse: Glimpse<WitState>): Move {
                const first: string | undefined = matchupOf(glimpse)[0];
                if (glimpse.phase === "writing" && first !== undefined && glimpse.state.round === 0) {
                    return { kind: "leave", playerId: first };
                }
                return glimpse.phase === "writing" ? writeAll(glimpse) ?? quiet : glimpse.phase === "voting" ? voteFirst(glimpse) : quiet;
            },
        },
        {
            name: "the voter who walks out",
            move(glimpse: Glimpse<WitState>): Move {
                if (glimpse.phase === "writing") {
                    return writeAll(glimpse) ?? quiet;
                }
                if (glimpse.phase !== "voting") {
                    return quiet;
                }
                const pending: string | undefined = glimpse.state.voters.find((id: string) => glimpse.state.votes[id] === undefined);
                const voted: number = Object.keys(glimpse.state.votes).length;
                return pending !== undefined && voted === glimpse.state.voters.length - 1 && glimpse.state.round === 0 ? { kind: "leave", playerId: pending } : voteFirst(glimpse);
            },
        },
        {
            name: "the shrinking table",
            move(glimpse: Glimpse<WitState>): Move {
                const bystander = (player: CartridgePlayer): boolean => matchupOf(glimpse).includes(player.playerId) === false;
                const spare: CartridgePlayer | undefined = glimpse.players.find(bystander) ?? glimpse.players[0];
                if (glimpse.phase === "writing" && spare !== undefined && glimpse.state.round >= 1) {
                    return { kind: "leave", playerId: spare.playerId };
                }
                return glimpse.phase === "writing" ? writeAll(glimpse) ?? quiet : glimpse.phase === "voting" ? voteFirst(glimpse) : quiet;
            },
        },
    ];
}
