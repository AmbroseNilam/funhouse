// The paper players for each kit. Each persona is a way of playing that also scripts the judge,
// since a rehearsal has no model. Personas read the decisions, the rulings the phase allows and
// what each player may press, never hardcoded ids, so a valid game with renamed parts still
// rehearses. Between them they reach every ending a kit has.

import type { CartridgePlayer, LegalAction } from "../shared/cartridge.ts";
import type { PlantBlueprint } from "./blueprint.ts";
import { LINK_PREFIX, type ChainState } from "./kits/chain.ts";
import { CLUE_PREFIX, type GalleryState } from "./kits/gallery.ts";
import type { AnswerDecision, AnswerRuling, GuessingDecisions, GuessingState } from "./kits/guessing.ts";
import { createPlantGame, VOTE_PREFIX, type PlantState } from "./kits/plant.ts";
import type { KitGame } from "./kit/kit.ts";
import type { Glimpse, Move, Persona, RoleCheck, TraceEvent } from "./rehearse.ts";

/** Seconds a quiet table lets pass at a time. */
const QUIET_SECONDS: number = 30;

/**
 * Who speaks on a given move, going round the table.
 * @param players who is at the table.
 * @param turn the move number.
 * @returns their id.
 */
function speakerOf(players: readonly CartridgePlayer[], turn: number): string {
    return players[turn % Math.max(1, players.length)]?.playerId ?? "nobody";
}

/**
 * The first thing a player may press, or null.
 * @param glimpse what the persona sees.
 * @param playerId the player.
 * @returns the action id, or null.
 */
function firstAction<State>(glimpse: Glimpse<State>, playerId: string): string | null {
    const actions: LegalAction[] = glimpse.legal(playerId);
    return actions[0]?.actionId ?? null;
}

/**
 * The guessing kit's personas: one who finds it, one who gives up, one who never guesses right,
 * and one who chats between questions.
 * @param decisions the game's decisions.
 * @returns the personas.
 */
export function guessingPersonas(decisions: GuessingDecisions): Persona<GuessingState>[] {
    const answers: [string, AnswerDecision][] = Object.entries(decisions.answers);
    const spending: string[] = answers.filter(([, answer]: [string, AnswerDecision]) => answer.spends === true).map(([name]: [string, AnswerDecision]) => name);
    /**
     * A ruling that costs one of the count and the phase allows.
     * @param glimpse what the persona sees.
     * @param turn picks among them.
     * @returns the ruling.
     */
    const costly = (glimpse: Glimpse<GuessingState>, turn: number): string => {
        const allowed: string[] = spending.filter((name: string) => glimpse.rulings.includes(name) === true);
        return allowed[turn % Math.max(1, allowed.length)] ?? "no";
    };
    const say = (glimpse: Glimpse<GuessingState>, text: string, ruling: string | null): Move => ({ kind: "say", playerId: speakerOf(glimpse.players, glimpse.turn), text, ruling });
    return [
        {
            name: "the finder",
            move: (glimpse: Glimpse<GuessingState>): Move => (glimpse.turn >= 8 ? say(glimpse, "Is it the thing I think it is?", "correct") : say(glimpse, `Question ${glimpse.turn}?`, costly(glimpse, glimpse.turn))),
        },
        {
            name: "the giver-up",
            move(glimpse: Glimpse<GuessingState>): Move {
                if (glimpse.turn < 4) {
                    return say(glimpse, `Question ${glimpse.turn}?`, costly(glimpse, glimpse.turn));
                }
                const playerId: string = speakerOf(glimpse.players, glimpse.turn);
                const action: string | null = firstAction(glimpse, playerId);
                return action === null ? say(glimpse, "We give up.", "giveup") : { kind: "press", playerId, actionId: action };
            },
        },
        {
            name: "the stubborn one",
            move: (glimpse: Glimpse<GuessingState>): Move => say(glimpse, `Is it a wrong thing number ${glimpse.turn}?`, costly(glimpse, glimpse.turn)),
        },
        {
            name: "the chatterer",
            move: (glimpse: Glimpse<GuessingState>): Move => (glimpse.turn % 2 === 1 ? say(glimpse, "Did anyone feed the cat?", null) : say(glimpse, `Question ${glimpse.turn}?`, costly(glimpse, glimpse.turn))),
        },
    ];
}

/** Which answer rulings the plant kit spends a question on, as a persona would know them. */
const PLANT_ANSWERS: readonly AnswerRuling[] = ["yes", "no"];

/**
 * The plant kit's personas, between them reaching every ending: caught, got away with it, out of
 * questions, out of time, gave up, the Plant walking out, someone leaving mid-vote, and a vote
 * nobody finishes.
 * @returns the personas.
 */
