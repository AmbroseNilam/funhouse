// The paper players for the oddword kit (everyone but one knows the secret word). Each persona is a way of playing that also
// scripts the judge, since a rehearsal has no model; they read the decisions and what each phone
// offers, never hardcoded ids, so a valid game with renamed parts still rehearses.

import type { CartridgePlayer, LegalAction } from "../../../shared/cartridge.ts";
import type { OddWordBlueprint } from "./index.ts";
import { createOddWordGame, ODD_VOTE_PREFIX, type OddWordState } from "./oddword.ts";
import type { KitGame } from "../../kit/kit.ts";
import type { Glimpse, Move, Persona, RoleCheck, TraceEvent } from "../../rehearse.ts";


/** Words that are never the secret, so a paper player's word is always allowed and always different. */
const PAPER_WORDS: readonly string[] = ["amber", "breeze", "cobalt", "dune", "ember", "fjord", "gale", "haze", "ivory", "jade", "kelp", "linen", "moss", "nectar", "opal", "pearl", "quartz", "reed", "sable", "tide", "umber", "velvet", "willow", "yarrow"];

/**
 * The odd-word kit's personas, between them reaching every ending and every way a word can go: a Stray
 * who is caught and misses, one who is caught and names the word, a split vote, a vote on someone
 * innocent, a Stray who says nothing when asked to guess, a table that mumbles, repeats and says the
 * secret, a table that never speaks, and the Stray or others walking out.
 * @returns the personas.
 */
export function oddWordPersonas(): Persona<OddWordState>[] {
    const upOf = (state: OddWordState): string => state.order[state.cursor] ?? state.strayId;
    /** One word from whoever is up, unique across the game. */
    const word = (glimpse: Glimpse<OddWordState>, text: string | null = null): Move => ({ kind: "say", playerId: upOf(glimpse.state), text: text ?? PAPER_WORDS[glimpse.state.said.length % PAPER_WORDS.length] ?? "amber", ruling: null });
    const vote = (glimpse: Glimpse<OddWordState>, choose: (voterId: string, options: string[]) => string): Move => {
        const voter: string | undefined = glimpse.state.voters.find((id: string) => glimpse.state.votes[id] === undefined);
        if (voter === undefined) {
            return { kind: "wait", seconds: 10 };
        }
        const options: string[] = glimpse.legal(voter).map((action: LegalAction) => action.actionId.slice(ODD_VOTE_PREFIX.length));
        return { kind: "press", playerId: voter, actionId: `${ODD_VOTE_PREFIX}${choose(voter, options)}` };
    };
    const wait: Move = { kind: "wait", seconds: 5 };
    /** A persona that says every word, votes as given, and rules the Stray's guess as given. */
    const voting = (name: string, choose: (glimpse: Glimpse<OddWordState>) => (voterId: string, options: string[]) => string, ruling: string | null): Persona<OddWordState> => ({
        name,
        move(glimpse: Glimpse<OddWordState>): Move {
            if (glimpse.phase === "dealing") {
                return wait;
            }
            if (glimpse.phase === "vote") {
                return vote(glimpse, choose(glimpse));
            }
            if (glimpse.phase === "guess") {
                return { kind: "say", playerId: glimpse.state.strayId, text: "I would say it is a teapot.", ruling };
            }
            return word(glimpse);
        },
    });
    const stray = (glimpse: Glimpse<OddWordState>) => (voterId: string, options: string[]): string => (voterId === glimpse.state.strayId ? options[0] ?? "" : glimpse.state.strayId);
    const innocent = (glimpse: Glimpse<OddWordState>) => (_voterId: string, options: string[]): string => options.find((id: string) => id !== glimpse.state.strayId) ?? "";
    const bystander = (glimpse: Glimpse<OddWordState>): string => glimpse.players.find((player: CartridgePlayer) => player.playerId !== glimpse.state.strayId)?.playerId ?? "nobody";
    return [
        voting("the caught stray", stray, "wrong"),
        voting("the lucky guess", stray, "right"),
        voting("the silent stray", stray, null),
        voting("the wrong accusation", innocent, "wrong"),
        {
            name: "the split vote",
            move(glimpse: Glimpse<OddWordState>): Move {
                if (glimpse.phase === "dealing") {
                    return wait;
                }
                if (glimpse.phase === "guess") {
                    return { kind: "say", playerId: glimpse.state.strayId, text: "Somewhere in a kitchen, I think.", ruling: "wrong" };
                }
                return glimpse.phase === "vote" ? vote(glimpse, (voterId: string, options: string[]) => options[voterId.length % 2 === 0 ? 0 : options.length - 1] ?? "") : word(glimpse);
            },
        },
        {
            name: "the mumbler, the echo and the one who says the secret",
            move(glimpse: Glimpse<OddWordState>): Move {
                if (glimpse.phase === "dealing") {
                    return wait;
                }
                if (glimpse.phase !== "clues") {
                    return glimpse.phase === "vote" ? vote(glimpse, stray(glimpse)) : { kind: "say", playerId: glimpse.state.strayId, text: "Not a clue, I am afraid.", ruling: "wrong" };
                }
                const state: OddWordState = glimpse.state;
                const phase: number = glimpse.turn % 4;
                if (phase === 0) {
                    return word(glimpse, "well it is sort of hard to say");
                }
                if (phase === 1 && state.said[0] !== undefined) {
                    return word(glimpse, state.said[0].word);
                }
                return phase === 2 && upOf(state) !== state.strayId ? word(glimpse, state.word) : word(glimpse);
            },
        },
        { name: "the quiet table", move: (): Move => ({ kind: "wait", seconds: 20 }) },
        {
            name: "the stray who leaves",
            move: (glimpse: Glimpse<OddWordState>): Move => (glimpse.state.said.length >= 2 ? { kind: "leave", playerId: glimpse.state.strayId } : glimpse.phase === "dealing" ? wait : word(glimpse)),
        },
        {
            name: "the walkout",
            move(glimpse: Glimpse<OddWordState>): Move {
                if (glimpse.phase === "dealing") {
                    return wait;
                }
                return glimpse.state.said.length >= 1 && glimpse.phase === "clues" ? { kind: "leave", playerId: bystander(glimpse) } : word(glimpse);
            },
        },
        {
            name: "the speaker who leaves their turn",
            move(glimpse: Glimpse<OddWordState>): Move {
                if (glimpse.phase === "dealing") {
                    return wait;
                }
                if (glimpse.phase === "vote") {
                    return vote(glimpse, stray(glimpse));
                }
                if (glimpse.phase === "guess") {
                    return { kind: "say", playerId: glimpse.state.strayId, text: "A very wild guess indeed.", ruling: "wrong" };
                }
                const up: string = upOf(glimpse.state);
                return glimpse.state.said.length === 2 && up !== glimpse.state.strayId ? { kind: "leave", playerId: up } : word(glimpse);
            },
        },
        {
            name: "the leaver mid-vote",
            move(glimpse: Glimpse<OddWordState>): Move {
                if (glimpse.phase === "dealing") {
                    return wait;
                }
                if (glimpse.phase === "vote") {
                    return Object.keys(glimpse.state.votes).length >= 1 && glimpse.players.length >= 5 ? { kind: "leave", playerId: bystander(glimpse) } : vote(glimpse, stray(glimpse));
                }
                return glimpse.phase === "guess" ? { kind: "say", playerId: glimpse.state.strayId, text: "Some sort of teapot.", ruling: "wrong" } : word(glimpse);
            },
        },
    ];
}

