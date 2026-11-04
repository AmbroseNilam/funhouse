// The paper players for the bot kit (the host writes one answer among the humans'). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import type { BotState } from "./bot.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";
import { QUIET_SECONDS, PAPER_ANSWERS, HOSTILE_TEXT, nextWriter, nextPresser } from "../../personas-text.ts";

/**
 * The bot kit's personas, between them reaching every ending: a table that votes every which way,
 * one that always catches the machine, one that never does, a table that never answers, one lone
 * answer, identical answers, a hostile box, a table that never votes, an answerer and a voter who
 * walk out, and a table that shrinks to two.
 * @returns the personas.
 */
export function botPersonas(): Persona<BotState>[] {
    const quiet: Move = { kind: "wait", seconds: QUIET_SECONDS };
    const answerText = (glimpse: Glimpse<BotState>, playerId: string): string => PAPER_ANSWERS[(glimpse.state.round * 5 + Number(playerId.slice(-1))) % PAPER_ANSWERS.length] ?? "";
    const writeAll = (glimpse: Glimpse<BotState>, text: (playerId: string) => string, skip: readonly string[] = []): Move | null => {
        const writer: { playerId: string; controlId: string } | null = nextWriter(glimpse, skip);
        return writer === null ? null : { kind: "answer", playerId: writer.playerId, controlId: writer.controlId, value: text(writer.playerId) };
    };
    const voteSpread = (glimpse: Glimpse<BotState>): Move => nextPresser(glimpse, (options: LegalAction[], place: number) => options[place % options.length]);
    const standard = (glimpse: Glimpse<BotState>): Move => (glimpse.phase === "answering" ? writeAll(glimpse, (id: string) => answerText(glimpse, id)) ?? quiet : glimpse.phase === "voting" ? voteSpread(glimpse) : quiet);
    const ghostIndex = (glimpse: Glimpse<BotState>): number => glimpse.state.options.findIndex((option) => option.ghost === true);
    return [
        { name: "the full table", move: standard },
        {
            name: "the sharp table",
            move: (glimpse: Glimpse<BotState>): Move => (glimpse.phase === "voting" ? nextPresser(glimpse, (options: LegalAction[]) => options.find((option) => option.actionId.endsWith(`:${ghostIndex(glimpse)}`)) ?? options[0]) : standard(glimpse)),
        },
        {
            name: "the fooled table",
            move: (glimpse: Glimpse<BotState>): Move => (glimpse.phase === "voting" ? nextPresser(glimpse, (options: LegalAction[]) => options.find((option) => option.actionId.endsWith(`:${ghostIndex(glimpse)}`) === false) ?? options[0]) : standard(glimpse)),
        },
        { name: "the silent table", move: (): Move => quiet },
        {
            name: "the lone answer",
            move: (glimpse: Glimpse<BotState>): Move => (glimpse.phase === "answering" ? writeAll(glimpse, (id: string) => answerText(glimpse, id), glimpse.players.slice(1).map((player: CartridgePlayer) => player.playerId)) ?? quiet : standard(glimpse)),
        },
        {
            name: "the twins",
            move: (glimpse: Glimpse<BotState>): Move => (glimpse.phase === "answering" ? writeAll(glimpse, () => PAPER_ANSWERS[glimpse.state.round] ?? "") ?? quiet : standard(glimpse)),
        },
        {
            name: "the hostile box",
            move(glimpse: Glimpse<BotState>): Move {
                const writer: { playerId: string; controlId: string } | null = glimpse.phase === "answering" ? nextWriter(glimpse) : null;
                if (writer === null) {
                    return standard(glimpse);
                }
                const refused: boolean = (glimpse.state.attempts[writer.playerId] ?? 0) > 0;
                return { kind: "answer", playerId: writer.playerId, controlId: writer.controlId, value: refused === true ? answerText(glimpse, writer.playerId) : HOSTILE_TEXT };
            },
        },
        {
            name: "the table that never votes",
            move: (glimpse: Glimpse<BotState>): Move => (glimpse.phase === "answering" ? writeAll(glimpse, (id: string) => answerText(glimpse, id)) ?? quiet : quiet),
        },
        {
            name: "the answerer who walks out",
            move(glimpse: Glimpse<BotState>): Move {
                const first: string | undefined = glimpse.players[0]?.playerId;
                return glimpse.phase === "answering" && first !== undefined && glimpse.state.round === 0 ? { kind: "leave", playerId: first } : standard(glimpse);
            },
        },
        {
            name: "the voter who walks out",
            move(glimpse: Glimpse<BotState>): Move {
                const pending: string | undefined = glimpse.state.voters.find((id: string) => glimpse.state.votes[id] === undefined);
                const voted: number = Object.keys(glimpse.state.votes).length;
                return glimpse.phase === "voting" && pending !== undefined && voted === glimpse.state.voters.length - 1 && glimpse.state.round === 0 ? { kind: "leave", playerId: pending } : standard(glimpse);
            },
        },
        {
            name: "the shrinking table",
            move(glimpse: Glimpse<BotState>): Move {
                const last: CartridgePlayer | undefined = glimpse.players.at(-1);
                return glimpse.phase === "answering" && last !== undefined && glimpse.state.round >= 1 ? { kind: "leave", playerId: last.playerId } : standard(glimpse);
            },
        },
    ];
}