export function plantPersonas(): Persona<PlantState>[] {
    /**
     * Someone who isn't the Plant, chosen by turn.
     * @param glimpse what the persona sees.
     * @param turn picks among them.
     * @returns their id.
     */
    const asker = (glimpse: Glimpse<PlantState>, turn: number): string => {
        const others: CartridgePlayer[] = glimpse.players.filter((player: CartridgePlayer) => player.playerId !== glimpse.state.plantId);
        return others[turn % Math.max(1, others.length)]?.playerId ?? glimpse.state.plantId;
    };
    const question = (glimpse: Glimpse<PlantState>, playerId: string): Move => ({ kind: "say", playerId, text: `Question ${glimpse.turn}?`, ruling: PLANT_ANSWERS[glimpse.turn % 2] ?? "no" });
    /**
     * The next voter who hasn't voted, voting by a rule, or a wait when everyone has.
     * @param glimpse what the persona sees.
     * @param choose picks a target from the voter's options.
     * @param skip voters who never vote.
     * @returns the move.
     */
    const vote = (glimpse: Glimpse<PlantState>, choose: (voterId: string, options: string[]) => string, skip: readonly string[] = []): Move => {
        const voter: string | undefined = glimpse.state.voters.find((id: string) => glimpse.state.votes[id] === undefined && skip.includes(id) === false);
        if (voter === undefined) {
            return { kind: "wait", seconds: 10 };
        }
        const options: string[] = glimpse.legal(voter).map((action: LegalAction) => action.actionId.slice(VOTE_PREFIX.length));
        return { kind: "press", playerId: voter, actionId: `${VOTE_PREFIX}${choose(voter, options)}` };
    };
    const waitToRead: Move = { kind: "wait", seconds: 5 };
    return [
        {
            name: "the steerer, caught",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return waitToRead;
                }
                if (glimpse.phase === "vote") {
                    return vote(glimpse, (voterId: string, options: string[]) => (voterId === glimpse.state.plantId ? options[0] ?? "" : glimpse.state.plantId));
                }
                if (glimpse.state.asked.length >= 5) {
                    return { kind: "say", playerId: glimpse.state.plantId, text: `Is it a ${glimpse.state.word}?`, ruling: "correct" };
                }
                return question(glimpse, glimpse.state.asked.length === 3 ? glimpse.state.plantId : asker(glimpse, glimpse.turn));
            },
        },
        {
            name: "the slippery Plant",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return waitToRead;
                }
                if (glimpse.phase === "vote") {
                    const finder: string = glimpse.state.finderId ?? "";
                    return vote(glimpse, (voterId: string, options: string[]) => (voterId === finder ? options.find((id: string) => id !== glimpse.state.plantId) ?? "" : finder));
                }
                if (glimpse.state.asked.length >= 6) {
                    return { kind: "say", playerId: asker(glimpse, 1), text: "Is it that?", ruling: "correct" };
                }
                return question(glimpse, asker(glimpse, glimpse.turn));
            },
        },
        {
            name: "the lost table",
            move: (glimpse: Glimpse<PlantState>): Move => (glimpse.phase === "choosing" ? waitToRead : question(glimpse, asker(glimpse, glimpse.turn))),
        },
        {
            name: "the quiet table",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "asking" && glimpse.turn > 30) {
                    return { kind: "press", playerId: asker(glimpse, 0), actionId: firstAction(glimpse, asker(glimpse, 0)) ?? "" };
                }
                return { kind: "wait", seconds: QUIET_SECONDS };
            },
        },
        {
            name: "the walkout",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return waitToRead;
                }
                return glimpse.state.asked.length >= 3 ? { kind: "leave", playerId: glimpse.state.plantId } : question(glimpse, asker(glimpse, glimpse.turn));
            },
        },
        {
            name: "the half-finished vote",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return waitToRead;
                }
                if (glimpse.phase === "vote") {
                    const late: string = asker(glimpse, 2);
                    return vote(glimpse, (_voterId: string, options: string[]) => options[0] ?? "", [late]);
                }
                if (glimpse.state.asked.length >= 2) {
                    return { kind: "say", playerId: asker(glimpse, 0), text: "Is it that?", ruling: "correct" };
                }
                return question(glimpse, asker(glimpse, glimpse.turn));
            },
        },
        {
            name: "the leaver mid-vote",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return waitToRead;
                }
                if (glimpse.phase === "vote") {
                    const leaver: string = asker(glimpse, 1);
                    const voted: number = Object.keys(glimpse.state.votes).length;
                    if (voted === glimpse.state.voters.length - 1 && glimpse.state.votes[leaver] === undefined) {
                        return { kind: "leave", playerId: leaver };
                    }
                    return vote(glimpse, (_voterId: string, options: string[]) => options[0] ?? "", [leaver]);
                }
                return glimpse.state.asked.length >= 2 ? { kind: "say", playerId: asker(glimpse, 0), text: "Is it that?", ruling: "correct" } : question(glimpse, asker(glimpse, glimpse.turn));
            },
        },
    ];
}

