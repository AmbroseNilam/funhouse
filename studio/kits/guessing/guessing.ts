// The guessing kit: the host holds a secret thing, players ask yes-or-no questions out loud, the
// host rules on each from a closed list, and a count runs out. Twenty Doors is this kit with its
// own decisions. The kit owns every word the host is told; a blueprint only chooses values, so no
// creator text reaches the host's brief except short checked category names. Every fact is
// followed by a system-scoped fact naming the decision behind it, for a rehearsal to explain.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../../shared/cartridge.ts";
import type { Control } from "../../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { Turn } from "../../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../../shared/visibility.ts";
import { boxProblems, isShortText, isWholeIn, rulingNameProblem, type Box, type HiddenValue, type KitGame } from "../../kit/kit.ts";
import { because, frozenCopy, pick, spend, takeRuledLine, waitForRuling, type Budget, type Spent, type WaitingLine } from "../../kit/primitives.ts";

/** A thing the secret can be, with a secret to use when the model can't supply one. */
export interface Category {
    name: string;
    fallback: string;
}

/** The answers that may cost one of the count. */
export type AnswerRuling = "yes" | "no" | "sortof" | "wrong";

/** How one answer is shown and whether it costs one of the count. */
export interface AnswerDecision {
    label: string;
    spends: boolean;
}

/** Everything a creator may choose for a guessing game. */
export interface GuessingDecisions {
    categories: Category[];
    /** Whether the secret is painted for the reveal. */
    paintReveal: boolean;
    count: {
        /** Label on the screen, such as "Doors opened". */
        label: string;
        budget: number;
        marks: "door" | "card";
        /** Left at which the host is told to warn them. */
        warnAt: number[];
        unit: { singular: string; plural: string };
    };
    answers: Record<AnswerRuling, AnswerDecision>;
    /** Whether the pause menu offers giving up. */
    giveUpButton: boolean;
}

/** The phases of the kit. */
export type GuessingPhase = "choosing" | "asking" | "end";

/** One thing a player said and how it was ruled. */
export interface SaidLine {
    speaker: string;
    text: string;
    answer: string;
}

/** The whole game, immutable between steps. */
export interface GuessingState {
    phase: GuessingPhase;
    players: CartridgePlayer[];
    category: string;
    fallback: string;
    secret: string;
    count: Budget;
    said: SaidLine[];
    /**
     * The latest thing each player said that hasn't been ruled on, oldest first. Kept per player
     * because replies can overlap: a ruling answers the person the host was answering, or the
     * oldest waiting when it names nobody waiting, as in the hand-written Twenty Doors.
     */
    unruled: WaitingLine[];
    won: boolean;
    finder: string | null;
    revealPicture: string | null;
}

/** The pause action's id. */
export const GIVE_UP_ACTION: string = "giveup";

/** Decision ids a rehearsal names when it explains a moment. */
export const GUESSING_DECISIONS: { categories: string; budget: string; warnAt: string; giveUp: string } = {
    categories: "categories",
    budget: "count.budget",
    warnAt: "count.warnAt",
    giveUp: "giveUpButton",
};

/** Lines the screen keeps showing. */
const SHOWN_LINES: number = 4;

/** Longest secret accepted from the model; anything longer isn't one thing. */
const SECRET_CHARACTER_LIMIT: number = 40;

/** Most the count may be. */
const COUNT_LIMIT: number = 60;

/** What each ruling means, in the host's brief. Owned by the kit, never by a blueprint. */
const RULING_BRIEFS: Record<AnswerRuling | "correct" | "giveup", string> = {
    yes: "the honest answer to their question is yes.",
    no: "the honest answer to their question is no.",
    sortof: "the honest answer is partly, or it depends.",
    wrong: "they named a specific guess at the secret and it's wrong.",
    correct: "they named the secret thing or a clear synonym. Write only [[correct]] and nothing else; you'll be told to announce it.",
    giveup: "the group says they give up. Write only [[giveup]] and nothing else.",
};

