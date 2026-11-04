// The host-guess kit: reverse twenty questions. The players secretly agree on one thing from a
// category they choose, and the host is the contestant. It asks yes-or-no questions by writing an
// "ask" ruling, the players answer with Yes, No or Sometimes on their phones, and code counts the
// answers (the most taps wins, a tie is Sometimes). Code holds the question budget, the guess
// allowance, the board of everything asked so far and every clock; the host only chooses what to ask
// and when to guess. Nothing secret lives in the game: the thing is never typed or spoken to it, so
// the host cannot leak it. The players tap whether the final guess was right after saying what it was.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, PhaseSpec, Step } from "../../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow as SceneTallyRow } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { Turn } from "../../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../../shared/visibility.ts";
import { HOST_LINE_RULES, SAY_IT_ALOUD, boxProblems, isShortText, isWholeIn, rulingNameProblem, squash, type Box, type HiddenValue, type KitGame } from "../../kit/kit.ts";
import { because, frozenCopy, pick, spend, tally, type Budget, type Spent, type Tally } from "../../kit/primitives.ts";

/** Everything a creator may choose for a host-guess game. */
export interface HostGuessDecisions {
    /** What the thing can be, such as "a famous person"; the players vote on one. */
    categories: string[];
    /** Questions the host may ask. A wrong guess before the last also costs one. */
    questions: number;
    /** Guesses the host may make, the last of them final. */
    guesses: number;
    /** Questions left at which the host is told to warn them. */
    warnAt: number[];
    /** Seconds to pick a category. */
    categorySeconds: number;
    /** Seconds to agree on the thing. */
    secretSeconds: number;
    /** Seconds to answer one question. */
    answerSeconds: number;
    /** Seconds to vote on a guess, and on the final one. */
    verdictSeconds: number;
    /** Seconds the host gets to ask or guess before it is nudged. */
    hostSeconds: number;
}

/** The phases of the kit. */
export type HostGuessPhase = "category" | "secret" | "asking" | "guess" | "reveal" | "end";

/** The answers a player may give. */
export type AnswerId = "yes" | "no" | "sometimes";

/** One question the host asked and how the table answered. */
export interface Exchange {
    question: string;
    /** The winning answer, or "none" when nobody answered. */
    answer: AnswerId | "none";
    /** The counts behind it, such as "3 yes, 1 no". Told to the host only. */
    split: string;
}

/** A guess waiting to be judged by the table. */
export interface Judging {
    guess: string;
    /** True for the last guess the host gets, which ends the game either way. */
    final: boolean;
    /** Each player's tap, by player id: "right" or "wrong". */
    votes: Record<string, string>;
    voters: string[];
}

/** The whole game, immutable between steps. */
export interface HostGuessState {
    phase: HostGuessPhase;
    players: CartridgePlayer[];
    /** Each player's category tap, by player id. */
    categoryVotes: Record<string, string>;
    category: string;
    /** Players who have said they agreed on a thing. */
    ready: string[];
    asked: Exchange[];
    /** The open question and each answer so far, by player id. Never shown to anyone while open. */
    pending: { question: string; answers: Record<string, string> } | null;
    /** Wrong guesses, in order. */
    wrongGuesses: string[];
    judging: Judging | null;
    /** Questions used. */
    count: Budget;
    /** Times the host has been nudged since it last acted. */
    nudges: number;
    /** Counts the clocks started, so a stale one is told apart. */
    beat: number;
    /** The id of the one clock that matters now. */
    armed: string;
    won: boolean;
    /** The guess that ended the game, if any. */
    lastGuess: string;
    /** True when the host never made its final guess. */
    passed: boolean;
}

/** Option id prefixes and ids the phones send. */
export const HOST_GUESS_IDS: { category: string; ready: string; answer: string; verdict: string } = { category: "cat:", ready: "ready", answer: "answer:", verdict: "verdict:" };

/** Decision ids a rehearsal names when it explains a moment. */
export const HOST_GUESS_DECISIONS: {
    categories: string;
    questions: string;
    guesses: string;
    warnAt: string;
    categorySeconds: string;
    secretSeconds: string;
    answerSeconds: string;
    verdictSeconds: string;
    hostSeconds: string;
} = {
    categories: "categories",
    questions: "questions",
    guesses: "guesses",
    warnAt: "warnAt",
    categorySeconds: "categorySeconds",
    secretSeconds: "secretSeconds",
    answerSeconds: "answerSeconds",
    verdictSeconds: "verdictSeconds",
    hostSeconds: "hostSeconds",
};

/** Answer ids in the order phones show them. */
const ANSWER_IDS: readonly AnswerId[] = ["yes", "no", "sometimes"];

/** How each answer is labelled. */
const ANSWER_LABELS: Record<AnswerId | "none", string> = { yes: "Yes", no: "No", sometimes: "Sometimes", none: "No answer" };

/** Most nudges the host gets before the round is called off. */
const NUDGE_LIMIT: number = 3;

