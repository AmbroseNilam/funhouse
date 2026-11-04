// The clue-board kit: two teams share a five-by-five board of words. One giver per team holds the
// key, which says which words are theirs, which are the other team's, which are bystanders and which
// one is the trapdoor. The giver gives one word and a number; the team turns over words with taps on
// their phones. Code deals the key, checks every clue against the board, counts every guess and ends
// the game. The host writes a fresh board each game, rules whether a clue is fair, and can give the
// clues for a side when it has no human giver. The host is never told the key: a voiced giver is
// handed its side's key in a content request that no player or caption can see. Tin Can Telephone is
// this kit.

import { HOST_NAME } from "../../shared/brand.ts";
import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../shared/controls.ts";
import type { BoardCell, Scene, SceneBlock } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Turn } from "../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { boxProblems, isShortText, isWholeIn, rulingNameProblem, squash, type Box, type HiddenValue, type KitGame } from "../kit/kit.ts";
import { because, frozenCopy } from "../kit/primitives.ts";
import { isPlainWord, listedWords, numberIn, shuffled, singleWord, titleCase, tooClose } from "../kit/words.ts";

/** Everything a creator may choose for a clue-board game. */
export interface ClueBoardDecisions {
    /** The two teams' names, first and second. Short and different. */
    teams: [string, string];
    /** Words to fall back on when the model can't write a board; at least forty plain words. */
    words: string[];
    /** Seconds a giver has to give a clue. */
    clueSeconds: number;
    /** Seconds a team has to finish guessing. */
    guessSeconds: number;
    /** Seconds the host has to rule on a clue before it counts as fair. */
    judgeSeconds: number;
    /** Fouls a giver may make in one turn before the turn passes. */
    maxFouls: number;
    /** Most turns in a game; the team with fewer words left wins when they run out. */
    turnLimit: number;
}

/** The phases of the kit. */
export type ClueBoardPhase = "setup" | "clue" | "guess" | "end";

/** How a game ended. */
export type ClueBoardResult = "cleared" | "trapdoor" | "turns" | "forfeit" | "emptied";

/** Which team: 0 is the first, 1 the second. */
export type TeamIndex = 0 | 1;

/** Whose a word is. */
export type Owner = "a" | "b" | "neutral" | "trap";

/** One word on the board. */
export interface Cell {
    word: string;
    owner: Owner;
    turned: boolean;
}

/** A clue the host is judging, or the one in play. */
export interface Clue {
    word: string;
    number: number;
}

/** The whole game, immutable between steps. */
export interface ClueBoardState {
    phase: ClueBoardPhase;
    /** Everyone still at the table, in seat order. */
    players: CartridgePlayer[];
    /** Each player's team. */
    teamOf: Record<string, TeamIndex>;
    /** The human who holds each team's key, or null when the host gives that team's clues. */
    giverIds: [string | null, string | null];
    /** The board, empty until the host has written it. */
    cells: Cell[];
    /** What the host's model is writing now, if anything. */
    awaiting: "grid" | "clue" | null;
    /** How many times the host's clue has been asked for this turn. */
    hostTries: number;
    /** Which team has the first move, and so nine words. */
    firstTeam: TeamIndex;
    turnTeam: TeamIndex;
    turnNumber: number;
    /** Which try at a clue this is, so every try has its own inputs. */
    attempt: number;
    fouls: number;
    /** A clue waiting for the host's ruling. */
    pending: Clue | null;
    /** True when the last typed clue was not one word and a number, so the box says so. */
    unclear: boolean;
    /** The clue in play. */
    clue: Clue | null;
    guessesLeft: number;
    guessesMade: number;
    winner: TeamIndex | null;
    result: ClueBoardResult | null;
    /** Why the game ended, in the host's words, for the reveal. */
    ending: string;
}

/** The prefix on a guess action's id. */
export const GUESS_PREFIX: string = "guess:";

/** The action that ends a team's guessing. */
export const STOP_ACTION: string = "stop";

/** The variant that has the host give the second team's clues. */
export const HOST_CLUES_VARIANT: string = "hostClues";

/** The decision ids a rehearsal names when it explains a moment. */
export const CLUE_DECISIONS: { words: string; clue: string; guess: string; judge: string; fouls: string; turns: string; teams: string } = {
    words: "words",
    clue: "clueSeconds",
    guess: "guessSeconds",
    judge: "judgeSeconds",
    fouls: "maxFouls",
    turns: "turnLimit",
    teams: "teams",
};

/** Words on the board. */
export const BOARD_SIZE: number = 25;

/** Columns on the board. */
export const BOARD_COLUMNS: number = 5;

/** Words the team with the first move must find; the other has one fewer. */
const FIRST_WORDS: number = 9;

/** Words the team with the second move must find. */
const SECOND_WORDS: number = 8;

/** Fewest people: with three, the lone team's giver is the host. */
const FEWEST_PLAYERS: number = 3;

/** What the key card on a giver's phone is headed. */
export const KEY_CARD_TITLE: string = "The key";

/** What the guessers' card is headed. */
export const GUESSER_CARD_TITLE: string = "You're guessing";

