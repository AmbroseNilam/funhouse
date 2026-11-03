// Quizmaster's rules core. The host's model writes six questions on the players' topic, and only the
// host is told each answer. Right answers score 2, close ones 1; each player answers once per question.

import type { Turn } from "../../shared/turn.ts";
import { HOST_NAME } from "../../shared/brand.ts";
import type { Cartridge, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { QUIZMASTER_MANIFEST } from "./manifest.ts";

/** Questions in one game. */
export const QUESTION_COUNT: number = 6;

/** Seconds a question stays open before the game moves on. */
export const QUESTION_SECONDS: number = 30;

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
}

/** Original general-knowledge questions used when the model can't supply any. */
const FALLBACK_QUESTIONS: QuizQuestion[] = [
    { question: "Which planet in our solar system is known for its bright rings?", answer: "Saturn" },
    { question: "What is the largest ocean on Earth?", answer: "The Pacific Ocean" },
    { question: "How many sides does a hexagon have?", answer: "Six" },
    { question: "Which animal is the tallest in the world?", answer: "The giraffe" },
    { question: "What do bees collect from flowers to make honey?", answer: "Nectar" },
    { question: "In which country would you find the city of Kyoto?", answer: "Japan" },
];

/** The whole game, immutable between steps. */
export interface QuizmasterState {
    phase: "topic" | "preparing" | "question" | "end";
    players: CartridgePlayer[];
    topic: string;
    questions: QuizQuestion[];
    /** Zero-based number of the question being asked. */
    index: number;
    /** Players who have already answered the current question. */
    answered: string[];
    /** Players whose spoken answers are waiting for a ruling; a ruling with nobody waiting is the host talking to itself. */
    heard: string[];
    scores: Record<string, number>;
    /** The answer to the question before the current one, shown once it has been revealed. */
    lastAnswer: string;
}

/**
 * Reads the model's questions defensively.
 * @param text whatever the model wrote, ideally a JSON array.
 * @returns the usable questions found, possibly none.
 */
export function parseQuestions(text: string): QuizQuestion[] {
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
        const entry: { question?: unknown; answer?: unknown } = typeof item === "object" && item !== null ? item : {};
        const question: string = typeof entry.question === "string" ? entry.question.trim() : "";
        const answer: string = typeof entry.answer === "string" ? entry.answer.trim() : "";
        if (question !== "" && answer !== "" && question.length <= TEXT_CHARACTER_LIMIT && answer.length <= TEXT_CHARACTER_LIMIT) {
            found.push({ question, answer });
        }
    }
    return found.slice(0, QUESTION_COUNT);
}

/**
 * Fills a short list of questions up to a full game from the built-in bank.
 * @param questions the questions the model supplied.
 * @returns exactly QUESTION_COUNT questions.
 */
function completeQuestions(questions: QuizQuestion[]): QuizQuestion[] {
    return [...questions, ...FALLBACK_QUESTIONS].slice(0, QUESTION_COUNT);
}

/**
 * Builds the Quizmaster cartridge.
 * @returns the cartridge.
 */
