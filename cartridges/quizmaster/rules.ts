// Quizmaster's rules core. The host's model writes six questions on the players' topic, and only the
// host is told each answer. Right answers score 2, close ones 1; each player answers once per question.

import type { StartPick } from "../../shared/shell.ts";
import type { Turn } from "../../shared/turn.ts";
import { HOST_NAME } from "../../shared/brand.ts";
import type { Cartridge, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import { sourceName } from "../../shared/sources.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { isHostSafe, shuffled } from "../../studio/kit/text.ts";
import { answerSetup, followUpPrompt, parseFollowUp, SETUP_START, setupBlocks, setupControls, setupFinished, type SetupProgress, type SetupQuestion } from "../setup-step.ts";
import { REVEAL_NOW } from "../../shared/controls.ts";
import { QUIZMASTER_MANIFEST } from "./manifest.ts";

/** Questions in one game. */
export const QUESTION_COUNT: number = 6;

/** Seconds a question stays open before the game moves on. */
export const QUESTION_SECONDS: number = 30;

/** How long the room holds its breath once the answers are locked in. */
export const REVEAL_BUILD_SECONDS: number = 4;

/** How long the lit answer, who got it and the points have the screen before the host reacts. */
export const REVEAL_REACT_SECONDS: number = 2;

/** How long a reveal stays up in all, reaction included, before the next question. */
export const REVEAL_HOLD_SECONDS: number = 8;

/** Asked for beyond the game's length, since any that give their answer away are dropped. */
const EXTRA_QUESTIONS_REQUESTED: number = 2;

/** The most questions a game can ask, and so the most worth keeping from the model. */
const MOST_QUESTIONS: number = 10;

/** How long the model gets to write a follow-up before setup carries on without one. */
const FOLLOW_UP_WAIT_SECONDS: number = 5;

/** The fixed setup questions. Each game of Quizmaster asks these after any follow-up. */
const SETUP_QUESTIONS: readonly SetupQuestion[] = [
    { id: "level", prompt: "How hard?", options: [{ id: "easy", label: "Easy" }, { id: "medium", label: "Medium" }, { id: "hard", label: "Hard" }] },
    { id: "count", prompt: "How many questions?", options: [{ id: "5", label: "5" }, { id: "10", label: "10" }] },
    { id: "time", prompt: "How long for each one?", options: [{ id: "relaxed", label: "Relaxed" }, { id: "normal", label: "Normal" }, { id: "quick", label: "Quick" }, { id: "none", label: "No timer" }] },
];

/** Seconds for each question at each pace; No timer has none. */
const PACE_SECONDS: Record<string, number | null> = { relaxed: 45, normal: QUESTION_SECONDS, quick: 15, none: null };

/** How the questions are pitched at each level. */
const LEVEL_WORDS: Record<string, string> = {
    easy: "Keep them all easy: anyone should have a fair shot.",
    medium: "Aim for two easy, three medium and one hard.",
    hard: "Make most of them hard, for people who know the subject well, but still fair.",
};

/** Seconds added once when time runs out with an answer on its way, so it isn't judged against the next question. */
const ANSWER_GRACE_SECONDS: number = 6;

/** Words that don't count when checking whether a question holds its own answer. */
const ANSWER_FILLER_WORDS: string[] = ["a", "an", "the", "of"];

/** What a tapped answer's action starts with; then which question and its place on screen, which says nothing about which is right. */
const ANSWER_ACTION: string = "answer:";

/** How the answers are labelled, on the TV and the phones. */
const LETTERS: string[] = ["A", "B", "C", "D"];

/** Wrong answers shown beside the right one. */
const WRONG_ANSWERS: number = 3;

/** Points for a right answer. */
const RIGHT_POINTS: number = 2;

/** Points for a close answer. */
const CLOSE_POINTS: number = 1;

/** Longest topic accepted from the host; anything longer is trimmed. */
const TOPIC_CHARACTER_LIMIT: number = 60;

/** Longest question or answer accepted from the model. */
const TEXT_CHARACTER_LIMIT: number = 300;

/** One question and its answer. */
export interface QuizQuestion {
    question: string;
    answer: string;
    /** The site it was checked against, when web search found one. */
    source?: string;
    /** Three wrong answers of the same kind, before they're mixed in. */
    wrong?: string[];
    /** The answer and the wrong ones in the order they're shown. Without them it's answered out loud only. */
    choices?: string[];
}

/** Original general-knowledge questions used when the model can't supply any. */
export const FALLBACK_QUESTIONS: QuizQuestion[] = [
    { question: "Which planet in our solar system is known for its bright rings?", answer: "Saturn", wrong: ["Jupiter", "Neptune", "Uranus"] },
    { question: "What is the largest ocean on Earth?", answer: "The Pacific Ocean", wrong: ["The Atlantic Ocean", "The Indian Ocean", "The Arctic Ocean"] },
    { question: "How many sides does a hexagon have?", answer: "Six", wrong: ["Five", "Seven", "Eight"] },
    { question: "Which animal is the tallest in the world?", answer: "The giraffe", wrong: ["The elephant", "The ostrich", "The moose"] },
    { question: "What do bees collect from flowers to make honey?", answer: "Nectar", wrong: ["Pollen", "Sap", "Dew"] },
    { question: "In which country would you find the city of Kyoto?", answer: "Japan", wrong: ["China", "South Korea", "Vietnam"] },
];

/** The whole game, immutable between steps. */
export interface QuizmasterState {
    phase: "topic" | "thinking" | "setup" | "preparing" | "question" | "lockedIn" | "reveal" | "end";
    players: CartridgePlayer[];
    topic: string;
    questions: QuizQuestion[];
    /** Zero-based number of the question being asked. */
    index: number;
    /** Players who have already answered the current question. */
    answered: string[];
    /** Players whose spoken answers are waiting for a ruling; a ruling with nobody waiting is the host talking to itself. */
    heard: string[];
    /** Players talking right now. */
    speaking: string[];
    /** True once the current question has had its extra time. */
    gotGrace: boolean;
    scores: Record<string, number>;
    /** The answer to the question before the current one, shown once it has been revealed. */
    lastAnswer: string;
    lastSource: string;
    /** Who has got the current question right, when it's multiple choice and waits for everyone. */
    rightNow: string[];
    /** Who was talking when the last question ended; what they finish saying isn't for this one. */
    staleSpeakers: string[];
    /** Points from the current question, held back until the reveal so the scores can't give the answer away. */
    pending: Record<string, number>;
    /** Where setup is, once its questions are ready. */
    setup: SetupProgress | null;
    /** How many questions this game has. */
    count: number;
    /** How the questions are pitched, by level id. */
    level: string;
    /** The room's answer to the follow-up, if it gave one. */
    focus: string;
    /** Seconds for each question; null means no timer. */
    questionSeconds: number | null;
    /** Points from the question being revealed, for counting up on the TV. */
    gained: Record<string, number>;
    /** What ended the question being revealed, for the host. */
    revealWhy: string;
}

/**
 * Reads the model's questions defensively.
 * @param text whatever the model wrote, ideally a JSON array.
 * @returns the usable questions found, possibly none.
 */
export function parseQuestions(text: string, sources: string[] = [], random?: () => number): QuizQuestion[] {
    const start: number = text.indexOf("[");
    const end: number = text.lastIndexOf("]");
    if (start === -1 || end <= start) {
        return [];
    }
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
        return [];
    }
    if (Array.isArray(parsed) === false) {
        return [];
    }
    const found: QuizQuestion[] = [];
    for (const item of parsed as unknown[]) {
        const entry: { question?: unknown; answer?: unknown; source?: unknown; wrong?: unknown } = typeof item === "object" && item !== null ? item : {};
        const question: string = typeof entry.question === "string" ? entry.question.trim() : "";
        const answer: string = typeof entry.answer === "string" ? entry.answer.trim() : "";
        if (isHostSafe(question, TEXT_CHARACTER_LIMIT) === true && isHostSafe(answer, TEXT_CHARACTER_LIMIT) === true) {
            const source: string = typeof entry.source === "string" ? sourceName(entry.source, sources) : "";
            const wrong: string[] = Array.isArray(entry.wrong) === true ? (entry.wrong as unknown[]).flatMap((option: unknown) => (typeof option === "string" ? [option.trim()] : [])) : [];
            if (random !== undefined && fairChoices(answer, wrong) === false) {
                continue;
            }
            found.push({ question, answer, ...(source === "" ? {} : { source }), ...(random === undefined ? {} : { wrong, choices: shuffled([answer, ...wrong], random) }) });
        }
    }
    return found.filter((question: QuizQuestion) => givesItAway(question) === false).slice(0, MOST_QUESTIONS);
}

