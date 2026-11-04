// The paper players for the charades kit (one player acts a prompt in silence). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import { CHARADES_GIVE_UP_ACTION, GO_ACTION, LEVEL_PREFIX, SWAP_ACTION, type CharadesDecisions, type CharadesState } from "./charades.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";


/** Seconds a persona waits to let a reveal run out. */
const REVEAL_WAIT_SECONDS: number = 10;

/**
 * The charades kit's personas, between them reaching every ending: a guess before and after the
 * halfway mark, a close guess the host is told about, a clock that runs out, a swapped prompt,
 * timers that choose and start for a slow performer, the performer walking out, guessers
 * walking out until too few are left, and the pause menu's give up.
 * @param decisions the game's decisions, so a persona knows the answer it is scripting guesses for.
 * @returns the personas.
 */
export function charadesPersonas(decisions: CharadesDecisions): Persona<CharadesState>[] {
    const answerOf = (glimpse: Glimpse<CharadesState>): string => decisions.prompts[glimpse.state.promptIndex ?? 0]?.answer ?? "";
    const guesser = (glimpse: Glimpse<CharadesState>, turn: number): string => {
        const others: CartridgePlayer[] = glimpse.players.filter((player: CartridgePlayer) => player.playerId !== glimpse.state.performerId);
        return others[turn % Math.max(1, others.length)]?.playerId ?? glimpse.state.performerId;
    };
    const press = (glimpse: Glimpse<CharadesState>, actionId: string): Move => ({ kind: "press", playerId: glimpse.state.performerId, actionId });
    /**
     * The performer's part before the clock: a level that changes turn by turn, then start.
     * @param glimpse what the persona sees.
     * @returns the move, or null when the clock is running or the reveal is up.
     */
    const prepare = (glimpse: Glimpse<CharadesState>): Move | null => {
        if (glimpse.phase === "pick") {
            const levels: LegalAction[] = glimpse.legal(glimpse.state.performerId).filter((action: LegalAction) => action.actionId.startsWith(LEVEL_PREFIX) === true);
            return press(glimpse, levels[glimpse.state.turnsDone % Math.max(1, levels.length)]?.actionId ?? "");
        }
        return glimpse.phase === "ready" ? press(glimpse, GO_ACTION) : null;
    };
    const say = (glimpse: Glimpse<CharadesState>, text: string): Move => ({ kind: "say", playerId: guesser(glimpse, glimpse.turn), text, ruling: null });
    const rest: Move = { kind: "wait", seconds: REVEAL_WAIT_SECONDS };
    return [
        {
            name: "the quick table",
            move(glimpse: Glimpse<CharadesState>): Move {
                const prepared: Move | null = prepare(glimpse);
                if (prepared !== null) {
                    return prepared;
                }
                if (glimpse.phase !== "acting") {
                    return rest;
                }
                return say(glimpse, glimpse.state.guesses.length < 2 ? `Is it a toaster number ${glimpse.turn}?` : `I think it's ${answerOf(glimpse)}`);
            },
        },
        {
            name: "the near miss",
            move(glimpse: Glimpse<CharadesState>): Move {
                const prepared: Move | null = prepare(glimpse);
                if (prepared !== null) {
                    return prepared;
                }
                if (glimpse.phase !== "acting") {
                    return rest;
                }
                const answer: string = answerOf(glimpse);
                const nearly: string = answer.includes(" ") === true ? answer.split(" ").find((word: string) => word.length > 3) ?? answer : `${answer.slice(0, 4)}ish`;
                return say(glimpse, glimpse.state.guesses.length < 3 ? nearly : answer);
            },
        },
        {
            name: "the stumped room",
            move(glimpse: Glimpse<CharadesState>): Move {
                const prepared: Move | null = prepare(glimpse);
                if (prepared !== null) {
                    return prepared;
                }
                if (glimpse.phase !== "acting") {
                    return rest;
                }
                return glimpse.state.guesses.length < 4 ? say(glimpse, `Is it a wardrobe number ${glimpse.turn}?`) : { kind: "wait", seconds: 40 };
            },
        },
        {
            name: "the swapper, guessed late",
            move(glimpse: Glimpse<CharadesState>): Move {
                if (glimpse.phase === "ready") {
                    return press(glimpse, glimpse.state.swapped === false ? SWAP_ACTION : GO_ACTION);
                }
                const prepared: Move | null = prepare(glimpse);
                if (prepared !== null) {
                    return prepared;
                }
                if (glimpse.phase !== "acting") {
                    return rest;
                }
                return glimpse.state.late === false ? { kind: "wait", seconds: 35 } : say(glimpse, answerOf(glimpse));
            },
        },
        {
            name: "the slow performer",
            move(glimpse: Glimpse<CharadesState>): Move {
                if (glimpse.phase === "pick") {
                    return { kind: "wait", seconds: decisions.pickSeconds + 1 };
                }
                if (glimpse.phase === "ready") {
                    return { kind: "wait", seconds: decisions.readySeconds + 1 };
                }
                return glimpse.phase === "acting" ? say(glimpse, answerOf(glimpse)) : rest;
            },
        },
        {
            name: "the walkout",
            move(glimpse: Glimpse<CharadesState>): Move {
                const prepared: Move | null = prepare(glimpse);
                if (prepared !== null) {
                    return prepared;
                }
                if (glimpse.phase !== "acting") {
                    return rest;
                }
                if (glimpse.state.history.length === 0 && glimpse.state.guesses.length >= 1) {
                    return { kind: "leave", playerId: glimpse.state.performerId };
                }
                return glimpse.state.guesses.length < 1 ? say(glimpse, "Is it a wardrobe?") : say(glimpse, answerOf(glimpse));
            },
        },
        {
            name: "the emptying table",
            move(glimpse: Glimpse<CharadesState>): Move {
                const prepared: Move | null = prepare(glimpse);
                if (prepared !== null) {
                    return prepared;
                }
                if (glimpse.phase !== "acting") {
                    return rest;
                }
                return { kind: "leave", playerId: guesser(glimpse, 0) };
            },
        },
        {
            name: "the giver-up",
            move(glimpse: Glimpse<CharadesState>): Move {
                if (glimpse.state.turnsDone >= 1 && glimpse.phase === "pick") {
                    return { kind: "press", playerId: glimpse.players[0]?.playerId ?? "", actionId: CHARADES_GIVE_UP_ACTION };
                }
                const prepared: Move | null = prepare(glimpse);
                if (prepared !== null) {
                    return prepared;
                }
                return glimpse.phase === "acting" ? say(glimpse, answerOf(glimpse)) : rest;
            },
        },
    ];
}
