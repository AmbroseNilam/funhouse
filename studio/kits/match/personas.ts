// The paper players for the match kit (everyone types a card and the room stacks them). Each persona
// is a way of playing that also scripts the judge, since a rehearsal has no model: they read what
// each phone offers, never hardcoded ids, so a valid game with renamed parts still rehearses.
// Between them they reach every ending: one mind, one odd card that takes the hat, a tie on the
// hat, pairs, pairs that look alike and need the closed question, a hostile box, a silent table, a
// table that shrinks until the game cannot go on.

import type { MatchState } from "./match.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";
import { HOSTILE_TEXT, PAPER_ANSWERS, QUIET_SECONDS, nextWriter } from "../../personas-text.ts";

/** What the host's model says to the closed question in a rehearsal: every pair, in every round, is the same thing. */
export const PAPER_SAME_REPLY: string = Array.from({ length: 12 }, (_unused: unknown, round: number) => [1, 2, 3, 4].map((pair: number) => `${round + 1}.${pair} yes`).join("\n")).join("\n");

/**
 * The match kit's personas.
 * @returns the personas.
 */
export function matchPersonas(): Persona<MatchState>[] {
    const quiet: Move = { kind: "wait", seconds: QUIET_SECONDS };
    /**
     * Has the next player with a box type what the rule says.
     * @param glimpse what the persona sees.
     * @param textFor picks the card for a player by seat and round.
     * @param skip players who never type.
     * @returns the move, or a wait when nobody has a box.
     */
    const write = (glimpse: Glimpse<MatchState>, textFor: (seat: number, round: number, tries: number) => string, skip: readonly string[] = []): Move => {
        const writer: { playerId: string; controlId: string } | null = nextWriter(glimpse, skip);
        if (writer === null) {
            return quiet;
        }
        const seat: number = glimpse.players.findIndex((player) => player.playerId === writer.playerId);
        return { kind: "answer", playerId: writer.playerId, controlId: writer.controlId, value: textFor(seat, glimpse.state.round, glimpse.state.attempts[writer.playerId] ?? 0) };
    };
    const playing = (glimpse: Glimpse<MatchState>): boolean => glimpse.phase === "writing";
    const distinct = (seat: number, round: number): string => PAPER_ANSWERS[(seat + round * 5) % PAPER_ANSWERS.length] ?? "";
    return [
        { name: "one mind", move: (glimpse: Glimpse<MatchState>): Move => (playing(glimpse) ? write(glimpse, (seat: number) => ["Pizza", "pizza", "pizzas", "PIZZA!"][seat % 4] ?? "pizza") : quiet) },
        { name: "one odd card", move: (glimpse: Glimpse<MatchState>): Move => (playing(glimpse) ? write(glimpse, (seat: number, round: number) => (seat === round % 3 ? distinct(seat, round) : "tacos")) : quiet) },
        { name: "everyone different", move: (glimpse: Glimpse<MatchState>): Move => (playing(glimpse) ? write(glimpse, distinct) : quiet) },
        { name: "pairs", move: (glimpse: Glimpse<MatchState>): Move => (playing(glimpse) ? write(glimpse, (seat: number, round: number) => (seat < 4 ? ["Umbrella", "umbrellas"][seat % 2] ?? "" : distinct(seat, round))) : quiet) },
        {
            name: "looks alike",
            move: (glimpse: Glimpse<MatchState>): Move => (playing(glimpse) ? write(glimpse, (seat: number) => ["bat", "baseball bat", "bats", "bait", "ice cream"][seat % 5] ?? "bat") : quiet),
        },
        {
            name: "hostile box",
            move: (glimpse: Glimpse<MatchState>): Move => (playing(glimpse) ? write(glimpse, (seat: number, _round: number, tries: number) => (seat === 0 && tries === 0 ? HOSTILE_TEXT : "river")) : quiet),
        },
        { name: "silent table", move: (): Move => quiet },
        {
            name: "one writer",
            move: (glimpse: Glimpse<MatchState>): Move => (playing(glimpse) ? write(glimpse, distinct, glimpse.players.slice(1).map((player) => player.playerId)) : quiet),
        },
        {
            name: "walkouts",
            move(glimpse: Glimpse<MatchState>): Move {
                const last = glimpse.players[glimpse.players.length - 1];
                if (playing(glimpse) && glimpse.state.round >= 2 && last !== undefined && glimpse.players.length > 1) {
                    return { kind: "leave", playerId: last.playerId };
                }
                return playing(glimpse) ? write(glimpse, distinct) : quiet;
            },
        },
    ];
}
