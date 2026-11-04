// The paper players for the identity kit (every player wears a name tag the others can see). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer } from "../../../shared/cartridge.ts";
import type { IdentityBlueprint } from "./index.ts";
import { createIdentityGame, type Identity, type IdentityState } from "./identity.ts";
import type { KitGame } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import type { Glimpse, Move, Persona, RoleCheck, TraceEvent } from "../../rehearse.ts";
import { firstAction } from "../../persona-support.ts";

/**
 * Name Tag's personas, between them reaching every ending of a turn: found out, out of questions,
 * out of time, passed, and the player on the spot leaving, plus a table that mumbles and talks
 * out of turn and a transcript that misspells the name.
 * @returns the personas.
 */
export function identityPersonas(): Persona<IdentityState>[] {
    /**
     * Who is on the spot, or the first seat.
     * @param glimpse what the persona sees.
     * @returns their id.
     */
    const spotlight = (glimpse: Glimpse<IdentityState>): string => glimpse.state.current ?? glimpse.players[0]?.playerId ?? "nobody";
    /**
     * Someone at the table who is not on the spot.
     * @param glimpse what the persona sees.
     * @returns their id.
     */
    const bystander = (glimpse: Glimpse<IdentityState>): string => glimpse.players.find((player: CartridgePlayer) => player.playerId !== glimpse.state.current)?.playerId ?? "nobody";
    const question = (glimpse: Glimpse<IdentityState>, playerId: string): Move => ({ kind: "say", playerId, text: `Am I something number ${glimpse.turn}?`, ruling: null });
    const idle: Move = { kind: "wait", seconds: 10 };
    /**
     * Says who the spotlight player is, as a guess.
     * @param glimpse what the persona sees.
     * @param spell changes the name before it is said.
     * @returns the move.
     */
    const guess = (glimpse: Glimpse<IdentityState>, spell: (name: string) => string = (name: string): string => name): Move => {
        const identity: Identity | undefined = glimpse.state.dealt[spotlight(glimpse)];
        return { kind: "say", playerId: spotlight(glimpse), text: `Am I ${spell(identity?.name ?? "nobody")}?`, ruling: null };
    };
    const asking = (glimpse: Glimpse<IdentityState>): boolean => glimpse.phase === "asking";
    return [
        { name: "the quick table", move: (glimpse: Glimpse<IdentityState>): Move => (asking(glimpse) ? (glimpse.state.asked >= 2 ? guess(glimpse) : question(glimpse, spotlight(glimpse))) : idle) },
        { name: "the table that runs out of questions", move: (glimpse: Glimpse<IdentityState>): Move => (asking(glimpse) ? question(glimpse, spotlight(glimpse)) : idle) },
        { name: "the table that goes quiet", move: (glimpse: Glimpse<IdentityState>): Move => (asking(glimpse) ? { kind: "wait", seconds: 20 } : idle) },
        {
            name: "the table that passes",
            move(glimpse: Glimpse<IdentityState>): Move {
                const action: string | null = asking(glimpse) ? firstAction(glimpse, spotlight(glimpse)) : null;
                return action === null ? idle : { kind: "press", playerId: spotlight(glimpse), actionId: action };
            },
        },
        {
            name: "the one who walks out",
            move(glimpse: Glimpse<IdentityState>): Move {
                if (asking(glimpse) && glimpse.state.turnNumber === 2 && glimpse.state.asked >= 1) {
                    return { kind: "leave", playerId: spotlight(glimpse) };
                }
                return asking(glimpse) ? (glimpse.state.asked >= 1 ? guess(glimpse) : question(glimpse, spotlight(glimpse))) : idle;
            },
        },
        {
            name: "the mumbler",
            move(glimpse: Glimpse<IdentityState>): Move {
                if (asking(glimpse) === false) {
                    return idle;
                }
                if (glimpse.turn % 4 === 0) {
                    return { kind: "say", playerId: bystander(glimpse), text: `I think they are ${glimpse.state.dealt[spotlight(glimpse)]?.name ?? ""}`, ruling: null };
                }
                if (glimpse.turn % 4 === 1) {
                    return { kind: "say", playerId: spotlight(glimpse), text: "Um", ruling: null };
                }
                return glimpse.state.asked >= 2 ? guess(glimpse, (name: string): string => `${name.slice(0, name.length - 3)}${name.slice(name.length - 2)}`) : question(glimpse, spotlight(glimpse));
            },
        },
    ];
}

/**
 * Name Tag's secrecy check: the same game with the name tags dealt differently, and a script played
 * the same way: the tags come out, the intro ends, the player on the spot asks two questions and
 * the hint clock fires. The TV and the host must stay the same whichever tags were dealt.
 * Other phones see the tags by design, so they are not compared; the leak check on every step
 * already requires that the owner's own phone never shows theirs.
 * @param blueprint the game.
 * @returns the check.
 */
export function identityNameCheck(blueprint: IdentityBlueprint): RoleCheck<IdentityState> {
    const script: TraceEvent[] = [
        { type: "contentReady", at: 0, text: "" },
        { type: "timerFired", at: 12, timerId: "intro" },
        { type: "speechEnded", at: 14, playerId: "paper1", text: "Am I alive right now?" },
        { type: "speechEnded", at: 20, playerId: "paper1", text: "Could you hold me in your hand?" },
        { type: "timerFired", at: 40, timerId: "hint1" },
    ];
    return {
        deal(seat: number): KitGame<IdentityState> {
            return createIdentityGame(blueprint.box, blueprint.decisions, seededRandom(seat + 11));
        },
        script,
        publicOnly: true,
    };
}