/**
 * Whether a question's wrong answers can stand beside the right one: three of them, all different,
 * fit to show, and the right answer not given away by being far longer than the rest.
 * @param answer the right answer.
 * @param wrong the wrong answers.
 * @returns true when they'll do.
 */
export function fairChoices(answer: string, wrong: string[]): boolean {
    const plain: string[] = [answer, ...wrong].map((option: string) => option.toLowerCase().replace(/^the\s+/, "").trim());
    const longestWrong: number = Math.max(0, ...wrong.map((option: string) => option.length));
    return wrong.length === WRONG_ANSWERS
        && new Set(plain).size === plain.length
        && wrong.every((option: string) => isHostSafe(option, TEXT_CHARACTER_LIMIT) === true)
        && answer.length <= longestWrong * 2 + 4;
}

/**
 * Whether a question gives its own answer away, which the model does when left to it, such as
 * asking which 1990 comedy leaves Kevin home alone.
 * @param question the question.
 * @returns true when the answer's words all appear in the question.
 */
export function givesItAway(question: QuizQuestion): boolean {
    const words = (text: string): string[] => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word: string) => word !== "" && ANSWER_FILLER_WORDS.includes(word) === false);
    const asked: string[] = words(question.question);
    const answer: string[] = words(question.answer);
    return answer.length > 0 && answer.every((word: string) => asked.includes(word) === true);
}

