// The paper players for the clueboard kit (two teams, a grid of words and a hidden key). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer } from "../../../shared/cartridge.ts";
import { GUESS_PREFIX, STOP_ACTION, type Cell, type ClueBoardState, type TeamIndex } from "./clueboard.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";


/** Clue words that are never on a board, so a paper giver's clue is always legal. */
const PAPER_CLUES: readonly string[] = ["zeta", "theta", "iota", "kappa", "lambda"];

/**
 * What the paper host's model writes for a clue-board game: nothing for the board, which sends the
 * game to its own words, and a legal clue when it is asked to give one.
 * @param request the content request.
 * @returns the reply.
 */
export function clueBoardContent(request: string): string {
    return request.startsWith("Write 25") === true ? "" : "xylophone, 2";
}

/**
 * The clue-board kit's personas, between them reaching every ending and every way a turn can go: a
 * team that finds all its words, a trapdoor, turns that run out because nobody finds anything, a
 * giver the host keeps calling foul, a clue the code refuses, a host that never rules, a table that
 * never speaks, guessers who stop early, a giver who leaves so the host gives the clues, and a team
 * that walks out.
 * @returns the personas.
 */
export function clueBoardPersonas(): Persona<ClueBoardState>[] {
    const giverOf = (state: ClueBoardState): string | null => state.giverIds[state.turnTeam];
    const guesserOf = (glimpse: Glimpse<ClueBoardState>): string => {
        const team: TeamIndex = glimpse.state.turnTeam;
        const guessers: CartridgePlayer[] = glimpse.players.filter((player: CartridgePlayer) => glimpse.state.teamOf[player.playerId] === team && player.playerId !== giverOf(glimpse.state));
        return guessers[0]?.playerId ?? "nobody";
    };
    const leftFor = (state: ClueBoardState, team: TeamIndex): number => state.cells.filter((cell: Cell) => cell.owner === (team === 0 ? "a" : "b") && cell.turned === false).length;
    /** The first unturned card satisfying a test, as a guess action. */
    const guessWhere = (glimpse: Glimpse<ClueBoardState>, test: (cell: Cell) => boolean): Move => {
        const index: number = glimpse.state.cells.findIndex((cell: Cell) => cell.turned === false && test(cell) === true);
        return index < 0 ? { kind: "wait", seconds: 10 } : { kind: "press", playerId: guesserOf(glimpse), actionId: `${GUESS_PREFIX}${index}` };
    };
    const ours = (glimpse: Glimpse<ClueBoardState>): ((cell: Cell) => boolean) => (cell: Cell): boolean => cell.owner === (glimpse.state.turnTeam === 0 ? "a" : "b");
    const waiting = (glimpse: Glimpse<ClueBoardState>): Move | null => (glimpse.state.awaiting !== null || glimpse.state.pending !== null ? { kind: "wait", seconds: 4 } : null);
    /** Says a clue for the team on turn, ruled as given. */
    const clue = (glimpse: Glimpse<ClueBoardState>, text: string, ruling: string | null): Move => {
        const giver: string | null = giverOf(glimpse.state);
        return giver === null ? { kind: "wait", seconds: 4 } : { kind: "say", playerId: giver, text, ruling };
    };
    const paperClue = (glimpse: Glimpse<ClueBoardState>): string => `${PAPER_CLUES[glimpse.state.turnNumber % PAPER_CLUES.length] ?? "zeta"} ${leftFor(glimpse.state, glimpse.state.turnTeam) > 1 ? "two" : "one"}`;
    /** A persona that plays a normal turn the way a function says to guess. */
    const turns = (name: string, guess: (glimpse: Glimpse<ClueBoardState>) => Move, ruling: string | null = "fair"): Persona<ClueBoardState> => ({
        name,
        move(glimpse: Glimpse<ClueBoardState>): Move {
            if (glimpse.phase === "setup") {
                return { kind: "wait", seconds: 2 };
            }
            if (glimpse.phase === "clue") {
                return waiting(glimpse) ?? clue(glimpse, paperClue(glimpse), ruling);
            }
            return guess(glimpse);
        },
    });
    return [
        turns("the sweep", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, ours(glimpse))),
        turns("the trapdoor", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, (cell: Cell): boolean => cell.owner === "trap")),
        turns("the wrong turns", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, (cell: Cell): boolean => cell.owner === "neutral")),
        turns("the other side's words", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, (cell: Cell): boolean => ours(glimpse)(cell) === false && cell.owner !== "trap")),
        turns("the early stopper", (glimpse: Glimpse<ClueBoardState>): Move => (glimpse.state.guessesMade >= 1 ? { kind: "press", playerId: guesserOf(glimpse), actionId: STOP_ACTION } : guessWhere(glimpse, ours(glimpse)))),
        turns("the foul caller", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, ours(glimpse)), "foul"),
        turns("the silent judge", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, ours(glimpse)), null),
        {
            name: "the board-word clue",
            move(glimpse: Glimpse<ClueBoardState>): Move {
                if (glimpse.phase !== "clue") {
                    return { kind: "wait", seconds: 60 };
                }
                const word: string = glimpse.state.cells.find((cell: Cell) => cell.turned === false)?.word ?? "";
                return waiting(glimpse) ?? clue(glimpse, `${word} two`, null);
            },
        },
        {
            name: "the mumbler",
            move: (glimpse: Glimpse<ClueBoardState>): Move => (glimpse.phase === "clue" && glimpse.turn % 3 === 0 && waiting(glimpse) === null ? clue(glimpse, "um, well, hmm", null) : { kind: "wait", seconds: 40 }),
        },
        { name: "the quiet table", move: (): Move => ({ kind: "wait", seconds: 30 }) },
        {
            name: "the giver who leaves",
            move(glimpse: Glimpse<ClueBoardState>): Move {
                const giver: string | null = giverOf(glimpse.state);
                if (glimpse.phase === "clue" && giver !== null && glimpse.state.turnNumber === 2) {
                    return { kind: "leave", playerId: giver };
                }
                if (glimpse.phase === "clue") {
                    return waiting(glimpse) ?? clue(glimpse, paperClue(glimpse), "fair");
                }
                return glimpse.phase === "guess" ? guessWhere(glimpse, ours(glimpse)) : { kind: "wait", seconds: 2 };
            },
        },
        {
            name: "the team that walks out",
            move(glimpse: Glimpse<ClueBoardState>): Move {
                const gone: CartridgePlayer | undefined = glimpse.players.find((player: CartridgePlayer) => glimpse.state.teamOf[player.playerId] === 1);
                if (glimpse.phase !== "setup" && glimpse.turn > 3 && gone !== undefined) {
                    return { kind: "leave", playerId: gone.playerId };
                }
                return { kind: "wait", seconds: 2 };
            },
        },
    ];
}
