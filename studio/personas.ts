// The paper players for each kit. Each persona is a way of playing that also scripts the judge,
// since a rehearsal has no model. Personas read the decisions, the rulings the phase allows and
// what each player may press, never hardcoded ids, so a valid game with renamed parts still
// rehearses. Between them they reach every ending a kit has.

import type { CartridgePlayer, LegalAction } from "../shared/cartridge.ts";
import type { OddWordBlueprint, PlantBlueprint, StrangerBlueprint } from "./blueprint.ts";
import { createOddWordGame, ODD_VOTE_PREFIX, type OddWordState } from "./kits/oddword.ts";
import { createStrangerGame, STRANGER_ACTIONS, type StrangerState } from "./kits/stranger.ts";
import { GUESS_PREFIX, STOP_ACTION, type Cell, type ClueBoardState, type TeamIndex } from "./kits/clueboard.ts";
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

/** Clue words that are never on a board, so a paper giver's clue is always legal. */
const PAPER_CLUES: readonly string[] = ["zeta", "theta", "iota", "kappa", "lambda"];

/**
 * What the paper host's model writes for a clue-board game: nothing for the board, which sends the
 * game to its own words, and a legal clue when it is asked to give one.
 * @param request the content request.
 * @returns the reply.
 */
export function clueBoardContent(request: string): string {
    return request.startsWith("Write 25") === true ? "" : "xylophone, 2";
}

/**
 * The clue-board kit's personas, between them reaching every ending and every way a turn can go: a
 * team that finds all its words, a trapdoor, turns that run out because nobody finds anything, a
 * giver the host keeps calling foul, a clue the code refuses, a host that never rules, a table that
 * never speaks, guessers who stop early, a giver who leaves so the host gives the clues, and a team
 * that walks out.
 * @returns the personas.
 */
export function clueBoardPersonas(): Persona<ClueBoardState>[] {
    const giverOf = (state: ClueBoardState): string | null => state.giverIds[state.turnTeam];
    const guesserOf = (glimpse: Glimpse<ClueBoardState>): string => {
        const team: TeamIndex = glimpse.state.turnTeam;
        const guessers: CartridgePlayer[] = glimpse.players.filter((player: CartridgePlayer) => glimpse.state.teamOf[player.playerId] === team && player.playerId !== giverOf(glimpse.state));
        return guessers[0]?.playerId ?? "nobody";
    };
    const leftFor = (state: ClueBoardState, team: TeamIndex): number => state.cells.filter((cell: Cell) => cell.owner === (team === 0 ? "a" : "b") && cell.turned === false).length;
    /** The first unturned card satisfying a test, as a guess action. */
    const guessWhere = (glimpse: Glimpse<ClueBoardState>, test: (cell: Cell) => boolean): Move => {
        const index: number = glimpse.state.cells.findIndex((cell: Cell) => cell.turned === false && test(cell) === true);
        return index < 0 ? { kind: "wait", seconds: 10 } : { kind: "press", playerId: guesserOf(glimpse), actionId: `${GUESS_PREFIX}${index}` };
    };
    const ours = (glimpse: Glimpse<ClueBoardState>): ((cell: Cell) => boolean) => (cell: Cell): boolean => cell.owner === (glimpse.state.turnTeam === 0 ? "a" : "b");
    const waiting = (glimpse: Glimpse<ClueBoardState>): Move | null => (glimpse.state.awaiting !== null || glimpse.state.pending !== null ? { kind: "wait", seconds: 4 } : null);
    /** Says a clue for the team on turn, ruled as given. */
    const clue = (glimpse: Glimpse<ClueBoardState>, text: string, ruling: string | null): Move => {
        const giver: string | null = giverOf(glimpse.state);
        return giver === null ? { kind: "wait", seconds: 4 } : { kind: "say", playerId: giver, text, ruling };
    };
    const paperClue = (glimpse: Glimpse<ClueBoardState>): string => `${PAPER_CLUES[glimpse.state.turnNumber % PAPER_CLUES.length] ?? "zeta"} ${leftFor(glimpse.state, glimpse.state.turnTeam) > 1 ? "two" : "one"}`;
    /** A persona that plays a normal turn the way a function says to guess. */
    const turns = (name: string, guess: (glimpse: Glimpse<ClueBoardState>) => Move, ruling: string | null = "fair"): Persona<ClueBoardState> => ({
        name,
        move(glimpse: Glimpse<ClueBoardState>): Move {
            if (glimpse.phase === "setup") {
                return { kind: "wait", seconds: 2 };
            }
            if (glimpse.phase === "clue") {
                return waiting(glimpse) ?? clue(glimpse, paperClue(glimpse), ruling);
            }
            return guess(glimpse);
        },
    });
    return [
        turns("the sweep", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, ours(glimpse))),
        turns("the trapdoor", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, (cell: Cell): boolean => cell.owner === "trap")),
        turns("the wrong turns", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, (cell: Cell): boolean => cell.owner === "neutral")),
        turns("the other side's words", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, (cell: Cell): boolean => ours(glimpse)(cell) === false && cell.owner !== "trap")),
        turns("the early stopper", (glimpse: Glimpse<ClueBoardState>): Move => (glimpse.state.guessesMade >= 1 ? { kind: "press", playerId: guesserOf(glimpse), actionId: STOP_ACTION } : guessWhere(glimpse, ours(glimpse)))),
        turns("the foul caller", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, ours(glimpse)), "foul"),
        turns("the silent judge", (glimpse: Glimpse<ClueBoardState>): Move => guessWhere(glimpse, ours(glimpse)), null),
        {
            name: "the board-word clue",
            move(glimpse: Glimpse<ClueBoardState>): Move {
                if (glimpse.phase !== "clue") {
                    return { kind: "wait", seconds: 60 };
                }
                const word: string = glimpse.state.cells.find((cell: Cell) => cell.turned === false)?.word ?? "";
                return waiting(glimpse) ?? clue(glimpse, `${word} two`, null);
            },
        },
        {
            name: "the mumbler",
            move: (glimpse: Glimpse<ClueBoardState>): Move => (glimpse.phase === "clue" && glimpse.turn % 3 === 0 && waiting(glimpse) === null ? clue(glimpse, "um, well, hmm", null) : { kind: "wait", seconds: 40 }),
        },
        { name: "the quiet table", move: (): Move => ({ kind: "wait", seconds: 30 }) },
        {
            name: "the giver who leaves",
            move(glimpse: Glimpse<ClueBoardState>): Move {
                const giver: string | null = giverOf(glimpse.state);
                if (glimpse.phase === "clue" && giver !== null && glimpse.state.turnNumber === 2) {
                    return { kind: "leave", playerId: giver };
                }
                if (glimpse.phase === "clue") {
                    return waiting(glimpse) ?? clue(glimpse, paperClue(glimpse), "fair");
                }
                return glimpse.phase === "guess" ? guessWhere(glimpse, ours(glimpse)) : { kind: "wait", seconds: 2 };
            },
        },
        {
            name: "the team that walks out",
            move(glimpse: Glimpse<ClueBoardState>): Move {
                const gone: CartridgePlayer | undefined = glimpse.players.find((player: CartridgePlayer) => glimpse.state.teamOf[player.playerId] === 1);
                if (glimpse.phase !== "setup" && glimpse.turn > 3 && gone !== undefined) {
                    return { kind: "leave", playerId: gone.playerId };
                }
                return { kind: "wait", seconds: 2 };
            },
        },
    ];
}

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