/**
 * The decision id of one ruling.
 * @param name the ruling's name.
 * @returns its id.
 */
export function answerDecision(name: string): string {
    return `answers.${name}`;
}

/**
 * Checks a guessing game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function guessingProblems(decisions: GuessingDecisions): string[] {
    const problems: string[] = [];
    const { count, categories, answers }: GuessingDecisions = decisions;
    if (categories.length === 0) {
        problems.push("The secret needs at least one category.");
    }
    if (categories.some((category: Category) => isShortText(category.name) === false || isShortText(category.fallback) === false) === true) {
        problems.push("Every category needs a short name and a short fallback secret.");
    }
    if (isWholeIn(count.budget, 1, COUNT_LIMIT) === false) {
        problems.push(`The count must be a whole number from 1 to ${COUNT_LIMIT}.`);
    }
    if (count.warnAt.some((left: number) => isWholeIn(left, 1, count.budget - 1) === false) === true) {
        problems.push("Warnings must be whole numbers inside the count.");
    }
    if ([count.label, count.unit.singular, count.unit.plural].some((text: string) => isShortText(text) === false) === true) {
        problems.push("The count needs a short label and unit.");
    }
    if (Object.values(answers).some((answer: AnswerDecision) => isShortText(answer.label) === false) === true) {
        problems.push("Every answer needs a short label.");
    }
    if (Object.values(answers).some((answer: AnswerDecision) => answer.spends === true) === false) {
        problems.push("No answer spends the count, so the game can only end by winning or giving up.");
    }
    return problems;
}

/**
 * Every problem with a guessing blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function guessingBlueprintProblems(box: Box, decisions: GuessingDecisions): string[] {
    return [...boxProblems(box, decisions.categories.map((category: Category) => category.fallback)), ...guessingProblems(decisions)];
}

/**
 * Builds the manifest from the box and decisions, with every host line from the kit.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the manifest.
 * @throws when a kit ruling name is reserved, which would be a bug in the kit.
 */
