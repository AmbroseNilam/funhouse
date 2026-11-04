// The paper players for each kit. Each persona is a way of playing that also scripts the judge,
// since a rehearsal has no model. Personas read the decisions, the rulings the phase allows and
// what each player may press, never hardcoded ids, so a valid game with renamed parts still
// rehearses. Between them they reach every ending a kit has.

import type { CartridgePlayer, LegalAction } from "../shared/cartridge.ts";
import type { Control } from "../shared/controls.ts";
import type { PlantBlueprint } from "./blueprint.ts";
import type { AnswerDecision, AnswerRuling, GuessingDecisions, GuessingState } from "./kits/guessing.ts";
import { CLUE_GIVE_UP_ACTION, CLUE_LOCKED_RULING, type ClueState } from "./kits/clue.ts";
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

/** Clues the paper players write: none is a word in any list, and none is close to another. */
const PAPER_CLUES: readonly string[] = ["amber", "brisk", "cobalt", "dune", "ember", "fjord", "gravel"];

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
                return { kind: "answer", playerId: giver.playerId, controlId, text: textFor(place, glimpse.state.attempts[giver.playerId] ?? 0) };
            }
        }
        return { kind: "wait", seconds: 5 };
    };
    const typeGuess = (glimpse: Glimpse<ClueState>, text: string): Move => {
        const controlId: string | null = boxOf(glimpse, glimpse.state.guesserId);
        return controlId === null ? { kind: "wait", seconds: 5 } : { kind: "answer", playerId: glimpse.state.guesserId, controlId, text };
    };
    const distinct = (place: number): string => PAPER_CLUES[place % PAPER_CLUES.length] ?? "amber";
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
