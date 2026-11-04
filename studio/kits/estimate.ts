// The estimate kit: a numeric question, every player types a guess on their phone, the guesses are
// shown low to high without the answer, and everyone bets on whose guess is closest. Then the answer
// comes out. The answer, the distances, the bets and the points are all code; the host never knows
// the answer before the reveal, so it cannot hint, and it only reads the question, reads the guesses
// back, and narrates who was closest and who read the room. Off by a Mile is this kit.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow as SceneTallyRow } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Turn } from "../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { boxProblems, isShortText, isWholeIn, type Box, type HiddenValue, type KitGame } from "../kit/kit.ts";
import { because, frozenCopy } from "../kit/primitives.ts";

/** One numeric question, with where its answer comes from. */
export interface EstimateQuestion {
    /** Letters only; names the question in a report. */
    id: string;
    /** The question, ending in a question mark. */
    prompt: string;
    /** What the number counts, such as "metres". */
    unit: string;
    /** The true answer. Never shown or told to the host before the reveal. */
    answer: number;
    /** The least and most a guess may be, and the grid between them. */
    min: number;
    max: number;
    step: number;
    /** Where the number comes from, named well enough to check. */
    source: string;
    /** One more true thing about it, for the host to add at the reveal. */
    aside: string;
}

/** Everything a creator may choose for an estimate game. */
export interface EstimateDecisions {
    questions: EstimateQuestion[];
    /** How many questions a game asks, drawn from the bank without repeats. */
    rounds: number;
    /** Seconds to type a guess. */
    guessSeconds: number;
    /** Seconds to place a bet. */
    betSeconds: number;
    /** Seconds the answer stays up before the next question. */
    revealSeconds: number;
    /** True when the pause menu offers "We give up", which ends the game with the scores so far. */
    giveUpButton: boolean;
    /** Points for the closest guess, for backing it, and the extra for backing it when few did. */
    points: { closest: number; backer: number; bold: number };
}

/** The phases of the kit. */
export type EstimatePhase = "guess" | "bet" | "reveal" | "end";

/** How a game ended. */
export type EstimateResult = "played" | "stopped";

/** What one revealed round came to. */
export interface RoundResult {
    /** The closest guessers, more than one on a tie; empty when the round was void. */
    closest: string[];
    /** Each guesser's distance from the answer. */
    off: Record<string, number>;
    /** Who backed a closest guess. */
    backers: string[];
    /** Backers of a closest guess that few others backed. */
    bold: string[];
    /** Points each player won this round. */
    gains: Record<string, number>;
}

/** The whole game, immutable between steps. */
export interface EstimateState {
    phase: EstimatePhase;
    /** Everyone who started, so names survive people leaving. */
    everyone: CartridgePlayer[];
    /** Everyone still at the table, in seat order. */
    players: CartridgePlayer[];
    /** Indexes into the question bank, one per round. */
    order: number[];
    /** The round being played, from zero. */
    round: number;
    guesses: Record<string, number>;
    bets: Record<string, string>;
    scores: Record<string, number>;
    last: RoundResult | null;
    result: EstimateResult | null;
}

/** The pause action's id. */
export const ESTIMATE_GIVE_UP_ACTION: string = "giveup";

/** The prefix on a bet's option id. */
export const BET_PREFIX: string = "bet:";

/** The id of the number input for a round. Each round has its own, because a control is answered once. */
export function guessControlId(round: number): string {
    return `guess-${round}`;
}

/** Decision ids a rehearsal names when it explains a moment. */
export const ESTIMATE_DECISIONS: { questions: string; rounds: string; guess: string; bet: string; reveal: string; points: string; giveUp: string } = {
    questions: "questions",
    rounds: "rounds",
    guess: "guessSeconds",
    bet: "betSeconds",
    reveal: "revealSeconds",
    points: "points",
    giveUp: "giveUp",
};

/** How a question is numbered in words, so no digit on the screen can be mistaken for a guess. */
const ORDINALS: readonly string[] = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];

/** Longest source or aside. */
const LINE_LIMIT: number = 200;

