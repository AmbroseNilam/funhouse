// The paper players for the gallery kit (hands of painted cards, a clue, a vote). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import { ballotLetter, CLUE_PREFIX, type GalleryState, VOTE_PREFIX as BALLOT_PREFIX } from "./gallery.ts";
import type { Glimpse, Move, Persona } from "../../rehearse.ts";
import { QUIET_SECONDS, firstAction } from "../../persona-support.ts";

/** How a gallery persona plays one round. */
interface GalleryWay {
    name: string;
    /** Whether the storyteller picks a card and gives a clue. */
    clue: boolean;
    /** Whether the others put cards in. */
    plays: boolean;
    /** Who the voters find: the storyteller's card for "all", half of them for "split", never for "none", or nobody votes for "absent". */
    finds: "all" | "split" | "none" | "absent";
    /** Someone leaves part way through. */
    leaves?: "teller" | "voter" | "most";
}

/**
 * The gallery kit's personas, between them reaching every way a round can come out: the clue that
 * works, the one everyone finds, the one nobody finds, a storyteller who never gives a clue,
 * players who never put a card in or never vote, and people leaving.
 * @returns the personas.
 */
export function galleryPersonas(): Persona<GalleryState>[] {
    const ways: GalleryWay[] = [
        { name: "the clean table", clue: true, plays: true, finds: "split" },
        { name: "the obvious clue", clue: true, plays: true, finds: "all" },
        { name: "the obscure clue", clue: true, plays: true, finds: "none" },
        { name: "the storyteller who freezes", clue: false, plays: true, finds: "split" },
        { name: "the table that doesn't play", clue: true, plays: false, finds: "split" },
        { name: "the table that doesn't vote", clue: true, plays: true, finds: "absent" },
        { name: "the storyteller who walks out", clue: true, plays: true, finds: "split", leaves: "teller" },
        { name: "the voter who walks out", clue: true, plays: true, finds: "split", leaves: "voter" },
        { name: "the table that empties", clue: true, plays: true, finds: "split", leaves: "most" },
    ];
    return ways.map((way: GalleryWay): Persona<GalleryState> => ({
        name: way.name,
        move(glimpse: Glimpse<GalleryState>): Move {
            const state: GalleryState = glimpse.state;
            const teller: string = state.tellers[state.round] ?? "";
            const here: CartridgePlayer[] = glimpse.players.filter((player: CartridgePlayer) => state.gone.includes(player.playerId) === false);
            const others: CartridgePlayer[] = here.filter((player: CartridgePlayer) => player.playerId !== teller);
            const idle: Move = { kind: "wait", seconds: way.clue === true && way.plays === true && way.finds !== "absent" ? 5 : QUIET_SECONDS };
            if (way.leaves === "teller" && state.round === 0 && state.phase === "play") {
                return { kind: "leave", playerId: teller };
            }
            if (way.leaves === "voter" && state.phase === "vote" && state.round === 0 && others[0] !== undefined && state.votes[others[0].playerId] === undefined) {
                return { kind: "leave", playerId: others[0].playerId };
            }
            if (way.leaves === "most" && state.round === 1 && state.phase === "play" && others.length > 0) {
                return { kind: "leave", playerId: others[0]?.playerId ?? "" };
            }
            if (state.phase === "clue") {
                if (way.clue === false) {
                    return { kind: "wait", seconds: QUIET_SECONDS };
                }
                return state.pickedId === null
                    ? { kind: "press", playerId: teller, actionId: firstAction(glimpse, teller) ?? "" }
                    : { kind: "answer", playerId: teller, controlId: `${CLUE_PREFIX}${state.round}`, value: "a quiet harbour" };
            }
            if (state.phase === "play") {
                const waiting: CartridgePlayer | undefined = others.find((player: CartridgePlayer) => state.plays[player.playerId] === undefined);
                return way.plays === false || waiting === undefined ? { kind: "wait", seconds: QUIET_SECONDS } : { kind: "press", playerId: waiting.playerId, actionId: firstAction(glimpse, waiting.playerId) ?? "" };
            }
            if (state.phase === "vote") {
                const voters: CartridgePlayer[] = others.filter((player: CartridgePlayer) => state.plays[player.playerId] !== undefined);
                const voter: CartridgePlayer | undefined = voters.find((player: CartridgePlayer) => state.votes[player.playerId] === undefined);
                if (voter === undefined || way.finds === "absent") {
                    return { kind: "wait", seconds: QUIET_SECONDS };
                }
                const tellerCard: string = state.plays[teller] ?? "";
                const options: string[] = glimpse.legal(voter.playerId).map((action: LegalAction) => action.actionId);
                const toTeller: string | undefined = options.find((id: string) => id === `${BALLOT_PREFIX}${ballotLetter(state.spread, tellerCard)}`);
                const away: string | undefined = options.find((id: string) => id !== `${BALLOT_PREFIX}${ballotLetter(state.spread, tellerCard)}`);
                const finds: boolean = way.finds === "all" || (way.finds === "split" && voters.indexOf(voter) % 2 === 0);
                return { kind: "press", playerId: voter.playerId, actionId: (finds === true ? toTeller : away) ?? options[0] ?? "" };
            }
            return idle;
        },
    }));
}