/**
 * Fills a short list of questions up to a full game from the built-in bank.
 * @param questions the questions the model supplied.
 * @param random for mixing answers, when the questions are multiple choice.
 * @param count how many a full game has.
 * @returns that many questions, or every one there is if the bank runs short.
 */
function completeQuestions(questions: QuizQuestion[], random?: () => number, count: number = QUESTION_COUNT): QuizQuestion[] {
    const bank: QuizQuestion[] = FALLBACK_QUESTIONS.map((entry: QuizQuestion) => (random === undefined ? { question: entry.question, answer: entry.answer } : { ...entry, choices: shuffled([entry.answer, ...(entry.wrong ?? [])], random) }));
    return [...questions, ...bank].slice(0, count);
}

/** Topics offered before a game. Nothing here needs a specialist or starts an argument. */
const SUGGESTED_TOPICS: string[] = ["Movies", "Animals", "Food and drink", "Music", "Space", "Geography"];

/** More topics a surprise can land on. */
const SURPRISE_TOPICS: string[] = [...SUGGESTED_TOPICS, "Inventions", "Board games", "Dinosaurs", "The human body", "Cartoons", "Oceans"];

/** The id of the choice that keeps the spoken topic. */
const OWN_TOPIC: string = "own";

/** The id of the choice that picks a topic for them. */
const SURPRISE: string = "surprise";

/** The choice before a game: a suggested topic, their own, or a surprise. */
export const QUIZMASTER_PICK: StartPick = {
    prompt: "What's the quiz on?",
    hostLine: "They can slide to a topic and tap it, or choose to say their own. If they don't, you'll surprise them.",
    choices: [{ id: SURPRISE, label: "Surprise me" }, { id: OWN_TOPIC, label: "Say your own topic" }, ...SUGGESTED_TOPICS.map((topic: string) => ({ id: topic, label: topic }))],
};

/**
 * Builds the Quizmaster cartridge.
 * @param chosen what was chosen before the game, if anything; without it the room is asked for a topic.
 * @param random a function returning [0, 1), for a surprise topic and for mixing answers.
 * @param multipleChoice false for answers out loud only, as the game was first.
 * @returns the cartridge.
 */
