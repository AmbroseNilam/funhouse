// The stranger kit: everyone but one player knows where they are. The host writes a fresh place and a
// list of roles at it; code deals each player a role and one player the Stranger, who is told nothing.
// Players question each other in an order the code enforces: the asker picks someone, asks out loud,
// that person answers out loud, and then they ask. Nobody may ask the person who just asked them.
// Anyone can call the vote, the Stranger can announce they know the place, and a caught Stranger gets
// one last guess, which the host rules on. The host knows the place and never who the Stranger is.
// Code runs the order, the clocks, the vote and the outcome. Wrong Room is this kit.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Turn } from "../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { boxProblems, isShortText, isWholeIn, rulingNameProblem, squash, type Box, type HiddenValue, type KitGame } from "../kit/kit.ts";
import { because, dealOne, frozenCopy, pick, spend, tally, type Budget, type Spent, type Tally } from "../kit/primitives.ts";
import { shuffled, titleCase } from "../kit/words.ts";

/** A place and the roles people have there. */
export interface Place {
    name: string;
    roles: string[];
}

/** Everything a creator may choose for a stranger game. */
export interface StrangerDecisions {
    /** Places to fall back on when the model can't write one; each with at least eight roles. */
    places: Place[];
    /** How many questions the room may ask before the vote, and when to say how many are left. */
    questions: { budget: number; warnAt: number[] };
    /** Seconds everyone gets to read their card before questions start. */
    readSeconds: number;
    /** Seconds each step of a question (picking, asking, answering) may take. */
    stepSeconds: number;
    /** Seconds the questioning may last in all; 0 means no clock. */
    talkSeconds: number;
    /** Seconds the vote stays open. */
    voteSeconds: number;
    /** Seconds a Stranger has to name the place. */
    guessSeconds: number;
}

/** The phases of the kit. */
export type StrangerPhase = "dealing" | "questions" | "vote" | "guess" | "end";

/** The three steps of one question. */
export type StrangerStep = "pick" | "ask" | "answer";

/** How a round ended. */
export type StrangerResult = "caught" | "namedIt" | "slipped" | "early" | "earlyMiss" | "strangerLeft" | "emptied";

/** The whole game, immutable between steps. */
export interface StrangerState {
    phase: StrangerPhase;
    /** Everyone still at the table, in seat order. */
    players: CartridgePlayer[];
    strangerId: string;
    /** The place, once the host has written it; empty until then. */
    place: string;
    /** The place to use if the host can't write one, and its roles. */
    fallback: Place;
    /** Each player's role at the place; the Stranger has none. */
    roles: Record<string, string>;
    step: StrangerStep;
    askerId: string;
    /** Who was picked, once the asker has picked. */
    targetId: string | null;
    /** Who asked the current asker, who may not be asked back. */
    askedById: string | null;
    questions: Budget;
    /** What the last typed question or answer said; empty when it was spoken. */
    typed: string;
    /** Players who have called for the vote. */
    calls: string[];
    voters: string[];
    votes: Record<string, string>;
    /** True once the Stranger has spoken a guess the host has not yet ruled on. */
    guessHeard: boolean;
    result: StrangerResult | null;
    /** Kept at the end so the reveal shows names even if people have left. */
    strangerName: string;
    accusedName: string;
    /** Why the round ended, for the host. */
    ending: string;
}

/** Action ids. */
export const STRANGER_ACTIONS: { target: string; call: string; reveal: string; vote: string } = { target: "target:", call: "call", reveal: "reveal", vote: "vote:" };

/** What the Stranger's card says, and what everyone else's title says. */
export const STRANGER_CARD_TITLE: string = "You're the stranger";

/** The decision ids a rehearsal names when it explains a moment. */
export const STRANGER_DECISIONS: { places: string; budget: string; warnAt: string; read: string; step: string; talk: string; vote: string; guess: string; left: string } = {
    places: "places", budget: "questions.budget", warnAt: "questions.warnAt", read: "readSeconds", step: "stepSeconds", talk: "talkSeconds", vote: "voteSeconds", guess: "guessSeconds", left: "players",
};

/** Fewest roles a place needs, so every seat gets one. */
const FEWEST_ROLES: number = 8;

/** Longest place name or role, in letters. */
const NAME_LIMIT: number = 30;

/** What each ruling means, in the host's brief. Owned by the kit. */
const RULING_BRIEFS: Record<string, string> = {
    right: "the Stranger's guess names the place, or a clear synonym of it. Write only [[right]] and nothing else; you'll be told what to say.",
    wrong: "the Stranger's guess is some other place, or too vague to be the place. Write only [[wrong]] and nothing else; you'll be told what to say.",
};

