// The paper players for the claims kit (three claims, one lie, and a host that interviews). Each persona is a way of
// playing; they read the state and what each phone offers, never hardcoded ids, so a valid game with
// renamed parts still rehearses. Between them they reach every ending: a full game, a table that sees
// through every lie, a table that is fooled every time, a split table, a table that writes nothing, a
// claimant who never speaks, claims the game turns down, and people walking out at every stage.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import { CLAIM_COUNT, CLAIMS_LIE_PREFIX, CLAIMS_VOTE_PREFIX, type ClaimsState } from "./claims.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";
import { HOSTILE_TEXT, QUIET_SECONDS, nextPresser, nextWriter } from "../../personas-text.ts";

/** Claims for paper players to type, none touching a forbidden subject and none alike. */
export const PAPER_CLAIMS: readonly string[] = [
    "I have climbed a lighthouse in a storm", "I once won a goose at a fair", "I can whistle two tunes at once", "I have eaten a whole pineapple in one sitting",
    "I lost a shoe in a canal", "I have swum in a cold lake in March", "I learned to juggle on a train", "I met a famous cellist at a bus stop",
    "I have slept in a hammock for a week", "I painted a fence bright green", "I rode a tandem bicycle across a bridge", "I can name every cheese in a shop window",
    "I once got locked in a museum", "I have watched the sun rise from a ferry", "I kept a tortoise called Gerald", "I have sung on a stage in Lisbon",
    "I found a coin in a library book", "I walked a very long beach at midnight", "I once sailed a borrowed boat", "I have baked bread in a snowstorm",
    "I fixed a clock with a hairpin", "I danced at a lantern festival", "I read a whole novel on a roof", "I have carried a ladder through a market",
];

/** A claim the game turns down, because it goes near family and work. */
const TURNED_DOWN: string = "My dad got me a job at his office";

/** What paper players say aloud, long enough to count. */
const ANSWER_TEXT: string = "It was a few years back, by the harbour in March";

/** What a named paper player asks aloud. */
const QUESTION_TEXT: string = "Which street was that on exactly";

/**
 * The claims kit's personas.
 * @returns the personas.
 */
