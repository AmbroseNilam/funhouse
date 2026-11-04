// The clue kit: a cooperative word game. Each round one player is the guesser and never sees the
// secret word. Everyone else sees it on their phone and types ONE-word clue. Clues that match each
// other once merged cancel out and are hidden; so are clues that contain the word or an obvious
// form of it. The surviving clues are read out, the guesser gets one guess, spoken or typed, and
// the table scores together over several rounds. After the guess the host reveals the cancelled
// clues, which is the joke. The word comes from a list in the blueprint and code checks the guess,
// so the host is never told the word and cannot leak it; it only reads, rules that a spoken line
// was the final guess, and narrates. Lonely Clues is this kit.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Turn } from "../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { appearsAsWord, boxProblems, isWholeIn, rulingNameProblem, type Box, type HiddenValue, type KitGame } from "../kit/kit.ts";
import { mergeDuplicates, normalize, sameAnswer, type DuplicateMerger, type MergedGroup } from "../kit/merge.ts";
import { because, frozenCopy, pick, takeRuledLine, waitForRuling, type WaitingLine } from "../kit/primitives.ts";

/** Everything a creator may choose for a clue game. */
export interface ClueDecisions {
    /** The words a round can use: plain words, one or two, no repeats within a game. */
    words: string[];
    /** How many rounds the table plays; each round has one guesser, turn and turn about. */
    rounds: number;
    /** Seconds everyone has to type a clue. */
    writingSeconds: number;
    /** Seconds each surviving clue takes to come up on the screen. */
    beatSeconds: number;
    /** Seconds the guesser has to guess once the clues are out. */
    guessSeconds: number;
    /** Seconds the cancelled clues stay on the screen before the next round. */
    resultSeconds: number;
    /** How many more tries someone gets after a clue the rules refuse. */
    clueRetries: number;
    /** Points for a right guess. */
    correctPoints: number;
    /** Extra points when a right guess came from a round with no cancelled or refused clue. */
    cleanBonus: number;
    /** Whether the pause menu offers "We give up", which passes the word. */
    giveUpButton: boolean;
}

/** The phases of the kit. */
export type CluePhase = "writing" | "reveal" | "guess" | "result" | "end";

/** How a round ended. */
export type ClueVerdict = "right" | "wrong" | "timeout" | "passed" | "voided";

/** One clue and who wrote it. */
export interface Clue {
    playerId: string;
    text: string;
}

/** What a round was worth, kept for the final recap. */
export interface RoundRecord {
    word: string;
    points: number;
    verdict: ClueVerdict;
}

/** The whole game, immutable between steps. */
export interface ClueState {
    phase: CluePhase;
    /** Everyone still at the table, in seat order. */
    players: CartridgePlayer[];
    /** Which seat guesses first; the guesser moves one seat on each round. */
    firstSeat: number;
    /** Round number, starting at 1. */
    round: number;
    guesserId: string;
    word: string;
    usedWords: string[];
    /** Clues the rules accepted this round, in the order they came in. */
    clues: Clue[];
    /** Tries each clue giver has used this round. */
    attempts: Record<string, number>;
    /** Givers who used every try and have no clue this round. */
    out: string[];
    /** Clues the rules refused, kept for the reveal. */
    refused: Clue[];
    /** Givers who wrote nothing before the clock ran out. */
    silent: string[];
    /** Clues that survived, in seat order, fixed when writing closes. */
    survivors: Clue[];
    /** Groups of clues that cancelled each other, fixed when writing closes. */
    cancelled: Clue[][];
    /** How many survivors the screen is showing so far. */
    shown: number;
    /** The guesser's spoken lines waiting for a ruling. */
    unruled: WaitingLine[];
    guess: string;
    verdict: ClueVerdict | null;
    score: number;
    /** Points won this round. */
    roundPoints: number;
    record: RoundRecord[];
}

/** The pause action's id. */
export const CLUE_GIVE_UP_ACTION: string = "giveup";

/** The ruling that says a spoken line was the guesser's final answer. */
export const CLUE_LOCKED_RULING: string = "locked";

/** Decision ids a rehearsal names when it explains a moment. */
export const CLUE_DECISIONS: { words: string; rounds: string; writing: string; beat: string; guess: string; result: string; retries: string; points: string; giveUp: string } = {
    words: "words",
    rounds: "rounds",
    writing: "writingSeconds",
    beat: "beatSeconds",
    guess: "guessSeconds",
    result: "resultSeconds",
    retries: "clueRetries",
    points: "correctPoints",
    giveUp: "giveUp",
};

/** Seats at the table the kit needs: a guesser and two to write, or no clue could ever cancel. */
export const CLUE_MINIMUM_PLAYERS: number = 3;

/** Longest word a creator may list. */
const WORD_CHARACTER_LIMIT: number = 20;

/** Longest clue a player may type. */
const CLUE_CHARACTER_LIMIT: number = 24;