/**
 * Checks a stranger game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function strangerProblems(decisions: StrangerDecisions): string[] {
    const problems: string[] = [];
    if (decisions.places.length < 8) {
        problems.push("The game needs at least eight places of its own.");
    }
    const bad: Place | undefined = decisions.places.find((place: Place) => isPlaceName(place.name) === false || place.roles.length < FEWEST_ROLES || place.roles.every(isRoleName) === false || new Set(place.roles.map(squash)).size !== place.roles.length);
    if (bad !== undefined) {
        problems.push("Every place needs a short plain name and at least eight different short roles.");
    }
    if (new Set(decisions.places.map((place: Place) => squash(place.name))).size !== decisions.places.length) {
        problems.push("The places must all be different.");
    }
    if (isWholeIn(decisions.questions.budget, 6, 60) === false || decisions.questions.warnAt.some((left: number) => isWholeIn(left, 1, decisions.questions.budget - 1) === false) === true) {
        problems.push("The questions must be a whole number from 6 to 60, and warnings whole numbers inside it.");
    }
    if (isWholeIn(decisions.readSeconds, 3, 30) === false || isWholeIn(decisions.stepSeconds, 15, 90) === false) {
        problems.push("Reading must be 3 to 30 seconds and each step 15 to 90, as whole numbers.");
    }
    if (decisions.talkSeconds !== 0 && isWholeIn(decisions.talkSeconds, 120, 900) === false) {
        problems.push("The questioning clock must be off, or a whole number of seconds from 120 to 900.");
    }
    if (isWholeIn(decisions.voteSeconds, 15, 120) === false || isWholeIn(decisions.guessSeconds, 15, 90) === false) {
        problems.push("The vote must last 15 to 120 seconds and the guess 15 to 90, as whole numbers.");
    }
    return problems;
}

/**
 * Every problem with a stranger blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function strangerBlueprintProblems(box: Box, decisions: StrangerDecisions): string[] {
    const problems: string[] = [...boxProblems(box, decisions.places.map((place: Place) => place.name)), ...strangerProblems(decisions)];
    if (box.minPlayers < 3) {
        problems.push("A stranger game needs at least three people, or there is nobody to question but the Stranger.");
    }
    if (box.maxPlayers > FEWEST_ROLES) {
        problems.push("A place has eight roles, so the table can't be bigger than eight.");
    }
    return problems;
}

/**
 * Checks a place name: one to three plain words.
 * @param name the name.
 * @returns true when it can be a place.
 */
export function isPlaceName(name: string): boolean {
    return name.length <= NAME_LIMIT && /^\p{L}[\p{L}'-]*( \p{L}[\p{L}'-]*){0,2}$/u.test(name) === true && isShortText(name) === true;
}

/**
 * Checks a role: one or two plain words.
 * @param role the role.
 * @returns true when it can be a role.
 */
export function isRoleName(role: string): boolean {
    return role.length <= NAME_LIMIT && /^\p{L}[\p{L}'-]*( \p{L}[\p{L}'-]*)?$/u.test(role) === true;
}

/**
 * Reads the place and roles the host's model wrote, in the form "Place: X | Roles: a, b, c".
 * @param reply the model's reply.
 * @returns the place, or null when it isn't usable.
 */
