// The charades kit: one player at a time gets a private prompt on their phone and acts it out in
// silence while a clock runs on the TV; everyone else shouts guesses at their phones. Code hears each
// guess as text and rules it against the answer and its listed synonyms, so the host never holds the
// answer and cannot be talked into a ruling. Points go to the guesser and the performer, the
// performer rotates, and the host only commentates what the rules tell it. Pantomime Panic is this kit.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow as SceneTallyRow } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Turn } from "../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { boxProblems, isShortText, isWholeIn, type Box, type HiddenValue, type KitGame } from "../kit/kit.ts";
import { type GuessRuling, keyStems, ruleGuess } from "../kit/matching.ts";
import { because, frozenCopy, pick } from "../kit/primitives.ts";

/** How hard a prompt is to act out. */
export type Level = "easy" | "medium" | "hard";

/** What sort of thing a prompt is. */
export type PromptKind = "title" | "action" | "character";

/** Every level, easiest first. */
export const LEVELS: readonly Level[] = ["easy", "medium", "hard"];

/** Every kind of prompt. */
export const PROMPT_KINDS: readonly PromptKind[] = ["title", "action", "character"];

/** One thing to act out, and the other ways of saying it that count. */
export interface Prompt {
    kind: PromptKind;
    level: Level;
    answer: string;
    /** Other ways to say the answer that are accepted just the same. */
    also: string[];
}

/** What one level is worth and how long it gets. */
export interface LevelDecision {
    label: string;
    /** Points each to the guesser and the performer for a guess. */
    points: number;
    /** Seconds on the clock. */
    seconds: number;
}

/** Everything a creator may choose for a charades game. */
export interface CharadesDecisions {
    prompts: Prompt[];
    levels: Record<Level, LevelDecision>;
    /** How many turns each player gets as the performer. */
    turnsEach: number;
    /** Seconds the performer has to choose how hard; the middle level is chosen for them after. */
    pickSeconds: number;
    /** Seconds the performer has to read the prompt before the clock starts by itself. */
    readySeconds: number;
    /** Seconds the answer stays on the TV before the next turn. */
    revealSeconds: number;
    /** Extra points each, when the guess comes before the clock is half gone. */
    fastBonus: number;
    /** Points to the performer when nobody guesses, for the effort. */
    tryPoints: number;
    /** Whether the pause menu offers ending the game early. */
    giveUpButton: boolean;
}

/** The phases of the kit. */
export type CharadesPhase = "pick" | "ready" | "acting" | "reveal" | "end";

/** How one turn ended. */
export type TurnEnding = "guessed" | "timeUp" | "left";

/** How the whole game ended. */
export type CharadesResult = "finished" | "gaveUp" | "tooFew";

/** One guess the room made. */
export interface GuessLine {
    playerId: string;
    text: string;
    close: boolean;
}

/** What happened in one turn, kept for the reveal and the closing words. */
export interface TurnRecord {
    performerId: string;
    performerName: string;
    guesserId: string | null;
    guesserName: string;
    answer: string;
    level: Level;
    ending: TurnEnding;
    fast: boolean;
    /** Points each to the guesser and the performer; for a turn nobody guessed, the performer's alone. */
    points: number;
}

/** The whole game, immutable between steps. */
export interface CharadesState {
    phase: CharadesPhase;
    /** Everyone still at the table, in seat order. */
    players: CartridgePlayer[];
    /** Every name by id, kept for those who leave. */
    names: Record<string, string>;
    performerId: string;
    /** The performers still to come after the current one. */
    upcoming: string[];
    turnsDone: number;
    level: Level | null;
    /** Position in the decisions' prompts of the one being acted, from ready until the reveal ends. */
    promptIndex: number | null;
    swapped: boolean;
    /** Positions of every prompt used so far, so none comes twice while others are left. */
    used: number[];
    /** True once the clock is half gone. */
    late: boolean;
    guesses: GuessLine[];
    /** How many close calls the host has been told about this turn. */
    closeCalls: number;
    /** Guesses since the host was last told of a close one. */
    sinceCloseCall: number;
    scores: Record<string, number>;
    /** The latest finished turn, shown in the reveal. */
    latest: TurnRecord | null;
    history: TurnRecord[];
    result: CharadesResult | null;
}

/** The pause action's id. */
export const CHARADES_GIVE_UP_ACTION: string = "giveup";

/** The prefix on a level button's id. */
export const LEVEL_PREFIX: string = "level:";

/** The id of the button that starts the clock. */
export const GO_ACTION: string = "go";

/** The id of the button that swaps the prompt for another of the same level. */
export const SWAP_ACTION: string = "swap";