/** The fewest words a list may have for a game, so rounds never run it dry. */
const WORD_MINIMUM_COUNT: number = 20;

/** Most cancelled groups and refused clues together that the screen names in a result. */
const SHOWN_LINES: number = 4;

/** Seconds between a beat and the moment the guess opens, after the last clue is up. */
const LAST_BEAT_SECONDS: number = 3;

/** The ratings, best first: the share of the best possible score needed, and what the table is called. */
const RATINGS: readonly [number, string][] = [[0.8, "Mind readers"], [0.55, "On the same page"], [0.3, "Getting warm"], [0, "Polite strangers"]];

/** What the host may rule in the guess phase, in the host's brief. Owned by the kit, never by a blueprint. */
const RULING_BRIEFS: Record<string, string> = {
    locked: "the guesser has just committed to one answer, a single word or short phrase they mean as their guess. Write only [[locked]] and nothing else. If they are still thinking aloud, comparing answers or asking for help, rule nothing.",
};

/**
 * Checks a word a creator listed: one or two plain words, short.
 * @param word the word.
 * @returns true when it can be a secret word.
 */
export function isUsableClueWord(word: string): boolean {
    const trimmed: string = word.trim();
    return trimmed.length > 0 && trimmed.length <= WORD_CHARACTER_LIMIT && /^\p{L}[\p{L}'-]*( \p{L}[\p{L}'-]*)?$/u.test(trimmed) === true;
}

/**
 * Checks a clue's shape: one word of at least two letters, with a hyphen or apostrophe allowed inside.
 * @param text what was typed.
 * @returns true when it is one word.
 */