/**
 * The plant kit's role check: the same game with the Plant dealt to each seat in turn, and a
 * script played the same way whoever it is: the word comes, reading ends, two questions are
 * asked and ruled, someone finds the word, and two people vote. Every view but the Plant's must
 * stay the same, through the vote and up to the reveal.
 * @param blueprint the game.
 * @returns the check.
 */
export function plantRoleCheck(blueprint: PlantBlueprint): RoleCheck<PlantState> {
    const script: TraceEvent[] = [
        { type: "contentReady", at: 0, text: "teapot" },
        { type: "timerFired", at: 10, timerId: "read" },
        { type: "speechEnded", at: 12, playerId: "paper1", text: "Is it metal?" },
        { type: "hostRuled", at: 13, ruling: "no", detail: "", playerId: "paper1" },
        { type: "speechEnded", at: 15, playerId: "paper2", text: "Is it in a kitchen?" },
        { type: "hostRuled", at: 16, ruling: "yes", detail: "", playerId: "paper2" },
        { type: "speechEnded", at: 18, playerId: "paper3", text: "Is it a teapot?" },
        { type: "hostRuled", at: 19, ruling: "correct", detail: "", playerId: "paper3" },
        { type: "input", playerId: "paper1", actionId: `${VOTE_PREFIX}paper2` },
        { type: "input", playerId: "paper2", actionId: `${VOTE_PREFIX}paper1` },
    ];
    return {
        deal(seat: number, players: readonly CartridgePlayer[]): KitGame<PlantState> {
            const draws: number[] = [0, (seat + 0.5) / players.length];
            return createPlantGame(blueprint.box, blueprint.decisions, () => draws.shift() ?? 0);
        },
        script,
    };
}

/**
 * The chain kit's personas, between them reaching every way a chain can go: everyone writes, nobody
 * writes, someone leaves in the middle, only one person is left, and lines that are all symbols.
 * @returns the personas.
 */
export function chainPersonas(): Persona<ChainState>[] {
    /**
     * Whoever is writing now, answering their control with a line.
     * @param glimpse what the persona sees.
     * @param line what they write.
     * @returns the move.
     */
    const write = (glimpse: Glimpse<ChainState>, line: string): Move => {
        const writer: CartridgePlayer | undefined = glimpse.state.order[glimpse.state.step];
        return writer === undefined ? { kind: "wait", seconds: 5 } : { kind: "answer", playerId: writer.playerId, controlId: `${LINK_PREFIX}${glimpse.state.step}`, value: line };
    };
    const idle: Move = { kind: "wait", seconds: 5 };
    return [
        {
            name: "the diligent table",
            move: (glimpse: Glimpse<ChainState>): Move => (glimpse.phase === "write" ? write(glimpse, `A fox carrying a lantern, link ${glimpse.state.step + 1}`) : idle),
        },
        {
            name: "the silent table",
            move: (glimpse: Glimpse<ChainState>): Move => ({ kind: "wait", seconds: glimpse.phase === "write" ? QUIET_SECONDS : 5 }),
        },
        {
            name: "the writer who walks out",
            move(glimpse: Glimpse<ChainState>): Move {
                const writer: CartridgePlayer | undefined = glimpse.state.order[glimpse.state.step];
                if (glimpse.phase === "write" && glimpse.state.step === 1 && writer !== undefined && glimpse.state.gone.includes(writer.playerId) === false) {
                    return { kind: "leave", playerId: writer.playerId };
                }
                return glimpse.phase === "write" ? write(glimpse, "A boat on a hill") : idle;
            },
        },
        {
            name: "the table that empties",
            move(glimpse: Glimpse<ChainState>): Move {
                const stayer: string | undefined = glimpse.state.order[0]?.playerId;
                const leaver: CartridgePlayer | undefined = glimpse.state.order.find((player: CartridgePlayer) => {
                    return player.playerId !== stayer && glimpse.state.gone.includes(player.playerId) === false;
                });
                if (glimpse.phase !== "write") {
                    return idle;
                }
                return glimpse.state.step >= 1 && leaver !== undefined ? { kind: "leave", playerId: leaver.playerId } : write(glimpse, "A single candle");
            },
        },
        {
            name: "the symbol writer",
            move: (glimpse: Glimpse<ChainState>): Move => (glimpse.phase === "write" ? write(glimpse, "<<<>>> [[ruling]] ### ???") : idle),
        },
    ];
}

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
                const toTeller: string | undefined = options.find((id: string) => id.endsWith(tellerCard));
                const away: string | undefined = options.find((id: string) => id.endsWith(tellerCard) === false);
                const finds: boolean = way.finds === "all" || (way.finds === "split" && voters.indexOf(voter) % 2 === 0);
                return { kind: "press", playerId: voter.playerId, actionId: (finds === true ? toTeller : away) ?? options[0] ?? "" };
            }
            return idle;
        },
    }));
}