/** Decision ids a rehearsal names when it explains a moment. */
export const CHARADES_DECISIONS: Record<"prompts" | "levels" | "turns" | "pick" | "ready" | "reveal" | "bonus" | "tryPoints" | "giveUp", string> = {
    prompts: "prompts",
    levels: "levels",
    turns: "turnsEach",
    pick: "pickSeconds",
    ready: "readySeconds",
    reveal: "revealSeconds",
    bonus: "fastBonus",
    tryPoints: "tryPoints",
    giveUp: "giveUpButton",
};

/** Guesses the TV keeps showing. */
const SHOWN_GUESSES: number = 3;

/** Guesses kept in memory for a turn. */
const KEPT_GUESSES: number = 24;

/** Longest guess shown on the TV, in characters. */
const SHOWN_GUESS_CHARACTERS: number = 60;

/** Close calls the host hears about in one turn. */
const CLOSE_CALLS_PER_TURN: number = 2;

/** Guesses that must pass before the host hears of another close one. */
const GUESSES_BETWEEN_CLOSE_CALLS: number = 2;

/** Seconds left at which the host nudges the room. */
const HURRY_SECONDS_LEFT: number = 10;

/** The fewest seconds a clock may have, so every warning falls inside it. */
const SHORTEST_CLOCK: number = 30;

/** The longest clock. */
const LONGEST_CLOCK: number = 180;

/** Fewest prompts each level needs. */
const LEAST_PROMPTS_PER_LEVEL: number = 8;

/** How each kind of prompt is named to the room. */
const KIND_LABELS: Record<PromptKind, string> = { title: "Movie title", action: "Action", character: "Character" };

/** How each kind of prompt is named inside a sentence. */
const KIND_PHRASES: Record<PromptKind, string> = { title: "a movie-style title", action: "an action", character: "a character" };

/**
 * How many words a prompt has, which the room is told.
 * @param answer the answer.
 * @returns the count.
 */
export function wordCountOf(answer: string): number {
    return answer.trim().split(/\s+/).length;
}

/**
 * Checks a charades game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function charadesProblems(decisions: CharadesDecisions): string[] {
    const problems: string[] = [];
    const seen: Set<string> = new Set();
    for (const prompt of decisions.prompts) {
        const forms: string[] = [prompt.answer, ...prompt.also];
        if (PROMPT_KINDS.includes(prompt.kind) === false || LEVELS.includes(prompt.level) === false) {
            problems.push(`A prompt has a kind or level that doesn't exist: "${prompt.answer}".`);
        }
        if (forms.some((form: string) => isShortText(form) === false || keyStems(form).length === 0) === true) {
            problems.push(`"${prompt.answer}" or one of its other ways to say it is empty, too long or has no key word.`);
        }
        const key: string = prompt.answer.toLowerCase().trim();
        if (seen.has(key) === true) {
            problems.push(`"${prompt.answer}" is in the list twice.`);
        }
        seen.add(key);
    }
    for (const level of LEVELS) {
        const decision: LevelDecision = decisions.levels[level];
        if (decisions.prompts.filter((prompt: Prompt) => prompt.level === level).length < LEAST_PROMPTS_PER_LEVEL) {
            problems.push(`Level ${level} needs at least ${LEAST_PROMPTS_PER_LEVEL} prompts.`);
        }
        if (isShortText(decision.label) === false) {
            problems.push(`Level ${level} needs a short label.`);
        }
        if (isWholeIn(decision.points, 1, 9) === false) {
            problems.push(`Level ${level} must be worth a whole number of points from 1 to 9.`);
        }
        if (isWholeIn(decision.seconds, SHORTEST_CLOCK, LONGEST_CLOCK) === false) {
            problems.push(`Level ${level} must have a clock of ${SHORTEST_CLOCK} to ${LONGEST_CLOCK} whole seconds.`);
        }
    }
    if (isWholeIn(decisions.turnsEach, 1, 2) === false) {
        problems.push("Turns each must be 1 or 2.");
    }
    if (isWholeIn(decisions.pickSeconds, 5, 30) === false || isWholeIn(decisions.readySeconds, 5, 30) === false || isWholeIn(decisions.revealSeconds, 4, 20) === false) {
        problems.push("Choosing and reading must last 5 to 30 whole seconds, and the reveal 4 to 20.");
    }
    if (isWholeIn(decisions.fastBonus, 0, 3) === false || isWholeIn(decisions.tryPoints, 0, 3) === false) {
        problems.push("The quick bonus and the points for trying must be whole numbers from 0 to 3.");
    }
    return problems;
}

/**
 * Every problem with a charades blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function charadesBlueprintProblems(box: Box, decisions: CharadesDecisions): string[] {
    const hidden: string[] = decisions.prompts.flatMap((prompt: Prompt) => [prompt.answer, ...prompt.also]);
    const problems: string[] = [...boxProblems(box, hidden), ...charadesProblems(decisions)];
    if (box.minPlayers < 2) {
        problems.push("Charades needs at least two people at the table: one to act and one to guess.");
    }
    if (decisions.prompts.length < box.maxPlayers * decisions.turnsEach) {
        problems.push("There are fewer prompts than turns in the biggest game.");
    }
    return problems;
}

/**
 * Builds the manifest from the box and decisions, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 */