export function createQuizmaster(chosen?: string, random: () => number = Math.random, multipleChoice: boolean = true): Cartridge<QuizmasterState> {
    const mixing: (() => number) | undefined = multipleChoice === true ? random : undefined;
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const nameOf = (state: QuizmasterState, playerId: string): string => state.players.find((player) => player.playerId === playerId)?.name ?? "Someone";
    const scoreOf = (state: QuizmasterState, playerId: string): number => state.scores[playerId] ?? 0;

    /**
     * Sets off writing the questions on a topic.
     * @param state the state.
     * @param topic the topic.
     * @returns the step.
     */
    const prepare = (state: QuizmasterState, topic: string): Step<QuizmasterState> => {
        const request: string = [
            `Write ${state.count + EXTRA_QUESTIONS_REQUESTED} trivia questions about the topic "${state.focus === "" ? topic : `${topic}: ${state.focus}`}", pitched at general knowledge: fun for adults, none needing specialist expertise,`,
            "each with a short answer of a few words that can be said out loud. Ask plainly, like a friendly pub quiz.",
            "Only use facts you are sure of, and don't put the answer in the question.",
            ...(multipleChoice === true ? [
                `Four answers will be on screen. ${LEVEL_WORDS[state.level] ?? ""} None so easy the wrong answers look silly, and no clue in the question that points straight at the answer.`,
                "Avoid claims like \"the only\" or \"the first\" unless they're beyond doubt.",
                "Give three wrong answers of the same kind and about the same length as the right one, each believable to someone who isn't sure. No jokes, no \"all of the above\".",
            ] : []),
            `Reply with only a JSON array of objects, each with a "question" field and an "answer" field,${multipleChoice === true ? ' a "wrong" field with an array of the three wrong answers,' : ""} plus a "source" field with the address of the page it came from if you looked it up.`,
        ].join(" ");
        const next: QuizmasterState = { ...state, phase: "preparing", topic };
        const fact: ScopedFact = publicFact("preparing", `The topic is ${topic}. Say you are writing the questions now, in one short line.`);
        return { state: next, facts: [fact], nextPhaseId: "preparing", contentRequest: request, contentGrounding: { usable: (text: string) => parseQuestions(text, [], mixing).length >= state.count, cacheable: true } };
    };

    /**
     * Has a think about the topic: asks for a follow-up, with setup open meanwhile so Just start works.
     * @param state the state.
     * @param topic the topic.
     * @returns the step.
     */
    const startThinking = (state: QuizmasterState, topic: string): Step<QuizmasterState> => {
        const fact: ScopedFact = publicFact("thinking", `The topic is ${topic}. Say you're having a quick think about it, in a few words.`);
        return {
            state: { ...state, phase: "thinking", topic, setup: null, focus: "" },
            facts: [fact],
            nextPhaseId: "thinking",
            followUpRequest: { id: `follow-up-${topic}`, prompt: followUpPrompt(topic) },
            timers: { "setup-wait": FOLLOW_UP_WAIT_SECONDS },
        };
    };

    /**
     * Opens the setup questions.
     * @param state the state.
     * @param followUp the model's question, if it wrote a good one.
     * @returns the step.
     */
    const askSetup = (state: QuizmasterState, followUp: SetupQuestion | null): Step<QuizmasterState> => {
        const questions: SetupQuestion[] = [...(followUp === null ? [] : [followUp]), ...SETUP_QUESTIONS];
        return { state: { ...state, phase: "setup", setup: { questions, at: 0, chosen: {} } }, facts: [], nextPhaseId: "setup" };
    };

    /**
     * Ends setup and writes the questions, with defaults for whatever wasn't answered.
     * @param state the state.
     * @returns the step.
     */
    const finishSetup = (state: QuizmasterState): Step<QuizmasterState> => {
        const chosen: Record<string, string> = state.setup?.chosen ?? {};
        const followUp: SetupQuestion | undefined = state.setup?.questions.find((question: SetupQuestion) => question.id === "follow-up");
        const focus: string = followUp?.options.find((option) => option.id === chosen["follow-up"])?.label ?? "";
        const pace: number | null | undefined = PACE_SECONDS[chosen.time ?? "normal"];
        return prepare({ ...state, setup: null, focus, level: chosen.level ?? "medium", count: Number(chosen.count ?? QUESTION_COUNT), questionSeconds: pace === undefined ? QUESTION_SECONDS : pace }, state.topic);
    };

    /**
     * The clock for one question, if this game has one.
     * @param state the state.
     * @param index which question.
     * @returns the timers.
     */
    const questionTimers = (state: QuizmasterState, index: number): Record<string, number> => (state.questionSeconds === null ? {} : { [`question-${index}`]: state.questionSeconds });

    /**
     * Tells the host to read a question exactly.
     * @param state the state, already pointing at the question.
     * @returns the instruction.
     */
    const readInstruction = (state: QuizmasterState): string => {
        const total: number = state.questions.length;
        const on: string[] = state.questions[state.index]?.choices ?? [];
        const listed: string = on.length === 0 ? "" : ` Don't read the answers out; they're on screen as ${on.map((option: string, index: number) => `${LETTERS[index] ?? ""} ${option}`).join(", ")}, in no special order. People may tap one or say it, so "B" means that answer.`;
        return `Read question ${state.index + 1} of ${total} exactly as written, word for word: "${state.questions[state.index]?.question ?? ""}"${listed}`;
    };

    /**
     * The players with the highest score, when anyone has scored.
     * @param state the state.
     * @returns the leaders, or none when nobody scored.
     */
    const leaders = (state: QuizmasterState): CartridgePlayer[] => {
        const top: number = Math.max(0, ...state.players.map((player) => scoreOf(state, player.playerId)));
        return top === 0 ? [] : state.players.filter((player) => scoreOf(state, player.playerId) === top);
    };

    /**
     * Says who won a finished quiz.
     * @param state the finished game.
     * @returns the headline.
     */
    const endHeadline = (state: QuizmasterState): string => {
        const names: string[] = leaders(state).map((player: CartridgePlayer) => player.name);
        if (names.length === 0) {
            return "Nobody scored";
        }
        return names.length === 1 ? `${names[0] ?? ""} wins` : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""} tie`;
    };

    /**
     * Explains the points of a finished quiz in one plain line.
     * @param state the finished game.
     * @returns the line.
     */
    const endLine = (state: QuizmasterState): string => {
        const top: number = Math.max(0, ...state.players.map((player: CartridgePlayer) => scoreOf(state, player.playerId)));
        const scored: string = top === 0 ? "" : `${top} out of ${state.questions.length * RIGHT_POINTS}. `;
        return multipleChoice === true ? `${scored}${RIGHT_POINTS} points for each right answer.` : `${scored}${RIGHT_POINTS} points for a right answer, ${CLOSE_POINTS} for a close one.`;
    };

    /**
     * Reveals the current answer and moves to the next question, or ends the game after the last.
     * @param unsettled the state, with this question's points not yet added.
     * @param why what just happened, for the host.
     * @param announced true when the host has already been told the answer, in a reveal.
     * @returns the step.
     */
    const advance = (unsettled: QuizmasterState, why: string, announced: boolean = false): Step<QuizmasterState> => {
        const scores: Record<string, number> = { ...unsettled.scores };
        for (const [playerId, points] of Object.entries(unsettled.pending)) {
            scores[playerId] = (scores[playerId] ?? 0) + points;
        }
        const state: QuizmasterState = { ...unsettled, scores, pending: {} };
        const answer: string = state.questions[state.index]?.answer ?? "";
        const source: string = state.questions[state.index]?.source ?? "";
        const credit: string = state.questions[state.index]?.choices === undefined ? "" : state.rightNow.length === 0 ? " Nobody got it." : ` ${state.rightNow.join(" and ")} got it right.`;
        const reveal: string = announced === true ? "" : `${why}${credit} The answer to that question was: ${answer}. Tell them the answer. `;
        const nextIndex: number = state.index + 1;
        if (nextIndex >= state.questions.length || state.players.length === 0) {
            const finished: QuizmasterState = { ...state, phase: "end", answered: [], heard: [], lastAnswer: answer, lastSource: source, rightNow: [], pending: {}, staleSpeakers: [] };
            const board: string = state.players.map((player) => `${player.name} ${scoreOf(state, player.playerId)}`).join(", ");
            const winners: string = leaders(finished).map((player) => player.name).join(" and ");
            const verdict: string = winners === "" ? "Nobody scored." : `Winner: ${winners}.`;
            const text: string = `${reveal}That was the last question. Final scores: ${board}. ${verdict} Announce them.`;
            return { state: finished, facts: [publicFact("game-over", text)], nextPhaseId: "end" };
        }
        const next: QuizmasterState = { ...state, phase: "question", index: nextIndex, answered: [], heard: [], speaking: [], gotGrace: false, lastAnswer: answer, lastSource: source, rightNow: [], pending: {}, staleSpeakers: state.speaking };
        return {
            state: next,
            facts: [publicFact("question", announced === true ? readInstruction(next) : `${reveal}Then ${readInstruction(next)}`)],
            timers: questionTimers(next, nextIndex),
            ...(announced === true ? { nextPhaseId: "question" } : {}),
        };
    };

    /**
     * Ends a question. Four answers get the drumroll and a reveal; an answer out loud moves straight on.
     * @param unsettled the state, with this question's points not yet added.
     * @param why what just happened, for the host.
     * @returns the step.
     */
    const finishQuestion = (unsettled: QuizmasterState, why: string): Step<QuizmasterState> => {
        if (unsettled.questions[unsettled.index]?.choices === undefined || unsettled.players.length === 0) {
            return advance(unsettled, why);
        }
        return { state: { ...unsettled, phase: "lockedIn", revealWhy: why }, facts: [], nextPhaseId: "lockedIn", timers: { "reveal-build": REVEAL_BUILD_SECONDS } };
    };

    /**
     * Lights the answer: the points land here, so the scores and the answer arrive together.
     * @param locked the state with the answers locked in.
     * @returns the step.
     */
    const lightAnswer = (locked: QuizmasterState): Step<QuizmasterState> => {
        const scores: Record<string, number> = { ...locked.scores };
        for (const [playerId, points] of Object.entries(locked.pending)) {
            scores[playerId] = (scores[playerId] ?? 0) + points;
        }
        const state: QuizmasterState = { ...locked, phase: "reveal", scores, gained: locked.pending, pending: {} };
        return { state, facts: [], nextPhaseId: "reveal", timers: { "reveal-react": REVEAL_REACT_SECONDS, "reveal-next": REVEAL_HOLD_SECONDS } };
    };

    /**
     * Scores a ruled answer, and moves on after a right answer or once everyone has answered.
     * @param state the state.
     * @param ruling right, close or wrong.
     * @param playerId who answered.
     * @returns the step.
     */
    const score = (state: QuizmasterState, ruling: string, playerId: string | null): Step<QuizmasterState> => {
        const known: boolean = playerId !== null && state.players.some((player) => player.playerId === playerId);
        if (playerId === null || known === false || state.answered.includes(playerId) === true || state.heard.includes(playerId) === false) {
            return { state, facts: [] };
        }
        const points: number = ruling === "right" ? RIGHT_POINTS : ruling === "close" ? CLOSE_POINTS : 0;
        const next: QuizmasterState = {
            ...state,
            answered: [...state.answered, playerId],
            heard: state.heard.filter((candidate: string) => candidate !== playerId),
            ...(state.questions[state.index]?.choices === undefined
                ? { scores: points === 0 ? state.scores : { ...state.scores, [playerId]: scoreOf(state, playerId) + points } }
                : { pending: points === 0 ? state.pending : { ...state.pending, [playerId]: points } }),
        };
        const name: string = nameOf(state, playerId);
        if (ruling === "right" && state.questions[state.index]?.choices === undefined) {
            return advance(next, `${name} got it right.`);
        }
        const counted: QuizmasterState = ruling === "right" ? { ...next, rightNow: [...next.rightNow, name] } : next;
        if (state.players.every((player) => counted.answered.includes(player.playerId)) === true) {
            return finishQuestion(counted, "Everyone has answered.");
        }
        return { state: counted, facts: [] };
    };

    return {
        manifest: QUIZMASTER_MANIFEST,

        init(players: CartridgePlayer[]): Step<QuizmasterState> {
            const state: QuizmasterState = { phase: "topic", setup: null, count: QUESTION_COUNT, level: "medium", focus: "", questionSeconds: QUESTION_SECONDS, gained: {}, revealWhy: "", players, topic: "", questions: [], index: 0, answered: [], heard: [], speaking: [], gotGrace: false, scores: {}, lastAnswer: "", lastSource: "", rightNow: [], pending: {}, staleSpeakers: [] };
            if (chosen === SURPRISE) {
                return prepare(state, SURPRISE_TOPICS[Math.floor(random() * SURPRISE_TOPICS.length)] ?? "Animals");
            }
            if (chosen !== undefined && chosen !== OWN_TOPIC) {
                return startThinking(state, chosen);
            }
            return { state, facts: [publicFact("ask-topic", "Welcome them to the quiz and ask what topic they would like to be quizzed on.")], nextPhaseId: "topic" };
        },

        phaseOf(state: QuizmasterState): string {
            return state.phase;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: QuizmasterState): LegalAction[] {
            return state.phase === "question" ? [{ actionId: "skip", label: "Skip this question" }, { actionId: "changeTopic", label: "Change the topic" }] : [];
        },

        apply(state: QuizmasterState, playerId: string, actionId: string): Step<QuizmasterState> {
            if ((state.phase === "thinking" || state.phase === "setup") && actionId === SETUP_START) {
                return finishSetup(state);
            }
            if (state.phase === "setup" && state.setup !== null) {
                const progress: SetupProgress | null = answerSetup(state.setup, actionId);
                if (progress === null) {
                    return { state, facts: [] };
                }
                const answered: QuizmasterState = { ...state, setup: progress };
                return setupFinished(progress) === true ? finishSetup(answered) : { state: answered, facts: [] };
            }
            if (state.phase === "question" && state.questionSeconds === null && actionId === REVEAL_NOW) {
                return finishQuestion(state, "The host of the room asked to see the answer.");
            }
            if (state.phase === "question" && actionId.startsWith(ANSWER_ACTION) === true) {
                const question: QuizQuestion | undefined = state.questions[state.index];
                const [asked, place] = actionId.slice(ANSWER_ACTION.length).split(":").map(Number);
                const tapped: string | undefined = question?.choices?.[place ?? -1];
                if (asked !== state.index || tapped === undefined || state.answered.includes(playerId) === true) {
                    return { state, facts: [] };
                }
                return score({ ...state, heard: [...state.heard.filter((candidate: string) => candidate !== playerId), playerId] }, tapped === question?.answer ? "right" : "wrong", playerId);
            }
            if (state.phase === "topic" && actionId === SURPRISE) {
                return prepare(state, SURPRISE_TOPICS[Math.floor(random() * SURPRISE_TOPICS.length)] ?? "Animals");
            }
            if (state.phase === "question" && actionId === "changeTopic") {
                const fresh: QuizmasterState = { ...state, phase: "topic", topic: "", questions: [], index: 0, answered: [], heard: [], speaking: [], gotGrace: false, lastAnswer: "", lastSource: "", rightNow: [], pending: {}, staleSpeakers: [] };
                return { state: fresh, facts: [publicFact("ask-topic", "They want a new topic. Scores stay. Ask what topic they would like next.")], nextPhaseId: "topic" };
            }
            if (state.phase !== "question" || actionId !== "skip") {
                return { state, facts: [] };
            }
            return advance(state, "The players skipped this question.");
        },

        onEvent(state: QuizmasterState, event: RoomEvent): Step<QuizmasterState> {
            if (event.type === "playerLeft") {
                const players: CartridgePlayer[] = state.players.filter((player) => player.playerId !== event.playerId);
                const remaining: QuizmasterState = { ...state, players, heard: state.heard.filter((playerId: string) => playerId !== event.playerId), speaking: state.speaking.filter((playerId: string) => playerId !== event.playerId) };
                if (state.phase !== "question") {
                    return { state: remaining, facts: [] };
                }
                const settled: boolean = players.length === 0 || players.every((player) => state.answered.includes(player.playerId));
                return settled === true ? finishQuestion(remaining, "Everyone left has answered.") : { state: remaining, facts: [] };
            }
            if (event.type === "followUpReady") {
                return state.phase === "thinking" ? askSetup(state, parseFollowUp(event.text)) : { state, facts: [] };
            }
            if (event.type === "timerFired") {
                if (state.phase === "thinking" && event.timerId === "setup-wait") {
                    return askSetup(state, null);
                }
                if (state.phase === "lockedIn" && event.timerId === "reveal-build") {
                    return lightAnswer(state);
                }
                if (state.phase === "reveal" && event.timerId === "reveal-react") {
                    const credit: string = state.rightNow.length === 0 ? "Nobody got it." : `${state.rightNow.join(" and ")} got it right.`;
                    return { state, facts: [publicFact("reveal", `${state.revealWhy} ${credit} The answer was: ${state.questions[state.index]?.answer ?? ""}. React in one short line that includes the answer. Don't ask anything; the next question comes on its own.`)] };
                }
                if (state.phase === "reveal" && event.timerId === "reveal-next") {
                    return advance({ ...state, gained: {} }, "", true);
                }
                if (state.phase !== "question" || event.timerId !== `question-${state.index}`) {
                    return { state, facts: [] };
                }
                if (state.gotGrace === false && state.speaking.length + state.heard.length > 0) {
                    return { state: { ...state, gotGrace: true }, facts: [], timers: { [event.timerId]: ANSWER_GRACE_SECONDS } };
                }
                return finishQuestion(state, "Time is up.");
            }
            if (event.type === "speechStarted") {
                return { state: { ...state, speaking: [...state.speaking, event.playerId] }, facts: [] };
            }
            if (event.type === "speechEnded") {
                const seated: boolean = state.players.some((player) => player.playerId === event.playerId);
                // Speech that began before this question was for the last one, even if it finishes now.
                const late: boolean = state.staleSpeakers.includes(event.playerId);
                const eligible: boolean = state.phase === "question" && seated === true && late === false && state.answered.includes(event.playerId) === false;
                const speaking: string[] = state.speaking.filter((playerId: string) => playerId !== event.playerId);
                const staleSpeakers: string[] = state.staleSpeakers.filter((playerId: string) => playerId !== event.playerId);
                const secondTry: boolean = state.phase === "question" && seated === true && state.answered.includes(event.playerId) === true;
                const reminder: ScopedFact[] = secondTry === true ? [publicFact("second-try", "That player has already answered this question, so anything more from them doesn't count. If they just gave another answer, say in a few words that it's one try each, and don't say whether it's right. If it was only chat, treat it as chat.")] : [];
                return { state: { ...state, speaking, staleSpeakers, heard: eligible === true ? [...state.heard, event.playerId] : state.heard }, facts: late === true ? [] : reminder };
            }
            if (event.type === "contentReady" && state.phase === "preparing") {
                const questions: QuizQuestion[] = completeQuestions(parseQuestions(event.text, event.sources, mixing), mixing, state.count);
                const next: QuizmasterState = { ...state, phase: "question", questions, index: 0, answered: [], heard: [] };
                return {
                    state: next,
                    facts: [publicFact("question", `The questions are ready. Say the quiz is starting, ${multipleChoice === true ? "tap an answer or say it" : "answers are out loud"}, one try each. Then ${readInstruction(next)}`)],
                    nextPhaseId: "question",
                    timers: questionTimers(next, 0),
                };
            }
            if (event.type !== "hostRuled") {
                return { state, facts: [] };
            }
            if (state.phase === "topic" && event.ruling === "topic") {
                const topic: string = event.detail.replace(/[\r\n"\\]+/g, " ").trim().slice(0, TOPIC_CHARACTER_LIMIT);
                if (topic === "") {
                    return { state, facts: [] };
                }
                return startThinking(state, topic);
            }
            if (state.phase === "question" && (event.ruling === "right" || event.ruling === "close" || event.ruling === "wrong")) {
                return score(state, event.ruling, event.playerId);
            }
            return { state, facts: [] };
        },

        publicScene(state: QuizmasterState): Scene {
            if (state.phase === "topic") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: "Quizmaster" }, { type: "text", text: "Say or type a topic.", emphasis: "large" }] };
            }
            if (state.phase === "thinking") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: "Quizmaster", kicker: state.topic }, { type: "text", text: `${HOST_NAME} is thinking…`, emphasis: "large" }] };
            }
            if (state.phase === "setup" && state.setup !== null) {
                return { mood: "neutral", transition: "cut", blocks: setupBlocks(state.setup, state.topic) };
            }
            if (state.phase === "preparing") {
                const waiting: SceneBlock[] = [{ type: "title", text: "Quizmaster", kicker: state.topic }, { type: "text", text: "Writing the questions…", emphasis: "whisper" }];
                return { mood: "neutral", transition: "fade", blocks: waiting };
            }
            const winners: string[] = leaders(state).map((player) => player.playerId);
            const rows: TallyRow[] = state.players.map((player) => ({
                label: player.name,
                count: scoreOf(state, player.playerId),
                ...(state.phase === "end" && winners.includes(player.playerId) === true ? { highlight: true } : {}),
            }));
            const last: SceneBlock[] = state.lastAnswer === "" ? [] : [{ type: "text", text: `Last answer: ${state.lastAnswer}${state.lastSource === "" ? "" : ` · Source: ${state.lastSource}`}`, emphasis: "whisper" }];
            if (state.phase === "end") {
                const board: SceneBlock[] = [{ type: "title", text: endHeadline(state), kicker: "Final scores" }, { type: "text", text: endLine(state), emphasis: "large" }, { type: "tally", title: "Scores", rows }, ...last];
                return { mood: winners.length > 0 ? "victory" : "neutral", transition: "fade", blocks: board };
            }
            const onScreen: string[] = state.questions[state.index]?.choices ?? [];
            const lettered: string[] = onScreen.map((option: string, index: number) => `${LETTERS[index] ?? ""}. ${option}`);
            if (state.phase === "lockedIn") {
                return {
                    mood: "neutral",
                    transition: "cut",
                    blocks: [
                        { type: "title", text: state.questions[state.index]?.question ?? "", kicker: state.topic },
                        { type: "choices", options: lettered, locked: true },
                        { type: "text", text: "Answers are in.", emphasis: "large" },
                    ],
                };
            }
            if (state.phase === "reveal") {
                const gotIt: string = state.rightNow.length === 0 ? "Nobody got it." : `${state.rightNow.join(" and ")} got it!`;
                return {
                    mood: "neutral",
                    transition: "cut",
                    blocks: [
                        { type: "title", text: state.questions[state.index]?.question ?? "", kicker: state.topic },
                        { type: "choices", options: lettered, right: onScreen.indexOf(state.questions[state.index]?.answer ?? "") },
                        { type: "text", text: gotIt, emphasis: "large" },
                        { type: "tally", title: "Scores", rows: state.players.map((player) => ({ label: player.name, count: scoreOf(state, player.playerId), gained: state.gained[player.playerId] ?? 0 })) },
                    ],
                };
            }
            if (onScreen.length > 0) {
                // Four answers need the room, so the scores move up beside the topic.
                const standings: string = state.players.map((player) => `${player.name} ${scoreOf(state, player.playerId)}`).join(", ");
                return {
                    mood: "neutral",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: state.questions[state.index]?.question ?? "", kicker: `${state.topic} · ${standings}` },
                        { type: "choices", options: lettered },
                        ...(state.questionSeconds === null ? [] : [{ type: "timer" as const, seconds: state.questionSeconds, running: true }]),
                        { type: "progress", label: "Question", current: state.index + 1, max: state.questions.length },
                    ],
                };
            }
            return {
                mood: "neutral",
                transition: "fade",
                blocks: [
                    { type: "title", text: state.questions[state.index]?.question ?? "", kicker: state.topic },
                    { type: "progress", label: "Question", current: state.index + 1, max: state.questions.length },
                    { type: "tally", title: "Scores", rows },
                    ...last,
                ],
            };
        },

        privateControls(state: QuizmasterState, playerId: string): Control[] {
            if (state.phase === "topic") {
                return [{ type: "buttons", prompt: "Say or type a topic.", options: [{ id: SURPRISE, label: "Surprise me instead" }] }];
            }
            if (state.phase === "thinking" || state.phase === "setup") {
                return setupControls(state.setup, `${HOST_NAME} is thinking…`);
            }
            if (state.phase === "preparing") {
                return [{ type: "waiting", text: `${HOST_NAME} is writing the questions.` }];
            }
            if (state.phase === "end") {
                return [{ type: "waiting", text: `${endHeadline(state)}. ${endLine(state)}` }];
            }
            const seated: boolean = state.players.some((player) => player.playerId === playerId);
            if (state.phase === "lockedIn") {
                return [{ type: "waiting", text: "Answers are in. Watch the TV." }];
            }
            if (state.phase === "reveal") {
                const gained: number = state.gained[playerId] ?? 0;
                return [{ type: "waiting", text: seated === false ? "Watch the TV." : gained > 0 ? `You got it! +${gained}` : "Not this time." }];
            }
            const revealNow: Control[] = state.questionSeconds === null ? [{ type: "buttons", options: [{ id: REVEAL_NOW, label: "Reveal now", holderOnly: true }] }] : [];
            const onScreen: string[] = state.questions[state.index]?.choices ?? [];
            if (onScreen.length > 0 && seated === true && state.answered.includes(playerId) === false) {
                return [{ type: "choice", prompt: "Tap your answer, or say it", multiple: false, options: onScreen.map((option: string, index: number) => ({ id: `${ANSWER_ACTION}${state.index}:${index}`, label: `${LETTERS[index] ?? ""}. ${option}` })) }, ...revealNow];
            }
            const line: string = state.answered.includes(playerId) === true ? "Your answer's in" : "Answer out loud. One try.";
            return [{ type: "waiting", text: line }, ...revealNow];
        },

        turn(state: QuizmasterState): Turn | null {
            if (state.phase === "topic") {
                return { kind: "anyone", label: "" };
            }
            if (state.phase === "question") {
                return { kind: "everyone", playerIds: state.players.map((player) => player.playerId), doneIds: state.answered, label: "Everyone answers once" };
            }
            return null;
        },

        hostFacts(state: QuizmasterState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase !== "question") {
                return [];
            }
            const current: QuizQuestion | undefined = state.questions[state.index];
            return [
                { scope: { kind: "host" }, kind: "answer", text: `The answer to the current question is: ${current?.answer ?? ""}. Never say it until the game tells you to.` },
                { scope: { kind: "public" }, kind: "current-question", text: `Question ${state.index + 1} of ${state.questions.length} is: ${current?.question ?? ""}` },
            ];
        },

        outcome(state: QuizmasterState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            const winners: CartridgePlayer[] = leaders(state);
            if (winners.length === 0) {
                return "Nobody scored.";
            }
            return `${winners.map((player) => player.name).join(" and ")} won with ${scoreOf(state, winners[0]?.playerId ?? "")} points.`;
        },
    };
}