/** The characters a source or aside may use. */
const LINE_PATTERN: RegExp = /^[\p{L}\p{N} '’,.;:?%()/–-]+$/u;

/**
 * Writes a number for people: thousands separated, no more than three decimals.
 * @param value the number.
 * @returns the text.
 */
export function formatNumber(value: number): string {
    return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/**
 * Works out who was closest, who backed them, and what everyone won. The only place a round is scored.
 * @param guesses each guesser's number.
 * @param bets each bettor's pick.
 * @param answer the true answer.
 * @param points what each thing is worth.
 * @returns the result.
 */
export function scoreRound(guesses: Readonly<Record<string, number>>, bets: Readonly<Record<string, string>>, answer: number, points: EstimateDecisions["points"]): RoundResult {
    const guessers: string[] = Object.keys(guesses);
    const off: Record<string, number> = Object.fromEntries(guessers.map((playerId: string) => [playerId, Math.abs((guesses[playerId] ?? 0) - answer)]));
    if (guessers.length < 2) {
        return { closest: [], off, backers: [], bold: [], gains: {} };
    }
    const nearest: number = Math.min(...Object.values(off));
    const closest: string[] = guessers.filter((playerId: string) => Math.abs((off[playerId] ?? 0) - nearest) < 1e-9);
    const gains: Record<string, number> = {};
    for (const playerId of closest) {
        gains[playerId] = (gains[playerId] ?? 0) + points.closest;
    }
    const bettors: string[] = Object.keys(bets);
    const backers: string[] = bettors.filter((bettor: string) => closest.includes(bets[bettor] ?? "") === true);
    const bold: string[] = backers.filter((bettor: string) => bettors.filter((other: string) => bets[other] === bets[bettor]).length * 3 < bettors.length);
    for (const bettor of backers) {
        gains[bettor] = (gains[bettor] ?? 0) + points.backer + (bold.includes(bettor) === true ? points.bold : 0);
    }
    return { closest, off, backers, bold, gains };
}

/**
 * Checks one question.
 * @param question the question.
 * @returns the problems, in plain words.
 */
function questionProblems(question: EstimateQuestion): string[] {
    const problems: string[] = [];
    const named: string = `Question ${question.id}`;
    if (/^[a-zA-Z]+$/.test(question.id) === false) {
        problems.push("A question's id must be letters only.");
    }
    if (question.prompt.length > 140 || question.prompt.endsWith("?") === false || /[[\]{}<>]/.test(question.prompt) === true) {
        problems.push(`${named} must be a question of at most 140 characters, with no brackets.`);
    }
    if (isShortText(question.unit) === false) {
        problems.push(`${named} needs a short unit.`);
    }
    if ([question.answer, question.min, question.max, question.step].every((value: number) => Number.isFinite(value)) === false || question.step <= 0) {
        problems.push(`${named} needs finite numbers and a step above zero.`);
        return problems;
    }
    if (question.answer <= question.min || question.answer >= question.max) {
        problems.push(`${named}: the answer must sit inside the range a guess may be.`);
    }
    if ((question.max - question.min) / question.step > 5_000_000 || Number.isInteger((question.max - question.min) / question.step) === false) {
        problems.push(`${named}: the range must be a whole number of steps, and at most five million.`);
    }
    for (const [field, text] of [["source", question.source], ["aside", question.aside]] as const) {
        if (text.trim().length < 8 || text.length > LINE_LIMIT || LINE_PATTERN.test(text) === false) {
            problems.push(`${named}: the ${field} must be a plain line of 8 to ${LINE_LIMIT} characters.`);
        }
    }
    return problems;
}

/**
 * Checks an estimate game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function estimateProblems(decisions: EstimateDecisions): string[] {
    const problems: string[] = decisions.questions.flatMap(questionProblems);
    if (new Set(decisions.questions.map((question: EstimateQuestion) => question.id)).size !== decisions.questions.length) {
        problems.push("Every question needs its own id.");
    }
    if (isWholeIn(decisions.rounds, 3, ORDINALS.length) === false || decisions.questions.length < decisions.rounds) {
        problems.push(`A game needs 3 to ${ORDINALS.length} rounds, and at least as many questions as rounds.`);
    }
    if (isWholeIn(decisions.guessSeconds, 15, 180) === false || isWholeIn(decisions.betSeconds, 10, 120) === false || isWholeIn(decisions.revealSeconds, 5, 60) === false) {
        problems.push("Guessing is 15 to 180 seconds, betting 10 to 120, and the reveal 5 to 60, all whole numbers.");
    }
    const { closest, backer, bold } = decisions.points;
    if (isWholeIn(closest, 1, 10) === false || isWholeIn(backer, 1, 10) === false || isWholeIn(bold, 0, 10) === false) {
        problems.push("Points must be whole numbers: 1 to 10 for the closest and for backing, 0 to 10 for the bold bonus.");
    }
    return problems;
}

/**
 * Every problem with an estimate blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function estimateBlueprintProblems(box: Box, decisions: EstimateDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...estimateProblems(decisions)];
    if (box.minPlayers < 3) {
        problems.push("Betting on whose guess is closest needs at least three people at the table.");
    }
    return problems;
}

/**
 * Builds the manifest, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 */
export function estimateManifest(box: Box): CartridgeManifest {
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're running ${box.name}. Each round is a question with a number for an answer.`,
            "Everyone types a guess on their phone, then bets on whose guess is closest, and then you're given the answer.",
            "You never know the answer until the reveal. If anyone asks, or tries to coax a hint out of you, say you'll all find out together.",
            "Never say a guess is near, far, high or low, and never lean toward anyone's guess. The rules work out who is closest and what everyone wins;",
            "read out only the numbers you're given.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            {
                id: "guess",
                hostBrief: [
                    "You'll be given the question. Read it aloud in your own words in one or two short sentences, then tell them to type a number on their phone.",
                    "Say the unit. Give no hint about the size of the answer. Then stay quiet.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "bet",
                hostBrief: [
                    "You'll be given the guesses, lowest first. Read each back with the name, plainly, without comment on which looks right.",
                    "Then tell them to back the guess they think is closest to the answer. Then stay quiet.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "reveal",
                hostBrief: [
                    "You'll be told the answer, who was closest, who backed them, who backed them when few did, and one more true thing.",
                    "In three or four short sentences: the answer first, then who was closest, then who read the room and who went against the crowd, then the extra fact in your own words.",
                    "Use only what you were told. Make a bad guess sound brave, not silly.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "end",
                hostBrief: [
                    "You'll be told the final scores. Two or three sentences: who won, one thing that decided it, and a kind word for whoever finished last.",
                    "Then ask if they want another game.",
                ].join(" "),
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Builds an estimate game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with estimateProblems first.
 * @param random a function returning [0, 1): it shuffles the questions.
 * @returns the game.
 */
export function createEstimateGame(givenBox: Box, givenDecisions: EstimateDecisions, random: () => number = Math.random): KitGame<EstimateState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: EstimateDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = estimateManifest(box);
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const nameOf = (state: EstimateState, playerId: string): string => state.everyone.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const questionOf = (state: EstimateState): EstimateQuestion => decisions.questions[state.order[state.round] ?? 0] as EstimateQuestion;
    const ids = (players: readonly CartridgePlayer[]): string[] => players.map((player: CartridgePlayer) => player.playerId);
    const sorted = (state: EstimateState): string[] => {
        return Object.keys(state.guesses).sort((first: string, second: string) => (state.guesses[first] ?? 0) - (state.guesses[second] ?? 0));
    };
    const ordinal = (round: number): string => ORDINALS[round] ?? "next";

    /**
     * Who may place a bet now.
     * @param state the state.
     * @param playerId the player.
     * @returns true when they may.
     */
    const mayBet = (state: EstimateState, playerId: string): boolean => state.phase === "bet" && ids(state.players).includes(playerId) === true && state.bets[playerId] === undefined;

    /**
     * Opens a round.
     * @param state the state, with the round already set.
     * @param decision the decision behind it.
     * @returns the step.
     */
    const ask = (state: EstimateState, decision: string): Step<EstimateState> => {
        const question: EstimateQuestion = questionOf(state);
        const next: EstimateState = { ...state, phase: "guess", guesses: {}, bets: {}, last: null };
        const text: string = [
            `This is the ${ordinal(state.round)} question. Read it aloud in your own words: "${question.prompt}"`,
            `The answer is in ${question.unit}. Then tell them to type a number on their phone.`,
        ].join(" ");
        return { state: next, facts: because(publicFact("question", text), decision), nextPhaseId: "guess", timers: { guess: decisions.guessSeconds } };
    };

    /**
     * Ends the game with the standings.
     * @param state the state.
     * @param result how it ended.
     * @param decision the decision behind it.
     * @returns the step.
     */
    const finish = (state: EstimateState, result: EstimateResult, decision: string): Step<EstimateState> => {
        const ended: EstimateState = { ...state, phase: "end", result };
        const standings: string = ranking(ended).map((playerId: string) => `${nameOf(ended, playerId)} ${ended.scores[playerId] ?? 0}`).join(", ");
        const text: string = `${result === "stopped" ? "They stopped early." : "That was the last question."} Final scores, best first: ${standings}. Give the result, then ask if they want another game.`;
        return { state: ended, facts: because(publicFact("game-over", text), decision), nextPhaseId: "end" };
    };

    /**
     * The players at the table, best score first, ties in seat order.
     * @param state the state.
     * @returns their ids.
     */
    const ranking = (state: EstimateState): string[] => {
        const seated: string[] = ids(state.players);
        return seated.sort((first: string, second: string) => (state.scores[second] ?? 0) - (state.scores[first] ?? 0));
    };

    /**
     * Opens the betting, with the guesses now public.
     * @param state the state with at least two guesses.
     * @returns the step.
     */
    const openBets = (state: EstimateState): Step<EstimateState> => {
        const question: EstimateQuestion = questionOf(state);
        const lines: string = sorted(state).map((playerId: string) => `${nameOf(state, playerId)} says ${formatNumber(state.guesses[playerId] ?? 0)}`).join("; ");
        const text: string = `The guesses are in, lowest first, in ${question.unit}: ${lines}. Read them back, then tell them to back the guess they think is closest.`;
        return { state: { ...state, phase: "bet" }, facts: because(publicFact("guesses", text), ESTIMATE_DECISIONS.guess), nextPhaseId: "bet", timers: { bet: decisions.betSeconds } };
    };

    /**
     * Shows the answer and scores the round.
     * @param state the state in the betting, or in the guessing with too few guesses.
     * @returns the step.
     */
    const reveal = (state: EstimateState): Step<EstimateState> => {
        const question: EstimateQuestion = questionOf(state);
        const result: RoundResult = scoreRound(state.guesses, state.bets, question.answer, decisions.points);
        const scores: Record<string, number> = { ...state.scores };
        for (const [playerId, gain] of Object.entries(result.gains)) {
            scores[playerId] = (scores[playerId] ?? 0) + gain;
        }
        const next: EstimateState = { ...state, phase: "reveal", scores, last: result };
        const names = (list: string[]): string => (list.length === 0 ? "nobody" : list.map((playerId: string) => nameOf(state, playerId)).join(" and "));
        const text: string = result.closest.length === 0
            ? [
                `The answer was ${formatNumber(question.answer)} ${question.unit}. Too few guesses came in to score, so nobody wins points.`,
                `Tell them the answer, then this: ${question.aside}`,
            ].join(" ")
            : [
                `The answer was ${formatNumber(question.answer)} ${question.unit}.`,
                `Closest: ${names(result.closest)}, off by ${formatNumber(result.off[result.closest[0] ?? ""] ?? 0)}.`,
                `Backed a closest guess: ${names(result.backers)}.`,
                result.bold.length === 0 ? "" : `Went against the crowd and was right: ${names(result.bold)}.`,
                `One more true thing: ${question.aside}`,
            ].filter((line: string) => line !== "").join(" ");
        return { state: next, facts: because(publicFact("answer", text), ESTIMATE_DECISIONS.points), nextPhaseId: "reveal", timers: { reveal: decisions.revealSeconds } };
    };

    /**
     * Whether everyone at the table has done a thing.
     * @param state the state.
     * @param done who has.
     * @returns true when all have.
     */
    const everyoneHas = (state: EstimateState, done: Readonly<Record<string, unknown>>): boolean => {
        return state.players.length > 0 && state.players.every((player: CartridgePlayer) => done[player.playerId] !== undefined);
    };

    /**
     * Moves from guessing to betting, or voids the round if too few guessed.
     * @param state the state in the guessing.
     * @returns the step.
     */
    const closeGuessing = (state: EstimateState): Step<EstimateState> => (Object.keys(state.guesses).length >= 2 ? openBets(state) : reveal(state));

    /**
     * Someone left.
     * @param state the state.
     * @param playerId who.
     * @returns the step.
     */
    const left = (state: EstimateState, playerId: string): Step<EstimateState> => {
        if (state.phase === "end" || ids(state.players).includes(playerId) === false) {
            return { state, facts: [] };
        }
        const players: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => player.playerId !== playerId);
        const { [playerId]: _guess, ...guesses } = state.guesses;
        const { [playerId]: _bet, ...bets } = state.bets;
        const kept: Record<string, string> = Object.fromEntries(Object.entries(bets).filter(([, target]: [string, string]) => target !== playerId));
        const next: EstimateState = { ...state, players, guesses: state.phase === "guess" || state.phase === "bet" ? guesses : state.guesses, bets: state.phase === "bet" ? kept : state.bets };
        if (players.length === 0) {
            return finish(next, "stopped", ESTIMATE_DECISIONS.giveUp);
        }
        if (next.phase === "guess" && everyoneHas(next, next.guesses) === true) {
            return closeGuessing(next);
        }
        if (next.phase === "bet" && Object.keys(next.guesses).length < 2) {
            return reveal(next);
        }
        if (next.phase === "bet" && everyoneHas(next, next.bets) === true) {
            return reveal(next);
        }
        return { state: next, facts: [] };
    };

    const cartridge: Cartridge<EstimateState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<EstimateState> {
            const shuffled: number[] = decisions.questions.map((_question: EstimateQuestion, index: number) => index);
            for (let index = shuffled.length - 1; index > 0; index -= 1) {
                const swap: number = Math.floor(random() * (index + 1));
                [shuffled[index], shuffled[swap]] = [shuffled[swap] as number, shuffled[index] as number];
            }
            const state: EstimateState = {
                phase: "guess",
                everyone: players,
                players,
                order: shuffled.slice(0, decisions.rounds),
                round: 0,
                guesses: {},
                bets: {},
                scores: Object.fromEntries(players.map((player: CartridgePlayer) => [player.playerId, 0])),
                last: null,
                result: null,
            };
            return ask(state, ESTIMATE_DECISIONS.rounds);
        },

        phaseOf(state: EstimateState): string {
            return state.phase;
        },

        turn(state: EstimateState): Turn | null {
            if (state.phase === "guess") {
                return { kind: "everyone", playerIds: ids(state.players), doneIds: Object.keys(state.guesses), label: "Type a guess on your phone" };
            }
            if (state.phase === "bet") {
                return { kind: "everyone", playerIds: ids(state.players), doneIds: Object.keys(state.bets), label: "Back the closest guess" };
            }
            return null;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: EstimateState, playerId: string): LegalAction[] {
            const actions: LegalAction[] = [];
            if (state.phase === "bet" && mayBet(state, playerId) === true) {
                actions.push(...sorted(state).map((target: string) => ({ actionId: `${BET_PREFIX}${target}`, label: nameOf(state, target) })));
            }
            if ((state.phase === "guess" || state.phase === "bet") && decisions.giveUpButton === true) {
                actions.push({ actionId: ESTIMATE_GIVE_UP_ACTION, label: "We give up" });
            }
            return actions;
        },

        apply(state: EstimateState, playerId: string, actionId: string): Step<EstimateState> {
            if ((state.phase === "guess" || state.phase === "bet") && decisions.giveUpButton === true && actionId === ESTIMATE_GIVE_UP_ACTION) {
                return finish(state, "stopped", ESTIMATE_DECISIONS.giveUp);
            }
            if (mayBet(state, playerId) === false || actionId.startsWith(BET_PREFIX) === false) {
                return { state, facts: [] };
            }
            const target: string = actionId.slice(BET_PREFIX.length);
            if (state.guesses[target] === undefined) {
                return { state, facts: [] };
            }
            const next: EstimateState = { ...state, bets: { ...state.bets, [playerId]: target } };
            return everyoneHas(next, next.bets) === true ? reveal(next) : { state: next, facts: [] };
        },

        onEvent(state: EstimateState, event: RoomEvent): Step<EstimateState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "answered" && state.phase === "guess" && event.controlId === guessControlId(state.round)) {
                const question: EstimateQuestion = questionOf(state);
                const seated: boolean = ids(state.players).includes(event.playerId) === true;
                if (seated === false || state.guesses[event.playerId] !== undefined || typeof event.value !== "number" || Number.isFinite(event.value) === false) {
                    return { state, facts: [] };
                }
                if (event.value < question.min || event.value > question.max) {
                    return { state, facts: [] };
                }
                const next: EstimateState = { ...state, guesses: { ...state.guesses, [event.playerId]: event.value } };
                return everyoneHas(next, next.guesses) === true ? closeGuessing(next) : { state: next, facts: [] };
            }
            if (event.type === "timerFired" && event.timerId === "guess" && state.phase === "guess") {
                return closeGuessing(state);
            }
            if (event.type === "timerFired" && event.timerId === "bet" && state.phase === "bet") {
                return reveal(state);
            }
            if (event.type === "timerFired" && event.timerId === "reveal" && state.phase === "reveal") {
                return state.round + 1 >= state.order.length ? finish(state, "played", ESTIMATE_DECISIONS.rounds) : ask({ ...state, round: state.round + 1 }, ESTIMATE_DECISIONS.rounds);
            }
            return { state, facts: [] };
        },

        publicScene(state: EstimateState): Scene {
            const question: EstimateQuestion = questionOf(state);
            const kicker: string = `The ${ordinal(state.round)} question`;
            const standings: SceneTallyRow[] = ranking(state).map((playerId: string): SceneTallyRow => ({ label: nameOf(state, playerId), count: state.scores[playerId] ?? 0 }));
            if (state.phase === "guess") {
                const blocks: SceneBlock[] = [
                    { type: "title", text: box.name, kicker },
                    { type: "text", text: question.prompt, emphasis: "large" },
                    { type: "timer", seconds: decisions.guessSeconds, label: "to guess", running: true },
                ];
                return { mood: "neutral", transition: "fade", blocks };
            }
            if (state.phase === "bet") {
                const rows: SceneTallyRow[] = sorted(state).map((playerId: string): SceneTallyRow => ({ label: nameOf(state, playerId), count: state.guesses[playerId] ?? 0 }));
                return {
                    mood: "tense",
                    transition: "fade",
                    blocks: [
                        { type: "text", text: "Whose guess is closest?", emphasis: "large" },
                        { type: "text", text: question.prompt },
                        { type: "tally", title: `Guesses in ${question.unit}, lowest first`, rows },
                        { type: "timer", seconds: decisions.betSeconds, label: "to bet", running: true },
                    ],
                };
            }
            if (state.phase === "reveal") {
                const last: RoundResult | null = state.last;
                const names = (list: string[]): string => list.map((playerId: string) => nameOf(state, playerId)).join(", ");
                const closeBy: string = last === null || last.closest.length === 0 ? "" : `Closest: ${names(last.closest)}, off by ${formatNumber(last.off[last.closest[0] ?? ""] ?? 0)}.`;
                const backed: string = last === null || last.closest.length === 0
                    ? "Too few guesses to score this one."
                    : last.backers.length === 0 ? `${closeBy} Nobody backed it.` : `${closeBy} Backed it: ${names(last.backers)}.`;
                const blocks: SceneBlock[] = [
                    { type: "title", text: `${formatNumber(question.answer)} ${question.unit}`, kicker: "The answer" },
                    { type: "text", text: backed, emphasis: "large" },
                    { type: "text", text: question.aside },
                    { type: "tally", title: "Scores", rows: standings },
                ];
                return { mood: "victory", transition: "fade", blocks };
            }
            const top: number = standings[0]?.count ?? 0;
            return {
                mood: "victory",
                transition: "fade",
                blocks: [
                    { type: "title", text: "Final scores", kicker: box.name },
                    { type: "tally", title: "Best first", rows: standings.map((row: SceneTallyRow): SceneTallyRow => ({ ...row, highlight: row.count === top && top > 0 })) },
                ],
            };
        },

        privateControls(state: EstimateState, playerId: string): Control[] {
            const seated: boolean = ids(state.players).includes(playerId) === true;
            if (state.phase === "guess") {
                const question: EstimateQuestion = questionOf(state);
                if (seated === false || state.guesses[playerId] !== undefined) {
                    return [{ type: "waiting", text: "Your guess is in. Waiting for the others." }];
                }
                return [{
                    type: "numberInput",
                    id: guessControlId(state.round),
                    prompt: question.prompt,
                    min: question.min,
                    max: question.max,
                    step: question.step,
                    note: `In ${question.unit}. Nobody sees it yet.`,
                }];
            }
            if (state.phase === "bet") {
                if (mayBet(state, playerId) === false) {
                    const backed: string | undefined = state.bets[playerId];
                    return [{ type: "waiting", text: backed === undefined ? "Watching the bets." : `You backed ${nameOf(state, backed)}. Waiting for the others.` }];
                }
                const options: ControlOption[] = sorted(state).map((target: string): ControlOption => ({
                    id: `${BET_PREFIX}${target}`,
                    label: `${nameOf(state, target)}: ${formatNumber(state.guesses[target] ?? 0)}`,
                }));
                return [{ type: "choice", prompt: "Whose guess is closest?", options, multiple: false }];
            }
            const gain: number = state.last?.gains[playerId] ?? 0;
            const score: number = state.scores[playerId] ?? 0;
            if (state.phase === "reveal") {
                return [{ type: "waiting", text: gain > 0 ? `You won ${gain} ${gain === 1 ? "point" : "points"}. That's ${score} now.` : `No points that time. You're on ${score}.` }];
            }
            return [{ type: "waiting", text: `You finished on ${score}. Look at the screen.` }];
        },

        hostFacts(state: EstimateState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase === "end") {
                return [];
            }
            const question: EstimateQuestion = questionOf(state);
            const asked: ScopedFact = { scope: { kind: "public" }, kind: "question", text: `The ${ordinal(state.round)} question is: "${question.prompt}" The answer is in ${question.unit}.` };
            if (state.phase === "reveal") {
                const answer: ScopedFact = { scope: { kind: "host" }, kind: "answer", text: `The answer is ${formatNumber(question.answer)} ${question.unit}. Source: ${question.source}.` };
                return [asked, answer];
            }
            return [asked, { scope: { kind: "host" }, kind: "unknown", text: "You do not know the answer yet. Don't guess it, hint at it or react to anyone's guess." }];
        },

        outcome(state: EstimateState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            const top: number = Math.max(0, ...Object.values(state.scores));
            const winners: string[] = ranking(state).filter((playerId: string) => (state.scores[playerId] ?? 0) === top).map((playerId: string) => nameOf(state, playerId));
            return top === 0 ? "Nobody scored." : `${winners.join(" and ")} won with ${top}.`;
        },
    };

    return {
        cartridge,
        hidden(state: EstimateState): HiddenValue[] {
            if (state.phase === "reveal" || state.phase === "end") {
                return [];
            }
            const question: EstimateQuestion = questionOf(state);
            // A guess that happens to equal the answer is on the screen on purpose, and says nothing.
            const equalled: boolean = Object.values(state.guesses).some((guess: number) => Math.abs(guess - question.answer) < 1e-9);
            const answer: HiddenValue[] = equalled === true ? [] : [{ label: "the answer", text: formatNumber(question.answer), seenBy: [] }];
            if (state.phase === "bet") {
                return answer;
            }
            const guesses: HiddenValue[] = Object.entries(state.guesses).map(([playerId, guess]: [string, number]): HiddenValue => ({ label: "a player's guess", text: formatNumber(guess), seenBy: [playerId] }));
            return [...answer, ...guesses];
        },
    };
}