/**
 * The odd-word kit's role check: the same game with the Stray dealt to each seat in turn and a script
 * played the same way whoever it is: the word comes, reading ends, a round of words is said in order,
 * and two people vote. Every view but the Stray's must stay the same, up to the moment the vote would
 * be counted.
 * @param blueprint the game.
 * @returns the check.
 */
export function oddWordRoleCheck(blueprint: OddWordBlueprint): RoleCheck<OddWordState> {
    const script: TraceEvent[] = [
        { type: "contentReady", at: 0, text: "Category: a thing in a kitchen | Word: kettle" },
        { type: "timerFired", at: 10, timerId: "read" },
        ...["amber", "breeze", "cobalt", "dune", "ember"].map((text: string, index: number): TraceEvent => ({ type: "speechEnded", at: 14 + index * 4, playerId: `paper${((index + 1) % 5) + 1}`, text })),
        ...["fjord", "gale", "haze", "ivory", "jade"].map((text: string, index: number): TraceEvent => ({ type: "speechEnded", at: 40 + index * 4, playerId: `paper${((index + 1) % 5) + 1}`, text })),
        { type: "input", playerId: "paper1", actionId: `${ODD_VOTE_PREFIX}paper4` },
        { type: "input", playerId: "paper2", actionId: `${ODD_VOTE_PREFIX}paper4` },
    ];
    return {
        deal(seat: number, players: readonly CartridgePlayer[]): KitGame<OddWordState> {
            const draws: number[] = [0, (seat + 0.5) / players.length, 1.5 / players.length];
            return createOddWordGame(blueprint.box, blueprint.decisions, () => draws.shift() ?? 0.5);
        },
        script,
    };
}