/** What each ruling means, in the host's brief. Owned by the kit. */
const RULING_BRIEFS: Record<string, string> = {
    fair: "the clue is one ordinary word, and it doesn't spell, rhyme with, sound like, translate or point at the position of a word on the board. Write only [[fair]] and nothing else; you'll be told what to say.",
    foul: "the clue breaks one of those rules: it spells a word, rhymes with one, sounds like one, says where one is, or is a name or a made-up word. Write [[foul]] and then a few words on why, without hinting at which words are whose.",
};

/**
 * Checks a clue-board game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function clueBoardProblems(decisions: ClueBoardDecisions): string[] {
    const problems: string[] = [];
    const [first, second] = decisions.teams;
    if (isShortText(first) === false || isShortText(second) === false || squash(first) === squash(second)) {
        problems.push("The two teams need short, different names.");
    }
    const usable: string[] = decisions.words.filter((word: string) => isPlainWord(word) === true);
    if (usable.length !== decisions.words.length || new Set(usable.map(squash)).size !== usable.length || usable.length < 40) {
        problems.push("The fallback words must be at least forty different plain words.");
    }
    if (isWholeIn(decisions.clueSeconds, 20, 300) === false || isWholeIn(decisions.guessSeconds, 30, 300) === false) {
        problems.push("The clue and guess clocks must be whole numbers of seconds, 20 to 300 and 30 to 300.");
    }
    if (isWholeIn(decisions.judgeSeconds, 3, 30) === false) {
        problems.push("The judging wait must be a whole number of seconds from 3 to 30.");
    }
    if (isWholeIn(decisions.maxFouls, 1, 5) === false || isWholeIn(decisions.turnLimit, 6, 60) === false) {
        problems.push("Fouls must be 1 to 5 and the turn limit 6 to 60, as whole numbers.");
    }
    return problems;
}

/**
 * Every problem with a clue-board blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function clueBoardBlueprintProblems(box: Box, decisions: ClueBoardDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...clueBoardProblems(decisions)];
    if (box.minPlayers < FEWEST_PLAYERS) {
        problems.push("A clue board needs at least three people: a giver, a guesser and the other team's guesser.");
    }
    return problems;
}

/**
 * Builds the manifest from the box, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 * @throws when a kit ruling name is reserved, which would be a bug in the kit.
 */
