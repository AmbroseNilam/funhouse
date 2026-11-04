// The paper players for the hostGuess kit (players hold a thing in secret and the host asks questions). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import { HOST_GUESS_IDS, type HostGuessDecisions, type HostGuessState } from "./host-guess.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";
import { QUIET_SECONDS } from "../../persona-support.ts";

/**
 * The host-guess kit's personas. Each scripts the table and the host together, since a rehearsal has
 * no model: a table that answers and a host that guesses early and is right, a table that stumps the
 * host through every question and every guess, a table that never taps, a host that never acts, a
 * player who leaves with a question open, and a careless host that asks what it should not.
 * @param decisions the game's decisions.
 * @returns the personas.
 */
export function hostGuessPersonas(decisions: HostGuessDecisions): Persona<HostGuessState>[] {
    /**
     * Has the first player who can press something do so, or waits for a clock.
     * @param glimpse what the persona sees.
     * @param choose picks among a player's actions given their seat; undefined means they do nothing.
     * @returns the move.
     */
    const everyone = (glimpse: Glimpse<HostGuessState>, choose: (actions: LegalAction[], seat: number) => LegalAction | undefined): Move => {
        for (const [seat, player] of glimpse.players.entries()) {
            const chosen: LegalAction | undefined = choose(glimpse.legal(player.playerId), seat);
            if (chosen !== undefined) {
                return { kind: "press", playerId: player.playerId, actionId: chosen.actionId };
            }
        }
        return { kind: "wait", seconds: QUIET_SECONDS };
    };
    const ending = (suffix: string): ((actions: LegalAction[]) => LegalAction | undefined) => {
        return (actions: LegalAction[]) => actions.find((action: LegalAction) => action.actionId.endsWith(suffix));
    };
    const first = (actions: LegalAction[]): LegalAction | undefined => actions[0];
    const answerWith = (answers: readonly string[]): ((actions: LegalAction[], seat: number) => LegalAction | undefined) => {
        return (actions: LegalAction[], seat: number) => actions.find((action: LegalAction) => action.actionId === `${HOST_GUESS_IDS.answer}${answers[seat % answers.length] ?? "yes"}`);
    };
    const ask = (glimpse: Glimpse<HostGuessState>): Move => ({ kind: "rule", ruling: "ask", detail: `Is the thing number ${glimpse.state.asked.length + 1} on my list?` });
    const guess = (text: string): Move => ({ kind: "rule", ruling: "guess", detail: text });
    const left = (glimpse: Glimpse<HostGuessState>): number => glimpse.state.count.max - glimpse.state.count.used;
    /**
     * Plays the phases every persona plays the same way: pick the first category, say ready.
     * @param glimpse what the persona sees.
     * @returns the move, or null for a phase the persona plays itself.
     */
    const opening = (glimpse: Glimpse<HostGuessState>): Move | null => (glimpse.phase === "category" || glimpse.phase === "secret" ? everyone(glimpse, first) : null);
    const judged = (verdict: string): ((glimpse: Glimpse<HostGuessState>) => Move | null) => {
        return (glimpse: Glimpse<HostGuessState>): Move | null => (glimpse.phase === "guess" || glimpse.phase === "reveal" ? everyone(glimpse, ending(`${HOST_GUESS_IDS.verdict}${verdict}`)) : null);
    };
    return [
        {
            name: "the quick win",
            move(glimpse: Glimpse<HostGuessState>): Move {
                const early: Move | null = opening(glimpse) ?? judged("right")(glimpse);
                if (early !== null) {
                    return early;
                }
                if (glimpse.state.pending !== null) {
                    return everyone(glimpse, answerWith(["yes", "no"]));
                }
                return glimpse.state.asked.length >= 3 ? guess("A lighthouse") : ask(glimpse);
            },
        },
        {
            name: "the table that stumps the host",
            move(glimpse: Glimpse<HostGuessState>): Move {
                const early: Move | null = opening(glimpse) ?? judged("wrong")(glimpse);
                if (early !== null) {
                    return early;
                }
                if (glimpse.state.pending !== null) {
                    return everyone(glimpse, answerWith(["yes", "no", "sometimes", "yes", "no"]));
                }
                if (glimpse.state.wrongGuesses.length === 0 && glimpse.state.asked.length === 2 && decisions.guesses > 1) {
                    return guess("A very wrong guess");
                }
                return left(glimpse) > 0 ? ask(glimpse) : guess("A final wrong guess");
            },
        },
        {
            name: "the table that never taps",
            move(glimpse: Glimpse<HostGuessState>): Move {
                if (glimpse.phase === "asking" && glimpse.state.pending === null) {
                    return glimpse.state.asked.length >= 2 ? guess("Something quiet") : ask(glimpse);
                }
                return { kind: "wait", seconds: QUIET_SECONDS };
            },
        },
        {
            name: "the host that never acts",
            move: (glimpse: Glimpse<HostGuessState>): Move => opening(glimpse) ?? { kind: "wait", seconds: QUIET_SECONDS },
        },
        {
            name: "the one who leaves with a question open",
            move(glimpse: Glimpse<HostGuessState>): Move {
                const early: Move | null = opening(glimpse) ?? judged("right")(glimpse);
                if (early !== null) {
                    return early;
                }
                if (glimpse.state.pending !== null) {
                    const leaver: CartridgePlayer | undefined = glimpse.players[glimpse.players.length - 1];
                    const answered: number = Object.keys(glimpse.state.pending.answers).length;
                    const lastToAnswer: boolean = leaver !== undefined && glimpse.state.pending.answers[leaver.playerId] === undefined;
                    if (leaver !== undefined && lastToAnswer === true && glimpse.players.length > 2 && answered === glimpse.players.length - 1) {
                        return { kind: "leave", playerId: leaver.playerId };
                    }
                    return everyone(glimpse, answerWith(["yes"]));
                }
                return glimpse.state.asked.length >= 2 ? guess("A teapot") : ask(glimpse);
            },
        },
        {
            name: "the careless host",
            move(glimpse: Glimpse<HostGuessState>): Move {
                const early: Move | null = opening(glimpse) ?? judged("wrong")(glimpse);
                if (early !== null) {
                    return early;
                }
                if (glimpse.state.pending !== null) {
                    return everyone(glimpse, answerWith(["no"]));
                }
                const carelessTurn: boolean = glimpse.turn % 2 === 1;
                const lastQuestion: string | undefined = glimpse.state.asked.at(-1)?.question;
                const lastWrong: string | undefined = glimpse.state.wrongGuesses.at(-1);
                if (carelessTurn === true && lastWrong !== undefined) {
                    return guess(lastWrong);
                }
                if (carelessTurn === true) {
                    return { kind: "rule", ruling: "ask", detail: lastQuestion ?? "hm" };
                }
                if (left(glimpse) === 0) {
                    return guess("Something final");
                }
                return glimpse.state.asked.length === 2 && glimpse.state.wrongGuesses.length === 0 && decisions.guesses > 1 ? guess("Something early") : ask(glimpse);
            },
        },
    ];
}
