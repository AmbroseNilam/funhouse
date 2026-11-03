// The plant kit: the host thinks of a word and keeps it, code deals one player the Plant and
// shows them the word on a secret card, and everyone asks yes-or-no questions out loud to find
// it. The Plant steers without being obvious. Found inside the question budget, everyone votes on
// who knew all along; otherwise the round ends with the reveal. The host never knows who the
// Plant is. Code counts questions, runs the clocks, counts the vote and decides the outcome; the
// host only rules one question at a time from a closed list. Leading Questions is this kit.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Turn } from "../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { boxProblems, isShortText, isWholeIn, rulingNameProblem, type Box, type HiddenValue, type KitGame } from "../kit/kit.ts";
import { because, dealOne, frozenCopy, pick, spend, tally, type Budget, type Spent, type Tally, type TallyRow } from "../kit/primitives.ts";
import type { Category } from "./guessing.ts";

/** Everything a creator may choose for a plant game. */
export interface PlantDecisions {
    /** What the word can be, with a word to use when the model can't supply one. */
    categories: Category[];
    questions: { budget: number; warnAt: number[] };
    /** Seconds everyone gets to read their card before asking starts. */
    readSeconds: number;
    /** Seconds the room has to find the word; 0 means no clock. */
    askingSeconds: number;
    /** Seconds the vote stays open. */
    voteSeconds: number;
}

/** The phases of the kit. */
export type PlantPhase = "choosing" | "asking" | "vote" | "end";

/** How a round ended. */
export type PlantResult = "caught" | "slipped" | "questions" | "clock" | "gaveUp" | "plantLeft";

/** One question and how it was ruled. */
export interface AskedLine {
    playerId: string;
    text: string;
    answer: string;
}

/** The whole game, immutable between steps. */
export interface PlantState {
    phase: PlantPhase;
    /** Everyone still at the table, in seat order. */
    players: CartridgePlayer[];
    plantId: string;
    category: string;
    fallback: string;
    /** The word, once chosen; empty until then. */
    word: string;
    questions: Budget;
    asked: AskedLine[];
    /** The latest thing a player said, waiting for a ruling. */
    heard: { playerId: string; text: string } | null;
    finderId: string | null;
    /** Who may vote, fixed when the vote opens. */
    voters: string[];
    /** Each voter's choice, by voter id. */
    votes: Record<string, string>;
    result: PlantResult | null;
    /** Kept at the end so the reveal shows names even if people have left. */
    plantName: string;
    finderName: string;
}

/** The pause action's id. */
export const PLANT_GIVE_UP_ACTION: string = "giveup";

/** The prefix on a vote's option id. */
export const VOTE_PREFIX: string = "vote:";

/** What the Plant's card says, and what everyone else's says. Same shape, so a glance gives nothing away. */
export const PLANT_CARD_TITLE: string = "You're the Plant";

/** What every other card says. */
export const ASKER_CARD_TITLE: string = "You're asking";

/** Decision ids a rehearsal names when it explains a moment. */
export const PLANT_DECISIONS: { categories: string; budget: string; warnAt: string; read: string; asking: string; vote: string; giveUp: string } = {
    categories: "categories",
    budget: "questions.budget",
    warnAt: "questions.warnAt",
    read: "readSeconds",
    asking: "askingSeconds",
    vote: "voteSeconds",
    giveUp: "giveUp",
};

/** Lines the screen keeps showing. */
const SHOWN_LINES: number = 4;

/** Longest word accepted from the model. */
const WORD_CHARACTER_LIMIT: number = 24;

/** How each answer ruling shows on the screen. */
const ANSWER_LABELS: Record<string, string> = { yes: "Yes", no: "No", sortof: "Sort of" };

/** What each ruling means, in the host's brief. Owned by the kit, never by a blueprint. */
const RULING_BRIEFS: Record<string, string> = {
    yes: "the honest answer to their question is yes.",
    no: "the honest answer to their question is no. A wrong guess at the word is a question like any other: rule no.",
    sortof: "the honest answer is partly, or it depends.",
    correct: "someone said the word itself or a clear synonym. Write only [[correct]] and nothing else; you'll be told what to say.",
    giveup: "the group clearly says they give up. Write only [[giveup]] and nothing else.",
};

