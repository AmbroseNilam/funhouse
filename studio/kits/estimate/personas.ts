// The paper players for the estimate kit (a numeric question and bets on the closest guess). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import { BET_PREFIX, ESTIMATE_GIVE_UP_ACTION, guessControlId, scoreRound, type EstimateDecisions, type EstimateQuestion, type EstimateState } from "./estimate.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";


/**
 * The estimate kit's personas, between them reaching every ending: a table that guesses close and backs
 * the closest, one where a lone player goes against the crowd and is right, a tie, an exact guess, a
 * round too few people guess in, a table that says nothing, one that gives up, and people leaving in the
 * guessing and in the betting.
 * @param decisions the game's decisions, for the questions.
 * @returns the personas.
 */
export function estimatePersonas(decisions: EstimateDecisions): Persona<EstimateState>[] {
    const questionOf = (state: EstimateState): EstimateQuestion => decisions.questions[state.order[state.round] ?? 0] as EstimateQuestion;
    /**
     * A number on the question's grid, near a share of the answer.
     * @param question the question.
     * @param share how far from the answer, as a fraction of it.
     * @returns the number.
     */
    const near = (question: EstimateQuestion, share: number): number => {
        const wanted: number = question.answer * (1 + share);
        const onGrid: number = question.min + Math.round((wanted - question.min) / question.step) * question.step;
        return Math.min(question.max, Math.max(question.min, onGrid));
    };
    /**
     * The first player at the table who has no entry in a record.
     * @param glimpse what the persona sees.
     * @param record guesses or bets.
     * @param skip players who never act.
     * @returns their id, or undefined.
     */
    const waiting = (glimpse: Glimpse<EstimateState>, record: Readonly<Record<string, unknown>>, skip: readonly string[] = []): string | undefined => {
        return glimpse.players.find((player: CartridgePlayer) => record[player.playerId] === undefined && skip.includes(player.playerId) === false)?.playerId;
    };
    /**
     * Everyone guesses a spread around the answer, each a different distance.
     * @param glimpse what the persona sees.
     * @param spread how far apart, as a fraction.
     * @param skip players who never guess.
     * @returns the move, or null when everyone has.
     */
    const guess = (glimpse: Glimpse<EstimateState>, spread: number, skip: readonly string[] = []): Move | null => {
        const playerId: string | undefined = waiting(glimpse, glimpse.state.guesses, skip);
        if (playerId === undefined) {
            return null;
        }
        const index: number = glimpse.players.findIndex((player: CartridgePlayer) => player.playerId === playerId);
        return { kind: "answer", playerId, controlId: guessControlId(glimpse.state.round), value: near(questionOf(glimpse.state), spread * (index + 1)) };
    };
    /**
     * The guessers the rules would call closest.
     * @param glimpse what the persona sees.
     * @returns their ids.
     */
    const closest = (glimpse: Glimpse<EstimateState>): string[] => scoreRound(glimpse.state.guesses, {}, questionOf(glimpse.state).answer, decisions.points).closest;
    /**
     * The next bettor backs a chosen guesser.
     * @param glimpse what the persona sees.
     * @param choose picks the target from the options and the bettor.
     * @returns the move, or a wait when everyone has bet.
     */
    const bet = (glimpse: Glimpse<EstimateState>, choose: (bettorId: string, targets: string[]) => string): Move => {
        const playerId: string | undefined = waiting(glimpse, glimpse.state.bets);
        if (playerId === undefined) {
            return { kind: "wait", seconds: 10 };
        }
        const offered: string[] = glimpse.legal(playerId).map((action: LegalAction) => action.actionId);
        const targets: string[] = offered.filter((actionId: string) => actionId.startsWith(BET_PREFIX) === true).map((actionId: string) => actionId.slice(BET_PREFIX.length));
        return { kind: "press", playerId, actionId: `${BET_PREFIX}${choose(playerId, targets)}` };
    };
    const rest: Move = { kind: "wait", seconds: 20 };
    return [
        {
            name: "the close guessers who back the closest",
            move(glimpse: Glimpse<EstimateState>): Move {
                if (glimpse.phase === "guess") {
                    return guess(glimpse, 0.04) ?? rest;
                }
                return glimpse.phase === "bet" ? bet(glimpse, (_bettorId: string, targets: string[]) => closest(glimpse).find((id: string) => targets.includes(id) === true) ?? targets[0] ?? "") : rest;
            },
        },
        {
            name: "the lone wolf who is right",
            move(glimpse: Glimpse<EstimateState>): Move {
                if (glimpse.phase === "guess") {
                    return guess(glimpse, 0.05) ?? rest;
                }
                if (glimpse.phase !== "bet") {
                    return rest;
                }
                const wolf: string = glimpse.players[0]?.playerId ?? "";
                const right: string = closest(glimpse)[0] ?? "";
                return bet(glimpse, (bettorId: string, targets: string[]) => (bettorId === wolf ? right : targets.find((id: string) => id !== right) ?? targets[0] ?? ""));
            },
        },
        {
            name: "the tie and the exact guess",
            move(glimpse: Glimpse<EstimateState>): Move {
                if (glimpse.phase === "guess") {
                    const playerId: string | undefined = waiting(glimpse, glimpse.state.guesses);
                    const question: EstimateQuestion = questionOf(glimpse.state);
                    const index: number = glimpse.players.findIndex((player: CartridgePlayer) => player.playerId === playerId);
                    if (playerId === undefined) {
                        return rest;
                    }
                    const value: number = index === 0 ? near(question, 0) : near(question, 0.5);
                    return { kind: "answer", playerId, controlId: guessControlId(glimpse.state.round), value };
                }
                return glimpse.phase === "bet" ? bet(glimpse, (_bettorId: string, targets: string[]) => targets[0] ?? "") : rest;
            },
        },
        {
            name: "the round nobody finishes",
            move(glimpse: Glimpse<EstimateState>): Move {
                if (glimpse.phase === "guess") {
                    const only: string = glimpse.players[0]?.playerId ?? "";
                    const others: string[] = glimpse.players.slice(1).map((player: CartridgePlayer) => player.playerId);
                    return glimpse.state.guesses[only] === undefined ? guess(glimpse, 0.1, others) ?? rest : rest;
                }
                return rest;
            },
        },
        { name: "the quiet table", move: (): Move => ({ kind: "wait", seconds: 40 }) },
        {
            name: "the giver-up",
            move(glimpse: Glimpse<EstimateState>): Move {
                const playerId: string = glimpse.players[0]?.playerId ?? "";
                if (glimpse.phase === "guess" && glimpse.state.round >= 1) {
                    return { kind: "press", playerId, actionId: ESTIMATE_GIVE_UP_ACTION };
                }
                return glimpse.phase === "guess" ? guess(glimpse, 0.05) ?? rest : glimpse.phase === "bet" ? bet(glimpse, (_bettorId: string, targets: string[]) => targets[0] ?? "") : rest;
            },
        },
        {
            name: "the one who leaves mid-guess and the one who leaves mid-bet",
            move(glimpse: Glimpse<EstimateState>): Move {
                const early: CartridgePlayer | undefined = glimpse.players[1];
                if (glimpse.phase === "guess" && glimpse.state.round === 0 && early !== undefined && glimpse.state.guesses[early.playerId] !== undefined) {
                    return { kind: "leave", playerId: early.playerId };
                }
                if (glimpse.phase === "guess") {
                    return guess(glimpse, 0.06) ?? rest;
                }
                const late: CartridgePlayer | undefined = glimpse.players[2];
                if (glimpse.phase === "bet" && glimpse.state.round === 1 && late !== undefined && glimpse.players.length >= 3 && Object.keys(glimpse.state.bets).length >= 1) {
                    return { kind: "leave", playerId: late.playerId };
                }
                return glimpse.phase === "bet" ? bet(glimpse, (_bettorId: string, targets: string[]) => targets[0] ?? "") : rest;
            },
        },
        {
            name: "the table that all leaves",
            move: (glimpse: Glimpse<EstimateState>): Move => ({ kind: "leave", playerId: glimpse.players[0]?.playerId ?? "nobody" }),
        },
    ];
}