export function charadesManifest(box: Box): CartridgeManifest {
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're running ${box.name}. One player at a time acts out a secret prompt in silence while everyone else shouts guesses.`,
            "You do not know the prompt and you are never told it until the turn is over.",
            "You never judge a guess yourself. The game hears every guess and rules it in code, and you are told what happened in a (Game: ...) note.",
            "Never say whether a guess is right, never guess the prompt, and never hint at it. You commentate the chaos: short, warm, a little dry, on the players' side.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            {
                id: "pick",
                hostBrief: [
                    "A turn is starting. In one short line say who is up, as you're told, and that they're choosing how hard.",
                    "If this is the first turn, first explain in two short sentences: one person acts silently, everyone else shouts guesses at their phone, and the quicker the guess the more points both get.",
                    "Then stop. In this spirit, never word for word: 'One of you acts it out, no talking. The rest shout. Quicker guess, more points, for both of you.' then 'Up first: Spoon. Choose how hard.'",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "ready",
                hostBrief: [
                    "The performer is reading their prompt. Say only what you're told, in one short line: what kind of prompt it is and how many words, and that the room should get their voices ready.",
                    "In this spirit, never word for word: 'A movie title, four words. Warm up your voices.' Reply exactly (quiet) to anything else.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "acting",
                hostBrief: [
                    "The clock is running. Guesses reach you as 'Name: what they said'. You do not rule on them.",
                    "Reply exactly (quiet) to every guess unless a (Game: ...) note told you something.",
                    "When told, react in six words or fewer, in fresh words each time: a close guess gets a cheer for the guesser without saying what was close, ten seconds left gets a nudge, the start gets a go.",
                    "In this spirit, never word for word: 'Go on, then.' 'Nearly there.' 'That was warm.' 'Ten seconds.' 'Clock's nearly gone.'",
                    "Never repeat what a guesser said back as if it might be right.",
                ].join(" "),
                listening: { performer: "muted", "*": "holdToTalk" },
                hostMayInterject: false,
                hostMostlyQuiet: true,
                silenceSeconds: 0,
            },
            {
                id: "reveal",
                hostBrief: [
                    "The turn is over and you've been told the answer. In one or two short sentences say what it was and who got it, and tease the performer or the guessers.",
                    "Be kind: a turn nobody got is still a good show. Don't say whose turn is next; that follows by itself.",
                    "In this spirit, never word for word: 'The Lighthouse Keeper's Secret. Spoon had it fast, and Teacup earned every point of that.' or 'Nobody got it. It was Sneezing. Brave effort.'",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "end",
                hostBrief: [
                    "The game is over. In two or three sentences name the winner or winners, mention the best moment you were told, and tease whoever scored least, kindly. Then ask if they want another game.",
                    "In this spirit, never word for word: 'Saucer takes it, with Teacup right behind. Spoon got the quickest guess of the night. Another go?'",
                ].join(" "),
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Builds a charades game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with charadesBlueprintProblems first.
 * @param random a function returning [0, 1): the first draw picks who goes first, the rest choose prompts.
 * @returns the game.
 */
export function createCharadesGame(givenBox: Box, givenDecisions: CharadesDecisions, random: () => number = Math.random): KitGame<CharadesState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: CharadesDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = charadesManifest(box);
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const nameOf = (state: CharadesState, playerId: string | null): string => (playerId === null ? "Someone" : state.names[playerId] ?? "Someone");
    const pointsWord = (amount: number): string => (amount === 1 ? "point" : "points");
    const promptOf = (state: CharadesState): Prompt | null => (state.promptIndex === null ? null : decisions.prompts[state.promptIndex] ?? null);
    const inTurn = (state: CharadesState): boolean => state.phase === "pick" || state.phase === "ready" || state.phase === "acting";
    const turnsTotal = (state: CharadesState): number => state.turnsDone + state.upcoming.length + (inTurn(state) === true ? 1 : 0);

    /**
     * Everyone at the table, highest score first, ties in seat order.
     * @param state the state.
     * @returns the players.
     */
    const byScore = (state: CharadesState): CartridgePlayer[] => {
        return [...state.players].sort((first: CartridgePlayer, second: CartridgePlayer) => (state.scores[second.playerId] ?? 0) - (state.scores[first.playerId] ?? 0));
    };

    /**
     * The scores as one sentence for the host, best first.
     * @param state the state.
     * @returns the sentence.
     */
    const scoreLine = (state: CharadesState): string => {
        const rows: string[] = byScore(state).map((player: CartridgePlayer) => `${player.name} ${state.scores[player.playerId] ?? 0}`);
        return `Scores: ${rows.join(", ")}.`;
    };

    /**
     * Chooses a prompt of a level, one not used yet when there is one.
     * @param state the state.
     * @param level the level.
     * @returns its position in the prompts.
     */
    const choosePrompt = (state: CharadesState, level: Level): number => {
        const all: number[] = decisions.prompts.map((_prompt: Prompt, index: number) => index).filter((index: number) => decisions.prompts[index]?.level === level);
        const fresh: number[] = all.filter((index: number) => state.used.includes(index) === false && index !== state.promptIndex);
        return pick(fresh.length > 0 ? fresh : all, random);
    };

    /**
     * Ends the game with the scores.
     * @param state the state.
     * @param result how it ended.
     * @param decision the decision behind it.
     * @returns the step.
     */
    const finishGame = (state: CharadesState, result: CharadesResult, decision: string): Step<CharadesState> => {
        const ended: CharadesState = { ...state, phase: "end", result, promptIndex: null };
        const ranked: CartridgePlayer[] = byScore(state);
        const top: number = state.scores[ranked[0]?.playerId ?? ""] ?? 0;
        const leaders: string[] = ranked.filter((player: CartridgePlayer) => (state.scores[player.playerId] ?? 0) === top).map((player: CartridgePlayer) => player.name);
        const quickest: TurnRecord | undefined = state.history.find((record: TurnRecord) => record.ending === "guessed" && record.fast === true);
        const unsolved: number = state.history.filter((record: TurnRecord) => record.ending === "timeUp").length;
        const why: string = result === "gaveUp" ? "They stopped early." : result === "tooFew" ? "Too few people were left to keep going." : "Everyone has had their turn.";
        const text: string = [
            `${why} ${scoreLine(state)} ${top === 0 ? "Nobody scored, which is its own achievement." : `${leaders.join(" and ")} ${leaders.length > 1 ? "lead" : "leads"} with ${top}.`}`,
            quickest === undefined ? "" : `A quick one to mention: ${quickest.guesserName} got "${quickest.answer}" for ${quickest.performerName} before the clock was half gone.`,
            unsolved === 0 ? "" : `${unsolved} ${unsolved === 1 ? "turn" : "turns"} went unguessed.`,
            "Wrap up now.",
        ].filter((part: string) => part !== "").join(" ");
        return { state: ended, facts: because(publicFact("game-over", text), decision), nextPhaseId: "end" };
    };

    /**
     * Starts the next turn, or ends the game when everyone has had theirs.
     * @param state the state, with its latest turn recorded.
     * @returns the step.
     */
    const advance = (state: CharadesState): Step<CharadesState> => {
        const next: string | undefined = state.upcoming[0];
        if (next === undefined) {
            return finishGame(state, "finished", CHARADES_DECISIONS.turns);
        }
        const started: CharadesState = {
            ...state,
            phase: "pick",
            performerId: next,
            upcoming: state.upcoming.slice(1),
            level: null,
            promptIndex: null,
            swapped: false,
            late: false,
            guesses: [],
            closeCalls: 0,
            sinceCloseCall: GUESSES_BETWEEN_CLOSE_CALLS,
        };
        const text: string = `Turn ${started.turnsDone + 1} of ${turnsTotal(started)}: ${nameOf(started, next)} is up and is choosing how hard. Say so in a few words.`;
        return { state: started, facts: because(publicFact("turn", text), CHARADES_DECISIONS.turns), nextPhaseId: "pick", timers: { pick: decisions.pickSeconds } };
    };

    /**
     * Ends a turn: scores it, shows the answer, and starts the reveal clock.
     * @param state the state.
     * @param ending how it ended.
     * @param guesserId who guessed it, for a guess.
     * @returns the step.
     */
    const endTurn = (state: CharadesState, ending: TurnEnding, guesserId: string | null): Step<CharadesState> => {
        const prompt: Prompt | null = promptOf(state);
        const level: Level = state.level ?? "medium";
        if (prompt === null) {
            return advance({ ...state, turnsDone: state.turnsDone + 1 });
        }
        const fast: boolean = ending === "guessed" && state.late === false;
        const worth: number = ending === "guessed" ? decisions.levels[level].points + (fast === true ? decisions.fastBonus : 0) : ending === "timeUp" ? decisions.tryPoints : 0;
        const scores: Record<string, number> = { ...state.scores };
        scores[state.performerId] = (scores[state.performerId] ?? 0) + worth;
        if (guesserId !== null) {
            scores[guesserId] = (scores[guesserId] ?? 0) + worth;
        }
        const record: TurnRecord = {
            performerId: state.performerId,
            performerName: nameOf(state, state.performerId),
            guesserId,
            guesserName: nameOf(state, guesserId),
            answer: prompt.answer,
            level,
            ending,
            fast,
            points: worth,
        };
        const next: CharadesState = { ...state, phase: "reveal", scores, latest: record, history: [...state.history, record], turnsDone: state.turnsDone + 1, guesses: [] };
        const board: string = scoreLine(next);
        const texts: Record<TurnEnding, string> = {
            guessed: `${record.guesserName} guessed it: the answer was "${record.answer}", which ${record.performerName} was acting${fast === true ? ", and it came quickly" : ""}. Both get ${worth} ${pointsWord(worth)}. ${board} Say it in a line or two.`,
            timeUp: [
                `Time's up and nobody got it. The answer was "${record.answer}", which ${record.performerName} was acting.`,
                `${record.performerName} gets ${worth} ${pointsWord(worth)} for trying. Say it kindly in a line or two.`,
            ].join(" "),
            left: `${record.performerName} left in the middle of their turn. The answer was "${record.answer}". Say so in a few words and carry on.`,
        };
        return { state: next, facts: because(publicFact("reveal", texts[ending]), CHARADES_DECISIONS.reveal), nextPhaseId: "reveal", timers: { reveal: decisions.revealSeconds } };
    };

    /**
     * Gives the performer a prompt of the level they chose, and lets them read it.
     * @param state the state in the pick phase.
     * @param level the level.
     * @returns the step.
     */
    const chooseLevel = (state: CharadesState, level: Level): Step<CharadesState> => {
        const index: number = choosePrompt(state, level);
        const prompt: Prompt | undefined = decisions.prompts[index];
        const next: CharadesState = { ...state, phase: "ready", level, promptIndex: index, used: [...state.used, index] };
        const words: number = wordCountOf(prompt?.answer ?? "");
        const text: string = `${nameOf(state, state.performerId)} chose ${decisions.levels[level].label.toLowerCase()} and is reading ${KIND_PHRASES[prompt?.kind ?? "title"]} of ${words} ${words === 1 ? "word" : "words"}. Tell the room that, and to get their voices ready.`;
        return { state: next, facts: because(publicFact("ready", text), CHARADES_DECISIONS.levels), nextPhaseId: "ready", timers: { ready: decisions.readySeconds } };
    };

    /**
     * Starts the clock.
     * @param state the state in the ready phase.
     * @returns the step.
     */
    const startActing = (state: CharadesState): Step<CharadesState> => {
        const seconds: number = decisions.levels[state.level ?? "medium"].seconds;
        const text: string = `The clock is running, ${seconds} seconds, and ${nameOf(state, state.performerId)} is acting. Send them off in a few words.`;
        const timers: Record<string, number> = { acting: seconds, half: Math.floor(seconds / 2), hurry: seconds - HURRY_SECONDS_LEFT };
        return { state: { ...state, phase: "acting", late: false, guesses: [], closeCalls: 0, sinceCloseCall: GUESSES_BETWEEN_CLOSE_CALLS }, facts: because(publicFact("go", text), CHARADES_DECISIONS.ready), nextPhaseId: "acting", timers };
    };

    /**
     * Hears one guess: rules it in code, and ends the turn on a match.
     * @param state the state in the acting phase.
     * @param playerId who spoke.
     * @param text what they said.
     * @returns the step.
     */
    const hear = (state: CharadesState, playerId: string, text: string): Step<CharadesState> => {
        const prompt: Prompt | null = promptOf(state);
        const heard: string = text.trim();
        if (prompt === null || heard === "" || playerId === state.performerId || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return { state, facts: [] };
        }
        const ruling: GuessRuling = ruleGuess(heard, prompt.answer, prompt.also);
        if (ruling === "match") {
            return endTurn(state, "guessed", playerId);
        }
        const line: GuessLine = { playerId, text: heard, close: ruling === "close" };
        const guesses: GuessLine[] = [...state.guesses, line].slice(-KEPT_GUESSES);
        const mayCheer: boolean = ruling === "close" && state.closeCalls < CLOSE_CALLS_PER_TURN && state.sinceCloseCall >= GUESSES_BETWEEN_CLOSE_CALLS;
        if (mayCheer === false) {
            return { state: { ...state, guesses, sinceCloseCall: state.sinceCloseCall + 1 }, facts: [] };
        }
        const cheer: string = [
            `${nameOf(state, playerId)} was close, but it isn't right.`,
            "Cheer them on in six words or fewer, without saying what was close or what the answer might be.",
        ].join(" ");
        return { state: { ...state, guesses, closeCalls: state.closeCalls + 1, sinceCloseCall: 0 }, facts: because(publicFact("close", cheer), CHARADES_DECISIONS.prompts) };
    };

    /**
     * Someone left the table.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: CharadesState, playerId: string): Step<CharadesState> => {
        if (state.phase === "end" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return { state, facts: [] };
        }
        const remaining: CharadesState = {
            ...state,
            players: state.players.filter((player: CartridgePlayer) => player.playerId !== playerId),
            upcoming: state.upcoming.filter((upcomingId: string) => upcomingId !== playerId),
            guesses: state.guesses.filter((guess: GuessLine) => guess.playerId !== playerId),
        };
        if (remaining.players.length < 2) {
            return finishGame(remaining, "tooFew", CHARADES_DECISIONS.turns);
        }
        if (playerId !== state.performerId || inTurn(state) === false) {
            return { state: remaining, facts: [] };
        }
        return endTurn(remaining, "left", null);
    };

    const cartridge: Cartridge<CharadesState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<CharadesState> {
            const start: number = Math.floor(random() * Math.max(1, players.length));
            const order: string[] = players.map((_player: CartridgePlayer, index: number) => players[(start + index) % players.length]?.playerId ?? "");
            const turns: string[] = Array.from({ length: decisions.turnsEach }, () => order).flat();
            const first: string = turns[0] ?? "";
            const names: Record<string, string> = Object.fromEntries(players.map((player: CartridgePlayer) => [player.playerId, player.name]));
            const state: CharadesState = {
                phase: "pick",
                players,
                names,
                performerId: first,
                upcoming: turns.slice(1),
                turnsDone: 0,
                level: null,
                promptIndex: null,
                swapped: false,
                used: [],
                late: false,
                guesses: [],
                closeCalls: 0,
                sinceCloseCall: GUESSES_BETWEEN_CLOSE_CALLS,
                scores: Object.fromEntries(players.map((player: CartridgePlayer) => [player.playerId, 0])),
                latest: null,
                history: [],
                result: null,
            };
            const text: string = [
                "The game has begun. Explain it in two short sentences: one person acts out a secret prompt in silence,",
                "everyone else shouts guesses at their phone, and the quicker the guess the more points both get.",
                `Then say that ${nameOf(state, first)} is up first and is choosing how hard. There are ${turns.length} turns.`,
            ].join(" ");
            return { state, facts: because(publicFact("opening", text), CHARADES_DECISIONS.turns), nextPhaseId: "pick", timers: { pick: decisions.pickSeconds } };
        },

        phaseOf(state: CharadesState): string {
            return state.phase;
        },

        turn(state: CharadesState): Turn | null {
            const labels: Partial<Record<CharadesPhase, string>> = { pick: "Choosing:", ready: "Reading:", acting: "Acting:" };
            const label: string | undefined = labels[state.phase];
            if (label !== undefined) {
                return { kind: "one", playerId: state.performerId, label };
            }
            return state.phase === "reveal" ? { kind: "anyone", label: "Here is the answer" } : null;
        },

        roleOf(state: CharadesState, playerId: string): string {
            return inTurn(state) === true && playerId === state.performerId ? "performer" : "guesser";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: CharadesState, playerId: string): LegalAction[] {
            if (state.phase === "end") {
                return [];
            }
            const giveUp: LegalAction[] = decisions.giveUpButton === true ? [{ actionId: CHARADES_GIVE_UP_ACTION, label: "We give up" }] : [];
            if (playerId !== state.performerId) {
                return giveUp;
            }
            if (state.phase === "pick") {
                return [...LEVELS.map((level: Level) => ({ actionId: `${LEVEL_PREFIX}${level}`, label: decisions.levels[level].label })), ...giveUp];
            }
            if (state.phase === "ready") {
                return [{ actionId: GO_ACTION, label: "Start acting" }, ...(state.swapped === false ? [{ actionId: SWAP_ACTION, label: "Swap it" }] : []), ...giveUp];
            }
            return giveUp;
        },

        apply(state: CharadesState, playerId: string, actionId: string): Step<CharadesState> {
            if (state.phase === "end") {
                return { state, facts: [] };
            }
            if (actionId === CHARADES_GIVE_UP_ACTION) {
                return decisions.giveUpButton === true ? finishGame(state, "gaveUp", CHARADES_DECISIONS.giveUp) : { state, facts: [] };
            }
            if (playerId !== state.performerId) {
                return { state, facts: [] };
            }
            if (state.phase === "pick" && actionId.startsWith(LEVEL_PREFIX) === true) {
                const level: string = actionId.slice(LEVEL_PREFIX.length);
                return LEVELS.some((candidate: Level) => candidate === level) === true ? chooseLevel(state, level as Level) : { state, facts: [] };
            }
            if (state.phase === "ready" && actionId === GO_ACTION) {
                return startActing(state);
            }
            if (state.phase === "ready" && actionId === SWAP_ACTION && state.swapped === false && state.level !== null) {
                const index: number = choosePrompt(state, state.level);
                return { state: { ...state, swapped: true, promptIndex: index, used: [...state.used, index] }, facts: [] };
            }
            return { state, facts: [] };
        },

        onEvent(state: CharadesState, event: RoomEvent): Step<CharadesState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "speechEnded" && state.phase === "acting") {
                return hear(state, event.playerId, event.text);
            }
            if (event.type !== "timerFired") {
                return { state, facts: [] };
            }
            if (event.timerId === "pick" && state.phase === "pick") {
                return chooseLevel(state, "medium");
            }
            if (event.timerId === "ready" && state.phase === "ready") {
                return startActing(state);
            }
            if (event.timerId === "half" && state.phase === "acting") {
                return { state: { ...state, late: true }, facts: [] };
            }
            if (event.timerId === "hurry" && state.phase === "acting") {
                return { state, facts: because(publicFact("hurry", `${HURRY_SECONDS_LEFT} seconds left. Nudge the room in a few words, without hinting at the answer.`), CHARADES_DECISIONS.levels) };
            }
            if (event.timerId === "acting" && state.phase === "acting") {
                return endTurn(state, "timeUp", null);
            }
            if (event.timerId === "reveal" && state.phase === "reveal") {
                return advance(state);
            }
            return { state, facts: [] };
        },

        publicScene(state: CharadesState): Scene {
            const performer: string = nameOf(state, state.performerId);
            const prompt: Prompt | null = promptOf(state);
            const words: number = wordCountOf(prompt?.answer ?? "");
            const hint: string = prompt === null ? "" : `${KIND_LABELS[prompt.kind]} · ${words} ${words === 1 ? "word" : "words"}`;
            const turns: SceneBlock = { type: "progress", label: "Turns", current: state.turnsDone, max: Math.max(1, turnsTotal(state)), marks: "card" };
            if (state.phase === "pick") {
                return {
                    mood: "neutral",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: `${performer} is up`, kicker: `Turn ${state.turnsDone + 1} of ${turnsTotal(state)}` },
                        { type: "text", text: "Choosing how hard", emphasis: "large" },
                        { type: "timer", seconds: decisions.pickSeconds, label: "to choose", running: true },
                        turns,
                    ],
                };
            }
            if (state.phase === "ready") {
                return {
                    mood: "neutral",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: `${performer} is reading`, kicker: hint },
                        { type: "text", text: "Get your voices ready", emphasis: "large" },
                        { type: "timer", seconds: decisions.readySeconds, label: "until the clock starts", running: true },
                        turns,
                    ],
                };
            }
            if (state.phase === "acting") {
                const level: LevelDecision = decisions.levels[state.level ?? "medium"];
                const recent: SceneBlock[] = state.guesses.slice(-SHOWN_GUESSES).map((guess: GuessLine): SceneBlock => {
                    const said: string = guess.text.length > SHOWN_GUESS_CHARACTERS ? `${guess.text.slice(0, SHOWN_GUESS_CHARACTERS)}…` : guess.text;
                    return { type: "text", text: `${nameOf(state, guess.playerId)}: ${said}${guess.close === true ? " (close)" : ""}` };
                });
                return {
                    mood: "tense",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: `${performer} is acting`, kicker: `${hint} · ${level.label}` },
                        { type: "timer", seconds: level.seconds, label: "to guess it", running: true },
                        ...recent,
                        turns,
                    ],
                };
            }
            const rows: SceneTallyRow[] = byScore(state).map((player: CartridgePlayer): SceneTallyRow => ({ label: player.name, count: state.scores[player.playerId] ?? 0 }));
            if (state.phase === "reveal" && state.latest !== null) {
                const record: TurnRecord = state.latest;
                const kickers: Record<TurnEnding, string> = { guessed: `${record.guesserName} got it`, timeUp: "Time's up. It was", left: `${record.performerName} left. It was` };
                const lines: Record<TurnEnding, string> = {
                    guessed: `${record.guesserName} and ${record.performerName} get ${record.points} ${pointsWord(record.points)} each.`,
                    timeUp: record.points > 0 ? `${record.performerName} gets ${record.points} ${pointsWord(record.points)} for the effort.` : "Nobody gets a point for that one.",
                    left: "No points for that turn.",
                };
                return {
                    mood: record.ending === "guessed" ? "victory" : "dawn",
                    transition: "fade",
                    blocks: [{ type: "title", text: record.answer, kicker: kickers[record.ending] }, { type: "text", text: lines[record.ending], emphasis: "large" }, { type: "tally", title: "Scores", rows }],
                };
            }
            const top: number = rows[0]?.count ?? 0;
            const leaders: string[] = rows.filter((row: SceneTallyRow) => row.count === top).map((row: SceneTallyRow) => row.label);
            const headline: string = top === 0 ? "Nobody scored. Everybody acted." : leaders.length > 1 ? `${leaders.join(" and ")} share the top` : `${leaders[0] ?? "Someone"} takes it`;
            const rowsMarked: SceneTallyRow[] = rows.map((row: SceneTallyRow): SceneTallyRow => ({ ...row, highlight: top > 0 && row.count === top }));
            return {
                mood: "victory",
                transition: "fade",
                blocks: [{ type: "title", text: headline, kicker: state.result === "gaveUp" ? "Stopped early" : "Final scores" }, { type: "tally", title: "Scores", rows: rowsMarked }],
            };
        },

        privateControls(state: CharadesState, playerId: string): Control[] {
            const performer: string = nameOf(state, state.performerId);
            const prompt: Prompt | null = promptOf(state);
            const isPerformer: boolean = playerId === state.performerId;
            if (state.phase === "end") {
                return [{ type: "waiting", text: "Look at the screen" }];
            }
            if (state.phase === "reveal") {
                const record: TurnRecord | null = state.latest;
                const earned: string = record !== null && record.points > 0 && (playerId === record.guesserId || playerId === record.performerId) ? `+${record.points} ${pointsWord(record.points)}` : "Look at the screen";
                return [{ type: "waiting", text: earned }];
            }
            if (isPerformer === false) {
                const waiting: Record<"pick" | "ready" | "acting", string> = { pick: `${performer} is choosing how hard`, ready: "Get ready to shout", acting: "Hold and shout your guess" };
                return [{ type: "waiting", text: waiting[state.phase] }];
            }
            if (state.phase === "pick") {
                const options: ControlOption[] = LEVELS.map((level: Level): ControlOption => {
                    const decision: LevelDecision = decisions.levels[level];
                    return { id: `${LEVEL_PREFIX}${level}`, label: `${decision.label} · ${decision.points} ${pointsWord(decision.points)}` };
                });
                return [{ type: "buttons", prompt: "How hard?", options }, { type: "waiting", text: "Choose how hard" }];
            }
            if (prompt === null) {
                return [{ type: "waiting", text: "Your prompt is coming" }];
            }
            const words: number = wordCountOf(prompt.answer);
            const card: Control = { type: "roleCard", title: prompt.answer, body: `${KIND_LABELS[prompt.kind]} · ${words} ${words === 1 ? "word" : "words"}`, secret: false };
            if (state.phase === "acting") {
                return [card, { type: "waiting", text: "Act it out. No words." }];
            }
            const options: ControlOption[] = [{ id: GO_ACTION, label: "Start acting" }, ...(state.swapped === false ? [{ id: SWAP_ACTION, label: "Swap it for another" }] : [])];
            return [card, { type: "buttons", options }, { type: "waiting", text: "Read it, then start" }];
        },

        hostFacts(state: CharadesState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase === "end") {
                return [];
            }
            const prompt: Prompt | null = promptOf(state);
            const words: number = wordCountOf(prompt?.answer ?? "");
            const acting: string = prompt === null || state.phase === "reveal" ? "" : ` ${nameOf(state, state.performerId)} is acting ${KIND_PHRASES[prompt.kind]} of ${words} ${words === 1 ? "word" : "words"}.`;
            return [{ scope: { kind: "public" }, kind: "progress", text: `Turn ${Math.min(state.turnsDone + (state.phase === "reveal" ? 0 : 1), turnsTotal(state))} of ${turnsTotal(state)}.${acting} ${scoreLine(state)}` }];
        },

        outcome(state: CharadesState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            const top: number = Math.max(0, ...state.players.map((player: CartridgePlayer) => state.scores[player.playerId] ?? 0));
            const leaders: string[] = state.players.filter((player: CartridgePlayer) => (state.scores[player.playerId] ?? 0) === top).map((player: CartridgePlayer) => player.name);
            return top === 0 ? "Nobody scored." : `${leaders.join(" and ")} ${leaders.length > 1 ? "share the lead" : "led"} with ${top}.`;
        },
    };

    return {
        cartridge,
        hidden(state: CharadesState): HiddenValue[] {
            const prompt: Prompt | null = promptOf(state);
            if (prompt === null || (state.phase !== "ready" && state.phase !== "acting")) {
                return [];
            }
            return [prompt.answer, ...prompt.also].map((text: string): HiddenValue => ({ label: "the prompt", text, seenBy: [state.performerId] }));
        },
    };
}