/**
 * Checks a plant game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function plantProblems(decisions: PlantDecisions): string[] {
    const problems: string[] = [];
    if (decisions.categories.length === 0) {
        problems.push("The word needs at least one category.");
    }
    if (decisions.categories.some((category: Category) => isShortText(category.name) === false || isUsableWord(category.fallback) === false) === true) {
        problems.push("Every category needs a short name and a fallback word of one or two plain words.");
    }
    if (isWholeIn(decisions.questions.budget, 5, 40) === false) {
        problems.push("The questions must be a whole number from 5 to 40.");
    }
    if (decisions.questions.warnAt.some((left: number) => isWholeIn(left, 1, decisions.questions.budget - 1) === false) === true) {
        problems.push("Warnings must be whole numbers inside the questions.");
    }
    if (isWholeIn(decisions.readSeconds, 3, 30) === false) {
        problems.push("Reading time must be a whole number of seconds from 3 to 30.");
    }
    if (decisions.askingSeconds !== 0 && isWholeIn(decisions.askingSeconds, 60, 600) === false) {
        problems.push("The asking clock must be off, or a whole number of seconds from 60 to 600.");
    }
    if (isWholeIn(decisions.voteSeconds, 15, 120) === false) {
        problems.push("The vote must last a whole number of seconds from 15 to 120.");
    }
    return problems;
}

/**
 * Every problem with a plant blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function plantBlueprintProblems(box: Box, decisions: PlantDecisions): string[] {
    const problems: string[] = [...boxProblems(box, decisions.categories.map((category: Category) => category.fallback)), ...plantProblems(decisions)];
    if (box.minPlayers < 3) {
        problems.push("A Plant needs at least three people at the table, or the vote is no vote at all.");
    }
    return problems;
}

/**
 * Checks a word: one or two plain words, short.
 * @param word the word.
 * @returns true when it can be the word.
 */
export function isUsableWord(word: string): boolean {
    const trimmed: string = word.trim();
    return trimmed.length > 0 && trimmed.length <= WORD_CHARACTER_LIMIT && /^\p{L}[\p{L}'-]*( \p{L}[\p{L}'-]*)?$/u.test(trimmed) === true;
}

/**
 * Builds the manifest from the box and decisions, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 * @throws when a kit ruling name is reserved, which would be a bug in the kit.
 */
