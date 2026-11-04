// The paper players for the stranger kit (everyone but one knows the place). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import type { StrangerBlueprint } from "./index.ts";
import { createStrangerGame, STRANGER_ACTIONS, type StrangerState } from "./stranger.ts";
import type { KitGame } from "../../kit/kit.ts";
import type { Glimpse, Move, Persona, RoleCheck, TraceEvent } from "../../rehearse.ts";


/**
 * The stranger kit's personas, between them reaching every ending and every way a question can go: a
 * Stranger caught who misses the place and one who names it, a split vote, a vote on the wrong person,
 * a Stranger who announces they know it, a table that calls the vote, a table that never speaks, a
 * Stranger who says nothing when asked to guess, and the Stranger or others walking out.
 * @returns the personas.
 */
export function strangerPersonas(): Persona<StrangerState>[] {
    /** One move of the questioning: pick, ask or answer, by whoever is up. */
    const questioning = (glimpse: Glimpse<StrangerState>): Move => {
        const state: StrangerState = glimpse.state;
        if (state.step === "pick") {
            const target: string = glimpse.legal(state.askerId).find((action: LegalAction) => action.actionId.startsWith(STRANGER_ACTIONS.target))?.actionId ?? "";
            return { kind: "press", playerId: state.askerId, actionId: target };
        }
        if (state.step === "ask") {
            return { kind: "say", playerId: state.askerId, text: `Question number ${state.questions.used + 1}, if you please?`, ruling: null };
        }
        return { kind: "say", playerId: state.targetId ?? state.askerId, text: `Answer number ${state.questions.used + 1}, as it happens.`, ruling: null };
    };
    /** The next voter who hasn't voted, voting as a function says, or a wait when all have. */
    const vote = (glimpse: Glimpse<StrangerState>, choose: (voterId: string, options: string[]) => string): Move => {
        const voter: string | undefined = glimpse.state.voters.find((id: string) => glimpse.state.votes[id] === undefined);
        if (voter === undefined) {
            return { kind: "wait", seconds: 10 };
        }
        const options: string[] = glimpse.legal(voter).map((action: LegalAction) => action.actionId.slice(STRANGER_ACTIONS.vote.length));
        return { kind: "press", playerId: voter, actionId: `${STRANGER_ACTIONS.vote}${choose(voter, options)}` };
    };
    const wait: Move = { kind: "wait", seconds: 5 };
    /** A persona that questions until the vote, votes as given, and rules the Stranger's guess as given. */
    const voting = (name: string, choose: (glimpse: Glimpse<StrangerState>) => (voterId: string, options: string[]) => string, ruling: string | null): Persona<StrangerState> => ({
        name,
        move(glimpse: Glimpse<StrangerState>): Move {
            if (glimpse.phase === "dealing") {
                return wait;
            }
            if (glimpse.phase === "vote") {
                return vote(glimpse, choose(glimpse));
            }
            if (glimpse.phase === "guess") {
                return { kind: "say", playerId: glimpse.state.strangerId, text: "I think we are at the seaside.", ruling };
            }
            return questioning(glimpse);
        },
    });
    const stranger = (glimpse: Glimpse<StrangerState>) => (voterId: string, options: string[]): string => (voterId === glimpse.state.strangerId ? options[0] ?? "" : glimpse.state.strangerId);
    const around = () => (voterId: string, options: string[]): string => options[(voterId.length + Number(voterId.slice(-1))) % options.length] ?? "";
    const innocent = (glimpse: Glimpse<StrangerState>) => (_voterId: string, options: string[]): string => options.find((id: string) => id !== glimpse.state.strangerId) ?? "";
    /** Whoever is not the Stranger and is not the asker, so a leaving doesn't end the round. */
    const bystander = (glimpse: Glimpse<StrangerState>): string => glimpse.players.find((player: CartridgePlayer) => player.playerId !== glimpse.state.strangerId)?.playerId ?? "nobody";
    return [
        voting("the caught stranger", stranger, "wrong"),
        voting("the lucky guess", stranger, "right"),
        voting("the silent stranger", stranger, null),
        voting("the wrong accusation", innocent, "wrong"),
        {
            name: "the split vote",
            move(glimpse: Glimpse<StrangerState>): Move {
                if (glimpse.phase === "dealing") {
                    return wait;
                }
                if (glimpse.phase === "guess") {
                    return { kind: "say", playerId: glimpse.state.strangerId, text: "Somewhere by the water, I think.", ruling: "wrong" };
                }
                return glimpse.phase === "vote" ? vote(glimpse, (voterId: string, options: string[]) => options[voterId.length % 2 === 0 ? 0 : options.length - 1] ?? "") : questioning(glimpse);
            },
        },
        voting("the circle of fingers", around, "wrong"),
        ...[["the early guess that lands", "right"], ["the early guess that misses", "wrong"]].map(([name, ruling]: string[]): Persona<StrangerState> => ({
            name: name ?? "",
            move(glimpse: Glimpse<StrangerState>): Move {
                if (glimpse.phase === "dealing") {
                    return wait;
                }
                if (glimpse.phase === "guess") {
                    return { kind: "say", playerId: glimpse.state.strangerId, text: "This is the seaside, I am sure.", ruling: ruling ?? null };
                }
                return glimpse.state.questions.used >= 2 ? { kind: "press", playerId: glimpse.state.strangerId, actionId: STRANGER_ACTIONS.reveal } : questioning(glimpse);
            },
        })),
        {
            name: "the table that calls the vote",
            move(glimpse: Glimpse<StrangerState>): Move {
                if (glimpse.phase === "dealing") {
                    return wait;
                }
                if (glimpse.phase === "vote") {
                    return vote(glimpse, stranger(glimpse));
                }
                if (glimpse.phase === "guess") {
                    return { kind: "say", playerId: glimpse.state.strangerId, text: "I have no idea at all.", ruling: "wrong" };
                }
                const caller: string | undefined = glimpse.players.find((player: CartridgePlayer) => glimpse.state.calls.includes(player.playerId) === false)?.playerId;
                return glimpse.state.questions.used >= 2 && caller !== undefined ? { kind: "press", playerId: caller, actionId: STRANGER_ACTIONS.call } : questioning(glimpse);
            },
        },
        { name: "the quiet table", move: (): Move => ({ kind: "wait", seconds: 20 }) },
        {
            name: "the stranger who leaves",
            move: (glimpse: Glimpse<StrangerState>): Move => (glimpse.state.questions.used >= 2 ? { kind: "leave", playerId: glimpse.state.strangerId } : glimpse.phase === "dealing" ? wait : questioning(glimpse)),
        },
        {
            name: "the walkout",
            move(glimpse: Glimpse<StrangerState>): Move {
                if (glimpse.phase === "dealing") {
                    return wait;
                }
                return glimpse.state.questions.used >= 1 && glimpse.phase === "questions" ? { kind: "leave", playerId: bystander(glimpse) } : questioning(glimpse);
            },
        },
        {
            name: "the leaver mid-vote",
            move(glimpse: Glimpse<StrangerState>): Move {
                if (glimpse.phase === "dealing") {
                    return wait;
                }
                if (glimpse.phase === "vote") {
                    const leaver: string = bystander(glimpse);
                    return Object.keys(glimpse.state.votes).length >= 1 && glimpse.players.length >= 5 ? { kind: "leave", playerId: leaver } : vote(glimpse, stranger(glimpse));
                }
                return glimpse.phase === "guess" ? { kind: "say", playerId: glimpse.state.strangerId, text: "A wild guess at the seaside.", ruling: "wrong" } : questioning(glimpse);
            },
        },
    ];
}