export function isOneWord(text: string): boolean {
    const trimmed: string = text.trim();
    return trimmed.length <= CLUE_CHARACTER_LIMIT && /^\p{L}[\p{L}'’-]+$/u.test(trimmed) === true;
}

/**
 * How many letters two words share at the start.
 * @param first a word.
 * @param second a word.
 * @returns the count.
 */
function sharedPrefix(first: string, second: string): number {
    let at: number = 0;
    while (at < first.length && at < second.length && first[at] === second[at]) {
        at += 1;
    }
    return at;
}

/**
 * Whether a clue is the word or an obvious form of it: the same word, a plural or another ending,
 * a spelling variant, a slip of a letter, the word inside the clue or the clue inside the word,
 * or a long shared start. For a word of two words, either part counts. Clues of fewer than four
 * letters are only refused when they are the word itself.
 * @param clue what was typed.
 * @param word the secret word.
 * @returns true when the clue gives the word away.
 */
export function isFormOfWord(clue: string, word: string): boolean {
    const typed: string = normalize(clue);
    if (typed === "") {
        return false;
    }
    const parts: string[] = [word, ...word.split(/[\s-]+/)].map(normalize).filter((part: string) => part.length >= 3);
    return parts.some((part: string) => {
        if (sameAnswer(typed, part) === true) {
            return true;
        }
        if (typed.length < 4 || part.length < 4) {
            return false;
        }
        const close: number = sharedPrefix(typed, part);
        return typed.includes(part) === true || part.includes(typed) === true || (close >= 5 && close >= Math.min(typed.length, part.length) * 0.6);
    });
}

/**
 * Why the rules refuse a clue, if they do.
 * @param text what was typed.
 * @param word the secret word.
 * @returns "shape" for not one word, "word" for giving the word away, or null when it is fine.
 */
export function clueProblem(text: string, word: string): "shape" | "word" | null {
    if (isOneWord(text) === false) {
        return "shape";
    }
    return isFormOfWord(text, word) === true ? "word" : null;
}

/**
 * Whether a guess, spoken or typed, names the word: any word said in it is the word or a plain
 * variant of it, so "a teapot" and "teapots?" both count.
 * @param guess what the guesser said or typed.
 * @param word the secret word.
 * @returns true when it is right.
 */
export function guessMatches(guess: string, word: string): boolean {
    const target: string = normalize(word);
    if (target === "" || normalize(guess) === "") {
        return false;
    }
    if (sameAnswer(guess, word) === true) {
        return true;
    }
    const spoken: string[] = guess.split(/[^\p{L}\p{N}'’]+/u).filter((token: string) => token !== "");
    const joined: boolean = spoken.some((_token: string, at: number) => [2, 3].some((size: number) => sameAnswer(spoken.slice(at, at + size).join(""), word) === true));
    const wanted: string[] = word.split(/\s+/).filter((token: string) => token !== "");
    return joined === true || wanted.every((part: string) => spoken.some((token: string) => sameAnswer(token, part) === true));
}

/**
 * Checks a clue game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function clueProblems(decisions: ClueDecisions): string[] {
    const problems: string[] = [];
    if (decisions.words.length < WORD_MINIMUM_COUNT || decisions.words.length < decisions.rounds) {
        problems.push(`The word list needs at least ${WORD_MINIMUM_COUNT} words, and more than the rounds.`);
    }
    if (decisions.words.some((word: string) => isUsableClueWord(word) === false) === true) {
        problems.push("Every word must be one or two plain words of letters.");
    }
    if (new Set(decisions.words.map(normalize)).size !== decisions.words.length) {
        problems.push("The word list repeats a word.");
    }
    const timing: [string, number, number, number][] = [
        ["Rounds", decisions.rounds, 1, 12],
        ["Writing time", decisions.writingSeconds, 15, 180],
        ["The pause between clues", decisions.beatSeconds, 1, 10],
        ["Guessing time", decisions.guessSeconds, 10, 120],
        ["The result", decisions.resultSeconds, 5, 60],
        ["Clue retries", decisions.clueRetries, 0, 3],
        ["Points for a right guess", decisions.correctPoints, 1, 10],
        ["The clean bonus", decisions.cleanBonus, 0, 10],
    ];
    for (const [label, value, low, high] of timing) {
        if (isWholeIn(value, low, high) === false) {
            problems.push(`${label} must be a whole number from ${low} to ${high}.`);
        }
    }
    return problems;
}

/**
 * Every problem with a clue blueprint, box included. No word may stand in the box as a word of its
 * own, since the box is shown to everyone.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function clueBlueprintProblems(box: Box, decisions: ClueDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...clueProblems(decisions)];
    if (box.minPlayers < CLUE_MINIMUM_PLAYERS) {
        problems.push("A clue game needs at least three people, or no two clues could ever cancel.");
    }
    const shown: string[] = [box.name, box.pitch, ...box.howToPlay, ...box.remarks, ...box.keywords];
    if (decisions.words.some((word: string) => appearsAsWord(shown, word) === true) === true) {
        problems.push("The box shows one of the secret words.");
    }
    return problems;
}

/**
 * Builds the manifest from the box, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 * @throws when a kit ruling name is reserved, which would be a bug in the kit.
 */
export function clueManifest(box: Box): CartridgeManifest {
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
            `You're running ${box.name}, a team game. Each round one player guesses a secret word and everyone else writes them one-word clues.`,
            "Clues that match each other cancel out and the guesser never sees them. You are never told the word while the guesser is guessing, and you are never told a cancelled clue until the guess is made.",
            "So never guess the word, hint at it or comment on a clue's meaning. The rules, not you, decide which clues cancel, whether the guess is right and the score.",
            "Speak to the whole table as a team that wins together. Dry and warm. Short.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            {
                id: "writing",
                hostBrief: [
                    "You'll be told who is guessing. Say it in two short sentences: the guesser looks away from everyone's phones,",
                    "and everyone else types one word. Warn them that clues which match will cancel out, so they should be clever or unlucky together. Then stop; they are typing in silence.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "reveal",
                hostBrief: [
                    "You'll be given the clues that survived, in order, and how many did not. Build the moment.",
                    "Say how many did not survive, without guessing what they were, then read each surviving clue in turn, slowly, one beat apart, as if turning over cards.",
                    "If none survived, say so with relish. Say only the clues you were given, exactly as written. Then stop; the guess opens by itself.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "guess",
                hostBrief: [
                    "The guesser has one guess, spoken or typed. Invite it in a few words, then stay quiet.",
                    "Only the guesser can talk to you now. Never react to a guess out loud until you are told how it came out.",
                    "If the guesser asks you for help, a hint or whether they are close, say you can't and that it's their one guess.",
                ].join(" "),
                listening: { guesser: "holdToTalk", "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
                hostRulings: { ...RULING_BRIEFS },
            },
            {
                id: "result",
                hostBrief: [
                    "You'll be told the word, the guess, whether it was right and every clue that cancelled or was refused, with who wrote it.",
                    "Say how the guess went in one sentence. Then reveal the cancelled clues, one pair or group at a time, like confessions: name who wrote what and let the coincidence land.",
                    "Be warm about it; they're a team and the joke is on all of them. Refused clues are rule-breaking and get a raised eyebrow, not a lecture.",
                    "Four or five short sentences in all. Say the team's score once. Never invent a clue you weren't told. Then stop; the next round starts by itself.",
                ].join(" "),
                listening: { "*": "holdToTalk" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "end",
                hostBrief: [
                    "You'll be told the final score, the table's rating and each word with what it won. Two or three sentences:",
                    "say the rating, pick out one word that went well or badly, and offer another game. Warm, not salesy.",
                ].join(" "),
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Builds a clue game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with clueBlueprintProblems first.
 * @param random a function returning [0, 1): the first draw picks the first guesser, then one per word.
 * @param merge decides which clues are the same; the local one by default.
 * @returns the game.
 */
export function createClueGame(givenBox: Box, givenDecisions: ClueDecisions, random: () => number = Math.random, merge: DuplicateMerger = mergeDuplicates): KitGame<ClueState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: ClueDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = clueManifest(box);
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const nameOf = (state: ClueState, playerId: string | null): string => state.players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const givers = (state: ClueState): CartridgePlayer[] => state.players.filter((player: CartridgePlayer) => player.playerId !== state.guesserId);
    const settled = (state: ClueState, playerId: string): boolean => state.clues.some((clue: Clue) => clue.playerId === playerId) === true || state.out.includes(playerId) === true;
    const clueControl = (state: ClueState, playerId: string): string => `clue:${state.round}:${state.attempts[playerId] ?? 0}`;
    const guessControl = (state: ClueState): string => `guess:${state.round}`;
    const ofCount = (amount: number, one: string, many: string): string => (amount === 1 ? one : many);

    /**
     * Starts a round: a new word, a new guesser, empty hands.
     * @param before the state the round follows, or a bare start.
     * @param round the round number.
     * @returns the step.
     */
    const startRound = (before: ClueState, round: number): Step<ClueState> => {
        const fresh: string[] = decisions.words.filter((word: string) => before.usedWords.includes(word) === false);
        const word: string = pick(fresh.length > 0 ? fresh : decisions.words, random);
        const guesserId: string = before.players[(before.firstSeat + round - 1) % before.players.length]?.playerId ?? "";
        const state: ClueState = {
            ...before,
            phase: "writing",
            round,
            guesserId,
            word,
            usedWords: [...before.usedWords, word],
            clues: [],
            attempts: {},
            out: [],
            refused: [],
            silent: [],
            survivors: [],
            cancelled: [],
            shown: 0,
            unruled: [],
            guess: "",
            verdict: null,
            roundPoints: 0,
        };
        const text: string = [
            `Round ${round} of ${decisions.rounds}. ${nameOf(state, guesserId)} is guessing and can't see the word; everyone else can.`,
            "Tell them in two short sentences to type one word each, and that matching clues cancel out. You don't know the word.",
        ].join(" ");
        return { state, facts: because(publicFact("round", text), CLUE_DECISIONS.rounds), nextPhaseId: "writing", timers: { writing: decisions.writingSeconds } };
    };

    /**
     * Points a finished round earned, and the new total.
     * @param state the state with its verdict set.
     * @returns the points.
     */
    const pointsFor = (state: ClueState): number => {
        if (state.verdict !== "right") {
            return 0;
        }
        const clean: boolean = state.cancelled.length === 0 && state.refused.length === 0 && state.silent.length === 0 && state.out.length === 0;
        return decisions.correctPoints + (clean === true ? decisions.cleanBonus : 0);
    };

    /**
     * What the host is told once the guess is in: everything that was held back.
     * @param state the state with its verdict set.
     * @returns the text.
     */
    const resultText = (state: ClueState): string => {
        const guesser: string = nameOf(state, state.guesserId);
        const lines: string[] = [`The word was ${state.word}.`];
        const verdicts: Record<ClueVerdict, string> = {
            right: `${guesser} guessed "${state.guess}", which is right.`,
            wrong: `${guesser} guessed "${state.guess}", which is wrong.`,
            timeout: `${guesser} ran out of time without a guess.`,
            passed: "The table passed on this word.",
            voided: "The guesser left, so this round doesn't count.",
        };
        lines.push(verdicts[state.verdict ?? "passed"]);
        for (const group of state.cancelled) {
            lines.push(`${group.map((clue: Clue) => `${nameOf(state, clue.playerId)} wrote "${clue.text}"`).join(" and ")}, so they cancelled each other out.`);
        }
        for (const clue of state.refused) {
            lines.push(`${nameOf(state, clue.playerId)} tried "${clue.text}", which is too close to the word.`);
        }
        for (const playerId of state.silent) {
            lines.push(`${nameOf(state, playerId)} wrote nothing in time.`);
        }
        const total: string = `The team has ${state.score} ${ofCount(state.score, "point", "points")} after ${state.round} of ${decisions.rounds}.`;
        return [...lines, total].join(" ");
    };

    /**
     * Ends the round with the reveal of what was held back.
     * @param state the state.
     * @param verdict how it ended.
     * @param guess what the guesser said or typed, or "".
     * @param decision the decision behind it.
     * @returns the step.
     */
    const finishRound = (state: ClueState, verdict: ClueVerdict, guess: string, decision: string): Step<ClueState> => {
        const judged: ClueState = { ...state, verdict, guess, unruled: [] };
        const roundPoints: number = verdict === "voided" ? 0 : pointsFor(judged);
        const scored: ClueState = { ...judged, phase: "result", roundPoints, score: state.score + roundPoints, record: [...state.record, { word: state.word, points: roundPoints, verdict }] };
        const last: boolean = scored.round >= decisions.rounds;
        const text: string = resultText(scored);
        return { state: scored, facts: because(publicFact("result", text), decision), nextPhaseId: "result", timers: { next: last === true ? decisions.resultSeconds + LAST_BEAT_SECONDS : decisions.resultSeconds } };
    };

    /**
     * Merges the clues written so far: which survive, which cancel, who wrote nothing.
     * @param state the state in writing.
     * @returns the state with survivors, cancelled groups and silent givers set.
     */
    const analyse = (state: ClueState): ClueState => {
        const seat = (playerId: string): number => state.players.findIndex((player: CartridgePlayer) => player.playerId === playerId);
        const ordered: Clue[] = [...state.clues].sort((first: Clue, second: Clue) => seat(first.playerId) - seat(second.playerId));
        const groups: MergedGroup[] = merge(ordered.map((clue: Clue) => ({ playerId: clue.playerId, text: clue.text })));
        const twins: Set<string> = new Set(groups.flatMap((group: MergedGroup) => group.playerIds));
        const silent: string[] = givers(state).map((player: CartridgePlayer) => player.playerId).filter((playerId: string) => settled(state, playerId) === false);
        return {
            ...state,
            survivors: ordered.filter((clue: Clue) => twins.has(clue.playerId) === false),
            cancelled: groups.map((group: MergedGroup) => ordered.filter((clue: Clue) => group.playerIds.includes(clue.playerId) === true)),
            silent,
        };
    };

    /**
     * Closes the writing: merges the clues and starts the reveal.
     * @param state the state in writing.
     * @returns the step.
     */
    const closeWriting = (state: ClueState): Step<ClueState> => {
        const next: ClueState = { ...analyse(state), phase: "reveal", shown: 0 };
        const lost: number = givers(state).length - next.survivors.length;
        const listed: string = next.survivors.length === 0 ? "None survived." : `The survivors, in order: ${next.survivors.map((clue: Clue) => `"${clue.text}"`).join(", ")}.`;
        const text: string = [
            lost === 0 ? "The clues are in and every one survived." : `The clues are in. ${lost} of ${givers(state).length} did not make it, and you don't know which or why; don't guess.`,
            `${listed} Build the moment, then read them to ${nameOf(state, state.guesserId)} one at a time.`,
        ].join(" ");
        return { state: next, facts: because(publicFact("reveal", text), CLUE_DECISIONS.beat), nextPhaseId: "reveal", timers: { beat: decisions.beatSeconds } };
    };

    /**
     * Moves on once every giver is settled.
     * @param state the state in writing.
     * @returns the step.
     */
    const settleWriting = (state: ClueState): Step<ClueState> => {
        return givers(state).every((player: CartridgePlayer) => settled(state, player.playerId) === true) === true ? closeWriting(state) : { state, facts: [] };
    };

    /**
     * Takes a typed clue. A clue the rules refuse costs a try; the phone gets a fresh box.
     * @param state the state in writing.
     * @param playerId who wrote it.
     * @param text what they typed.
     * @returns the step.
     */
    const takeClue = (state: ClueState, playerId: string, text: string): Step<ClueState> => {
        const trimmed: string = text.trim();
        const problem: "shape" | "word" | null = clueProblem(trimmed, state.word);
        if (problem === null) {
            return settleWriting({ ...state, clues: [...state.clues, { playerId, text: trimmed }] });
        }
        const tries: number = (state.attempts[playerId] ?? 0) + 1;
        const refused: Clue[] = problem === "word" ? [...state.refused, { playerId, text: trimmed }] : state.refused;
        const out: string[] = tries > decisions.clueRetries ? [...state.out, playerId] : state.out;
        return settleWriting({ ...state, attempts: { ...state.attempts, [playerId]: tries }, refused, out });
    };

    /**
     * Ends a round early because someone passed or left.
     * @param state the state.
     * @param verdict "passed" or "voided".
     * @param decision the decision behind it.
     * @returns the step.
     */
    const abandon = (state: ClueState, verdict: ClueVerdict, decision: string): Step<ClueState> => {
        // Passing or leaving mid-writing blames nobody for a missing clue, so only the clues in hand are merged.
        return finishRound(state.phase === "writing" ? { ...analyse(state), silent: [] } : state, verdict, "", decision);
    };

    /**
     * The closing text for the host.
     * @param state the state at the end.
     * @param lead a first sentence, or "".
     * @returns the text.
     */
    const endText = (state: ClueState, lead: string): string => {
        const best: number = state.record.length * (decisions.correctPoints + decisions.cleanBonus);
        const rating: string = RATINGS.find(([share]: [number, string]) => best === 0 || state.score / best >= share)?.[1] ?? "Polite strangers";
        const recap: string = state.record.map((round: RoundRecord) => `${round.word} ${round.points === 0 ? "scored nothing" : `scored ${round.points}`}`).join("; ");
        return [lead, `The game is over. Final score ${state.score}, so the table is: ${rating}. Round by round: ${recap || "no rounds finished"}.`, "Say the rating, pick out one word, and offer another game."].filter((part: string) => part !== "").join(" ");
    };

    /**
     * Someone left. The guesser leaving voids the round; a giver leaving takes their clue.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: ClueState, playerId: string): Step<ClueState> => {
        if (state.phase === "end" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return { state, facts: [] };
        }
        const remaining: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => player.playerId !== playerId);
        const seatsLeft: ClueState = { ...state, players: remaining, firstSeat: Math.min(state.firstSeat, Math.max(0, remaining.length - 1)) };
        if (remaining.length < CLUE_MINIMUM_PLAYERS) {
            const ended: ClueState = { ...seatsLeft, phase: "end", unruled: [] };
            return { state: ended, facts: because(publicFact("game-over", endText(ended, "Too few people were left to play.")), CLUE_DECISIONS.rounds), nextPhaseId: "end" };
        }
        if (state.phase === "result") {
            return { state: seatsLeft, facts: [] };
        }
        if (playerId === state.guesserId) {
            return abandon(seatsLeft, "voided", CLUE_DECISIONS.rounds);
        }
        const cleaned: ClueState = { ...seatsLeft, clues: state.clues.filter((clue: Clue) => clue.playerId !== playerId), out: state.out.filter((id: string) => id !== playerId) };
        if (state.phase !== "writing") {
            return { state: cleaned, facts: [] };
        }
        return settleWriting(cleaned);
    };

    /**
     * Moves from a finished round to the next, or to the end.
     * @param state the state in result.
     * @returns the step.
     */
    const afterResult = (state: ClueState): Step<ClueState> => {
        if (state.round < decisions.rounds) {
            return startRound(state, state.round + 1);
        }
        const ended: ClueState = { ...state, phase: "end" };
        return { state: ended, facts: because(publicFact("game-over", endText(ended, "")), CLUE_DECISIONS.rounds), nextPhaseId: "end" };
    };

    /**
     * Takes the guess, however it came, and judges it in code.
     * @param state the state in guess.
     * @param text the guess.
     * @returns the step.
     */
    const takeGuess = (state: ClueState, text: string): Step<ClueState> => {
        return finishRound(state, guessMatches(text, state.word) === true ? "right" : "wrong", text.trim(), CLUE_DECISIONS.points);
    };

    /**
     * What a player may press: the pause menu's give-up, while a round is live.
     * @param state the state.
     * @param playerId the player.
     * @returns the actions.
     */
    function legal(state: ClueState, playerId: string): LegalAction[] {
        if (decisions.giveUpButton === false || state.phase === "result" || state.phase === "end" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return [];
        }
        return [{ actionId: CLUE_GIVE_UP_ACTION, label: "We give up" }];
    }

    const cartridge: Cartridge<ClueState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<ClueState> {
            const bare: ClueState = {
                phase: "writing",
                players,
                firstSeat: Math.floor(random() * Math.max(1, players.length)),
                round: 0,
                guesserId: "",
                word: "",
                usedWords: [],
                clues: [],
                attempts: {},
                out: [],
                refused: [],
                silent: [],
                survivors: [],
                cancelled: [],
                shown: 0,
                unruled: [],
                guess: "",
                verdict: null,
                score: 0,
                roundPoints: 0,
                record: [],
            };
            return startRound(bare, 1);
        },

        phaseOf(state: ClueState): string {
            return state.phase;
        },

        turn(state: ClueState): Turn | null {
            if (state.phase === "writing") {
                return { kind: "everyone", playerIds: givers(state).map((player: CartridgePlayer) => player.playerId), doneIds: givers(state).map((player: CartridgePlayer) => player.playerId).filter((id: string) => settled(state, id) === true), label: "Type your clue" };
            }
            if (state.phase === "reveal" || state.phase === "guess") {
                return { kind: "one", playerId: state.guesserId, label: "Guesser" };
            }
            return null;
        },

        roleOf(state: ClueState, playerId: string): string {
            return playerId === state.guesserId && state.phase !== "end" ? "guesser" : "giver";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions: legal,

        apply(state: ClueState, playerId: string, actionId: string): Step<ClueState> {
            if (actionId !== CLUE_GIVE_UP_ACTION || legal(state, playerId).length === 0) {
                return { state, facts: [] };
            }
            return abandon(state, "passed", CLUE_DECISIONS.giveUp);
        },

        onEvent(state: ClueState, event: RoomEvent): Step<ClueState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "answered" && typeof event.value === "string") {
                if (state.phase === "writing" && event.playerId !== state.guesserId && settled(state, event.playerId) === false && event.controlId === clueControl(state, event.playerId)) {
                    return takeClue(state, event.playerId, event.value);
                }
                if (state.phase === "guess" && event.playerId === state.guesserId && event.controlId === guessControl(state) && event.value.trim() !== "") {
                    return takeGuess(state, event.value);
                }
                return { state, facts: [] };
            }
            if (event.type === "timerFired" && event.timerId === "writing" && state.phase === "writing") {
                return closeWriting(state);
            }
            if (event.type === "timerFired" && event.timerId === "beat" && state.phase === "reveal") {
                if (state.shown < state.survivors.length) {
                    const shown: number = state.shown + 1;
                    const wait: number = shown === state.survivors.length ? decisions.beatSeconds + LAST_BEAT_SECONDS : decisions.beatSeconds;
                    return { state: { ...state, shown }, facts: [], timers: { beat: wait } };
                }
                const text: string = `The guess is open. Invite ${nameOf(state, state.guesserId)}'s one guess in a few words, then stay quiet.`;
                return { state: { ...state, phase: "guess" }, facts: because(publicFact("guess", text), CLUE_DECISIONS.guess), nextPhaseId: "guess", timers: { guess: decisions.guessSeconds } };
            }
            if (event.type === "timerFired" && event.timerId === "guess" && state.phase === "guess") {
                return finishRound(state, "timeout", "", CLUE_DECISIONS.guess);
            }
            if (event.type === "timerFired" && event.timerId === "next" && state.phase === "result") {
                return afterResult(state);
            }
            if (event.type === "speechEnded" && state.phase === "guess" && event.playerId === state.guesserId) {
                return { state: { ...state, unruled: waitForRuling(state.unruled, event.playerId, event.text) }, facts: [] };
            }
            if (event.type === "hostRuled" && state.phase === "guess" && event.ruling === CLUE_LOCKED_RULING) {
                const taken: { line: WaitingLine | undefined } = takeRuledLine(state.unruled, state.guesserId);
                return taken.line === undefined ? { state, facts: [] } : takeGuess(state, taken.line.text);
            }
            return { state, facts: [] };
        },

        publicScene(state: ClueState): Scene {
            const guesser: string = nameOf(state, state.guesserId);
            const kicker: string = `Round ${state.round} of ${decisions.rounds}`;
            if (state.phase === "writing") {
                const total: number = givers(state).length;
                return {
                    mood: "neutral",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: "One word each", kicker: `${kicker}. ${guesser} is guessing` },
                        { type: "text", text: "Clue givers, the word is on your phone. Matching clues cancel out.", emphasis: "large" },
                        { type: "progress", label: "Clues in", current: givers(state).filter((player: CartridgePlayer) => settled(state, player.playerId) === true).length, max: total, marks: "card" },
                        { type: "timer", seconds: decisions.writingSeconds, label: "to write", running: true },
                    ],
                };
            }
            if (state.phase === "reveal" || state.phase === "guess") {
                const lost: number = givers(state).length - state.survivors.length;
                const shown: Clue[] = state.phase === "guess" ? state.survivors : state.survivors.slice(0, state.shown);
                const blocks: SceneBlock[] = [{ type: "title", text: state.phase === "guess" ? "One guess" : "The clues that survived", kicker: `${kicker}. ${guesser} is guessing` }];
                if (shown.length > 0) {
                    blocks.push({ type: "text", text: shown.map((clue: Clue) => clue.text).join(", "), emphasis: "large" });
                }
                if (state.phase === "reveal" && state.survivors.length === 0 && state.shown === 0) {
                    blocks.push({ type: "text", text: "Nothing survived.", emphasis: "large" });
                }
                if (state.phase === "guess" || state.shown >= state.survivors.length) {
                    blocks.push({ type: "text", text: lost === 0 ? "Every clue survived." : `${lost} ${ofCount(lost, "clue", "clues")} did not make it.`, emphasis: "whisper" });
                }
                if (state.phase === "guess") {
                    blocks.push({ type: "timer", seconds: decisions.guessSeconds, label: "to guess", running: true });
                }
                return { mood: state.phase === "guess" ? "tense" : "dawn", transition: "fade", blocks };
            }
            if (state.phase === "result") {
                const verdictKicker: Record<ClueVerdict, string> = { right: "Right", wrong: "Not this time", timeout: "Out of time", passed: "Passed", voided: "Round void" };
                const blocks: SceneBlock[] = [{ type: "title", text: state.word, kicker: verdictKicker[state.verdict ?? "passed"] }];
                if (state.guess !== "") {
                    blocks.push({ type: "text", text: `${guesser} said ${state.guess}.`, emphasis: "large" });
                }
                const told: SceneBlock[] = [
                    ...state.cancelled.map((group: Clue[]): SceneBlock => ({
                        type: "text",
                        text: `${group.map((clue: Clue) => nameOf(state, clue.playerId)).join(" and ")} both wrote ${group[0]?.text ?? ""}.`,
                    })),
                    ...state.refused.map((clue: Clue): SceneBlock => ({ type: "text", text: `${nameOf(state, clue.playerId)} tried ${clue.text}. Too close.`, emphasis: "whisper" })),
                ];
                blocks.push(...told.slice(0, SHOWN_LINES));
                if (told.length > SHOWN_LINES) {
                    blocks.push({ type: "text", text: `And ${told.length - SHOWN_LINES} more.`, emphasis: "whisper" });
                }
                if (state.roundPoints > 0) {
                    blocks.push({ type: "text", text: `${state.roundPoints} ${ofCount(state.roundPoints, "point", "points")} for the team.`, emphasis: "large" });
                }
                blocks.push({ type: "tally", title: "Team score", rows: [{ label: `After round ${state.round}`, count: state.score, highlight: state.roundPoints > 0 }] });
                return { mood: state.verdict === "right" ? "victory" : "defeat", transition: "fade", blocks };
            }
            const best: number = state.record.length * (decisions.correctPoints + decisions.cleanBonus);
            const rating: string = RATINGS.find(([share]: [number, string]) => best === 0 || state.score / best >= share)?.[1] ?? "Polite strangers";
            const rows: TallyRow[] = state.record.map((round: RoundRecord): TallyRow => ({ label: round.word, count: round.points, highlight: round.points > 0 }));
            return {
                mood: "victory",
                transition: "fade",
                blocks: [{ type: "title", text: `${state.score} ${ofCount(state.score, "point", "points")}`, kicker: rating }, { type: "tally", title: "Round by round", rows }],
            };
        },

        privateControls(state: ClueState, playerId: string): Control[] {
            if (state.phase === "result") {
                return [{ type: "waiting", text: "Look at the screen." }];
            }
            if (state.phase === "end") {
                return [{ type: "waiting", text: "That's the game." }];
            }
            if (state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
                return [{ type: "waiting", text: "Look at the screen." }];
            }
            if (playerId === state.guesserId) {
                const card: Control = { type: "roleCard", title: "You're guessing", body: "Everyone else can see the word. Wait for their clues.", secret: false };
                if (state.phase !== "guess") {
                    return [card, { type: "waiting", text: state.phase === "writing" ? "Look away from their phones." : "Watch the screen." }];
                }
                return [{ type: "textInput", id: guessControl(state), prompt: "Your one guess. Type it, or hold and say it.", placeholder: "your guess", maxLength: CLUE_CHARACTER_LIMIT }];
            }
            const word: Control = { type: "roleCard", title: "The word", body: state.word, secret: false };
            if (state.phase !== "writing") {
                return [word, { type: "waiting", text: state.phase === "guess" ? "Quiet. Let them guess." : "Watch the screen." }];
            }
            if (state.out.includes(playerId) === true) {
                return [word, { type: "waiting", text: "No clue from you this round." }];
            }
            if (settled(state, playerId) === true) {
                return [word, { type: "waiting", text: "Your clue is in." }];
            }
            const retried: boolean = (state.attempts[playerId] ?? 0) > 0;
            const tooClose: boolean = state.refused.some((clue: Clue) => clue.playerId === playerId) === true;
            const field: Control = { type: "textInput", id: clueControl(state, playerId), prompt: "One word. Make it count.", placeholder: "one word", maxLength: CLUE_CHARACTER_LIMIT };
            if (retried === false) {
                return [word, field];
            }
            return [word, { ...field, note: tooClose === true ? "That's too close to the word. Try another." : "One word, please. Try again." }];
        },

        hostFacts(state: ClueState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase === "end") {
                return [];
            }
            const facts: ScopedFact[] = [publicFact("score", `The team has ${state.score} ${ofCount(state.score, "point", "points")}. It is round ${state.round} of ${decisions.rounds}, and ${nameOf(state, state.guesserId)} is guessing.`)];
            if (state.phase === "result") {
                facts.push(publicFact("word", `The word was ${state.word}.`));
            }
            if (state.phase === "reveal" || state.phase === "guess") {
                facts.push(publicFact("survivors", state.survivors.length === 0 ? "No clue survived." : `The surviving clues are: ${state.survivors.map((clue: Clue) => clue.text).join(", ")}.`));
            }
            return facts;
        },

        outcome(state: ClueState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            return `The team scored ${state.score} ${ofCount(state.score, "point", "points")}.`;
        },
    };

    return {
        cartridge,
        hidden(state: ClueState): HiddenValue[] {
            if (state.phase === "result" || state.phase === "end") {
                return [];
            }
            const seeing: string[] = givers(state).map((player: CartridgePlayer) => player.playerId);
            const word: HiddenValue = { label: "the word", text: state.word, seenBy: seeing };
            const held: HiddenValue[] = [...state.cancelled.flat(), ...state.refused].map((clue: Clue): HiddenValue => ({ label: "a cancelled or refused clue", text: clue.text, seenBy: seeing }));
            return [word, ...held];
        },
    };
}