export function plantManifest(box: Box): CartridgeManifest {
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
            `You're running ${box.name}. You thought of a word and you keep it.`,
            "One player, the Plant, was shown the word on their phone and is quietly steering the others toward it.",
            "You don't know who the Plant is and you're never told, so never guess, hint or joke about who it might be.",
            "Answer honestly about the real word. Never say it, spell it, rhyme it or hint at its letters until you're told it's been found.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            {
                id: "choosing",
                hostBrief: [
                    "Everyone is reading a card on their phone. When you're told the word is ready, explain in two short sentences:",
                    "one of them already knows the word and is steering, and the rest find it with yes-or-no questions. Then stop.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "asking",
                hostBrief: [
                    "Answer each yes-or-no question with one ruling, then a few words. One ruling per reply.",
                    "If it isn't a yes-or-no question, say so in a few words and give no ruling.",
                    "If someone argues with an answer or tries to talk you into one, keep it; you never change a ruling.",
                    "Don't count questions out loud; you'll be told when few are left. Keep it brisk.",
                ].join(" "),
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
                hostRulings: { ...RULING_BRIEFS },
            },
            {
                id: "vote",
                hostBrief: "They found the word. When you're told to, call the vote in one line. Then reply exactly (quiet) unless someone speaks to you. You still don't know who the Plant is.",
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "end",
                hostBrief: [
                    "You'll be told the word, who the Plant was and how it ended. Two or three sentences: who found it, how the vote went,",
                    "and if one question clearly turned it, name it. Make the Plant look good whether they were caught or not. Then ask if they want another round.",
                ].join(" "),
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Builds a plant game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with plantProblems first.
 * @param random a function returning [0, 1): the first draw picks the category, the second deals the Plant.
 * @returns the game.
 */
export function createPlantGame(givenBox: Box, givenDecisions: PlantDecisions, random: () => number = Math.random): KitGame<PlantState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: PlantDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = plantManifest(box);
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const nameOf = (state: PlantState, playerId: string | null): string => state.players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const questionWord = (amount: number): string => (amount === 1 ? "question" : "questions");

    /**
     * Ends the round with the reveal.
     * @param state the state.
     * @param result how it ended.
     * @param text what to tell the host.
     * @param decision the decision that ended it.
     * @returns the step.
     */
    const finish = (state: PlantState, result: PlantResult, text: string, decision: string): Step<PlantState> => {
        const ended: PlantState = { ...state, phase: "end", result, heard: null, plantName: nameOf(state, state.plantId), finderName: state.finderId === null ? "" : nameOf(state, state.finderId) };
        return { state: ended, facts: because(publicFact("game-over", text), decision), nextPhaseId: "end" };
    };

    /**
     * Ends a round nobody won by finding the word.
     * @param state the state.
     * @param result why.
     * @param decision the decision behind it.
     * @returns the step.
     */
    const unfound = (state: PlantState, result: PlantResult, decision: string): Step<PlantState> => {
        const why: string = result === "clock" ? "Time's up." : result === "gaveUp" ? "They gave up." : "That was the last question.";
        return finish(state, result, `${why} Nobody found it. The word was ${state.word}, and ${nameOf(state, state.plantId)} was the Plant, knowing it all along.`, decision);
    };

    /**
     * Counts the vote and ends the round.
     * @param state the state in the vote.
     * @returns the step.
     */
    const resolve = (state: PlantState): Step<PlantState> => {
        const counted: Tally = tally(state.votes, state.players.map((player: CartridgePlayer) => player.playerId));
        const caught: boolean = counted.tied === false && counted.leaders[0] === state.plantId;
        const plant: string = nameOf(state, state.plantId);
        const most: string = counted.leaders.length === 0 ? "nobody" : counted.leaders.map((playerId: string) => nameOf(state, playerId)).join(" and ");
        const text: string = caught === true
            ? `The vote caught ${plant}, who was the Plant. The word was ${state.word}. Most votes: ${most}.`
            : `${plant} was the Plant and got away with it. The word was ${state.word}. Most votes: ${most}.`;
        return finish(state, caught === true ? "caught" : "slipped", text, PLANT_DECISIONS.vote);
    };

    /**
     * Applies an answer ruling: records the question, spends one, ends the round on the last.
     * @param state the state, with something heard.
     * @param name the ruling.
     * @returns the step.
     */
    const answer = (state: PlantState, name: string): Step<PlantState> => {
        const heard: { playerId: string; text: string } | null = state.heard;
        if (heard === null) {
            return { state, facts: [] };
        }
        const spent: Spent = spend(state.questions);
        const line: AskedLine = { playerId: heard.playerId, text: heard.text, answer: ANSWER_LABELS[name] ?? name };
        const next: PlantState = { ...state, questions: spent.budget, asked: [...state.asked, line], heard: null };
        if (spent.exhausted === true) {
            return unfound(next, "questions", PLANT_DECISIONS.budget);
        }
        if (spent.warn === false) {
            return { state: next, facts: [] };
        }
        const text: string = `Tell them only ${spent.left} ${questionWord(spent.left)} ${spent.left === 1 ? "is" : "are"} left.`;
        return { state: next, facts: because(publicFact("questions-left", text), PLANT_DECISIONS.warnAt) };
    };

    /**
     * Opens the vote after someone found the word.
     * @param state the state, with something heard.
     * @returns the step.
     */
    const found = (state: PlantState): Step<PlantState> => {
        const finderId: string | null = state.heard?.playerId ?? null;
        const voters: string[] = state.players.map((player: CartridgePlayer) => player.playerId);
        const next: PlantState = { ...state, phase: "vote", finderId, voters, votes: {}, heard: null };
        const text: string = [
            `${nameOf(state, finderId)} found it: the word was ${state.word}.`,
            "Say so, then call the vote in one line: everyone votes on their phone for who knew it all along.",
        ].join(" ");
        return { state: next, facts: because(publicFact("found", text), PLANT_DECISIONS.vote), nextPhaseId: "vote", timers: { vote: decisions.voteSeconds } };
    };

    /**
     * Who a voter may vote for: everyone else still at the table.
     * @param state the state.
     * @param voterId the voter.
     * @returns the candidates.
     */
    const candidatesFor = (state: PlantState, voterId: string): CartridgePlayer[] => state.players.filter((player: CartridgePlayer) => player.playerId !== voterId);

    /**
     * Whether a player may vote now.
     * @param state the state.
     * @param playerId the player.
     * @returns true when they may.
     */
    const mayVote = (state: PlantState, playerId: string): boolean => state.phase === "vote" && state.voters.includes(playerId) === true && state.votes[playerId] === undefined;

    /**
     * Someone left. The Plant leaving ends the round; anyone else is just gone from the vote.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: PlantState, playerId: string): Step<PlantState> => {
        if (state.phase === "end" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return { state, facts: [] };
        }
        if (playerId === state.plantId) {
            const word: string = state.word === "" ? state.fallback : state.word;
            return finish({ ...state, word }, "plantLeft", `The Plant left the game, so the round is over. The word was ${word}.`, PLANT_DECISIONS.giveUp);
        }
        const votes: Record<string, string> = Object.fromEntries(Object.entries(state.votes).filter(([voter]: [string, string]) => voter !== playerId));
        const next: PlantState = {
            ...state,
            players: state.players.filter((player: CartridgePlayer) => player.playerId !== playerId),
            voters: state.voters.filter((voter: string) => voter !== playerId),
            votes,
            heard: state.heard?.playerId === playerId ? null : state.heard,
        };
        if (next.phase === "vote" && next.voters.every((voter: string) => next.votes[voter] !== undefined) === true) {
            return resolve(next);
        }
        return { state: next, facts: [] };
    };

    const cartridge: Cartridge<PlantState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<PlantState> {
            const category: Category = pick(decisions.categories, random);
            const plantId: string = dealOne(players, random);
            const state: PlantState = {
                phase: "choosing",
                players,
                plantId,
                category: category.name,
                fallback: category.fallback,
                word: "",
                questions: { used: 0, max: decisions.questions.budget, warnAt: decisions.questions.warnAt },
                asked: [],
                heard: null,
                finderId: null,
                voters: [],
                votes: {},
                result: null,
                plantName: "",
                finderName: "",
            };
            const request: string = [
                `Choose one word for a party game where players find it with yes-or-no questions. It must be ${category.name}:`,
                "a concrete, everyday thing most adults know, and not the first thing anyone would say. Reply with only the word, at most two words, no punctuation.",
            ].join(" ");
            return { state, facts: [], nextPhaseId: "choosing", contentRequest: request };
        },

        phaseOf(state: PlantState): string {
            return state.phase;
        },

        turn(state: PlantState): Turn | null {
            if (state.phase === "choosing") {
                return { kind: "secret", label: "Look at your phone" };
            }
            if (state.phase === "asking") {
                return { kind: "anyone", label: "Anyone can ask" };
            }
            if (state.phase === "vote") {
                return { kind: "everyone", playerIds: state.voters, doneIds: Object.keys(state.votes), label: "Vote on your phone" };
            }
            return null;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: PlantState, playerId: string): LegalAction[] {
            if (state.phase === "asking") {
                return [{ actionId: PLANT_GIVE_UP_ACTION, label: "We give up" }];
            }
            if (mayVote(state, playerId) === false) {
                return [];
            }
            return candidatesFor(state, playerId).map((player: CartridgePlayer) => ({ actionId: `${VOTE_PREFIX}${player.playerId}`, label: player.name }));
        },

        apply(state: PlantState, playerId: string, actionId: string): Step<PlantState> {
            if (state.phase === "asking" && actionId === PLANT_GIVE_UP_ACTION) {
                return unfound(state, "gaveUp", PLANT_DECISIONS.giveUp);
            }
            if (mayVote(state, playerId) === false || actionId.startsWith(VOTE_PREFIX) === false) {
                return { state, facts: [] };
            }
            const target: string = actionId.slice(VOTE_PREFIX.length);
            if (candidatesFor(state, playerId).some((player: CartridgePlayer) => player.playerId === target) === false) {
                return { state, facts: [] };
            }
            const next: PlantState = { ...state, votes: { ...state.votes, [playerId]: target } };
            if (next.voters.every((voter: string) => next.votes[voter] !== undefined) === true) {
                return resolve(next);
            }
            return { state: next, facts: [] };
        },

        onEvent(state: PlantState, event: RoomEvent): Step<PlantState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "contentReady" && state.phase === "choosing" && state.word === "") {
                const chosen: string = event.text.trim().replace(/[."!?]/g, "");
                const usable: string = isUsableWord(chosen) === true ? chosen : state.fallback;
                const word: string = `${usable.charAt(0).toUpperCase()}${usable.slice(1)}`;
                const text: string = `The word is ready and everyone has their card. Explain the game now, then they have ${decisions.questions.budget} questions.`;
                return { state: { ...state, word }, facts: because(publicFact("ready", text), PLANT_DECISIONS.categories), timers: { read: decisions.readSeconds } };
            }
            if (event.type === "timerFired" && event.timerId === "read" && state.phase === "choosing" && state.word !== "") {
                const timers: Record<string, number> = decisions.askingSeconds > 0 ? { asking: decisions.askingSeconds } : {};
                const text: string = `Asking is open. Invite the first question. It's ${state.category}.`;
                return { state: { ...state, phase: "asking" }, facts: because(publicFact("asking", text), PLANT_DECISIONS.read), nextPhaseId: "asking", timers };
            }
            if (event.type === "timerFired" && event.timerId === "asking" && state.phase === "asking") {
                return unfound(state, "clock", PLANT_DECISIONS.asking);
            }
            if (event.type === "timerFired" && event.timerId === "vote" && state.phase === "vote") {
                return resolve(state);
            }
            if (event.type === "speechEnded" && state.phase === "asking") {
                return { state: { ...state, heard: { playerId: event.playerId, text: event.text } }, facts: [] };
            }
            if (event.type !== "hostRuled" || state.phase !== "asking") {
                return { state, facts: [] };
            }
            if (event.ruling === "giveup") {
                return unfound(state, "gaveUp", PLANT_DECISIONS.giveUp);
            }
            if (event.ruling === "correct" && state.heard !== null) {
                return found(state);
            }
            if (ANSWER_LABELS[event.ruling] !== undefined) {
                return answer(state, event.ruling);
            }
            return { state, facts: [] };
        },

        publicScene(state: PlantState): Scene {
            if (state.phase === "choosing") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: box.name }, { type: "text", text: "Look at your phone. Keep it to yourself.", emphasis: "large" }] };
            }
            if (state.phase === "asking") {
                const blocks: SceneBlock[] = [
                    { type: "title", text: "Find the word", kicker: `It's ${state.category}` },
                    { type: "progress", label: "Questions asked", current: state.questions.used, max: state.questions.max, marks: "card" },
                ];
                if (decisions.askingSeconds > 0) {
                    blocks.push({ type: "timer", seconds: decisions.askingSeconds, label: "to find it", running: true });
                }
                const recent: SceneBlock[] = state.asked.slice(-SHOWN_LINES).map((line: AskedLine): SceneBlock => ({ type: "text", text: `${line.text} ${line.answer}.` }));
                return { mood: "tense", transition: "fade", blocks: [...blocks, ...recent] };
            }
            if (state.phase === "vote") {
                return {
                    mood: "tense",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: state.word, kicker: `${nameOf(state, state.finderId)} found it` },
                        { type: "text", text: "Who knew it all along? Vote on your phone.", emphasis: "large" },
                        { type: "timer", seconds: decisions.voteSeconds, label: "to vote", running: true },
                    ],
                };
            }
            const kickers: Record<PlantResult, string> = {
                caught: "Caught",
                slipped: "Got away with it",
                questions: "Out of questions",
                clock: "Out of time",
                gaveUp: "You gave up",
                plantLeft: "The Plant left",
            };
            const blocks: SceneBlock[] = [
                { type: "title", text: state.word, kicker: kickers[state.result ?? "gaveUp"] },
                { type: "text", text: `${state.plantName} was the Plant.`, emphasis: "large" },
            ];
            if (state.voters.length > 0) {
                const counted: Tally = tally(state.votes, [...state.players.map((player: CartridgePlayer) => player.playerId)]);
                const rows = counted.rows.filter((row: TallyRow) => row.votes > 0 || row.playerId === state.plantId).map((row: TallyRow) => ({
                    label: nameOf(state, row.playerId),
                    count: row.votes,
                    highlight: row.playerId === state.plantId,
                }));
                blocks.push({ type: "tally", title: "Who you suspected", rows });
            }
            const victory: boolean = state.result === "caught" || state.result === "slipped";
            return { mood: victory === true ? "victory" : "defeat", transition: "fade", blocks };
        },

        privateControls(state: PlantState, playerId: string): Control[] {
            const isPlant: boolean = playerId === state.plantId;
            if (state.phase === "choosing" || state.phase === "asking") {
                const plantBody: string = state.word === "" ? "Your word is coming." : `The word is ${state.word}. Steer them to it with your questions, and don't get caught.`;
                const card: Control = isPlant === true
                    ? { type: "roleCard", title: PLANT_CARD_TITLE, body: plantBody, secret: true }
                    : { type: "roleCard", title: ASKER_CARD_TITLE, body: "Someone here knows the word. Find it with yes-or-no questions.", secret: true };
                return [card];
            }
            if (state.phase === "vote") {
                if (mayVote(state, playerId) === false) {
                    return [{ type: "waiting", text: state.voters.includes(playerId) === true ? "Voted." : "Watching the vote." }];
                }
                const options = candidatesFor(state, playerId).map((player: CartridgePlayer) => ({ id: `${VOTE_PREFIX}${player.playerId}`, label: player.name }));
                return [{ type: "choice", prompt: "Who knew it all along?", options, multiple: false }];
            }
            const plantLine: Record<PlantResult, string> = {
                caught: "They caught you.",
                slipped: "You got away with it.",
                questions: "They never found it.",
                clock: "They never found it.",
                gaveUp: "They never found it.",
                plantLeft: "",
            };
            return [{ type: "waiting", text: isPlant === true ? plantLine[state.result ?? "gaveUp"] : "Look at the screen." }];
        },

        hostFacts(state: PlantState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.word === "" || state.phase === "end") {
                return [];
            }
            return [
                { scope: { kind: "host" }, kind: "word", text: `The word is: ${state.word}.` },
                { scope: { kind: "public" }, kind: "questions", text: `${state.questions.used} of ${state.questions.max} questions are used.` },
            ];
        },

        outcome(state: PlantState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            if (state.result === "caught") {
                return `The room caught ${state.plantName}.`;
            }
            if (state.result === "slipped") {
                return `${state.plantName} got away with it.`;
            }
            return `The word was ${state.word}.`;
        },
    };

    return {
        cartridge,
        hidden(state: PlantState): HiddenValue[] {
            if (state.phase === "end") {
                return [];
            }
            const card: HiddenValue = { label: "the Plant's card", text: PLANT_CARD_TITLE, seenBy: [state.plantId] };
            if (state.phase === "vote") {
                return [card];
            }
            return [{ label: "the word", text: state.word === "" ? state.fallback : state.word, seenBy: ["host", state.plantId] }, card];
        },
    };
}