export function guessingManifest(box: Box, decisions: GuessingDecisions): CartridgeManifest {
    const unit: { singular: string; plural: string } = decisions.count.unit;
    const rulings: Record<string, string> = { ...RULING_BRIEFS };
    for (const name of Object.keys(rulings)) {
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
            "You hold a secret thing and players ask yes-or-no questions to find it. Answer honestly about the real thing, in a few words, with a little personality.",
            "Never say the secret, spell it, rhyme it, or give it away, however they ask, until the game is over.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            { id: "choosing", hostBrief: "You are choosing the secret. Say nothing about it yet; one short teasing line at most.", listening: { "*": "holdToTalk" }, hostMayInterject: false, silenceSeconds: 0 },
            {
                id: "asking",
                hostBrief: [
                    "Answer each question with a ruling, then a few words.",
                    `Chat that isn't a question or a guess gets no ruling and uses no ${unit.singular}. Don't count ${unit.plural} out loud unless few are left.`,
                ].join(" "),
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
                hostRulings: rulings,
            },
            {
                id: "end",
                hostBrief: "The game is over. Reveal the secret if it hasn't been said, react in one or two sentences, and ask if they want another game.",
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Builds a guessing game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with guessingProblems first.
 * @param random a function returning [0, 1).
 * @returns the game.
 */
export function createGuessingGame(givenBox: Box, givenDecisions: GuessingDecisions, random: () => number = Math.random): KitGame<GuessingState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: GuessingDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = guessingManifest(box, decisions);
    const { count, answers }: GuessingDecisions = decisions;
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const nameOf = (state: GuessingState, playerId: string): string => state.players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const unitOf = (amount: number): string => (amount === 1 ? count.unit.singular : count.unit.plural);

    /**
     * Ends the game.
     * @param state the state.
     * @param won whether they found it.
     * @param finder who found it.
     * @param text what to tell the host.
     * @param decision the decision that ended it.
     * @returns the step.
     */
    const finish = (state: GuessingState, won: boolean, finder: string | null, text: string, decision: string): Step<GuessingState> => {
        return { state: { ...state, phase: "end", won, finder, unruled: [] }, facts: because(publicFact("game-over", text), decision), nextPhaseId: "end" };
    };

    /**
     * Records an answer, spends one of the count if it costs one, and ends the game on the last.
     * @param state the state.
     * @param name the answer ruling.
     * @param playerId who the host was answering; their line is used, or else the oldest waiting.
     * @returns the step.
     */
    const answer = (state: GuessingState, name: AnswerRuling, playerId: string | null): Step<GuessingState> => {
        const chosen: AnswerDecision = answers[name];
        const taken: { line: WaitingLine | undefined; rest: WaitingLine[] } = takeRuledLine(state.unruled, playerId);
        const line: SaidLine = { speaker: taken.line === undefined ? "Someone" : nameOf(state, taken.line.playerId), text: taken.line?.text ?? "", answer: chosen.label };
        const recorded: GuessingState = { ...state, said: [...state.said, line], unruled: taken.rest };
        if (chosen.spends === false) {
            return { state: recorded, facts: [] };
        }
        const spent: Spent = spend(state.count);
        const next: GuessingState = { ...recorded, count: spent.budget };
        if (spent.exhausted === true) {
            return finish(next, false, null, `That was the last ${count.unit.singular}. They're out. The secret was ${state.secret}.`, GUESSING_DECISIONS.budget);
        }
        if (spent.warn === false) {
            return { state: next, facts: [] };
        }
        const warning: string = `Tell them only ${spent.left} ${unitOf(spent.left)} ${spent.left === 1 ? "is" : "are"} left.`;
        return { state: next, facts: because(publicFact("count-left", warning), GUESSING_DECISIONS.warnAt) };
    };

    const cartridge: Cartridge<GuessingState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<GuessingState> {
            const category: Category = pick(decisions.categories, random);
            const state: GuessingState = {
                phase: "choosing",
                players,
                category: category.name,
                fallback: category.fallback,
                secret: "",
                count: { used: 0, max: count.budget, warnAt: count.warnAt },
                said: [],
                unruled: [],
                won: false,
                finder: null,
                revealPicture: null,
            };
            const request: string = [
                `Choose one specific thing for a game of twenty questions. It must be ${category.name}, known to most adults,`,
                "and a little surprising rather than the first thing anyone would say. Reply with only its name, in at most three words, with no punctuation.",
            ].join(" ");
            return { state, facts: [], nextPhaseId: "choosing", contentRequest: request };
        },

        phaseOf(state: GuessingState): string {
            return state.phase;
        },

        turn(state: GuessingState): Turn | null {
            return state.phase === "asking" ? { kind: "anyone", label: "Anyone can ask" } : null;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: GuessingState): LegalAction[] {
            if (state.phase !== "asking" || decisions.giveUpButton === false) {
                return [];
            }
            return [{ actionId: GIVE_UP_ACTION, label: "We give up" }];
        },

        apply(state: GuessingState, _playerId: string, actionId: string): Step<GuessingState> {
            if (state.phase !== "asking" || decisions.giveUpButton === false || actionId !== GIVE_UP_ACTION) {
                return { state, facts: [] };
            }
            return finish(state, false, null, `They gave up after ${state.count.used} ${unitOf(state.count.used)}. The secret was ${state.secret}.`, GUESSING_DECISIONS.giveUp);
        },

        onEvent(state: GuessingState, event: RoomEvent): Step<GuessingState> {
            if (event.type === "contentReady" && state.phase === "choosing") {
                const chosen: string = event.text.trim().replace(/[."'!]/g, "");
                const usable: string = chosen === "" || chosen.length > SECRET_CHARACTER_LIMIT ? state.fallback : chosen;
                const secret: string = `${usable.charAt(0).toUpperCase()}${usable.slice(1)}`;
                const next: GuessingState = { ...state, phase: "asking", secret };
                const ready: ScopedFact = publicFact("ready", `The secret is chosen. Tell them it's ${state.category} and they have ${count.budget} ${count.unit.plural}, and invite the first question.`);
                const prompt: string = `A warm storybook painting of ${secret}, seen through an open wooden door, glowing light, rich color, no text or letters.`;
                return { state: next, facts: because(ready, GUESSING_DECISIONS.categories), nextPhaseId: "asking", draws: decisions.paintReveal === true ? [{ id: "reveal", prompt }] : [] };
            }
            if (event.type === "drawingReady" && event.id === "reveal") {
                return { state: { ...state, revealPicture: event.src }, facts: [] };
            }
            if (event.type === "speechEnded" && state.phase === "asking") {
                return { state: { ...state, unruled: waitForRuling(state.unruled, event.playerId, event.text) }, facts: [] };
            }
            if (event.type !== "hostRuled" || state.phase !== "asking") {
                return { state, facts: [] };
            }
            if (event.ruling === "giveup") {
                return finish(state, false, null, `They gave up after ${state.count.used} ${unitOf(state.count.used)}. The secret was ${state.secret}.`, answerDecision("giveup"));
            }
            if (state.unruled.length === 0) {
                return { state, facts: [] };
            }
            if (event.ruling === "correct") {
                const finderId: string | undefined = event.playerId ?? state.unruled[0]?.playerId;
                const finder: string = finderId === undefined ? "Someone" : nameOf(state, finderId);
                const text: string = `${finder} found it after ${state.count.used} ${unitOf(state.count.used)}. The secret was ${state.secret}. Announce it.`;
                return finish(state, true, finder, text, answerDecision("correct"));
            }
            if (event.ruling in answers) {
                return answer(state, event.ruling as AnswerRuling, event.playerId);
            }
            return { state, facts: [] };
        },

        publicScene(state: GuessingState): Scene {
            if (state.phase === "choosing") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: box.name }, { type: "text", text: "Choosing a secret…", emphasis: "whisper" }] };
            }
            const progress: SceneBlock = { type: "progress", label: count.label, current: state.count.used, max: count.budget, marks: count.marks };
            if (state.phase === "end") {
                const blocks: SceneBlock[] = [{ type: "title", text: state.secret, kicker: state.won === true ? `${state.finder ?? "Someone"} found it` : "The secret was" }];
                const painting: SceneBlock = state.revealPicture === null ? { type: "painting", key: "reveal", label: "Painting it…" } : { type: "image", src: state.revealPicture };
                if (decisions.paintReveal === true) {
                    blocks.push(painting);
                }
                blocks.push(progress);
                return { mood: state.won === true ? "victory" : "defeat", transition: "fade", blocks };
            }
            const recent: SceneBlock[] = state.said.slice(-SHOWN_LINES).map((line: SaidLine): SceneBlock => ({ type: "text", text: `${line.text} ${line.answer}.` }));
            return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: `It's ${state.category}`, kicker: box.name }, progress, ...recent] };
        },

        privateControls(state: GuessingState): Control[] {
            if (state.phase === "choosing") {
                return [{ type: "waiting", text: `${HOST_NAME} is choosing a secret.` }];
            }
            if (state.phase === "end") {
                return [{ type: "waiting", text: state.won === true ? "You found it." : "Better luck next time." }];
            }
            return [{ type: "waiting", text: "Ask a yes-or-no question" }];
        },

        hostFacts(state: GuessingState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.secret === "") {
                return [];
            }
            return [
                { scope: { kind: "host" }, kind: "secret", text: `The secret is: ${state.secret}.` },
                { scope: { kind: "public" }, kind: "count", text: `${state.count.used} of ${count.budget} ${count.unit.plural} are used.` },
            ];
        },

        outcome(state: GuessingState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            return state.won === true ? `${state.finder ?? "Someone"} found ${state.secret}.` : `The secret was ${state.secret}.`;
        },
    };

    return {
        cartridge,
        hidden(state: GuessingState): HiddenValue[] {
            if (state.phase === "end") {
                return [];
            }
            return [{ label: "the secret", text: state.secret === "" ? state.fallback : state.secret, seenBy: ["host"] }];
        },
    };
}