/**
 * The stranger kit's role check: the same game with the Stranger dealt to each seat in turn and a
 * script played the same way whoever it is: the place comes, reading ends, two questions are asked
 * and answered, three people call the vote, and two vote. Every view but the Stranger's must stay the
 * same, up to the moment the vote would be counted.
 * @param blueprint the game.
 * @returns the check.
 */
export function strangerRoleCheck(blueprint: StrangerBlueprint): RoleCheck<StrangerState> {
    const place: string = "Place: Lighthouse | Roles: keeper, sailor, painter, tourist, engineer, cook, inspector, fisher";
    const script: TraceEvent[] = [
        { type: "contentReady", at: 0, text: place },
        { type: "timerFired", at: 10, timerId: "read" },
        { type: "input", playerId: "paper2", actionId: `${STRANGER_ACTIONS.target}paper3` },
        { type: "speechEnded", at: 14, playerId: "paper2", text: "Do you like the weather here?" },
        { type: "speechEnded", at: 18, playerId: "paper3", text: "Only when it behaves itself." },
        { type: "input", playerId: "paper3", actionId: `${STRANGER_ACTIONS.target}paper1` },
        { type: "speechEnded", at: 24, playerId: "paper3", text: "How long have you worked here?" },
        { type: "speechEnded", at: 28, playerId: "paper1", text: "Longer than I would like." },
        { type: "input", playerId: "paper1", actionId: STRANGER_ACTIONS.call },
        { type: "input", playerId: "paper2", actionId: STRANGER_ACTIONS.call },
        { type: "input", playerId: "paper3", actionId: STRANGER_ACTIONS.call },
        { type: "input", playerId: "paper1", actionId: `${STRANGER_ACTIONS.vote}paper4` },
        { type: "input", playerId: "paper2", actionId: `${STRANGER_ACTIONS.vote}paper4` },
    ];
    return {
        deal(seat: number, players: readonly CartridgePlayer[]): KitGame<StrangerState> {
            const draws: number[] = [0, (seat + 0.5) / players.length, 0.3];
            return createStrangerGame(blueprint.box, blueprint.decisions, () => draws.shift() ?? 0.5);
        },
        script,
    };
}