export function parsePlace(reply: string): Place | null {
    const match: RegExpExecArray | null = /Place:\s*([^|\n]+?)\s*\|\s*Roles:\s*([^\n]+)/i.exec(reply);
    const name: string = (match?.[1] ?? "").trim().replace(/[."!?]+$/g, "");
    const roles: string[] = [...new Set((match?.[2] ?? "").split(",").map((role: string) => role.trim().replace(/[."!?]+$/g, "").toLowerCase()).filter((role: string) => isRoleName(role) === true))];
    if (isPlaceName(name) === false || roles.length < FEWEST_ROLES || roles.some((role: string) => squash(role) === squash(name)) === true) {
        return null;
    }
    return { name: titleCase(name.toLowerCase()), roles: roles.slice(0, FEWEST_ROLES) };
}

/**
 * Whether a typed guess names the place: the same letters, or one inside the other when long enough.
 * @param place the place.
 * @param guess what was typed.
 * @returns true when it counts.
 */
export function namesPlace(place: string, guess: string): boolean {
    const wanted: string = squash(place);
    const given: string = squash(guess.replace(/^(the|a|an)\s+/i, ""));
    return given.length >= 3 && (given === wanted || (given.length >= 4 && wanted.includes(given) === true) || (wanted.length >= 4 && given.includes(wanted) === true));
}

/**
 * Builds the manifest from the box, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 * @throws when a kit ruling name is reserved, which would be a bug in the kit.
 */
export function strangerManifest(box: Box): CartridgeManifest {
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
            `You're running ${box.name}. You chose a place and everyone but one player was told where they are; that player, the Stranger, was told nothing.`,
            "You know the place and you never know who the Stranger is, so never guess, hint or joke about who it might be.",
            "Never say the place, its name, a part of it or anything about it until you're told the round is over.",
            "The order of questions, the clocks and the vote are the game's, never yours to change. You say what you're told, briefly, and you judge the Stranger's last guess.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            {
                id: "dealing",
                hostBrief: "Everyone is reading a card on their phone. When you're told the place is ready, explain in two short sentences: everyone knows where they are except one of them, and they question each other in turn to find who. Then stop.",
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "questions",
                hostBrief: "Players are questioning each other in turn. You say nothing unless you're told to; reply exactly (quiet) to anything you hear. Never answer a question about the place, and never comment on who sounds suspicious.",
                listening: { up: "holdToTalk", "*": "muted" },
                hostMayInterject: false,
                hostMostlyQuiet: true,
                silenceSeconds: 0,
            },
            {
                id: "vote",
                hostBrief: "The room is voting on its phones for who the Stranger is. When you're told to, call the vote in one line. Then reply exactly (quiet).",
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "guess",
                hostBrief: [
                    "The Stranger is naming the place, out loud or typed. If they speak, rule right or wrong against the real place you know, in one go, and nothing else.",
                    "A near miss in the same kind of place is wrong. Never hint how close they were.",
                ].join(" "),
                listening: { up: "holdToTalk", "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
                hostRulings: { ...RULING_BRIEFS },
            },
            {
                id: "end",
                hostBrief: "You'll be told the place, who the Stranger was and how it ended. Two or three sentences: the place, who the Stranger was, and one dry word for how they did. Make the Stranger look good whether they were caught or not. Then ask if they want another round.",
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Builds a stranger game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with strangerBlueprintProblems first.
 * @param random a function returning [0, 1): the first draw picks the fallback place, the second deals the Stranger, the third who asks first, and the rest shuffle the roles.
 * @returns the game.
 */
export function createStrangerGame(givenBox: Box, givenDecisions: StrangerDecisions, random: () => number = Math.random): KitGame<StrangerState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: StrangerDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = strangerManifest(box);
    const publicFact = (kind: string, text: string, quiet: boolean = false): ScopedFact => ({ scope: { kind: "public" }, kind, text, ...(quiet === true ? { quiet: true } : {}) });
    const nameOf = (state: StrangerState, playerId: string | null): string => state.players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const idsOf = (state: StrangerState): string[] => state.players.map((player: CartridgePlayer) => player.playerId);

    /**
     * Ends the round with the reveal.
     * @param state the state.
     * @param result how it ended.
     * @param text what to tell the host.
     * @param decision the decision that ended it.
     * @returns the step.
     */
    const finish = (state: StrangerState, result: StrangerResult, text: string, decision: string): Step<StrangerState> => {
        const place: string = state.place === "" ? state.fallback.name : state.place;
        const ended: StrangerState = { ...state, phase: "end", place, result, strangerName: nameOf(state, state.strangerId), ending: text };
        return { state: ended, facts: because(publicFact("game-over", text), decision), nextPhaseId: "end" };
    };

    /**
     * Opens the vote.
     * @param state the state.
     * @param why what brought it on, for the host.
     * @param decision the decision behind it.
     * @returns the step.
     */
    const openVote = (state: StrangerState, why: string, decision: string): Step<StrangerState> => {
        const next: StrangerState = { ...state, phase: "vote", voters: idsOf(state), votes: {}, typed: "" };
        const text: string = `${why} Call the vote in one line: everyone votes on their phone for who the Stranger is.`;
        return { state: next, facts: because(publicFact("vote", text), decision), nextPhaseId: "vote", timers: { vote: decisions.voteSeconds } };
    };

    /**
     * Opens the Stranger's last guess.
     * @param state the state.
     * @param text what to tell the host.
     * @param decision the decision behind it.
     * @returns the step.
     */
    const openGuess = (state: StrangerState, text: string, decision: string): Step<StrangerState> => {
        const next: StrangerState = { ...state, phase: "guess", guessHeard: false, typed: "" };
        return { state: next, facts: because(publicFact("guess", text), decision), nextPhaseId: "guess", timers: { guess: decisions.guessSeconds } };
    };

    /**
     * Counts the vote and moves on: nobody pinned or the wrong person ends it; the Stranger gets a guess.
     * @param state the state in the vote.
     * @returns the step.
     */
    const resolve = (state: StrangerState): Step<StrangerState> => {
        const counted: Tally = tally(state.votes, idsOf(state));
        const accusedId: string | undefined = counted.tied === false ? counted.leaders[0] : undefined;
        const place: string = state.place === "" ? state.fallback.name : state.place;
        const stranger: string = nameOf(state, state.strangerId);
        if (accusedId === state.strangerId) {
            const next: StrangerState = { ...state, accusedName: stranger };
            return openGuess(next, `The vote pinned ${stranger}, who was the Stranger. They get one guess at the place. Tell them so in a line; never hint at it.`, STRANGER_DECISIONS.vote);
        }
        const accused: string = accusedId === undefined ? "" : nameOf(state, accusedId);
        const how: string = accusedId === undefined ? "The vote was split, so nobody was pinned." : `The vote pinned ${accused}, who wasn't the Stranger.`;
        return finish({ ...state, accusedName: accused }, "slipped", `${how} ${stranger} was the Stranger and got away with it. The place was ${place}.`, STRANGER_DECISIONS.vote);
    };

    /**
     * Passes the questioning on: the person who answered picks next, or the budget runs out.
     * @param state the state after an answer.
     * @returns the step.
     */
    const afterAnswer = (state: StrangerState): Step<StrangerState> => {
        const spent: Spent = spend(state.questions);
        const next: StrangerState = { ...state, questions: spent.budget, step: "pick", askerId: state.targetId ?? state.askerId, askedById: state.askerId, targetId: null, typed: "" };
        if (spent.exhausted === true) {
            return openVote(next, "That was the last question.", STRANGER_DECISIONS.budget);
        }
        const timers: Record<string, number> = { turn: decisions.stepSeconds };
        if (spent.warn === true) {
            const text: string = `Tell them only ${spent.left} ${spent.left === 1 ? "question is" : "questions are"} left before the vote.`;
            return { state: next, facts: because(publicFact("questions-left", text), STRANGER_DECISIONS.warnAt), timers };
        }
        return { state: next, facts: [], timers };
    };

    /**
     * Whoever is up after a step stalls: a pick passes to the next person in seat order, a question
     * that was never asked is dropped, and an answer that never came is skipped. The room says so.
     * @param state the state.
     * @returns the step.
     */
    const stalled = (state: StrangerState): Step<StrangerState> => {
        const quiet = (text: string): ScopedFact[] => because(publicFact("stalled", text, true), STRANGER_DECISIONS.step);
        if (state.step === "pick") {
            const options: string[] = idsOf(state).filter((id: string) => id !== state.askerId && id !== state.askedById);
            const target: string = options[0] ?? state.askerId;
            const next: StrangerState = { ...state, step: "ask", targetId: target };
            return { state: next, facts: quiet(`${nameOf(state, state.askerId)} took too long, so the question goes to ${nameOf(state, target)}.`), timers: { turn: decisions.stepSeconds } };
        }
        if (state.step === "ask") {
            const next: StrangerState = { ...state, step: "answer" };
            return { state: next, facts: quiet(`${nameOf(state, state.askerId)} never asked.`), timers: { turn: decisions.stepSeconds } };
        }
        return withFacts(afterAnswer(state), quiet(`${nameOf(state, state.targetId)} never answered.`));
    };

    /**
     * Adds facts in front of a step's own.
     * @param step the step.
     * @param facts facts to put first.
     * @returns the step.
     */
    const withFacts = (step: Step<StrangerState>, facts: ScopedFact[]): Step<StrangerState> => ({ ...step, facts: [...facts, ...step.facts] });

    /**
     * Someone left. The Stranger leaving ends the round; anyone else leaving is gone from the order.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: StrangerState, playerId: string): Step<StrangerState> => {
        if (state.phase === "end" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return { state, facts: [] };
        }
        const place: string = state.place === "" ? state.fallback.name : state.place;
        if (playerId === state.strangerId) {
            return finish({ ...state, place }, "strangerLeft", `The Stranger left, so the round is over. The place was ${place}.`, STRANGER_DECISIONS.left);
        }
        const players: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => player.playerId !== playerId);
        const next: StrangerState = { ...state, players, calls: state.calls.filter((id: string) => id !== playerId), voters: state.voters.filter((id: string) => id !== playerId) };
        if (players.length < 3) {
            return finish({ ...next, place }, "emptied", `Too few people were left to play, so the round is over. The place was ${place}.`, STRANGER_DECISIONS.left);
        }
        if (state.phase === "vote") {
            const reopened: StrangerState = { ...next, votes: {}, voters: idsOf(next) };
            return { state: reopened, facts: because(publicFact("revote", `${nameOf(state, playerId)} left, so the vote starts again. Tell them in one line to vote again.`), STRANGER_DECISIONS.vote), timers: { vote: decisions.voteSeconds } };
        }
        if (state.phase !== "questions" || (playerId !== state.askerId && playerId !== state.targetId && playerId !== state.askedById)) {
            return { state: next, facts: [] };
        }
        const nextAsker: string = playerId === state.askerId ? idsOf(next)[0] ?? state.strangerId : state.askerId;
        const reset: StrangerState = { ...next, step: "pick", askerId: nextAsker, targetId: null, askedById: null, typed: "" };
        return { state: reset, facts: [], timers: { turn: decisions.stepSeconds } };
    };

    const cartridge: Cartridge<StrangerState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<StrangerState> {
            const fallback: Place = pick(decisions.places, random);
            const strangerId: string = dealOne(players, random);
            const first: string = dealOne(players, random);
            const state: StrangerState = {
                phase: "dealing", players, strangerId, place: "", fallback, roles: {}, step: "pick", askerId: first, targetId: null, askedById: null,
                questions: { used: 0, max: decisions.questions.budget, warnAt: decisions.questions.warnAt }, typed: "", calls: [], voters: [], votes: {},
                guessHeard: false, result: null, strangerName: "", accusedName: "", ending: "",
            };
            const request: string = [
                "Pick one place where about eight different kinds of people might be found at the same time: somewhere people work, visit or travel through.",
                "Make it a place most adults know, and not the first one anyone would think of.",
                "Reply in exactly this form and nothing else: Place: <the place, at most three words> | Roles: <eight different people who might be there, one or two words each, separated by commas>",
            ].join(" ");
            return { state, facts: [], nextPhaseId: "dealing", contentRequest: request };
        },

        phaseOf(state: StrangerState): string {
            return state.phase;
        },

        turn(state: StrangerState): Turn | null {
            if (state.phase === "dealing") {
                return { kind: "secret", label: "Look at your phone" };
            }
            if (state.phase === "questions") {
                if (state.step === "pick") {
                    return { kind: "one", playerId: state.askerId, label: "Picks who to ask:" };
                }
                return state.step === "ask" ? { kind: "one", playerId: state.askerId, label: "Asks:" } : { kind: "one", playerId: state.targetId ?? state.askerId, label: "Answers:" };
            }
            if (state.phase === "vote") {
                return { kind: "everyone", playerIds: state.voters, doneIds: Object.keys(state.votes), label: "Vote on your phone" };
            }
            return null;
        },

        roleOf(state: StrangerState, playerId: string): string {
            if (state.phase === "questions") {
                const speaker: string | null = state.step === "ask" ? state.askerId : state.step === "answer" ? state.targetId : null;
                return speaker === playerId ? "up" : "quiet";
            }
            return state.phase === "guess" && playerId === state.strangerId ? "up" : "quiet";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: StrangerState, playerId: string): LegalAction[] {
            if (state.phase === "questions") {
                const actions: LegalAction[] = [];
                if (state.step === "pick" && state.askerId === playerId) {
                    actions.push(...targetsOf(state).map((id: string): LegalAction => ({ actionId: `${STRANGER_ACTIONS.target}${id}`, label: nameOf(state, id) })));
                }
                if (state.calls.includes(playerId) === false) {
                    actions.push({ actionId: STRANGER_ACTIONS.call, label: "Call the vote" });
                }
                return playerId === state.strangerId ? [...actions, { actionId: STRANGER_ACTIONS.reveal, label: "I know where we are" }] : actions;
            }
            if (state.phase !== "vote" || state.voters.includes(playerId) === false || state.votes[playerId] !== undefined) {
                return [];
            }
            return idsOf(state).filter((id: string) => id !== playerId).map((id: string): LegalAction => ({ actionId: `${STRANGER_ACTIONS.vote}${id}`, label: nameOf(state, id) }));
        },

        apply(state: StrangerState, playerId: string, actionId: string): Step<StrangerState> {
            if (cartridge.legalActions(state, playerId).some((action: LegalAction) => action.actionId === actionId) === false) {
                return { state, facts: [] };
            }
            if (state.phase === "vote") {
                const next: StrangerState = { ...state, votes: { ...state.votes, [playerId]: actionId.slice(STRANGER_ACTIONS.vote.length) } };
                return next.voters.every((voter: string) => next.votes[voter] !== undefined) === true ? resolve(next) : { state: next, facts: [] };
            }
            if (actionId.startsWith(STRANGER_ACTIONS.target) === true) {
                const next: StrangerState = { ...state, step: "ask", targetId: actionId.slice(STRANGER_ACTIONS.target.length) };
                return { state: next, facts: [], timers: { turn: decisions.stepSeconds } };
            }
            if (actionId === STRANGER_ACTIONS.reveal) {
                return openGuess(state, `${nameOf(state, playerId)} says they know the place, which makes them the Stranger. Tell them in a line they get one guess at it, with no hint.`, STRANGER_DECISIONS.guess);
            }
            const calls: string[] = [...state.calls, playerId];
            const called: StrangerState = { ...state, calls };
            if (calls.length * 2 > state.players.length) {
                return openVote(called, "Most of the table wants a vote.", STRANGER_DECISIONS.talk);
            }
            return { state: called, facts: [] };
        },

        onEvent(state: StrangerState, event: RoomEvent): Step<StrangerState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "contentReady" && state.phase === "dealing" && state.place === "") {
                const written: Place | null = parsePlace(event.text);
                const place: Place = written ?? state.fallback;
                const order: string[] = shuffled(place.roles, random);
                const roles: Record<string, string> = Object.fromEntries(state.players.map((player: CartridgePlayer, seat: number) => [player.playerId, order[seat % order.length] ?? "visitor"]));
                const text: string = `The place is ready and everyone has their card. Explain the game now, then say ${nameOf(state, state.askerId)} asks first.`;
                return { state: { ...state, place: place.name, roles }, facts: because(publicFact("ready", text), STRANGER_DECISIONS.places), timers: { read: decisions.readSeconds } };
            }
            if (event.type === "timerFired" && event.timerId === "read" && state.phase === "dealing" && state.place !== "") {
                const timers: Record<string, number> = { turn: decisions.stepSeconds, ...(decisions.talkSeconds > 0 ? { talk: decisions.talkSeconds } : {}) };
                const text: string = `Questions are open. ${nameOf(state, state.askerId)} picks who to ask first. There are ${decisions.questions.budget} questions before the vote.`;
                return { state: { ...state, phase: "questions" }, facts: because(publicFact("questions", text), STRANGER_DECISIONS.read), nextPhaseId: "questions", timers };
            }
            if (event.type === "timerFired" && event.timerId === "turn" && state.phase === "questions") {
                return stalled(state);
            }
            if (event.type === "timerFired" && event.timerId === "talk" && state.phase === "questions") {
                return openVote(state, "Time is up for questions.", STRANGER_DECISIONS.talk);
            }
            if (event.type === "timerFired" && event.timerId === "vote" && state.phase === "vote") {
                return resolve(state);
            }
            if (event.type === "timerFired" && event.timerId === "guess" && state.phase === "guess") {
                return missed(state, "ran out of time");
            }
            if (state.phase === "questions") {
                return duringQuestions(state, event);
            }
            if (state.phase === "guess") {
                return duringGuess(state, event);
            }
            return { state, facts: [] };
        },

        publicScene(state: StrangerState): Scene {
            if (state.phase === "dealing") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: box.name }, { type: "text", text: "Look at your phone. Keep it to yourself.", emphasis: "large" }] };
            }
            if (state.phase === "questions") {
                const who: string = state.step === "pick" ? `${nameOf(state, state.askerId)} picks who to ask` : state.step === "ask" ? `${nameOf(state, state.askerId)} asks ${nameOf(state, state.targetId)}` : `${nameOf(state, state.targetId)} answers ${nameOf(state, state.askerId)}`;
                const blocks: SceneBlock[] = [
                    { type: "title", text: who, kicker: `Question ${Math.min(state.questions.used + 1, state.questions.max)} of ${state.questions.max}` },
                    { type: "progress", label: "Questions asked", current: state.questions.used, max: state.questions.max, marks: "card" },
                ];
                if (state.typed !== "") {
                    blocks.push({ type: "text", text: state.typed, emphasis: "large" });
                }
                if (decisions.talkSeconds > 0) {
                    blocks.push({ type: "timer", seconds: decisions.talkSeconds, label: "of questions left", running: true });
                }
                if (state.calls.length > 0) {
                    blocks.push({ type: "text", text: `${state.calls.length} of ${state.players.length} want to vote.` });
                }
                return { mood: "tense", transition: "fade", blocks };
            }
            if (state.phase === "vote") {
                return {
                    mood: "tense",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: "Who is the stranger?", kicker: "Vote on your phone" },
                        { type: "timer", seconds: decisions.voteSeconds, label: "to vote", running: true },
                    ],
                };
            }
            if (state.phase === "guess") {
                return {
                    mood: "tense",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: `${nameOf(state, state.strangerId)} is the stranger`, kicker: "One guess" },
                        { type: "text", text: "Where are we? Hold and say it, or type it.", emphasis: "large" },
                        { type: "timer", seconds: decisions.guessSeconds, label: "to name the place", running: true },
                    ],
                };
            }
            const kickers: Record<StrangerResult, string> = {
                caught: "Caught",
                namedIt: "Caught, and named the place",
                slipped: "Got away with it",
                early: "Named the place",
                earlyMiss: "Wrong place",
                strangerLeft: "The stranger left",
                emptied: "Too few left",
            };
            const blocks: SceneBlock[] = [
                { type: "title", text: state.place, kicker: kickers[state.result ?? "emptied"] },
                { type: "text", text: `${state.strangerName} was the stranger.`, emphasis: "large" },
            ];
            const winners: boolean = state.result === "namedIt" || state.result === "slipped" || state.result === "early";
            return { mood: winners === true ? "defeat" : "victory", transition: "fade", blocks };
        },

        privateControls(state: StrangerState, playerId: string): Control[] {
            const isStranger: boolean = playerId === state.strangerId;
            const card: Control = isStranger === true
                ? { type: "roleCard", title: STRANGER_CARD_TITLE, body: "You don't know where you are. Listen to the answers, and bluff.", secret: true }
                : { type: "roleCard", title: state.place === "" ? "You're somewhere" : `You're at: ${state.place}`, body: state.place === "" ? "Your place is coming." : `You're the ${state.roles[playerId] ?? "visitor"}. One of you doesn't know where you are.`, secret: true };
            if (state.phase === "dealing") {
                return [card];
            }
            if (state.phase === "questions") {
                return [card, ...questionControls(state, playerId)];
            }
            if (state.phase === "vote") {
                const options: ControlOption[] = cartridge.legalActions(state, playerId).map((action: LegalAction): ControlOption => ({ id: action.actionId, label: action.label }));
                if (options.length === 0) {
                    return [card, { type: "waiting", text: state.voters.includes(playerId) === true ? "Voted." : "Watching the vote." }];
                }
                return [card, { type: "choice", prompt: "Who is the stranger?", options, multiple: false }];
            }
            if (state.phase === "guess") {
                if (isStranger === false) {
                    return [card, { type: "waiting", text: "The stranger is guessing." }];
                }
                return [
                    card,
                    { type: "textInput", id: "guess", prompt: "Where are we?", placeholder: "the place", maxLength: 40, note: "Hold and say it, or type it." },
                ];
            }
            const line: Record<StrangerResult, string> = {
                caught: "They caught you, and you missed the place.",
                namedIt: "You named the place.",
                slipped: "You got away with it.",
                early: "You named the place.",
                earlyMiss: "That wasn't the place.",
                strangerLeft: "",
                emptied: "",
            };
            return [{ type: "waiting", text: isStranger === true ? line[state.result ?? "emptied"] : "Look at the screen." }];
        },

        hostFacts(state: StrangerState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.place === "" || state.phase === "end") {
                return [];
            }
            return [
                { scope: { kind: "host" }, kind: "place", text: `The place is: ${state.place}.` },
                { scope: { kind: "public" }, kind: "questions", text: `${state.questions.used} of ${state.questions.max} questions are used.` },
            ];
        },

        outcome(state: StrangerState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            const stranger: string = state.strangerName;
            const results: Record<StrangerResult, string> = {
                caught: `The room caught ${stranger}.`,
                namedIt: `${stranger} was caught but named the place.`,
                slipped: `${stranger} got away with it.`,
                early: `${stranger} named the place.`,
                earlyMiss: `${stranger} named the wrong place.`,
                strangerLeft: "The stranger left.",
                emptied: "Too few people were left.",
            };
            return results[state.result ?? "emptied"];
        },
    };

    /**
     * Who the asker may pick: everyone but themselves and whoever just asked them.
     * @param state the state.
     * @returns their ids.
     */
    function targetsOf(state: StrangerState): string[] {
        return idsOf(state).filter((id: string) => id !== state.askerId && id !== state.askedById);
    }

    /**
     * The Stranger's guess was wrong, or never came.
     * @param state the state.
     * @param how why it counts as wrong, for the host.
     * @returns the step.
     */
    function missed(state: StrangerState, how: string): Step<StrangerState> {
        const place: string = state.place === "" ? state.fallback.name : state.place;
        const early: boolean = state.accusedName === "";
        const stranger: string = nameOf(state, state.strangerId);
        const text: string = early === true
            ? `${stranger}, the Stranger, ${how === "ran out of time" ? "ran out of time" : "guessed wrong"}, so the room wins. The place was ${place}.`
            : `${stranger}, the Stranger, was pinned and ${how === "ran out of time" ? "ran out of time" : "guessed wrong"}, so the room wins. The place was ${place}.`;
        return finish(state, early === true ? "earlyMiss" : "caught", text, STRANGER_DECISIONS.guess);
    }

    /**
     * What a phone shows during questions, besides the card.
     * @param state the state.
     * @param playerId whose phone.
     * @returns the controls.
     */
    function questionControls(state: StrangerState, playerId: string): Control[] {
        const buttons: ControlOption[] = [];
        if (state.calls.includes(playerId) === false) {
            buttons.push({ id: STRANGER_ACTIONS.call, label: `Call the vote (${state.calls.length} of ${state.players.length})` });
        }
        if (playerId === state.strangerId) {
            buttons.push({ id: STRANGER_ACTIONS.reveal, label: "I know where we are" });
        }
        const extra: Control[] = buttons.length === 0 ? [] : [{ type: "buttons", options: buttons }];
        if (state.step === "pick" && state.askerId === playerId) {
            const options: ControlOption[] = targetsOf(state).map((id: string): ControlOption => ({ id: `${STRANGER_ACTIONS.target}${id}`, label: nameOf(state, id) }));
            return [{ type: "choice", prompt: "Who do you ask?", options, multiple: false }, ...extra];
        }
        if (state.step === "ask" && state.askerId === playerId) {
            return [{ type: "textInput", id: `ask:${state.questions.used}`, prompt: `Ask ${nameOf(state, state.targetId)}`, placeholder: "your question", maxLength: 80, note: "Hold and ask out loud, or type it." }, ...extra];
        }
        if (state.step === "answer" && state.targetId === playerId) {
            return [{ type: "textInput", id: `reply:${state.questions.used}`, prompt: `Answer ${nameOf(state, state.askerId)}`, placeholder: "your answer", maxLength: 80, note: "Hold and answer out loud, or type it." }, ...extra];
        }
        const waiting: string = state.step === "pick" ? `${nameOf(state, state.askerId)} is picking who to ask.` : state.step === "ask" ? `${nameOf(state, state.askerId)} is asking ${nameOf(state, state.targetId)}.` : `${nameOf(state, state.targetId)} is answering.`;
        return [{ type: "waiting", text: waiting }, ...extra];
    }

    /**
     * One event during questions: a spoken or typed question or answer from whoever is up.
     * @param state the state.
     * @param event the event.
     * @returns the step.
     */
    function duringQuestions(state: StrangerState, event: RoomEvent): Step<StrangerState> {
        const speaker: string | null = state.step === "ask" ? state.askerId : state.step === "answer" ? state.targetId : null;
        const spoken: boolean = event.type === "speechEnded" && event.playerId === speaker && event.text.trim().length >= 3;
        const typedId: string = state.step === "ask" ? `ask:${state.questions.used}` : `reply:${state.questions.used}`;
        const typed: boolean = event.type === "answered" && event.playerId === speaker && event.controlId === typedId && typeof event.value === "string";
        if (spoken === false && typed === false) {
            return { state, facts: [] };
        }
        const shown: string = typed === true && event.type === "answered" ? String(event.value) : "";
        if (state.step === "ask") {
            return { state: { ...state, step: "answer", typed: shown }, facts: [], timers: { turn: decisions.stepSeconds } };
        }
        return afterAnswer({ ...state, typed: shown });
    }

    /**
     * One event during the Stranger's guess: a spoken guess waits for the host; a typed one is checked by code.
     * @param state the state.
     * @param event the event.
     * @returns the step.
     */
    function duringGuess(state: StrangerState, event: RoomEvent): Step<StrangerState> {
        const place: string = state.place === "" ? state.fallback.name : state.place;
        if (event.type === "speechEnded" && event.playerId === state.strangerId && event.text.trim().length >= 3) {
            return { state: { ...state, guessHeard: true }, facts: [] };
        }
        if (event.type === "answered" && event.playerId === state.strangerId && event.controlId === "guess" && typeof event.value === "string") {
            return namesPlace(place, event.value) === true ? named(state) : missed(state, "guessed wrong");
        }
        if (event.type === "hostRuled" && state.guessHeard === true) {
            if (event.ruling === "right") {
                return named(state);
            }
            return event.ruling === "wrong" ? missed(state, "guessed wrong") : { state, facts: [] };
        }
        return { state, facts: [] };
    }

    /**
     * The Stranger named the place.
     * @param state the state.
     * @returns the step.
     */
    function named(state: StrangerState): Step<StrangerState> {
        const place: string = state.place === "" ? state.fallback.name : state.place;
        const stranger: string = nameOf(state, state.strangerId);
        const early: boolean = state.accusedName === "";
        const text: string = early === true
            ? `${stranger}, the Stranger, named the place: ${place}. The Stranger wins. Say so in two short sentences.`
            : `${stranger}, the Stranger, was pinned but named the place: ${place}. The Stranger wins anyway. Say so in two short sentences.`;
        return finish(state, early === true ? "early" : "namedIt", text, STRANGER_DECISIONS.guess);
    }

    return {
        cartridge,
        hidden(state: StrangerState): HiddenValue[] {
            if (state.phase === "end") {
                return [];
            }
            const place: string = state.place === "" ? state.fallback.name : state.place;
            const insiders: string[] = ["host", ...idsOf(state).filter((id: string) => id !== state.strangerId)];
            const card: HiddenValue = { label: "the Stranger's card", text: STRANGER_CARD_TITLE, seenBy: [state.strangerId] };
            const who: HiddenValue[] = [nameOf(state, state.strangerId), state.strangerId].map((text: string): HiddenValue => ({ label: "who the Stranger is", text, seenBy: [state.strangerId], near: "stranger" }));
            const roles: HiddenValue[] = Object.entries(state.roles).filter(([id]: [string, string]) => id !== state.strangerId).map(([id, role]: [string, string]): HiddenValue => ({ label: "a player's role", text: role, seenBy: [id] }));
            if (state.phase === "guess") {
                // The vote or the Stranger's own announcement has made them public; the place is still hidden.
                return [{ label: "the place", text: place, seenBy: insiders }, ...roles];
            }
            return [{ label: "the place", text: place, seenBy: insiders }, card, ...who, ...(state.phase === "dealing" ? [] : roles)];
        },
    };
}