/** Shortest and longest a question or a guess may be, in characters. */
const QUESTION_LENGTH: { least: number; most: number } = { least: 8, most: 140 };
const GUESS_LENGTH: { least: number; most: number } = { least: 2, most: 60 };

/** Exchanges the TV keeps showing. */
const SHOWN_EXCHANGES: number = 4;

/** The first seat the box allows; a table of one has no majority to speak of. */
const LEAST_PLAYERS: number = 2;

/** Most categories the phones can show without scrolling. */
const MOST_CATEGORIES: number = 8;

/** What each ruling means in the host's brief. Owned by the kit, never by a blueprint. */
const RULING_BRIEFS: Record<string, string> = {
    ask: "you ask your next yes-or-no question. Write [[ask: your question]] first, with the whole question inside the brackets, then say that same question aloud after at most a short reaction to the last answer. One question per reply, and never while a question is open.",
    guess: "you name what you think it is. Write [[guess: your guess]] first, with just the thing inside the brackets, then say your guess aloud in one sentence with a flourish. Only when you're fairly sure or nearly out of questions. You'll be told when a guess is your final one.",
};

/** A different way to put each next question, so they don't all come out as a reaction and then a question. */
const QUESTION_SHAPES: readonly string[] = [
    "This time, just ask, with no reaction first.",
    "This time, think aloud about what you've ruled out, then ask.",
    "This time, tease the table in a few words, then ask.",
    "This time, ask first, then add a few words after the question.",
];

/**
 * Checks a host-guess game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function hostGuessProblems(decisions: HostGuessDecisions): string[] {
    const problems: string[] = [];
    if (decisions.categories.length < 2 || decisions.categories.length > MOST_CATEGORIES || decisions.categories.some((name: string) => isShortText(name) === false) === true) {
        problems.push(`Offer two to ${MOST_CATEGORIES} categories, each a short plain name.`);
    }
    if (new Set(decisions.categories.map(squash)).size !== decisions.categories.length) {
        problems.push("Two categories share a name.");
    }
    if (isWholeIn(decisions.questions, 5, 30) === false) {
        problems.push("The question count must be a whole number from 5 to 30.");
    }
    if (isWholeIn(decisions.guesses, 1, 5) === false) {
        problems.push("The host gets a whole number of guesses from 1 to 5.");
    }
    if (decisions.warnAt.some((left: number) => isWholeIn(left, 1, decisions.questions - 1) === false) === true) {
        problems.push("Warnings must be whole numbers inside the question count.");
    }
    const clocks: [number, number, number][] = [
        [decisions.categorySeconds, 10, 60],
        [decisions.secretSeconds, 20, 180],
        [decisions.answerSeconds, 10, 60],
        [decisions.verdictSeconds, 10, 90],
        [decisions.hostSeconds, 10, 60],
    ];
    if (clocks.some(([seconds, least, most]: [number, number, number]) => isWholeIn(seconds, least, most) === false) === true) {
        problems.push("Every clock is a whole number of seconds inside its range.");
    }
    return problems;
}

/**
 * Every problem with a host-guess blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function hostGuessBlueprintProblems(box: Box, decisions: HostGuessDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...hostGuessProblems(decisions)];
    if (box.minPlayers < LEAST_PLAYERS) {
        problems.push("The table needs at least two people, or there is no majority to take.");
    }
    return problems;
}

/**
 * The text of a question or guess the host wrote, made safe to show and to say, or null when it
 * cannot be used.
 * @param text what sat inside the host's ruling.
 * @param length the shortest and longest allowed.
 * @returns the cleaned text, or null.
 */
export function cleanHostText(text: string, length: { least: number; most: number }): string | null {
    const cleaned: string = text.replace(/[[\]{}<>]/g, " ").replace(/\s+/g, " ").trim();
    return cleaned.length < length.least || cleaned.length > length.most ? null : cleaned;
}

/**
 * A guess as it reads inside a sentence: a leading article goes lower case, so "A lighthouse"
 * reads "Is it a lighthouse?" and never "Is it A lighthouse?".
 * @param guess the guess as the host wrote it.
 * @returns the guess for the middle of a sentence.
 */
export function inSentence(guess: string): string {
    return guess.replace(/^(A|An|The)\s/, (article: string) => article.toLowerCase());
}

/**
 * Builds the manifest, with every host line from the kit.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the manifest.
 * @throws when a kit ruling name is reserved, which would be a bug in the kit.
 */
