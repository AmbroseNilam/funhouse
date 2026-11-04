// The paper players for the bluff kit (a real fact with a blank and fakes). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import type { BluffState } from "./bluff.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";
import { QUIET_SECONDS, PAPER_ANSWERS, HOSTILE_TEXT, textBoxOf, nextWriter, nextPresser } from "../../personas-text.ts";

/**
 * The bluff kit's personas, between them reaching every ending: a full game, a table that never
 * writes, one lone fake, everyone writing the same fake, a player who keeps typing the truth, a
 * hostile box, a table that never picks, a writer and a picker who walk out, and a table that
 * shrinks to two.
 * @returns the personas.
 */
export function bluffPersonas(): Persona<BluffState>[] {
    const quiet: Move = { kind: "wait", seconds: QUIET_SECONDS };
    const fakeText = (glimpse: Glimpse<BluffState>, playerId: string): string => PAPER_ANSWERS[(glimpse.state.round * 5 + Number(playerId.slice(-1))) % PAPER_ANSWERS.length] ?? "";
    const writeAll = (glimpse: Glimpse<BluffState>, text: (playerId: string) => string, skip: readonly string[] = []): Move | null => {
        const writer: { playerId: string; controlId: string } | null = nextWriter(glimpse, skip);
        return writer === null ? null : { kind: "answer", playerId: writer.playerId, controlId: writer.controlId, value: text(writer.playerId) };
    };
    const pickSpread = (glimpse: Glimpse<BluffState>): Move => nextPresser(glimpse, (options: LegalAction[], place: number) => options[place % options.length]);
    const standard = (glimpse: Glimpse<BluffState>): Move => (glimpse.phase === "writing" ? writeAll(glimpse, (id: string) => fakeText(glimpse, id)) ?? quiet : glimpse.phase === "picking" ? pickSpread(glimpse) : quiet);
    const truthOf = (glimpse: Glimpse<BluffState>): string => glimpse.state.facts[glimpse.state.round]?.answer ?? "";
    return [
        { name: "the full table", move: standard },
        {
            name: "the truth-picker",
            move: (glimpse: Glimpse<BluffState>): Move => {
                if (glimpse.phase !== "picking") {
                    return standard(glimpse);
                }
                const truthIndex: number = glimpse.state.options.findIndex((option) => option.truth === true);
                return nextPresser(glimpse, (options: LegalAction[]) => options.find((option) => option.actionId.endsWith(`:${truthIndex}`)) ?? options[0]);
            },
        },
        { name: "the silent table", move: (): Move => quiet },
        {
            name: "the lone fake",
            move: (glimpse: Glimpse<BluffState>): Move => (glimpse.phase === "writing" ? writeAll(glimpse, (id: string) => fakeText(glimpse, id), glimpse.players.slice(1).map((player: CartridgePlayer) => player.playerId)) ?? quiet : glimpse.phase === "picking" ? pickSpread(glimpse) : quiet),
        },
        {
            name: "the identical fakes",
            move: (glimpse: Glimpse<BluffState>): Move => (glimpse.phase === "writing" ? writeAll(glimpse, () => PAPER_ANSWERS[glimpse.state.round] ?? "") ?? quiet : glimpse.phase === "picking" ? pickSpread(glimpse) : quiet),
        },
        {
            name: "the truth-typer",
            move: (glimpse: Glimpse<BluffState>): Move => {
                const first: string | undefined = glimpse.players[0]?.playerId;
                if (glimpse.phase !== "writing" || first === undefined || textBoxOf(glimpse.controls(first)) === null) {
                    return standard(glimpse);
                }
                return { kind: "answer", playerId: first, controlId: textBoxOf(glimpse.controls(first)) ?? "", value: `the ${truthOf(glimpse)}` };
            },
        },
        {
            name: "the hostile box",
            move(glimpse: Glimpse<BluffState>): Move {
                const writer: { playerId: string; controlId: string } | null = glimpse.phase === "writing" ? nextWriter(glimpse) : null;
                if (writer === null) {
                    return standard(glimpse);
                }
                const refused: boolean = (glimpse.state.attempts[writer.playerId] ?? 0) > 0;
                return { kind: "answer", playerId: writer.playerId, controlId: writer.controlId, value: refused === true ? fakeText(glimpse, writer.playerId) : HOSTILE_TEXT };
            },
        },
        {
            name: "the table that never picks",
            move: (glimpse: Glimpse<BluffState>): Move => (glimpse.phase === "writing" ? writeAll(glimpse, (id: string) => fakeText(glimpse, id)) ?? quiet : quiet),
        },
        {
            name: "the writer who walks out",
            move(glimpse: Glimpse<BluffState>): Move {
                const first: string | undefined = glimpse.players[0]?.playerId;
                return glimpse.phase === "writing" && first !== undefined && glimpse.state.round === 0 ? { kind: "leave", playerId: first } : standard(glimpse);
            },
        },
        {
            name: "the picker who walks out",
            move(glimpse: Glimpse<BluffState>): Move {
                const pending: string | undefined = glimpse.state.pickers.find((id: string) => glimpse.state.picks[id] === undefined);
                const picked: number = Object.keys(glimpse.state.picks).length;
                return glimpse.phase === "picking" && pending !== undefined && picked === glimpse.state.pickers.length - 1 && glimpse.state.round === 0 ? { kind: "leave", playerId: pending } : standard(glimpse);
            },
        },
        {
            name: "the shrinking table",
            move(glimpse: Glimpse<BluffState>): Move {
                const last: CartridgePlayer | undefined = glimpse.players.at(-1);
                return glimpse.phase === "writing" && last !== undefined && glimpse.state.round >= 1 ? { kind: "leave", playerId: last.playerId } : standard(glimpse);
            },
        },
    ];
}