export function claimsPersonas(): Persona<ClaimsState>[] {
    const quiet: Move = { kind: "wait", seconds: QUIET_SECONDS };
    const claimFor = (glimpse: Glimpse<ClaimsState>, playerId: string): string => {
        const seat: number = Math.max(0, glimpse.players.findIndex((player: CartridgePlayer) => player.playerId === playerId));
        const written: number = glimpse.state.claims[playerId]?.length ?? 0;
        return PAPER_CLAIMS[(seat * CLAIM_COUNT + written) % PAPER_CLAIMS.length] ?? "";
    };
    const write = (glimpse: Glimpse<ClaimsState>, skip: readonly string[] = []): Move | null => {
        const writer: { playerId: string; controlId: string } | null = nextWriter(glimpse, skip);
        return writer === null ? null : { kind: "answer", playerId: writer.playerId, controlId: writer.controlId, value: claimFor(glimpse, writer.playerId) };
    };
    const mark = (glimpse: Glimpse<ClaimsState>, skip: readonly string[] = []): Move => {
        for (const [seat, player] of glimpse.players.entries()) {
            const options: LegalAction[] = glimpse.legal(player.playerId).filter((option: LegalAction) => option.actionId.startsWith(CLAIMS_LIE_PREFIX) === true);
            const chosen: LegalAction | undefined = options[seat % CLAIM_COUNT];
            if (chosen !== undefined && skip.includes(player.playerId) === false) {
                return { kind: "press", playerId: player.playerId, actionId: chosen.actionId };
            }
        }
        return quiet;
    };
    const claimantOf = (glimpse: Glimpse<ClaimsState>): string => glimpse.state.queue[glimpse.state.turnIndex] ?? "";
    /** The shown position of the lie, which only a persona that is meant to see through it reads. */
    const lieOf = (glimpse: Glimpse<ClaimsState>): number => glimpse.state.order.indexOf(glimpse.state.marks[claimantOf(glimpse)] ?? -1);
    const speak = (playerId: string, text: string): Move => ({ kind: "say", playerId, text, ruling: null });
    const vote = (glimpse: Glimpse<ClaimsState>, choose: (place: number) => number): Move => {
        return nextPresser(glimpse, (options: LegalAction[], place: number) => options.find((option: LegalAction) => option.actionId === `${CLAIMS_VOTE_PREFIX}${choose(place)}`));
    };
    /**
     * Plays a whole game, with the vote left to the caller.
     * @param glimpse what the persona sees.
     * @param choose how a voter picks a shown position.
     * @returns the move.
     */
    const playThrough = (glimpse: Glimpse<ClaimsState>, choose: (glimpse: Glimpse<ClaimsState>, place: number) => number): Move => {
        if (glimpse.phase === "gathering") {
            return write(glimpse) ?? mark(glimpse);
        }
        if (glimpse.phase === "interview" || glimpse.phase === "answer") {
            return speak(claimantOf(glimpse), ANSWER_TEXT);
        }
        if (glimpse.phase === "challenge") {
            return speak(glimpse.state.askerId ?? "", QUESTION_TEXT);
        }
        return glimpse.phase === "vote" ? vote(glimpse, (place: number) => choose(glimpse, place)) : quiet;
    };
    return [
        { name: "the full table", move: (glimpse: Glimpse<ClaimsState>): Move => playThrough(glimpse, () => 0) },
        { name: "the sharp table", move: (glimpse: Glimpse<ClaimsState>): Move => playThrough(glimpse, () => lieOf(glimpse)) },
        { name: "the fooled table", move: (glimpse: Glimpse<ClaimsState>): Move => playThrough(glimpse, () => (lieOf(glimpse) + 1) % CLAIM_COUNT) },
        { name: "the split table", move: (glimpse: Glimpse<ClaimsState>): Move => playThrough(glimpse, () => (glimpse.turn % 2 === 0 ? lieOf(glimpse) : (lieOf(glimpse) + 1) % CLAIM_COUNT)) },
        { name: "the silent table", move: (): Move => ({ kind: "wait", seconds: QUIET_SECONDS * 4 }) },
        {
            name: "the claimant who never speaks",
            move: (glimpse: Glimpse<ClaimsState>): Move => (glimpse.phase === "gathering" || glimpse.phase === "vote" ? playThrough(glimpse, () => 0) : quiet),
        },
        {
            name: "the unfinished table",
            move(glimpse: Glimpse<ClaimsState>): Move {
                const idle: string[] = glimpse.players.slice(1).map((player: CartridgePlayer) => player.playerId);
                return glimpse.phase === "gathering" ? write(glimpse, idle) ?? mark(glimpse, idle) : playThrough(glimpse, () => 0);
            },
        },
        {
            name: "the claims the game turns down",
            move(glimpse: Glimpse<ClaimsState>): Move {
                const writer: { playerId: string; controlId: string } | null = glimpse.phase === "gathering" ? nextWriter(glimpse) : null;
                if (writer !== null) {
                    const turnedDown: boolean = (glimpse.state.attempts[writer.playerId] ?? 0) > 0;
                    const first: boolean = (glimpse.state.claims[writer.playerId] ?? []).length === 0;
                    const value: string = turnedDown === false && first === true ? (glimpse.turn % 2 === 0 ? TURNED_DOWN : HOSTILE_TEXT) : claimFor(glimpse, writer.playerId);
                    return { kind: "answer", playerId: writer.playerId, controlId: writer.controlId, value };
                }
                return playThrough(glimpse, () => 0);
            },
        },
        {
            name: "the claimant who walks out",
            move(glimpse: Glimpse<ClaimsState>): Move {
                if (glimpse.phase === "interview" && glimpse.state.turnIndex === 0) {
                    return { kind: "leave", playerId: claimantOf(glimpse) };
                }
                return playThrough(glimpse, () => 0);
            },
        },
        {
            name: "the asker who walks out",
            move(glimpse: Glimpse<ClaimsState>): Move {
                if (glimpse.phase === "challenge" && glimpse.state.turnIndex === 0 && glimpse.state.askerId !== null) {
                    return { kind: "leave", playerId: glimpse.state.askerId };
                }
                return playThrough(glimpse, () => 0);
            },
        },
        {
            name: "the voter who walks out",
            move(glimpse: Glimpse<ClaimsState>): Move {
                const pending: string | undefined = glimpse.state.voters.find((id: string) => glimpse.state.votes[id] === undefined);
                if (glimpse.phase === "vote" && pending !== undefined && glimpse.state.turnIndex === 0) {
                    return { kind: "leave", playerId: pending };
                }
                return playThrough(glimpse, () => 0);
            },
        },
        {
            name: "the table that shrinks to two",
            move(glimpse: Glimpse<ClaimsState>): Move {
                const claimant: string = claimantOf(glimpse);
                const leaver: CartridgePlayer | undefined = glimpse.players.find((player: CartridgePlayer) => player.playerId !== claimant);
                if (glimpse.phase === "interview" && glimpse.state.turnIndex === 0 && leaver !== undefined) {
                    return { kind: "leave", playerId: leaver.playerId };
                }
                return playThrough(glimpse, () => 0);
            },
        },
    ];
}