export function hostGuessManifest(box: Box, decisions: HostGuessDecisions): CartridgeManifest {
    for (const name of Object.keys(RULING_BRIEFS)) {
        const problem: string | null = rulingNameProblem(name);
        if (problem !== null) {
            throw new Error(problem);
        }
    }
    const hold = { "*": "holdToTalk" } as const;
    const muted = { "*": "muted" } as const;
    const phases: PhaseSpec[] = [
        {
            id: "category",
            hostBrief: "You're meeting the table. In two short sentences: they'll secretly choose something, you'll ask yes-or-no questions until you find it, and they should pick a category on their phones. Make no ruling.",
            listening: muted,
            hostMayInterject: false,
            silenceSeconds: 0,
        },
        {
            id: "secret",
            hostBrief: "They're agreeing on the thing. Tell them to settle on one specific thing in the category, keep their voices down, and tap ready, and that you're looking away. Then reply exactly (quiet) until you're told to start.",
            listening: muted,
            hostMayInterject: false,
            silenceSeconds: 0,
        },
        {
            id: "asking",
            hostBrief: [
                "You're the contestant. Each time you're told an answer, say your next question or a guess, with a few words of your own around it.",
                "Change the shape every time: sometimes just ask, sometimes think aloud first, sometimes tease the table. Never echo their answer back as a short opener like \"Got it\" or \"Noted\".",
                "Make exactly one ruling per reply. If a question is open, or you're told to wait, reply exactly (quiet).",
                "Don't count questions out loud unless you're told to warn them.",
            ].join(" "),
            listening: muted,
            hostMayInterject: true,
            silenceSeconds: 0,
            hostRulings: { ...RULING_BRIEFS },
        },
        { id: "guess", hostBrief: "Your guess is up and they're judging it on their phones. Reply exactly (quiet).", listening: muted, hostMayInterject: false, silenceSeconds: 0 },
        {
            id: "reveal",
            hostBrief: [
                "Your final guess is up. They'll say what the thing was and tap whether you were right.",
                "Don't say whether you were right. If someone tells you what it was, react in one line to the thing itself, with real curiosity. Otherwise reply exactly (quiet).",
            ].join(" "),
            listening: hold,
            hostMayInterject: false,
            silenceSeconds: 0,
        },
        {
            id: "end",
            hostBrief: [
                "The round is over and you've been told how it went. React with flair in about 25 words. Always speak here, never reply (quiet).",
                "If you were right, take a small bow and say what gave it away. If you were wrong, be gracious and openly impressed, and ask what it was if they haven't said.",
                "Then ask if they want another game.",
            ].join(" "),
            listening: hold,
            hostMayInterject: true,
            silenceSeconds: 0,
        },
    ];
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're ${HOST_NAME}, the contestant in ${box.name}. The players have secretly agreed on one thing from a category.`,
            "You don't know what it is, you can't hear them while they decide, and you must never pretend you do.",
            `You ask yes-or-no questions and they answer on their phones: most taps wins, and a tie counts as Sometimes. You have ${decisions.questions} questions.`,
            "The game keeps the count, and you're always shown the board of everything asked so far. Trust it over your own memory.",
            HOST_LINE_RULES,
            "Ask sharp questions. Each should cut what's left roughly in half, given every answer so far. Start wide for the category (alive or made, real or invented, bigger than a person, indoors or out, known for what) and only get specific once the answers have narrowed it.",
            "Use the whole board. Never repeat a question, never ask what an earlier answer already settled, never ask two things at once. Sometimes means the question was fuzzy or the answer depends, so sharpen it rather than treating it as a no. Keep a shortlist in mind, and when it's down to two or three, ask the question that splits them.",
            "Guess when you're fairly sure, or when the questions are nearly gone. A wrong guess before the last costs a question, and you only get a few.",
            "Sound dry, warm and quick. One short reaction, then the next question; a hint of your reasoning is welcome, a lecture isn't. Tease the thing or yourself, never a player.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases,
    };
}

/**
 * Builds a host-guess game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with hostGuessProblems first.
 * @param random a function returning [0, 1), used only to break a tie between categories.
 * @returns the game.
 */