export function createQuizmaster(): Cartridge<QuizmasterState> {
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const nameOf = (state: QuizmasterState, playerId: string): string => state.players.find((player) => player.playerId === playerId)?.name ?? "Someone";
    const scoreOf = (state: QuizmasterState, playerId: string): number => state.scores[playerId] ?? 0;

    /**
     * Tells the host to read a question exactly.
     * @param state the state, already pointing at the question.
     * @returns the instruction.
     */
    const readInstruction = (state: QuizmasterState): string => {
        const total: number = state.questions.length;
        return `Read question ${state.index + 1} of ${total} exactly as written, word for word: "${state.questions[state.index]?.question ?? ""}"`;
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
     * Reveals the current answer and moves to the next question, or ends the game after the last.
     * @param state the state.
     * @param why what just happened, for the host.
     * @returns the step.
     */
    const advance = (state: QuizmasterState, why: string): Step<QuizmasterState> => {
        const answer: string = state.questions[state.index]?.answer ?? "";
        const reveal: string = `${why} The answer to that question was: ${answer}. Tell them the answer.`;
        const nextIndex: number = state.index + 1;
        if (nextIndex >= state.questions.length || state.players.length === 0) {
            const finished: QuizmasterState = { ...state, phase: "end", answered: [], heard: [], lastAnswer: answer };
            const board: string = state.players.map((player) => `${player.name} ${scoreOf(state, player.playerId)}`).join(", ");
            const winners: string = leaders(finished).map((player) => player.name).join(" and ");
            const verdict: string = winners === "" ? "Nobody scored." : `Winner: ${winners}.`;
            const text: string = `${reveal} That was the last question. Final scores: ${board}. ${verdict} Announce them.`;
            return { state: finished, facts: [publicFact("game-over", text)], nextPhaseId: "end" };
        }
        const next: QuizmasterState = { ...state, index: nextIndex, answered: [], heard: [], lastAnswer: answer };
        return {
            state: next,
            facts: [publicFact("question", `${reveal} Then ${readInstruction(next)}`)],
            timers: { [`question-${nextIndex}`]: QUESTION_SECONDS },
        };
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
            scores: points === 0 ? state.scores : { ...state.scores, [playerId]: scoreOf(state, playerId) + points },
        };
        const name: string = nameOf(state, playerId);
        if (ruling === "right") {
            return advance(next, `${name} got it right.`);
        }
        if (state.players.every((player) => next.answered.includes(player.playerId)) === true) {
            return advance(next, "Everyone has answered.");
        }
        return { state: next, facts: [] };
    };

    return {
        manifest: QUIZMASTER_MANIFEST,

        init(players: CartridgePlayer[]): Step<QuizmasterState> {
            const state: QuizmasterState = { phase: "topic", players, topic: "", questions: [], index: 0, answered: [], heard: [], scores: {}, lastAnswer: "" };
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
            return state.phase === "question" ? [{ actionId: "skip", label: "Skip this question" }] : [];
        },

        apply(state: QuizmasterState, _playerId: string, actionId: string): Step<QuizmasterState> {
            if (state.phase !== "question" || actionId !== "skip") {
                return { state, facts: [] };
            }
            return advance(state, "The players skipped this question.");
        },

        onEvent(state: QuizmasterState, event: RoomEvent): Step<QuizmasterState> {
            if (event.type === "playerLeft") {
                const players: CartridgePlayer[] = state.players.filter((player) => player.playerId !== event.playerId);
                const remaining: QuizmasterState = { ...state, players, heard: state.heard.filter((playerId: string) => playerId !== event.playerId) };
                if (state.phase !== "question") {
                    return { state: remaining, facts: [] };
                }
                const settled: boolean = players.length === 0 || players.every((player) => state.answered.includes(player.playerId));
                return settled === true ? advance(remaining, "Everyone left has answered.") : { state: remaining, facts: [] };
            }
            if (event.type === "timerFired") {
                if (state.phase !== "question" || event.timerId !== `question-${state.index}`) {
                    return { state, facts: [] };
                }
                return advance(state, "Time is up.");
            }
            if (event.type === "speechEnded") {
                const seated: boolean = state.players.some((player) => player.playerId === event.playerId);
                const eligible: boolean = state.phase === "question" && seated === true && state.answered.includes(event.playerId) === false;
                return eligible === true ? { state: { ...state, heard: [...state.heard, event.playerId] }, facts: [] } : { state, facts: [] };
            }
            if (event.type === "contentReady" && state.phase === "preparing") {
                const questions: QuizQuestion[] = completeQuestions(parseQuestions(event.text));
                const next: QuizmasterState = { ...state, phase: "question", questions, index: 0, answered: [], heard: [] };
                return {
                    state: next,
                    facts: [publicFact("question", `The questions are ready. Say the quiz is starting, answers are out loud, one try each. Then ${readInstruction(next)}`)],
                    nextPhaseId: "question",
                    timers: { "question-0": QUESTION_SECONDS },
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
                const request: string = [
                    `Write ${QUESTION_COUNT} trivia questions about the topic "${topic}", pitched at general knowledge: fun for adults, none needing specialist expertise,`,
                    "each with a short answer of a few words that can be said out loud.",
                    "Reply with only a JSON array of objects, each with a \"question\" field and an \"answer\" field.",
                ].join(" ");
                const next: QuizmasterState = { ...state, phase: "preparing", topic };
                const fact: ScopedFact = publicFact("preparing", `The topic is ${topic}. Say you are writing the questions now, in one short line.`);
                return { state: next, facts: [fact], nextPhaseId: "preparing", contentRequest: request };
            }
            if (state.phase === "question" && (event.ruling === "right" || event.ruling === "close" || event.ruling === "wrong")) {
                return score(state, event.ruling, event.playerId);
            }
            return { state, facts: [] };
        },

        publicScene(state: QuizmasterState): Scene {
            if (state.phase === "topic") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: "Quizmaster" }, { type: "text", text: "Choose a topic…", emphasis: "whisper" }] };
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
            const last: SceneBlock[] = state.lastAnswer === "" ? [] : [{ type: "text", text: `Last answer: ${state.lastAnswer}`, emphasis: "whisper" }];
            if (state.phase === "end") {
                const board: SceneBlock[] = [{ type: "title", text: "Quizmaster", kicker: "Final scores" }, { type: "tally", title: "Scores", rows }, ...last];
                return { mood: winners.length > 0 ? "victory" : "neutral", transition: "fade", blocks: board };
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
                return [{ type: "waiting", text: "Say a topic out loud." }];
            }
            if (state.phase === "preparing") {
                return [{ type: "waiting", text: `${HOST_NAME} is writing the questions.` }];
            }
            if (state.phase === "end") {
                return [{ type: "waiting", text: "That's the quiz." }];
            }
            const line: string = state.answered.includes(playerId) === true ? "Your answer's in" : "Answer out loud. One try.";
            return [{ type: "waiting", text: line }];
        },

        turn(state: QuizmasterState): Turn | null {
            if (state.phase === "topic") {
                return { kind: "anyone", label: "Anyone can pick the topic" };
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
