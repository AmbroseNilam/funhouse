// The paper players for the clue kit (a secret word and one-word clues that cancel). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import type { Control } from "../../../shared/controls.ts";
import { CLUE_GIVE_UP_ACTION, CLUE_LOCKED_RULING, type ClueState } from "./clue.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";


/** Clues the paper players write: none is a word in any list, and none is close to another. */
const CLUE_KIT_PAPER_CLUES: readonly string[] = ["amber", "brisk", "cobalt", "dune", "ember", "fjord", "gravel"];

/**
 * The clue kit's personas, between them reaching every ending: a clean round, twins that cancel,
 * clues the rules refuse, a spoken guess ruled by the host, a wrong guess, a table that never
 * writes, a guesser who never guesses, a table that gives up, and people leaving mid-round.
 * @returns the personas.
 */
export function cluePersonas(): Persona<ClueState>[] {
    const giversOf = (state: ClueState, players: readonly CartridgePlayer[]): CartridgePlayer[] => players.filter((player: CartridgePlayer) => player.playerId !== state.guesserId);
    /**
     * The control a player's phone offers for typing, or null.
     * @param glimpse what the persona sees.
     * @param playerId whose phone.
     * @returns the control's id.
     */
    const boxOf = (glimpse: Glimpse<ClueState>, playerId: string): string | null => {
        const box: Control | undefined = glimpse.controls(playerId).find((control: Control) => control.type === "textInput");
        return box?.type === "textInput" ? box.id : null;
    };
    /**
     * The next giver who still has a box, writing what the rule says.
     * @param glimpse what the persona sees.
     * @param textFor picks the clue for a giver by their place among the givers and their tries so far.
     * @returns the move, or a wait when everyone is done.
     */
    const write = (glimpse: Glimpse<ClueState>, textFor: (place: number, tries: number) => string): Move => {
        const givers: CartridgePlayer[] = giversOf(glimpse.state, glimpse.players);
        for (const [place, giver] of givers.entries()) {
            const controlId: string | null = boxOf(glimpse, giver.playerId);
            if (controlId !== null) {
                return { kind: "answer", playerId: giver.playerId, controlId, value: textFor(place, glimpse.state.attempts[giver.playerId] ?? 0) };
            }
        }
        return { kind: "wait", seconds: 5 };
    };
    const typeGuess = (glimpse: Glimpse<ClueState>, text: string): Move => {
        const controlId: string | null = boxOf(glimpse, glimpse.state.guesserId);
        return controlId === null ? { kind: "wait", seconds: 5 } : { kind: "answer", playerId: glimpse.state.guesserId, controlId, value: text };
    };
    const distinct = (place: number): string => CLUE_KIT_PAPER_CLUES[place % CLUE_KIT_PAPER_CLUES.length] ?? "amber";
    const idle: Move = { kind: "wait", seconds: 5 };
    return [
        {
            name: "the clean table",
            move(glimpse: Glimpse<ClueState>): Move {
                if (glimpse.phase === "writing") {
                    return write(glimpse, distinct);
                }
                return glimpse.phase === "guess" ? typeGuess(glimpse, `${glimpse.state.word}s`) : idle;
            },
        },
        {
            name: "the twins",
            move(glimpse: Glimpse<ClueState>): Move {
                if (glimpse.phase === "writing") {
                    return write(glimpse, (place: number) => (place < 2 ? ["Cheddar", "cheddars"][place] ?? "cheddar" : distinct(place)));
                }
                return glimpse.phase === "guess" ? typeGuess(glimpse, "not a chance") : idle;
            },
        },
        {
            name: "the rule breaker",
            move(glimpse: Glimpse<ClueState>): Move {
                if (glimpse.phase === "writing") {
                    const spelled: string = glimpse.state.word.toLowerCase();
                    return write(glimpse, (place: number, tries: number) => (place === 0 ? [spelled, "two words", `${spelled}s`, "grudge"][tries] ?? "grudge" : distinct(place)));
                }
                return glimpse.phase === "guess" ? typeGuess(glimpse, `Is it a ${glimpse.state.word}?`) : idle;
            },
        },
        {
            name: "the speaker",
            move(glimpse: Glimpse<ClueState>): Move {
                if (glimpse.phase === "writing") {
                    return write(glimpse, distinct);
                }
                if (glimpse.phase !== "guess") {
                    return idle;
                }
                const playerId: string = glimpse.state.guesserId;
                return { kind: "say", playerId, text: `I think it's ${glimpse.state.word}`, ruling: glimpse.rulings.includes(CLUE_LOCKED_RULING) === true ? CLUE_LOCKED_RULING : null };
            },
        },
        {
            name: "the thinker aloud",
            move(glimpse: Glimpse<ClueState>): Move {
                if (glimpse.phase === "writing") {
                    return write(glimpse, distinct);
                }
                if (glimpse.phase !== "guess") {
                    return idle;
                }
                return glimpse.turn % 2 === 0 ? { kind: "say", playerId: glimpse.state.guesserId, text: "Hmm, maybe a lamp", ruling: null } : typeGuess(glimpse, "a lamp");
            },
        },
        {
            name: "the silent table",
            move: (): Move => ({ kind: "wait", seconds: 30 }),
        },
        {
            name: "the guesser who never guesses",
            move: (glimpse: Glimpse<ClueState>): Move => (glimpse.phase === "writing" ? write(glimpse, distinct) : { kind: "wait", seconds: 20 }),
        },
        {
            name: "the giver-up",
            move(glimpse: Glimpse<ClueState>): Move {
                const first: CartridgePlayer | undefined = giversOf(glimpse.state, glimpse.players)[0];
                const offered: LegalAction[] = first === undefined ? [] : glimpse.legal(first.playerId);
                const action: string | null = offered.find((candidate: LegalAction) => candidate.actionId === CLUE_GIVE_UP_ACTION)?.actionId ?? null;
                if (glimpse.phase === "writing" && glimpse.turn % 2 === 1) {
                    return write(glimpse, distinct);
                }
                return first === undefined || action === null ? idle : { kind: "press", playerId: first.playerId, actionId: action };
            },
        },
        {
            name: "the walkouts",
            move(glimpse: Glimpse<ClueState>): Move {
                const givers: CartridgePlayer[] = giversOf(glimpse.state, glimpse.players);
                if (glimpse.phase === "writing" && glimpse.state.round % 2 === 1) {
                    return glimpse.state.clues.length >= 1 && glimpse.players.length > 4 ? { kind: "leave", playerId: givers[givers.length - 1]?.playerId ?? "" } : write(glimpse, distinct);
                }
                if (glimpse.phase === "writing") {
                    return write(glimpse, distinct);
                }
                if (glimpse.phase === "guess") {
                    return { kind: "leave", playerId: glimpse.state.guesserId };
                }
                return idle;
            },
        },
    ];
}