export function createHostGuessGame(givenBox: Box, givenDecisions: HostGuessDecisions, random: () => number = Math.random): KitGame<HostGuessState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: HostGuessDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = hostGuessManifest(box, decisions);
    const categoryIds: string[] = decisions.categories.map((_name: string, index: number) => `${HOST_GUESS_IDS.category}${index}`);
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const plural = (amount: number, word: string): string => `${amount} ${word}${amount === 1 ? "" : "s"}`;
    const idsOf = (players: readonly CartridgePlayer[]): string[] => players.map((player: CartridgePlayer) => player.playerId);
    const questionsLeft = (state: HostGuessState): number => Math.max(0, state.count.max - state.count.used);
    const guessesLeft = (state: HostGuessState): number => decisions.guesses - state.wrongGuesses.length;

    /**
     * Starts the one clock that matters, replacing any earlier one.
     * @param state the state.
     * @param kind names the clock.
     * @param seconds how long.
     * @returns the state and the timers to start.
     */
    const arm = (state: HostGuessState, kind: string, seconds: number): { state: HostGuessState; timers: Record<string, number> } => {
        const beat: number = state.beat + 1;
        const armed: string = `${kind}${beat}`;
        return { state: { ...state, beat, armed }, timers: { [armed]: seconds } };
    };

    /**
     * Waits for the host to ask or guess, with a nudge clock.
     * @param state the state.
     * @param facts what to tell the host now.
     * @returns the step.
     */
    const awaitHost = (state: HostGuessState, facts: ScopedFact[]): Step<HostGuessState> => {
        const armed: { state: HostGuessState; timers: Record<string, number> } = arm({ ...state, phase: "asking", pending: null, judging: null }, "host", decisions.hostSeconds);
        const changed: boolean = state.phase !== "asking";
        return { state: armed.state, facts, ...(changed === true ? { nextPhaseId: "asking" } : {}), timers: armed.timers };
    };

    /**
     * The warning to add when few questions are left.
     * @param left questions left.
     * @returns the sentence, or an empty string.
     */
    const warning = (left: number): string => (decisions.warnAt.includes(left) === true ? ` Tell them out loud that only ${plural(left, "question")} ${left === 1 ? "is" : "are"} left.` : "");

    /**
     * What to tell the host when it is its turn to act.
     * @param state the state.
     * @returns the instruction.
     */
    const yourTurn = (state: HostGuessState): string => {
        const left: number = questionsLeft(state);
        if (left === 0) {
            return "You're out of questions. Make your final guess now, with a guess ruling.";
        }
        const last: string = guessesLeft(state) === 1 ? " Your next guess is your final one." : "";
        return `${plural(left, "question")} left.${warning(left)}${last} Ask your next question, or guess if you're sure.`;
    };

    /**
     * Ends the round.
     * @param state the state.
     * @param won whether the host was right.
     * @param guess the guess that ended it, if any.
     * @param passed true when the host never made its final guess.
     * @param text what to tell the host.
     * @param decision the decision that ended it.
     * @returns the step.
     */
    const finish = (state: HostGuessState, won: boolean, guess: string, passed: boolean, text: string, decision: string): Step<HostGuessState> => {
        const next: HostGuessState = { ...state, phase: "end", pending: null, judging: null, won, lastGuess: guess, passed, armed: "" };
        return { state: next, facts: because(publicFact("game-over", `${text} ${SAY_IT_ALOUD}`), decision), nextPhaseId: "end" };
    };

    /**
     * Opens the category vote, or settles it when everyone has tapped or the clock ran out.
     * @param state the state while picking a category.
     * @returns the step.
     */
    const chooseCategory = (state: HostGuessState): Step<HostGuessState> => {
        const counted: Tally = tally(state.categoryVotes, categoryIds);
        const winner: string = pick(counted.leaders.length === 0 ? categoryIds : counted.leaders, random);
        const category: string = decisions.categories[categoryIds.indexOf(winner)] ?? "";
        const armed: { state: HostGuessState; timers: Record<string, number> } = arm({ ...state, phase: "secret", category, ready: [] }, "secret", decisions.secretSeconds);
        const text: string = [
            `They chose: ${category}. Tell them to settle on one specific thing in it, quietly, and tap ready.`,
            "You're looking away and can't hear. Then say nothing more until told.",
        ].join(" ");
        return { state: armed.state, facts: because(publicFact("category", text), HOST_GUESS_DECISIONS.categories), nextPhaseId: "secret", timers: armed.timers };
    };

    /**
     * Starts the questions.
     * @param state the state while they agree.
     * @param decision the decision that started them.
     * @returns the step.
     */
    const startAsking = (state: HostGuessState, decision: string): Step<HostGuessState> => {
        const text: string = `They've agreed on something in the category "${state.category}". You have ${plural(state.count.max, "question")}. Say you're turning round, then start with a wide first question.`;
        return awaitHost(state, because(publicFact("ready", text), decision));
    };

    /**
     * Counts the open question's answers, spends one question and tells the host the result.
     * @param state the state with an open question.
     * @returns the step.
     */
    const resolveQuestion = (state: HostGuessState): Step<HostGuessState> => {
        const pending: { question: string; answers: Record<string, string> } | null = state.pending;
        if (pending === null) {
            return { state, facts: [] };
        }
        const counted: Tally = tally(pending.answers, [...ANSWER_IDS]);
        const votesFor = (answer: AnswerId): number => counted.rows.find((row) => row.playerId === answer)?.votes ?? 0;
        const answered: number = Object.keys(pending.answers).length;
        const winning: AnswerId | "none" = answered === 0 ? "none" : counted.leaders.length === 1 ? (counted.leaders[0] as AnswerId) : "sometimes";
        const split: string = ANSWER_IDS.map((answer: AnswerId) => `${votesFor(answer)} ${answer}`).join(", ");
        const exchange: Exchange = { question: pending.question, answer: winning, split };
        const spent: Spent = spend(state.count);
        const next: HostGuessState = { ...state, asked: [...state.asked, exchange], count: spent.budget, pending: null, nudges: 0 };
        const tie: string = answered > 0 && counted.tied === true ? " The table split evenly, so it counts as Sometimes." : "";
        const verdict: string = winning === "none" ? "Nobody answered, so there's nothing to go on" : `The answer is ${ANSWER_LABELS[winning]} (${split})`;
        const shape: string = QUESTION_SHAPES[next.asked.length % QUESTION_SHAPES.length] ?? "";
        const text: string = `You asked "${pending.question}". ${verdict}.${tie} ${yourTurn(next)} ${shape}`;
        return awaitHost(next, because(publicFact("answer", text), HOST_GUESS_DECISIONS.answerSeconds));
    };

    /**
     * Counts a judged guess and carries on: the game ends on a right or final guess, otherwise the
     * host asks again.
     * @param state the state while a guess is being judged.
     * @returns the step.
     */
    const resolveJudging = (state: HostGuessState): Step<HostGuessState> => {
        const judging: Judging | null = state.judging;
        if (judging === null) {
            return { state, facts: [] };
        }
        const counted: Tally = tally(judging.votes, ["right", "wrong"]);
        const right: boolean = counted.leaders.length === 1 && counted.leaders[0] === "right";
        const used: string = plural(state.asked.length, "question");
        if (right === true) {
            const text: string = `They say you were right: it was ${judging.guess}. You got it after ${used}. React with flair: take a small bow and say what gave it away.`;
            return finish(state, true, judging.guess, false, text, HOST_GUESS_DECISIONS.verdictSeconds);
        }
        const wrong: HostGuessState = { ...state, wrongGuesses: [...state.wrongGuesses, judging.guess] };
        if (judging.final === true) {
            const text: string = `They say you were wrong, so you're stumped after ${used}. Be gracious and openly impressed. If they haven't said what it was, ask.`;
            return finish(wrong, false, judging.guess, false, text, HOST_GUESS_DECISIONS.guesses);
        }
        const text: string = `They say ${judging.guess} is wrong. ${yourTurn(wrong)}`;
        return awaitHost({ ...wrong, nudges: 0 }, because(publicFact("wrong-guess", text), HOST_GUESS_DECISIONS.guesses));
    };

    /**
     * Settles whatever the phase is waiting for, if everyone left has done their part.
     * @param state the state.
     * @returns the step, or the same state when the phase is still waiting.
     */
    const settle = (state: HostGuessState): Step<HostGuessState> => {
        const everyone: string[] = idsOf(state.players);
        if (everyone.length === 0) {
            return { state, facts: [] };
        }
        if (state.phase === "category" && everyone.every((playerId: string) => state.categoryVotes[playerId] !== undefined) === true) {
            return chooseCategory(state);
        }
        if (state.phase === "secret" && everyone.every((playerId: string) => state.ready.includes(playerId)) === true) {
            return startAsking(state, HOST_GUESS_DECISIONS.secretSeconds);
        }
        if (state.phase === "asking" && state.pending !== null && everyone.every((playerId: string) => state.pending?.answers[playerId] !== undefined) === true) {
            return resolveQuestion(state);
        }
        if ((state.phase === "guess" || state.phase === "reveal") && state.judging !== null && everyone.every((playerId: string) => state.judging?.votes[playerId] !== undefined) === true) {
            return resolveJudging(state);
        }
        return { state, facts: [] };
    };

    /**
     * Takes the host's question.
     * @param state the state.
     * @param detail the question as the host wrote it.
     * @returns the step.
     */
    const takeQuestion = (state: HostGuessState, detail: string): Step<HostGuessState> => {
        const correction = (text: string): Step<HostGuessState> => ({ state, facts: because(publicFact("rejected", text), HOST_GUESS_DECISIONS.questions) });
        if (state.pending !== null) {
            return { state, facts: [] };
        }
        if (questionsLeft(state) === 0) {
            return correction("You have no questions left. Make your final guess now, with a guess ruling.");
        }
        const question: string | null = cleanHostText(detail, QUESTION_LENGTH);
        if (question === null) {
            return correction("That question couldn't be used. Ask it again as one short yes-or-no question, with the whole question inside the ask ruling.");
        }
        const text: string = question.endsWith("?") === true ? question : `${question}?`;
        if (state.asked.some((exchange: Exchange) => squash(exchange.question) === squash(text)) === true) {
            return correction("You already asked that one. Ask something new that uses the board.");
        }
        const armed: { state: HostGuessState; timers: Record<string, number> } = arm({ ...state, pending: { question: text, answers: {} }, nudges: 0 }, "answer", decisions.answerSeconds);
        return { state: armed.state, facts: [], timers: armed.timers };
    };

    /**
     * Takes the host's guess.
     * @param state the state.
     * @param detail the guess as the host wrote it.
     * @returns the step.
     */
    const takeGuess = (state: HostGuessState, detail: string): Step<HostGuessState> => {
        const correction = (text: string): Step<HostGuessState> => ({ state, facts: because(publicFact("rejected", text), HOST_GUESS_DECISIONS.guesses) });
        if (state.pending !== null) {
            return { state, facts: [] };
        }
        const guess: string | null = cleanHostText(detail, GUESS_LENGTH);
        if (guess === null) {
            return correction("That guess couldn't be used. Name the one thing you think it is, inside the guess ruling.");
        }
        if (state.wrongGuesses.some((earlier: string) => squash(earlier) === squash(guess)) === true) {
            return correction("You already guessed that and it was wrong. Ask a question or name something else.");
        }
        const final: boolean = questionsLeft(state) === 0 || guessesLeft(state) === 1;
        const judging: Judging = { guess, final, votes: {}, voters: idsOf(state.players) };
        const spent: Spent = spend(state.count);
        const counted: Budget = final === true ? state.count : spent.budget;
        const armed: { state: HostGuessState; timers: Record<string, number> } = arm(
            { ...state, phase: final === true ? "reveal" : "guess", judging, count: counted, nudges: 0 },
            "verdict",
            decisions.verdictSeconds,
        );
        return { state: armed.state, facts: [], nextPhaseId: final === true ? "reveal" : "guess", timers: armed.timers };
    };

    /**
     * Acts on a clock that has run out.
     * @param state the state.
     * @returns the step.
     */
    const clockRanOut = (state: HostGuessState): Step<HostGuessState> => {
        if (state.phase === "category") {
            return chooseCategory(state);
        }
        if (state.phase === "secret") {
            return startAsking(state, HOST_GUESS_DECISIONS.secretSeconds);
        }
        if (state.phase === "asking" && state.pending !== null) {
            return resolveQuestion(state);
        }
        if (state.phase === "guess" || state.phase === "reveal") {
            return resolveJudging(state);
        }
        if (state.phase !== "asking") {
            return { state, facts: [] };
        }
        if (state.nudges >= NUDGE_LIMIT) {
            return finish(state, false, "", true, `You never made a move, so the round is called off after ${plural(state.asked.length, "question")}. Say sorry to the table and ask if they want to play again.`, HOST_GUESS_DECISIONS.hostSeconds);
        }
        const armed: { state: HostGuessState; timers: Record<string, number> } = arm({ ...state, nudges: state.nudges + 1 }, "host", decisions.hostSeconds);
        const text: string = `The table is waiting. ${yourTurn(state)}`;
        return { state: armed.state, facts: because(publicFact("nudge", text), HOST_GUESS_DECISIONS.hostSeconds), timers: armed.timers };
    };

    /**
     * Someone left: their taps are dropped and the phase is settled if everyone left has acted.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: HostGuessState, playerId: string): Step<HostGuessState> => {
        const without = (taps: Record<string, string>): Record<string, string> => {
            return Object.fromEntries(Object.entries(taps).filter(([tapper]: [string, string]) => tapper !== playerId));
        };
        const judging: Judging | null = state.judging === null ? null : {
            ...state.judging,
            votes: without(state.judging.votes),
            voters: state.judging.voters.filter((voter: string) => voter !== playerId),
        };
        const pending = state.pending === null ? null : { ...state.pending, answers: without(state.pending.answers) };
        const next: HostGuessState = {
            ...state,
            players: state.players.filter((player: CartridgePlayer) => player.playerId !== playerId),
            categoryVotes: without(state.categoryVotes),
            ready: state.ready.filter((readyId: string) => readyId !== playerId),
            pending,
            judging,
        };
        return state.phase === "end" ? { state: next, facts: [] } : settle(next);
    };

    /**
     * What a player may press now.
     * @param state the state.
     * @param playerId the player.
     * @returns the actions.
     */
    const legalFor = (state: HostGuessState, playerId: string): LegalAction[] => {
        if (state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return [];
        }
        if (state.phase === "category" && state.categoryVotes[playerId] === undefined) {
            return categoryIds.map((id: string, index: number): LegalAction => ({ actionId: id, label: decisions.categories[index] ?? "" }));
        }
        if (state.phase === "secret" && state.ready.includes(playerId) === false) {
            return [{ actionId: HOST_GUESS_IDS.ready, label: "We've agreed" }];
        }
        if (state.phase === "asking" && state.pending !== null && state.pending.answers[playerId] === undefined) {
            return ANSWER_IDS.map((answer: AnswerId): LegalAction => ({ actionId: `${HOST_GUESS_IDS.answer}${answer}`, label: ANSWER_LABELS[answer] }));
        }
        if ((state.phase === "guess" || state.phase === "reveal") && state.judging !== null && state.judging.votes[playerId] === undefined) {
            const labels: [string, string][] = state.phase === "reveal" ? [["right", "The host was right"], ["wrong", "The host was wrong"]] : [["right", "Yes, that's it"], ["wrong", "No, not it"]];
            return labels.map(([verdict, label]: [string, string]): LegalAction => ({ actionId: `${HOST_GUESS_IDS.verdict}${verdict}`, label }));
        }
        return [];
    };

    const cartridge: Cartridge<HostGuessState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<HostGuessState> {
            const state: HostGuessState = {
                phase: "category",
                players,
                categoryVotes: {},
                category: "",
                ready: [],
                asked: [],
                pending: null,
                wrongGuesses: [],
                judging: null,
                count: { used: 0, max: decisions.questions, warnAt: decisions.warnAt },
                nudges: 0,
                beat: 0,
                armed: "",
                won: false,
                lastGuess: "",
                passed: false,
            };
            const armed: { state: HostGuessState; timers: Record<string, number> } = arm(state, "category", decisions.categorySeconds);
            const text: string = `Meet the table. They're about to choose a category on their phones: ${decisions.categories.join(", ")}. Don't list them all.`;
            return { state: armed.state, facts: because(publicFact("welcome", text), HOST_GUESS_DECISIONS.categories), nextPhaseId: "category", timers: armed.timers };
        },

        phaseOf(state: HostGuessState): string {
            return state.phase;
        },

        turn(state: HostGuessState): Turn | null {
            const everyone = (label: string, doneIds: string[]): Turn => ({ kind: "everyone", playerIds: idsOf(state.players), doneIds, label });
            if (state.phase === "category") {
                return everyone("Pick a category", Object.keys(state.categoryVotes));
            }
            if (state.phase === "secret") {
                return everyone("Agree on a thing", state.ready);
            }
            if (state.phase === "asking" && state.pending !== null) {
                return everyone("Answer the question", Object.keys(state.pending.answers));
            }
            if ((state.phase === "guess" || state.phase === "reveal") && state.judging !== null) {
                return everyone("Judge the guess", Object.keys(state.judging.votes));
            }
            return null;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: HostGuessState, playerId: string): LegalAction[] {
            return legalFor(state, playerId);
        },

        apply(state: HostGuessState, playerId: string, actionId: string): Step<HostGuessState> {
            if (legalFor(state, playerId).some((action: LegalAction) => action.actionId === actionId) === false) {
                return { state, facts: [] };
            }
            if (state.phase === "category") {
                return settle({ ...state, categoryVotes: { ...state.categoryVotes, [playerId]: actionId } });
            }
            if (state.phase === "secret") {
                return settle({ ...state, ready: [...state.ready, playerId] });
            }
            if (state.phase === "asking" && state.pending !== null) {
                const answers: Record<string, string> = { ...state.pending.answers, [playerId]: actionId.slice(HOST_GUESS_IDS.answer.length) };
                return settle({ ...state, pending: { ...state.pending, answers } });
            }
            if (state.judging !== null) {
                const votes: Record<string, string> = { ...state.judging.votes, [playerId]: actionId.slice(HOST_GUESS_IDS.verdict.length) };
                return settle({ ...state, judging: { ...state.judging, votes } });
            }
            return { state, facts: [] };
        },

        onEvent(state: HostGuessState, event: RoomEvent): Step<HostGuessState> {
            if (event.type === "timerFired" && event.timerId === state.armed && state.phase !== "end") {
                return clockRanOut(state);
            }
            if (event.type === "playerLeft" && state.players.some((player: CartridgePlayer) => player.playerId === event.playerId) === true) {
                return left(state, event.playerId);
            }
            if (event.type !== "hostRuled" || state.phase !== "asking") {
                return { state, facts: [] };
            }
            if (event.ruling === "ask") {
                return takeQuestion(state, event.detail);
            }
            if (event.ruling === "guess") {
                return takeGuess(state, event.detail);
            }
            return { state, facts: [] };
        },

        publicScene(state: HostGuessState): Scene {
            const kicker: string = box.name;
            const progress: SceneBlock = { type: "progress", label: "Questions asked", current: state.count.used, max: state.count.max, marks: "card" };
            if (state.phase === "category") {
                const rows: SceneTallyRow[] = decisions.categories.map((name: string, index: number): SceneTallyRow => {
                    const votes: number = Object.values(state.categoryVotes).filter((vote: string) => vote === categoryIds[index]).length;
                    return { label: name, count: votes };
                });
                const top: number = Math.max(0, ...rows.map((row: SceneTallyRow) => row.count));
                return {
                    mood: "neutral",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: "What kind of thing?", kicker },
                        { type: "tally", title: "Votes", rows: rows.map((row: SceneTallyRow): SceneTallyRow => ({ ...row, highlight: top > 0 && row.count === top })) },
                    ],
                };
            }
            if (state.phase === "secret") {
                return {
                    mood: "night",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: `Agree on ${state.category}`, kicker },
                        { type: "text", text: `${HOST_NAME} is looking away. Settle on one specific thing, keep your voices down, then tap ready.`, emphasis: "large" },
                        { type: "timer", seconds: decisions.secretSeconds, label: "to agree", running: true },
                    ],
                };
            }
            if (state.phase === "guess" || state.phase === "reveal") {
                const final: boolean = state.phase === "reveal";
                const blocks: SceneBlock[] = [{ type: "title", text: final === true ? state.judging?.guess ?? "" : `Is it ${inSentence(state.judging?.guess ?? "")}?`, kicker: final === true ? `${HOST_NAME}'s final guess` : `${HOST_NAME} guesses` }];
                blocks.push({ type: "text", text: final === true ? "Hold your phone and say what it was. Then tap whether the host was right." : "Tap on your phone.", emphasis: "large" });
                blocks.push({ type: "timer", seconds: decisions.verdictSeconds, label: "to judge", running: true });
                return { mood: "tense", transition: "fade", blocks };
            }
            if (state.phase === "end") {
                const title: string = state.won === true ? `${HOST_NAME} got it` : state.passed === true ? `${HOST_NAME} lost the thread` : `${HOST_NAME} is stumped`;
                const blocks: SceneBlock[] = [{ type: "title", text: title, kicker }];
                blocks.push({ type: "text", text: state.lastGuess === "" ? `Category: ${state.category}` : `${state.won === true ? "It was" : "Final guess:"} ${inSentence(state.lastGuess)}`, emphasis: "large" });
                blocks.push(progress);
                return { mood: state.won === true ? "victory" : "dawn", transition: "fade", blocks };
            }
            const recent: SceneBlock[] = state.asked.slice(-SHOWN_EXCHANGES).map((exchange: Exchange): SceneBlock => ({ type: "text", text: `${exchange.question} ${ANSWER_LABELS[exchange.answer]}.` }));
            if (state.pending !== null) {
                return {
                    mood: "tense",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: state.pending.question, kicker: `Question ${state.count.used + 1} of ${state.count.max}` },
                        { type: "text", text: "Yes, No or Sometimes, on your phone.", emphasis: "large" },
                        { type: "timer", seconds: decisions.answerSeconds, label: "to answer", running: true },
                        progress,
                    ],
                };
            }
            const thinking: string = questionsLeft(state) === 0 ? `${HOST_NAME} must name it` : `${HOST_NAME} is thinking`;
            return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: thinking, kicker: state.category }, progress, ...recent] };
        },

        privateControls(state: HostGuessState, playerId: string): Control[] {
            const legal: LegalAction[] = legalFor(state, playerId);
            const options: ControlOption[] = legal.map((action: LegalAction): ControlOption => ({ id: action.actionId, label: action.label }));
            if (state.phase === "category") {
                return options.length > 0 ? [{ type: "buttons", prompt: "What kind of thing?", options }] : [{ type: "waiting", text: "Picked. Waiting for the others." }];
            }
            if (state.phase === "secret") {
                return options.length > 0 ? [{ type: "buttons", prompt: `Agree on one ${state.category.replace(/^an? /, "")} together. Keep it from the host.`, options }] : [{ type: "waiting", text: "Ready. Waiting for the others." }];
            }
            if (state.phase === "asking" && state.pending !== null) {
                return options.length > 0 ? [{ type: "buttons", prompt: state.pending.question, options }] : [{ type: "waiting", text: "Answered. Waiting for the others." }];
            }
            if (state.phase === "guess" || state.phase === "reveal") {
                const prompt: string = state.phase === "reveal" ? `${HOST_NAME}'s final guess: ${inSentence(state.judging?.guess ?? "")}. Hold your phone and say what it was, then tap.` : `Is it ${inSentence(state.judging?.guess ?? "")}?`;
                return options.length > 0 ? [{ type: "buttons", prompt, options }] : [{ type: "waiting", text: "Judged. Waiting for the others." }];
            }
            if (state.phase === "end") {
                return [{ type: "waiting", text: state.won === true ? `${HOST_NAME} read your minds.` : `You stumped ${HOST_NAME}.` }];
            }
            return [{ type: "waiting", text: `${HOST_NAME} is thinking of its next question.` }];
        },

        hostFacts(state: HostGuessState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.category === "") {
                return [];
            }
            const lines: string[] = [`Category: ${state.category}.`, `Questions used: ${state.count.used} of ${state.count.max}.`];
            lines.push(state.phase === "end" ? "The round is over." : `Guesses left: ${guessesLeft(state)}${guessesLeft(state) === 1 ? ", and it is your final one" : ""}.`);
            lines.push(state.asked.length === 0 ? "Nothing asked yet." : `The board so far:\n${state.asked.map((exchange: Exchange, index: number) => `${index + 1}. ${exchange.question} ${ANSWER_LABELS[exchange.answer]} (${exchange.split})`).join("\n")}`);
            if (state.wrongGuesses.length > 0) {
                lines.push(`Wrong guesses: ${state.wrongGuesses.join(", ")}.`);
            }
            if (state.pending !== null) {
                lines.push(`A question is open: "${state.pending.question}". Reply exactly (quiet) until it's answered.`);
            }
            return lines.map((text: string): ScopedFact => ({ scope: { kind: "public" }, kind: "board", text }));
        },

        outcome(state: HostGuessState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            if (state.passed === true) {
                return "The host never made its final guess.";
            }
            return state.won === true ? `The host guessed it after ${plural(state.asked.length, "question")}.` : `The host was stumped after ${plural(state.asked.length, "question")}.`;
        },
    };

    return {
        cartridge,
        hidden(): HiddenValue[] {
            return [];
        },
    };
}