export function clueBoardManifest(box: Box): CartridgeManifest {
    for (const name of Object.keys(RULING_BRIEFS)) {
        const problem: string | null = rulingNameProblem(name);
        if (problem !== null) {
            throw new Error(problem);
        }
    }
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're running ${box.name}: two teams, a board of twenty-five words, and a clue-giver on each side who knows which words are whose.`,
            "You wrote the board, and you never know the key, so never guess, hint or joke about which word belongs to whom.",
            "You judge whether a clue is fair and you read results aloud. The rules, the counts and the turns are in the game, never yours to change.",
            "When you're told to give a team's clue yourself, you say the clue and number you're handed in your own voice, as that team's clue-giver.",
        ].join(" "),
        keywords: box.keywords,
        variants: [{ id: HOST_CLUES_VARIANT, label: "Host gives the second team's clues", description: `${HOST_NAME} gives every clue for the second team, so everyone on it guesses.`, defaultOn: false }],
        phases: [
            {
                id: "setup",
                hostBrief: "You're writing the board. When you're told it's ready, explain in two short sentences: each clue is one word and a number, and the trapdoor word ends the game. Then stop.",
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "clue",
                hostBrief: [
                    "A giver is giving a clue, out loud or typed. You only judge it when you're told to; the code has already refused clues that are on the board.",
                    "Rule fair or foul in one go. Nothing about which words belong to whom, ever.",
                    "If a giver is struggling, you may tease them in a few words; never help them.",
                ].join(" "),
                listening: { giver: "holdToTalk", "*": "muted" },
                hostMayInterject: false,
                hostMostlyQuiet: true,
                silenceSeconds: 0,
                hostRulings: { ...RULING_BRIEFS },
            },
            {
                id: "guess",
                hostBrief: "A team is turning over words with taps on their phones. Say only what you're told, in one short line. If nothing is asked of you, reply exactly (quiet).",
                listening: { "*": "muted" },
                hostMayInterject: false,
                hostMostlyQuiet: true,
                silenceSeconds: 0,
            },
            {
                id: "end",
                hostBrief: "You'll be told how it ended. Two or three sentences: who won, the word that decided it if there was one, and a dry word for the losing side. Then ask if they want another game.",
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Splits the table into two teams and names each team's giver. Seats alternate between teams. A team's
 * giver is its first seat, unless the team has only one person or the host gives its clues.
 * @param players everyone at the table, in seat order.
 * @param hostGivesSecond whether the host gives the second team's clues.
 * @returns each player's team and each team's human giver.
 */
export function seatTeams(players: readonly CartridgePlayer[], hostGivesSecond: boolean): { teamOf: Record<string, TeamIndex>; giverIds: [string | null, string | null] } {
    const teamOf: Record<string, TeamIndex> = {};
    const members: [string[], string[]] = [[], []];
    players.forEach((player: CartridgePlayer, seat: number) => {
        const team: TeamIndex = seat % 2 === 0 ? 0 : 1;
        teamOf[player.playerId] = team;
        members[team].push(player.playerId);
    });
    const giverFor = (team: TeamIndex): string | null => (members[team].length >= 2 && (team === 0 || hostGivesSecond === false) ? members[team][0] ?? null : null);
    return { teamOf, giverIds: [giverFor(0), giverFor(1)] };
}

/**
 * Deals the key: which words belong to whom. The first team has nine, the second eight, seven are
 * bystanders and one is the trapdoor.
 * @param words the twenty-five board words.
 * @param firstTeam the team with the first move.
 * @param random a function returning [0, 1).
 * @returns the board, nothing turned over.
 */
export function dealKey(words: readonly string[], firstTeam: TeamIndex, random: () => number): Cell[] {
    const first: Owner = firstTeam === 0 ? "a" : "b";
    const second: Owner = firstTeam === 0 ? "b" : "a";
    const owners: Owner[] = [
        ...Array.from({ length: FIRST_WORDS }, (): Owner => first),
        ...Array.from({ length: SECOND_WORDS }, (): Owner => second),
        ...Array.from({ length: BOARD_SIZE - FIRST_WORDS - SECOND_WORDS - 1 }, (): Owner => "neutral"),
        "trap",
    ];
    const dealt: Owner[] = shuffled(owners, random);
    return words.slice(0, BOARD_SIZE).map((word: string, index: number): Cell => ({ word, owner: dealt[index] ?? "neutral", turned: false }));
}

/**
 * Why a clue can't be given, or null when it can. The same check for a typed, spoken or voiced clue.
 * @param clue the clue.
 * @param cells the board.
 * @param wordsLeft how many words the team still has to find.
 * @returns a problem in plain words, or null.
 */
export function clueProblem(clue: Clue, cells: readonly Cell[], wordsLeft: number): string | null {
    if (isPlainWord(clue.word) === false) {
        return "A clue is one plain word.";
    }
    if (cells.some((cell: Cell) => cell.turned === false && tooClose(clue.word, cell.word) === true) === true) {
        return "That word is on the board, or part of one.";
    }
    if (Number.isInteger(clue.number) === false || clue.number < 1 || clue.number > wordsLeft) {
        return `The number has to be from 1 to ${wordsLeft}.`;
    }
    return null;
}

/**
 * Reads a spoken or written clue: one word and a number.
 * @param text what was said.
 * @returns the clue, or null when it isn't one word and a number.
 */
export function parseClue(text: string): Clue | null {
    const word: string | null = singleWord(text);
    const number: number | null = numberIn(text);
    return word === null || number === null ? null : { word, number };
}

/**
 * Builds a clue-board game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with clueBoardBlueprintProblems first.
 * @param random a function returning [0, 1): the first draw picks who moves first, by its fourth decimal place, and the rest shuffle.
 * @returns the game.
 */
export function createClueBoardGame(givenBox: Box, givenDecisions: ClueBoardDecisions, random: () => number = Math.random): KitGame<ClueBoardState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: ClueBoardDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = clueBoardManifest(box);
    const publicFact = (kind: string, text: string, quiet: boolean = false): ScopedFact => ({ scope: { kind: "public" }, kind, text, ...(quiet === true ? { quiet: true } : {}) });
    const teamName = (team: TeamIndex): string => decisions.teams[team];
    const otherTeam = (team: TeamIndex): TeamIndex => (team === 0 ? 1 : 0);
    const ownerOf = (team: TeamIndex): Owner => (team === 0 ? "a" : "b");
    const nameOf = (state: ClueBoardState, playerId: string | null): string => (playerId === null ? HOST_NAME : state.players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone");
    const wordsLeft = (state: ClueBoardState, team: TeamIndex): number => state.cells.filter((cell: Cell) => cell.owner === ownerOf(team) && cell.turned === false).length;
    const membersOf = (state: ClueBoardState, team: TeamIndex): string[] => {
        return state.players.filter((player: CartridgePlayer) => state.teamOf[player.playerId] === team).map((player: CartridgePlayer) => player.playerId);
    };
    const guessersOf = (state: ClueBoardState, team: TeamIndex): string[] => membersOf(state, team).filter((playerId: string) => playerId !== state.giverIds[team]);
    const giverOf = (state: ClueBoardState): string | null => state.giverIds[state.turnTeam];
    const inputId = (state: ClueBoardState): string => `clue:${state.turnNumber}:${state.attempt}`;

    /**
     * The question the host's model answers when it gives a team's clue. It holds the key, and nothing
     * else sees it: this text goes to the model and to no screen, phone or caption.
     * @param state the state.
     * @returns the prompt.
     */
    const clueRequest = (state: ClueBoardState): string => {
        const list = (owner: Owner): string => state.cells.filter((cell: Cell) => cell.owner === owner && cell.turned === false).map((cell: Cell) => cell.word).join(", ");
        const mine: Owner = ownerOf(state.turnTeam);
        const theirs: Owner = ownerOf(otherTeam(state.turnTeam));
        return [
            "You are the clue-giver in a word-association party game. Your team must find these words on the board:",
            list(mine),
            `Their team's words, which your team must not be led to: ${list(theirs)}.`,
            `Bystander words, which you also want to avoid: ${list("neutral")}.`,
            `The trapdoor word, which you must never lead them to: ${list("trap")}.`,
            "Give ONE clue: a single plain English word with no spaces that is not one of the words on the board and is not part of one,",
            `and a number from 1 to ${wordsLeft(state, state.turnTeam)} for how many of your team's words it points at.`,
            "Prefer a clue that links two or three of your words and keeps well away from the dangerous ones.",
            "Reply with only the word, a comma and the number, like: harbour, 2",
        ].join(" ");
    };

    /**
     * Ends the game.
     * @param state the state.
     * @param winner the winning team.
     * @param result how it ended.
     * @param ending what to tell the host.
     * @param decision the decision behind it.
     * @returns the step.
     */
    const finish = (state: ClueBoardState, winner: TeamIndex | null, result: ClueBoardResult, ending: string, decision: string): Step<ClueBoardState> => {
        const done: ClueBoardState = { ...state, phase: "end", awaiting: null, pending: null, winner, result, ending, cells: state.cells };
        return { state: done, facts: because(publicFact("game-over", ending), decision), nextPhaseId: "end" };
    };

    /**
     * Ends the game on the turn limit: the team with fewer words left wins, and a tie goes to the
     * team that didn't have the first move.
     * @param state the state.
     * @param lead what happened to end the last turn.
     * @returns the step.
     */
    const outOfTurns = (state: ClueBoardState, lead: string): Step<ClueBoardState> => {
        const first: number = wordsLeft(state, 0);
        const second: number = wordsLeft(state, 1);
        const winner: TeamIndex = first < second ? 0 : first > second ? 1 : otherTeam(state.firstTeam);
        return finish(state, winner, "turns", `${lead} That was the last turn. ${teamName(winner)} had fewer words left and wins. Say who won, in a line.`, CLUE_DECISIONS.turns);
    };

    /**
     * Begins the next team's turn: a human giver is waited for on a clock, the host's own is asked of
     * the model.
     * @param state the state, with the turn not yet passed.
     * @param lead what happened to end the last turn, for the host.
     * @param decision the decision that ended it.
     * @returns the step.
     */
    const nextTurn = (state: ClueBoardState, lead: string, decision: string): Step<ClueBoardState> => {
        if (state.turnNumber >= decisions.turnLimit) {
            return outOfTurns(state, lead);
        }
        const team: TeamIndex = otherTeam(state.turnTeam);
        const giver: string | null = state.giverIds[team];
        const next: ClueBoardState = {
            ...state, phase: "clue", turnTeam: team, turnNumber: state.turnNumber + 1, attempt: 0, fouls: 0, pending: null, unclear: false,
            clue: null, guessesLeft: 0, guessesMade: 0, hostTries: 0, awaiting: giver === null ? "clue" : null,
        };
        const who: string = giver === null ? `You give ${teamName(team)}'s clue yourself; wait to be handed it.` : `${nameOf(state, giver)} gives ${teamName(team)}'s clue.`;
        const facts: ScopedFact[] = because(publicFact("turn", `${lead} It's ${teamName(team)}'s turn. ${who}`), decision);
        if (giver === null) {
            return { state: next, facts, nextPhaseId: "clue", contentRequest: clueRequest(next) };
        }
        return { state: next, facts, nextPhaseId: "clue", timers: { clue: decisions.clueSeconds } };
    };

    /**
     * Counts a team's words after a reveal and ends the game if someone has found them all.
     * @param state the state after a card was turned.
     * @returns the winner, or null.
     */
    const clearedBy = (state: ClueBoardState): TeamIndex | null => {
        if (wordsLeft(state, 0) === 0) {
            return 0;
        }
        return wordsLeft(state, 1) === 0 ? 1 : null;
    };

    /**
     * A clue passed the code's check and the host's ruling: the guessers go.
     * @param state the state.
     * @param clue the clue.
     * @returns the step.
     */
    const startGuessing = (state: ClueBoardState, clue: Clue): Step<ClueBoardState> => {
        const next: ClueBoardState = { ...state, phase: "guess", clue, pending: null, awaiting: null, guessesLeft: clue.number + 1, guessesMade: 0 };
        const text: string = [
            `The clue is "${titleCase(clue.word)}", ${clue.number}. Say it aloud in one short line as ${teamName(state.turnTeam)}'s clue,`,
            "then tell their guessers to go. Don't say anything else about the board.",
        ].join(" ");
        return { state: next, facts: because(publicFact("clue", text), CLUE_DECISIONS.clue), nextPhaseId: "guess", timers: { guess: decisions.guessSeconds } };
    };

    /**
     * A clue was refused, by the code or the host. Too many fouls pass the turn.
     * @param state the state.
     * @param why why, for the host.
     * @param decision the decision behind it.
     * @returns the step.
     */
    const foul = (state: ClueBoardState, why: string, decision: string): Step<ClueBoardState> => {
        const fouls: number = state.fouls + 1;
        if (fouls >= decisions.maxFouls) {
            return nextTurn({ ...state, fouls }, `${why} That was foul number ${fouls}, so ${teamName(state.turnTeam)} loses the turn.`, CLUE_DECISIONS.fouls);
        }
        const next: ClueBoardState = { ...state, fouls, attempt: state.attempt + 1, pending: null, unclear: false };
        return { state: next, facts: because(publicFact("foul", `${why} Tell the giver in a few words, and that they can try again.`), decision) };
    };

    /**
     * Takes a clue from a giver. The code refuses what is plainly illegal; the rest waits for the
     * host's ruling, which counts as fair if it doesn't come in time.
     * @param state the state.
     * @param clue the clue.
     * @returns the step.
     */
    const offer = (state: ClueBoardState, clue: Clue): Step<ClueBoardState> => {
        const problem: string | null = clueProblem(clue, state.cells, wordsLeft(state, state.turnTeam));
        if (problem !== null) {
            return foul(state, `The clue is refused. ${problem}`, CLUE_DECISIONS.fouls);
        }
        const next: ClueBoardState = { ...state, pending: clue, unclear: false };
        const text: string = `Judge the clue "${titleCase(clue.word)}", ${clue.number}, from ${nameOf(state, giverOf(state))} for ${teamName(state.turnTeam)}. Rule now.`;
        return { state: next, facts: because(publicFact("judge", text), CLUE_DECISIONS.judge), timers: { judge: decisions.judgeSeconds } };
    };

    /**
     * Reads the host's model's clue for a voiced giver.
     * @param state the state.
     * @param reply what the model wrote.
     * @returns the step.
     */
    const hostGave = (state: ClueBoardState, reply: string): Step<ClueBoardState> => {
        const clue: Clue | null = parseClue(reply);
        if (clue !== null && clueProblem(clue, state.cells, wordsLeft(state, state.turnTeam)) === null) {
            return startGuessing(state, clue);
        }
        if (state.hostTries < 1) {
            const again: ClueBoardState = { ...state, hostTries: state.hostTries + 1 };
            return { state: again, facts: [], contentRequest: clueRequest(again) };
        }
        return nextTurn({ ...state, awaiting: null }, "You have no clue for them this time. Say so in a few words and pass.", CLUE_DECISIONS.clue);
    };

    /**
     * Turns over one card and settles what it means.
     * @param state the state.
     * @param index which card.
     * @returns the step.
     */
    const turnOver = (state: ClueBoardState, index: number): Step<ClueBoardState> => {
        const card: Cell | undefined = state.cells[index];
        if (card === undefined) {
            return { state, facts: [] };
        }
        const cells: Cell[] = state.cells.map((cell: Cell, position: number) => (position === index ? { ...cell, turned: true } : cell));
        const turned: ClueBoardState = { ...state, cells, guessesLeft: state.guessesLeft - 1, guessesMade: state.guessesMade + 1 };
        const word: string = titleCase(card.word);
        const team: TeamIndex = state.turnTeam;
        if (card.owner === "trap") {
            return finish(turned, otherTeam(team), "trapdoor", `${teamName(team)} turned over ${word}, the trapdoor, so ${teamName(otherTeam(team))} wins. Say so with some drama in two short sentences.`, CLUE_DECISIONS.guess);
        }
        const winner: TeamIndex | null = clearedBy(turned);
        if (winner !== null) {
            return finish(turned, winner, "cleared", `${teamName(winner)} has found every one of its words${card.owner === ownerOf(winner) ? "" : ", though not on its own turn"}. Say who won in a line.`, CLUE_DECISIONS.guess);
        }
        if (card.owner === ownerOf(team)) {
            if (turned.guessesLeft <= 0) {
                return nextTurn(turned, `${word} was theirs, and that was their last guess.`, CLUE_DECISIONS.guess);
            }
            return { state: turned, facts: because(publicFact("found", `${teamName(team)} found ${word}.`, true), CLUE_DECISIONS.guess) };
        }
        const whose: string = card.owner === "neutral" ? "a bystander" : `${teamName(otherTeam(team))}'s`;
        return nextTurn(turned, `${teamName(team)} turned over ${word}, which was ${whose}, so their turn is over.`, CLUE_DECISIONS.guess);
    };

    /**
     * Someone left. A giver who leaves is replaced by the host; a team with nobody to guess forfeits.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: ClueBoardState, playerId: string): Step<ClueBoardState> => {
        if (state.phase === "end" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return { state, facts: [] };
        }
        const players: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => player.playerId !== playerId);
        const teamOf: Record<string, TeamIndex> = Object.fromEntries(Object.entries(state.teamOf).filter(([id]: [string, TeamIndex]) => id !== playerId));
        const stillGiving = (team: TeamIndex): string | null => {
            const giver: string | null = state.giverIds[team];
            const members: number = players.filter((player: CartridgePlayer) => teamOf[player.playerId] === team).length;
            return giver === playerId || members < 2 ? null : giver;
        };
        const giverIds: [string | null, string | null] = [stillGiving(0), stillGiving(1)];
        const next: ClueBoardState = { ...state, players, teamOf, giverIds };
        const emptied: TeamIndex | null = ([0, 1] as const).find((team: TeamIndex) => guessersOf(next, team).length === 0) ?? null;
        if (players.length < 2 || emptied !== null) {
            const winner: TeamIndex | null = emptied === null ? null : otherTeam(emptied);
            const ending: string = winner === null ? "Nearly everyone left, so the game is over." : `${teamName(emptied ?? 0)} has nobody left to guess, so ${teamName(winner)} wins. Say so in a line.`;
            return finish(next, winner, winner === null ? "emptied" : "forfeit", ending, CLUE_DECISIONS.teams);
        }
        const wasGiver: boolean = state.giverIds[state.turnTeam] !== null && giverIds[state.turnTeam] === null && state.phase === "clue";
        if (wasGiver === false) {
            return { state: next, facts: [] };
        }
        const handed: ClueBoardState = { ...next, pending: null, unclear: false, awaiting: "clue", hostTries: 0 };
        const name: string = teamName(state.turnTeam);
        const text: string = `${name}'s giver left, or is the last one on the team. You give ${name}'s clues from now on; wait to be handed this one.`;
        return { state: handed, facts: because(publicFact("giver-left", text), CLUE_DECISIONS.teams), contentRequest: clueRequest(handed) };
    };

    /**
     * Whether a player may turn over a card now: a guesser on the team whose turn it is.
     * @param state the state.
     * @param playerId the player.
     * @returns true when they may.
     */
    const mayGuess = (state: ClueBoardState, playerId: string): boolean => state.phase === "guess" && guessersOf(state, state.turnTeam).includes(playerId) === true;

    const cartridge: Cartridge<ClueBoardState> = {
        manifest,

        init(players: CartridgePlayer[], variants: Record<string, boolean>): Step<ClueBoardState> {
            const firstTeam: TeamIndex = Math.floor(random() * 2000) % 2 === 0 ? 0 : 1;
            const seated: { teamOf: Record<string, TeamIndex>; giverIds: [string | null, string | null] } = seatTeams(players, variants[HOST_CLUES_VARIANT] === true);
            const state: ClueBoardState = {
                phase: "setup", players, teamOf: seated.teamOf, giverIds: seated.giverIds, cells: [], awaiting: "grid", hostTries: 0, firstTeam,
                turnTeam: otherTeam(firstTeam), turnNumber: 0, attempt: 0, fouls: 0, pending: null, unclear: false, clue: null,
                guessesLeft: 0, guessesMade: 0, winner: null, result: null, ending: "",
            };
            const request: string = [
                "Write 25 different everyday words for a word-association party game, each one plain English word with no spaces.",
                "Mix things, places, animals, foods, materials and actions. No names of people or brands, nothing rude, nothing grim.",
                "Reply with only the 25 words separated by commas.",
            ].join(" ");
            return { state, facts: [], nextPhaseId: "setup", contentRequest: request };
        },

        phaseOf(state: ClueBoardState): string {
            return state.phase;
        },

        turn(state: ClueBoardState): Turn | null {
            if (state.phase === "setup") {
                return { kind: "secret", label: "Board coming up" };
            }
            if (state.phase === "clue") {
                const giver: string | null = giverOf(state);
                return giver === null ? { kind: "anyone", label: `${HOST_NAME} gives ${teamName(state.turnTeam)}'s clue` } : { kind: "one", playerId: giver, label: `${teamName(state.turnTeam)} clue from` };
            }
            if (state.phase === "guess") {
                return { kind: "everyone", playerIds: guessersOf(state, state.turnTeam), doneIds: [], label: `${teamName(state.turnTeam)} guesses` };
            }
            return null;
        },

        roleOf(state: ClueBoardState, playerId: string): string {
            return state.phase === "clue" && giverOf(state) === playerId ? "giver" : "other";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: ClueBoardState, playerId: string): LegalAction[] {
            if (mayGuess(state, playerId) === false) {
                return [];
            }
            const guesses: LegalAction[] = state.cells.flatMap((cell: Cell, index: number): LegalAction[] => {
                return cell.turned === false ? [{ actionId: `${GUESS_PREFIX}${index}`, label: titleCase(cell.word) }] : [];
            });
            return state.guessesMade > 0 ? [...guesses, { actionId: STOP_ACTION, label: "We're done" }] : guesses;
        },

        apply(state: ClueBoardState, playerId: string, actionId: string): Step<ClueBoardState> {
            if (mayGuess(state, playerId) === false) {
                return { state, facts: [] };
            }
            if (actionId === STOP_ACTION) {
                if (state.guessesMade === 0) {
                    return { state, facts: [] };
                }
                return nextTurn(state, `${teamName(state.turnTeam)} stopped guessing.`, CLUE_DECISIONS.guess);
            }
            if (actionId.startsWith(GUESS_PREFIX) === false) {
                return { state, facts: [] };
            }
            const index: number = Number(actionId.slice(GUESS_PREFIX.length));
            if (Number.isInteger(index) === false || state.cells[index]?.turned !== false) {
                return { state, facts: [] };
            }
            return turnOver(state, index);
        },

        onEvent(state: ClueBoardState, event: RoomEvent): Step<ClueBoardState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "contentReady" && state.awaiting === "grid" && state.phase === "setup") {
                const written: string[] = listedWords(event.text);
                const words: string[] = shuffled(written.length >= BOARD_SIZE ? written : decisions.words, random).slice(0, BOARD_SIZE);
                const cells: Cell[] = dealKey(words, state.firstTeam, random);
                const next: ClueBoardState = { ...state, cells, awaiting: null };
                return startFirstTurn(next);
            }
            if (event.type === "contentReady" && state.awaiting === "clue" && state.phase === "clue") {
                return hostGave(state, event.text);
            }
            if (state.phase === "clue" && state.awaiting === null) {
                const giver: string | null = giverOf(state);
                if (event.type === "speechEnded" && event.playerId === giver && state.pending === null) {
                    const clue: Clue | null = parseClue(event.text);
                    if (clue === null) {
                        const text: string = "The giver's clue wasn't one word and a number. Tell them, in a few words, to say one word and then a number.";
                        return { state, facts: because(publicFact("unclear", text), CLUE_DECISIONS.clue) };
                    }
                    return offer(state, clue);
                }
                if (event.type === "answered" && event.playerId === giver && state.pending === null && event.controlId === inputId(state)) {
                    const clue: Clue | null = typeof event.value === "string" ? parseClue(event.value) : null;
                    if (clue === null) {
                        return { state: { ...state, attempt: state.attempt + 1, unclear: true }, facts: [] };
                    }
                    return offer(state, clue);
                }
                if (event.type === "hostRuled" && state.pending !== null) {
                    if (event.ruling === "fair") {
                        return startGuessing(state, state.pending);
                    }
                    if (event.ruling === "foul") {
                        return foul(state, "The clue was ruled a foul.", CLUE_DECISIONS.judge);
                    }
                    return { state, facts: [] };
                }
                if (event.type === "timerFired" && event.timerId === "judge" && state.pending !== null) {
                    return startGuessing(state, state.pending);
                }
                if (event.type === "timerFired" && event.timerId === "clue" && state.pending === null) {
                    return nextTurn(state, `${teamName(state.turnTeam)} ran out of time for a clue.`, CLUE_DECISIONS.clue);
                }
            }
            if (event.type === "timerFired" && event.timerId === "guess" && state.phase === "guess") {
                return nextTurn(state, `${teamName(state.turnTeam)} ran out of time guessing.`, CLUE_DECISIONS.guess);
            }
            return { state, facts: [] };
        },

        publicScene(state: ClueBoardState): Scene {
            if (state.phase === "setup") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: box.name }, { type: "text", text: `${HOST_NAME} is writing the board.`, emphasis: "large" }] };
            }
            const showKey: boolean = state.phase === "end";
            const owners: Record<Owner, BoardCell["owner"]> = { a: "a", b: "b", neutral: "neutral", trap: "trap" };
            const names: Record<Owner, string> = { a: teamName(0), b: teamName(1), neutral: "Bystander", trap: "Trapdoor" };
            const cells: BoardCell[] = state.cells.map((cell: Cell): BoardCell => {
                if (cell.turned === true || showKey === true) {
                    return { text: titleCase(cell.word), owner: owners[cell.owner], turned: cell.turned, owned: names[cell.owner] };
                }
                return { text: titleCase(cell.word), owner: "unknown", turned: false };
            });
            const left: string = `${teamName(0)} ${wordsLeft(state, 0)} left, ${teamName(1)} ${wordsLeft(state, 1)} left`;
            const blocks: SceneBlock[] = [];
            if (state.phase === "end") {
                const title: string = state.winner === null ? "Nobody wins" : `${teamName(state.winner)} wins`;
                const kicker: Record<ClueBoardResult, string> = { cleared: "Every word found", trapdoor: "The trapdoor", turns: "Out of turns", forfeit: "A team left", emptied: "Everyone left" };
                blocks.push({ type: "title", text: title, kicker: `${kicker[state.result ?? "emptied"]}. ${left}` }, { type: "board", columns: BOARD_COLUMNS, cells });
                return { mood: state.winner === null ? "defeat" : "victory", transition: "fade", blocks };
            }
            const giver: string | null = giverOf(state);
            const doing: string = state.phase === "clue" ? (giver === null ? `${HOST_NAME} is thinking of a clue` : `${nameOf(state, giver)} is giving the clue`) : `Clue: ${titleCase(state.clue?.word ?? "")}, ${state.clue?.number ?? 0}`;
            const checking: string = state.phase === "clue" && state.pending !== null ? `Checking ${titleCase(state.pending.word)}, ${state.pending.number}. ` : "";
            blocks.push({ type: "title", text: `${teamName(state.turnTeam)}'s turn`, kicker: `${checking}${doing}. ${left}` }, { type: "board", columns: BOARD_COLUMNS, cells });
            if (state.phase === "guess") {
                blocks.push({ type: "timer", seconds: decisions.guessSeconds, label: `${state.guessesLeft} ${state.guessesLeft === 1 ? "guess" : "guesses"} left`, running: true });
            }
            if (state.phase === "clue" && giver !== null && state.pending === null) {
                blocks.push({ type: "timer", seconds: decisions.clueSeconds, label: "to give a clue", running: true });
            }
            return { mood: "tense", transition: "fade", blocks };
        },

        privateControls(state: ClueBoardState, playerId: string): Control[] {
            if (state.phase === "setup") {
                return [{ type: "waiting", text: "The board is coming." }];
            }
            if (state.phase === "end") {
                return [{ type: "waiting", text: "Look at the screen." }];
            }
            const humanGiver: boolean = state.giverIds[0] === playerId || state.giverIds[1] === playerId;
            const cards: Control[] = humanGiver === false ? [] : keyCards(state, playerId);
            const myTeam: TeamIndex = state.teamOf[playerId] ?? 0;
            if (humanGiver === false) {
                cards.push({ type: "roleCard", title: GUESSER_CARD_TITLE, body: `You're on ${teamName(myTeam)}.`, secret: false });
            }
            if (state.phase === "clue") {
                if (giverOf(state) === playerId) {
                    if (state.pending !== null) {
                        return [...cards, { type: "waiting", text: "Checking your clue." }];
                    }
                    const room: number = wordsLeft(state, state.turnTeam);
                    const note: string = state.fouls > 0 ? "That one didn't count. Try another." : state.unclear === true ? "That wasn't one word and a number." : "Hold and say it, or type it.";
                    return [
                        ...cards,
                        { type: "textInput", id: inputId(state), prompt: `One word and a number, 1 to ${room}`, placeholder: "harbour 2", maxLength: 24, note },
                    ];
                }
                return [...cards, { type: "waiting", text: state.teamOf[playerId] === state.turnTeam ? "Wait for your clue." : `${teamName(state.turnTeam)} are getting a clue.` }];
            }
            if (mayGuess(state, playerId) === false) {
                return [...cards, { type: "waiting", text: state.teamOf[playerId] === state.turnTeam ? "Your team is guessing." : `${teamName(state.turnTeam)} are guessing.` }];
            }
            const options: ControlOption[] = state.cells.flatMap((cell: Cell, index: number): ControlOption[] => {
                return cell.turned === false ? [{ id: `${GUESS_PREFIX}${index}`, label: titleCase(cell.word) }] : [];
            });
            const stop: ControlOption = { id: STOP_ACTION, label: "We're done", disabled: state.guessesMade === 0 };
            const prompt: string = `${titleCase(state.clue?.word ?? "")}, ${state.clue?.number ?? 0}. Agree out loud, then tap one.`;
            return [...cards, { type: "choice", prompt, options: [...options, stop], multiple: false }];
        },

        hostFacts(state: ClueBoardState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.cells.length === 0 || state.phase === "end") {
                return [];
            }
            const open: string = state.cells.filter((cell: Cell) => cell.turned === false).map((cell: Cell) => titleCase(cell.word)).join(", ");
            const facts: ScopedFact[] = [{ scope: { kind: "public" }, kind: "board", text: `Words still on the board: ${open}.` }];
            if (state.pending !== null) {
                facts.push({ scope: { kind: "public" }, kind: "pending", text: `The clue being judged is "${titleCase(state.pending.word)}", ${state.pending.number}.` });
            }
            return facts;
        },

        outcome(state: ClueBoardState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            return state.winner === null ? "Nobody won." : `${teamName(state.winner)} won.`;
        },
    };

    /**
     * Opens the first turn once the board is written.
     * @param state the state with the board dealt.
     * @returns the step.
     */
    function startFirstTurn(state: ClueBoardState): Step<ClueBoardState> {
        const team: TeamIndex = state.firstTeam;
        const first: Step<ClueBoardState> = nextTurn({ ...state, turnTeam: otherTeam(team), turnNumber: 0 }, "The board is on the TV and everyone has their phone.", CLUE_DECISIONS.words);
        const intro: string = "Explain in two short sentences: each clue is one word and a number, the team taps words on their phones, and one word is a trapdoor that loses the game.";
        const facts: ScopedFact[] = first.facts.map((fact: ScopedFact) => (fact.kind === "turn" ? { ...fact, text: `${fact.text} ${intro}` } : fact));
        return { ...first, facts };
    }

    /**
     * What a giver's phone shows of the key: the unturned words by owner, as short secret lines.
     * @param state the state.
     * @param playerId the giver.
     * @returns the cards.
     */
    function keyCards(state: ClueBoardState, playerId: string): Control[] {
        const list = (owner: Owner): string => state.cells.filter((cell: Cell) => cell.owner === owner && cell.turned === false).map((cell: Cell) => titleCase(cell.word)).join(", ");
        const mine: TeamIndex = state.teamOf[playerId] ?? 0;
        const rows: [string, Owner][] = [[`${teamName(mine)} (yours)`, ownerOf(mine)], [teamName(otherTeam(mine)), ownerOf(otherTeam(mine))], ["Bystander", "neutral"], ["Trapdoor", "trap"]];
        return rows.map(([label, owner]: [string, Owner]): Control => ({ type: "roleCard", title: KEY_CARD_TITLE, body: `${label}: ${list(owner) === "" ? "none left" : list(owner)}`, secret: true }));
    }

    return {
        cartridge,
        hidden(state: ClueBoardState): HiddenValue[] {
            if (state.phase === "end") {
                return [];
            }
            const keepers: string[] = state.giverIds.filter((id: string | null): id is string => id !== null);
            const labels: Record<Owner, string> = { a: teamName(0), b: teamName(1), neutral: "Bystander", trap: "Trapdoor" };
            return state.cells.filter((cell: Cell) => cell.turned === false).map((cell: Cell): HiddenValue => {
                return { label: `whose "${cell.word}" is`, text: cell.word, seenBy: keepers, near: labels[cell.owner] };
            });
        },
    };
}
