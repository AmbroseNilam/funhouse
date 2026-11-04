// The identity kit: every player is dealt a secret identity (a person, a creature or a thing) that
// everyone else sees on their phone and they do not. Players take turns being on the spot: they ask
// the room yes-or-no questions out loud while the room answers out loud, until they say who they
// are or the clock or the questions run out. Code deals the identities, matches each guess
// against the real name, keeps the clocks and the scores. The host is never told an identity
// until it is revealed, so it cannot give one away; it only talks about turns, time and results.
// Name Tag is this kit.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Turn } from "../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { boxProblems, isWholeIn, squash, type Box, type HiddenValue, type KitGame } from "../kit/kit.ts";
import { because, frozenCopy } from "../kit/primitives.ts";
import { nameIn, scoreboard } from "./tap.ts";

/** What kind of thing an identity is. Shown to its owner as a hint halfway through their turn. */
export type IdentityKind = "person" | "creature" | "thing";

/** One identity that can be dealt. */
export interface Identity {
    /** What the card says. */
    name: string;
    kind: IdentityKind;
    /** Other names that count as saying it, such as a surname. At least four letters each. */
    also: string[];
}

/** Everything a creator may choose for a Name Tag game. */
export interface IdentityDecisions {
    /** Seconds everyone gets to look at the others' name tags before the first turn. */
    introSeconds: number;
    /** Seconds each player is on the spot. */
    turnSeconds: number;
    /** Questions each player may ask before the turn ends. */
    questionsPerTurn: number;
    /** Seconds the answer stays up between turns. */
    betweenSeconds: number;
    /** Identities to deal when the model writes too few. At least one per seat. */
    identities: Identity[];
}

/** The phases of the game. */
export type IdentityPhase = "writing" | "intro" | "asking" | "between" | "end";

/** How one player's turn ended. */
export type IdentityResult = "solved" | "questions" | "clock" | "passed" | "left";

/** What came of one player's turn. */
export interface TurnRecord {
    result: IdentityResult;
    questions: number;
    points: number;
}

/** The whole game, immutable between steps. */
export interface IdentityState {
    phase: IdentityPhase;
    /** Everyone still at the table, in seat order. */
    players: CartridgePlayer[];
    /** The identity each player is wearing, by player id. Only the owner may never see theirs. */
    dealt: Record<string, Identity>;
    /** Players who have yet to take a turn, then the player on the spot first. */
    waiting: string[];
    /** The player on the spot, or null between games. */
    current: string | null;
    /** Which turn this is, from 1; also names the clocks, so a stale clock is ignored. */
    turnNumber: number;
    /** How many turns the game will have had if nobody leaves. */
    turnCount: number;
    /** Questions the player on the spot has asked this turn. */
    asked: number;
    /** Whether the player on the spot has been given their hint. */
    hinted: boolean;
    /** Whose name tag has been shown to everyone, so it is no longer secret. */
    revealed: string[];
    /** How each finished turn ended, by player id. */
    records: Record<string, TurnRecord>;
    scores: Record<string, number>;
    /** Names of everyone who ever sat down, so a result still reads after a player leaves. */
    names: Record<string, string>;
}

/** Decision ids a rehearsal names when it explains a moment. */
export const IDENTITY_DECISIONS: { identities: string; intro: string; turn: string; questions: string; between: string; rotation: string } = {
    identities: "identities",
    intro: "introSeconds",
    turn: "turnSeconds",
    questions: "questionsPerTurn",
    between: "betweenSeconds",
    rotation: "turnOrder",
};

/** The one thing the player on the spot can press. */
export const PASS_ACTION: string = "pass";

/** Points for finding out who you are, before questions are taken off. */
const SOLVE_POINTS: number = 5;

/** Points for a player who didn't, so nobody ends the game on nothing. */
const STORY_POINTS: number = 1;

/** Questions it takes to lose one point from a solve. */
const QUESTIONS_PER_POINT: number = 3;

/** Longest identity name accepted from the model. */
const NAME_CHARACTER_LIMIT: number = 32;

/** Most words in an identity name. */
const NAME_WORD_LIMIT: number = 4;

/** Shortest alias, in letters, so a common word can't count as a guess. */
const ALIAS_LETTER_MINIMUM: number = 4;

/** Words a question needs before it counts, so a cough or "um" is free. */
const QUESTION_WORD_MINIMUM: number = 2;

/** Names the model may not write. A backstop to the request, which also asks for non-sensitive names. */
const BLOCKED_WORDS: readonly string[] = [
    "hitler", "nazi", "stalin", "mussolini", "pol pot", "bin laden", "isis", "kkk", "jesus", "muhammad", "allah", "buddha", "satan", "devil",
    "trump", "biden", "putin", "obama", "epstein", "weinstein", "cosby", "columbine", "holocaust", "genocide", "slave", "terror", "rapist", "murder",
    "sex", "porn", "nude", "drug", "cocaine", "heroin", "suicide",
];

/** The wording for each kind in the host's lines. */
const KIND_PHRASES: Record<IdentityKind, string> = { person: "a person", creature: "a creature", thing: "a thing" };

/**
 * Whether an identity is one the game will deal: a short plain name, a known kind, aliases of at least
 * four letters, and nothing from the blocked list.
 * @param identity the identity.
 * @returns true when it can be dealt.
 */
export function isUsableIdentity(identity: Identity): boolean {
    const words: string[] = identity.name.trim().split(/\s+/).filter((word: string) => word !== "");
    const shape: boolean = /^[\p{L}\p{N} '’.,&-]+$/u.test(identity.name) === true && identity.name.length <= NAME_CHARACTER_LIMIT && words.length >= 1 && words.length <= NAME_WORD_LIMIT;
    if (shape === false || (["person", "creature", "thing"] as string[]).includes(identity.kind) === false) {
        return false;
    }
    const names: string[] = [identity.name, ...identity.also];
    if (identity.also.some((alias: string) => squash(alias).length < ALIAS_LETTER_MINIMUM) === true) {
        return false;
    }
    return names.every((text: string) => BLOCKED_WORDS.every((blocked: string) => squash(text).includes(squash(blocked)) === false));
}

/**
 * The names that count as saying an identity: the card, the card without a leading "the", "a" or
 * "an", and, for a person written as first and last name, the last name.
 * @param identity the identity.
 * @returns the names, without duplicates.
 */
export function namesOf(identity: Identity): string[] {
    const bare: string = identity.name.replace(/^(the|a|an)\s+/i, "");
    const words: string[] = bare.split(/\s+/).filter((word: string) => word !== "");
    const surname: string[] = identity.kind === "person" && words.length >= 2 && squash(words.at(-1) ?? "").length >= ALIAS_LETTER_MINIMUM ? [words.at(-1) ?? ""] : [];
    return [...new Set([identity.name, bare, ...identity.also, ...surname])];
}

/**
 * How far apart two strings are, counting single-letter changes. Used to forgive a microphone that
 * heard "Einstien" for "Einstein".
 * @param first one string.
 * @param second the other.
 * @returns the number of edits.
 */
export function editDistance(first: string, second: string): number {
    let previous: number[] = Array.from({ length: second.length + 1 }, (_unused: unknown, index: number) => index);
    for (let row = 1; row <= first.length; row += 1) {
        const current: number[] = [row];
        for (let column = 1; column <= second.length; column += 1) {
            const same: number = first[row - 1] === second[column - 1] ? 0 : 1;
            current.push(Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, (previous[column - 1] ?? 0) + same));
        }
        previous = current;
    }
    return previous[second.length] ?? 0;
}

/**
 * Whether what someone said contains one of an identity's names. Matches whole words and runs of
 * words, ignoring case, spacing and punctuation, and forgives one wrong letter in a name of seven
 * or more letters and two in twelve or more, since a transcript is never perfect. A name shorter than
 * seven letters must match exactly, so "moan" never counts as "Moon".
 * @param said the transcript.
 * @param identity the identity.
 * @returns true when the speaker said who they are.
 */
export function saidIdentity(said: string, identity: Identity): boolean {
    const spoken: string[] = said.split(/\s+/).map(squash).filter((word: string) => word !== "");
    for (const name of namesOf(identity)) {
        const target: string = squash(name);
        const length: number = name.split(/\s+/).filter((word: string) => word !== "").length;
        const allowed: number = target.length >= 12 ? 2 : target.length >= 7 ? 1 : 0;
        for (let size = Math.max(1, length - 1); size <= length + 1; size += 1) {
            for (let start = 0; start + size <= spoken.length; start += 1) {
                if (editDistance(spoken.slice(start, start + size).join(""), target) <= allowed) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Reads the model's identities defensively. Each is a string "Name|kind", and the usable ones only
 * are kept, once each.
 * @param text whatever the model wrote, ideally a JSON array of such strings.
 * @returns the identities found, possibly none.
 */
export function parseIdentities(text: string): Identity[] {
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
    const found: Identity[] = [];
    for (const item of parsed as unknown[]) {
        if (typeof item !== "string") {
            continue;
        }
        const [name, kind] = item.split("|").map((part: string) => part.trim());
        const identity: Identity = { name: name ?? "", kind: (kind ?? "") as IdentityKind, also: [] };
        if (isUsableIdentity(identity) === true) {
            found.push(identity);
        }
    }
    return found;
}

/**
 * The identities to deal: the model's usable ones first, topped up from the fallback bank, with no
 * two that share a name or an alias.
 * @param written the model's identities.
 * @param fallback the bank.
 * @param count how many are needed.
 * @param random a function returning [0, 1), used to shuffle the fallback.
 * @param seatNames the names at the table. An identity that is, or is inside, one of them is skipped,
 * since the screen shows those names all game and would look like a leak.
 * @returns exactly that many identities, or as many as both together have.
 */
export function identitiesToDeal(written: readonly Identity[], fallback: readonly Identity[], count: number, random: () => number, seatNames: readonly string[] = []): Identity[] {
    const bank: Identity[] = shuffled(fallback, random);
    const chosen: Identity[] = [];
    for (const identity of [...written, ...bank]) {
        const taken: boolean = chosen.some((other: Identity) => namesOf(other).some((name: string) => namesOf(identity).some((mine: string) => squash(mine) === squash(name))) === true);
        const clashes: boolean = namesOf(identity).some((name: string) => seatNames.some((seat: string) => squash(seat).includes(squash(name)) === true || (squash(seat).length >= ALIAS_LETTER_MINIMUM && squash(name).includes(squash(seat)) === true)));
        if (taken === false && clashes === false && chosen.length < count) {
            chosen.push(identity);
        }
    }
    return chosen;
}

/**
 * A shuffled copy.
 * @param items what to shuffle.
 * @param random a function returning [0, 1).
 * @returns the copy.
 */
export function shuffled<Item>(items: readonly Item[], random: () => number): Item[] {
    const copy: Item[] = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap: number = Math.floor(random() * (index + 1));
        const held: Item | undefined = copy[index];
        copy[index] = copy[swap] as Item;
        copy[swap] = held as Item;
    }
    return copy;
}

/**
 * Points for finding out who you are: more for fewer questions, never fewer than one.
 * @param questions how many questions it took, counting the one that solved it.
 * @returns the points.
 */
export function solvePoints(questions: number): number {
    return Math.max(1, SOLVE_POINTS - Math.floor((questions - 1) / QUESTIONS_PER_POINT));
}

/**
 * Checks a Name Tag game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function identityProblems(decisions: IdentityDecisions): string[] {
    const problems: string[] = [];
    if (isWholeIn(decisions.introSeconds, 5, 30) === false || isWholeIn(decisions.betweenSeconds, 4, 30) === false) {
        problems.push("The intro takes 5 to 30 seconds and the pause between turns 4 to 30, in whole seconds.");
    }
    if (isWholeIn(decisions.turnSeconds, 30, 180) === false) {
        problems.push("A turn takes a whole number of seconds from 30 to 180.");
    }
    if (isWholeIn(decisions.questionsPerTurn, 4, 30) === false) {
        problems.push("A turn allows a whole number of questions from 4 to 30.");
    }
    if (decisions.identities.length < 8 || decisions.identities.some((identity: Identity) => isUsableIdentity(identity) === false) === true) {
        problems.push("There must be at least eight usable fallback identities, each a short plain name of a known kind.");
    }
    const names: string[] = decisions.identities.flatMap((identity: Identity) => namesOf(identity).map(squash));
    if (new Set(names).size !== names.length) {
        problems.push("No two fallback identities may share a name or an alias.");
    }
    return problems;
}

/**
 * Every problem with a Name Tag blueprint, box included. The fallback identities are checked
 * against the box, since a pitch that names one would give it away.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function identityBlueprintProblems(box: Box, decisions: IdentityDecisions): string[] {
    const problems: string[] = [...boxProblems(box, decisions.identities.flatMap(namesOf)), ...identityProblems(decisions)];
    if (box.minPlayers < 3) {
        problems.push("Name Tag needs at least three people, so someone is left to answer.");
    }
    if (box.maxPlayers > 8) {
        problems.push("Name Tag turns into a crowd above eight people.");
    }
    return problems;
}

/**
 * Builds the manifest, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 */
export function identityManifest(box: Box): CartridgeManifest {
    const quiet: Record<string, "muted"> = { "*": "muted" };
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're hosting ${box.name}. Every player has a secret name tag: a person, a creature or a thing. Everyone sees it on their phone except its owner. One player at a time is on the spot and asks the room yes-or-no questions out loud to work out who they are, and the room answers out loud.`,
            "You are never told a name tag until it is revealed, so never guess at one, hint at one, or confirm one. If anyone asks you what someone is, say it is not yours to tell.",
            "You keep the pace: say who is up, say how many questions are left when you are told, and say what happened when a turn ends. The game's code works out who guessed right and keeps the score; never decide that yourself and never change a score.",
            "Your tone: plain, dry, warm, short. Tease the name tag, never the person. If someone is stuck, be kind and let them pass.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            { id: "writing", hostBrief: "The name tags are being written. One short line at most, then wait.", listening: quiet, hostMayInterject: false, silenceSeconds: 0 },
            { id: "intro", hostBrief: "In two short sentences: everyone's name tag is on everyone else's phone, so look at the others' and keep quiet about them; then say who goes first when you are told. Do not read any name tag out.", listening: quiet, hostMayInterject: false, silenceSeconds: 0 },
            {
                id: "asking",
                hostBrief: "One player is on the spot and holds to talk. When you are told who is up, say their name and tell them to hold to talk and ask the room. After that reply exactly (quiet) unless you are told something new, or someone speaks to you. Never answer their questions: the room does.",
                listening: { spotlight: "holdToTalk", "*": "muted" },
                hostMayInterject: false,
                hostMostlyQuiet: true,
                silenceSeconds: 0,
            },
            { id: "between", hostBrief: "A turn is over and the name tag is out. Say what it was, in one or two short lines, kind to the player; then say who is next when you are told.", listening: quiet, hostMayInterject: true, silenceSeconds: 0 },
            { id: "end", hostBrief: "The game is over. Two sentences: who found out fastest, and one kind line for the player who took longest. Then ask if they want another game.", listening: { "*": "holdToTalk" }, hostMayInterject: true, silenceSeconds: 0 },
        ],
    };
}

/**
 * Builds a Name Tag game.
 * @param givenBox the box; copied.
 * @param givenDecisions the decisions; copied. Check them with identityBlueprintProblems first.
 * @param random a function returning [0, 1).
 * @returns the game.
 */
export function createIdentityGame(givenBox: Box, givenDecisions: IdentityDecisions, random: () => number = Math.random): KitGame<IdentityState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: IdentityDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = identityManifest(box);
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });

    /**
     * Whether a player is the one on the spot.
     * @param state the state.
     * @param playerId the player.
     * @returns true when they are, during a turn.
     */
    const isOnTheSpot = (state: IdentityState, playerId: string): boolean => state.phase === "asking" && state.current === playerId;

    /**
     * Questions left in this turn.
     * @param state the state.
     * @returns the number.
     */
    const questionsLeft = (state: IdentityState): number => decisions.questionsPerTurn - state.asked;

    /**
     * Opens a player's turn.
     * @param state the state, with the player no longer waiting.
     * @param playerId who is up.
     * @param decision the decision that opened it.
     * @returns the step.
     */
    const startTurn = (state: IdentityState, playerId: string, decision: string): Step<IdentityState> => {
        const turnNumber: number = state.turnNumber + 1;
        const next: IdentityState = { ...state, phase: "asking", current: playerId, turnNumber, asked: 0, hinted: false, waiting: state.waiting.filter((id: string) => id !== playerId) };
        const text: string = [
            `Turn ${turnNumber} of ${state.turnCount}: ${nameIn(state.players, playerId)} is on the spot, with ${decisions.turnSeconds} seconds and ${decisions.questionsPerTurn} questions.`,
            "Say their name and tell them to hold to talk and ask the room a yes-or-no question. Do not say or guess what they are.",
        ].join(" ");
        const timers: Record<string, number> = { [`turn${turnNumber}`]: decisions.turnSeconds, [`hint${turnNumber}`]: Math.floor(decisions.turnSeconds / 2) };
        return { state: next, facts: because(publicFact("turn", text), decision), nextPhaseId: "asking", timers };
    };

    /**
     * Ends the player's turn: records it, reveals the name tag, scores it and moves to the pause.
     * @param state the state during a turn.
     * @param result how it ended.
     * @param decision the decision behind the ending.
     * @returns the step.
     */
    const endTurn = (state: IdentityState, result: IdentityResult, decision: string): Step<IdentityState> => {
        const playerId: string = state.current ?? "";
        const identity: Identity | undefined = state.dealt[playerId];
        const points: number = result === "solved" ? solvePoints(state.asked) : STORY_POINTS;
        const records: Record<string, TurnRecord> = { ...state.records, [playerId]: { result, questions: state.asked, points } };
        const scores: Record<string, number> = { ...state.scores, [playerId]: (state.scores[playerId] ?? 0) + points };
        const next: IdentityState = { ...state, phase: "between", records, scores, revealed: [...state.revealed, playerId] };
        const who: string = nameIn(state.players, playerId);
        const was: string = identity?.name ?? "someone";
        const stories: Record<IdentityResult, string> = {
            solved: `${who} worked out who they are after ${state.asked} ${state.asked === 1 ? "question" : "questions"}: ${was}. That is ${points} ${points === 1 ? "point" : "points"}. Say so in a line or two.`,
            questions: `${who} ran out of questions. They were ${was}. They get a point for the story. Be kind and tease the name tag, not them.`,
            clock: `Time ran out on ${who}. They were ${was}. They get a point for the story. Be kind and tease the name tag, not them.`,
            passed: `${who} passed. They were ${was}. They get a point for the story. Say it lightly.`,
            left: `${who} left.`,
        };
        const timers: Record<string, number> = { [`between${state.turnNumber}`]: decisions.betweenSeconds };
        return { state: next, facts: because(publicFact("turn-over", stories[result]), decision), nextPhaseId: "between", timers };
    };

    /**
     * Finishes the game with the scores.
     * @param state the state.
     * @returns the step.
     */
    const finish = (state: IdentityState): Step<IdentityState> => {
        const solved: [string, TurnRecord][] = Object.entries(state.records).filter(([, record]: [string, TurnRecord]) => record.result === "solved");
        const quickest: [string, TurnRecord] | undefined = [...solved].sort((first: [string, TurnRecord], second: [string, TurnRecord]) => first[1].questions - second[1].questions)[0];
        const ranked: [string, number][] = Object.entries(state.scores).sort((first: [string, number], second: [string, number]) => second[1] - first[1]);
        const top: string = ranked.slice(0, 2).map(([playerId, points]: [string, number]) => `${state.names[playerId] ?? "Someone"} with ${points}`).join(" and ");
        const found: string = quickest === undefined ? "Nobody worked out who they were." : `${state.names[quickest[0]] ?? "Someone"} found out fastest, in ${quickest[1].questions} ${quickest[1].questions === 1 ? "question" : "questions"}.`;
        const text: string = `That was the last turn. ${found} Most points: ${top === "" ? "nobody" : top}.`;
        const revealed: string[] = Object.keys(state.dealt);
        return { state: { ...state, phase: "end", current: null, revealed }, facts: because(publicFact("game-over", text), IDENTITY_DECISIONS.rotation), nextPhaseId: "end" };
    };

    /**
     * Moves on after the pause: the next player, or the end.
     * @param state the state in the pause.
     * @returns the step.
     */
    const advance = (state: IdentityState): Step<IdentityState> => {
        const upNext: string | undefined = state.waiting[0];
        return upNext === undefined ? finish(state) : startTurn(state, upNext, IDENTITY_DECISIONS.between);
    };

    /**
     * Hears the player on the spot: if they said who they are the turn is solved; otherwise a real
     * question spends one of the turn's questions, and the last one ends the turn.
     * @param state the state during a turn.
     * @param text what they said.
     * @returns the step.
     */
    const heardAsker = (state: IdentityState, text: string): Step<IdentityState> => {
        const words: number = text.split(/\s+/).filter((word: string) => word !== "").length;
        if (words < QUESTION_WORD_MINIMUM) {
            return { state, facts: [] };
        }
        const asked: IdentityState = { ...state, asked: state.asked + 1 };
        const identity: Identity | undefined = state.dealt[state.current ?? ""];
        if (identity !== undefined && saidIdentity(text, identity) === true) {
            return endTurn(asked, "solved", IDENTITY_DECISIONS.identities);
        }
        if (questionsLeft(asked) <= 0) {
            return endTurn(asked, "questions", IDENTITY_DECISIONS.questions);
        }
        if (questionsLeft(asked) !== 3) {
            return { state: asked, facts: [] };
        }
        const warning: string = `${nameIn(state.players, state.current)} has 3 questions left. Say so in a few words.`;
        return { state: asked, facts: because(publicFact("questions-left", warning), IDENTITY_DECISIONS.questions) };
    };

    /**
     * Someone left. A player who hasn't had a turn simply loses it; the player on the spot ends their
     * turn at once; the game ends if fewer than three remain, since nobody would be left to answer.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: IdentityState, playerId: string): Step<IdentityState> => {
        const lostTurn: number = state.waiting.includes(playerId) === true ? 1 : 0;
        const without: IdentityState = { ...state, players: state.players.filter((player: CartridgePlayer) => player.playerId !== playerId), waiting: state.waiting.filter((id: string) => id !== playerId), turnCount: state.turnCount - lostTurn };
        if (state.phase === "end" || state.phase === "writing" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return { state: without, facts: [] };
        }
        if (without.players.length < 3) {
            return finish({ ...without, current: null });
        }
        if (state.phase === "asking" && state.current === playerId) {
            const after: IdentityState = { ...without, records: { ...without.records, [playerId]: { result: "left", questions: state.asked, points: 0 } } };
            const upNext: string | undefined = after.waiting[0];
            const text: string = `${nameIn(state.players, playerId)} left the game, so their turn is over. Say so in a line, then move on.`;
            const moved: Step<IdentityState> = upNext === undefined ? finish({ ...after, current: null }) : startTurn({ ...after, current: null }, upNext, IDENTITY_DECISIONS.rotation);
            return { ...moved, facts: [...because(publicFact("left", text), IDENTITY_DECISIONS.rotation), ...moved.facts] };
        }
        return { state: without, facts: [] };
    };

    /**
     * What a player may press now: the player on the spot may pass.
     * @param state the state.
     * @param playerId the player.
     * @returns the actions.
     */
    const legalFor = (state: IdentityState, playerId: string): LegalAction[] => (isOnTheSpot(state, playerId) === true ? [{ actionId: PASS_ACTION, label: "Pass this turn" }] : []);

    const cartridge: Cartridge<IdentityState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<IdentityState> {
            const names: Record<string, string> = Object.fromEntries(players.map((player: CartridgePlayer) => [player.playerId, player.name]));
            const state: IdentityState = {
                phase: "writing",
                players,
                dealt: {},
                waiting: players.map((player: CartridgePlayer) => player.playerId),
                current: null,
                turnNumber: 0,
                turnCount: players.length,
                asked: 0,
                hinted: false,
                revealed: [],
                records: {},
                scores: Object.fromEntries(players.map((player: CartridgePlayer) => [player.playerId, 0])),
                names,
            };
            const request: string = [
                `Write ${players.length + 4} secret identities for a party game where each player is told who they are by their friends.`,
                "Each is a well-known person, creature or thing that nearly everyone, children included, would know: historical figures, explorers, scientists, artists, animals, myths and fairy tales, famous places, everyday objects. Mix the three kinds.",
                "Leave out anyone alive in politics, anyone known for violence or a tragedy, religious figures, brands and anything about bodies, drugs or romance.",
                "Reply with only a JSON array of strings, each written as Name|kind, where kind is person, creature or thing, such as [\"Marie Curie|person\", \"Giraffe|creature\", \"Eiffel Tower|thing\"].",
            ].join(" ");
            return { state, facts: [], nextPhaseId: "writing", contentRequest: request };
        },

        phaseOf(state: IdentityState): string {
            return state.phase;
        },

        turn(state: IdentityState): Turn | null {
            if (state.phase === "asking" && state.current !== null) {
                return { kind: "one", playerId: state.current, label: "On the spot" };
            }
            return null;
        },

        roleOf(state: IdentityState, playerId: string): string {
            return isOnTheSpot(state, playerId) === true ? "spotlight" : "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: IdentityState, playerId: string): LegalAction[] {
            return legalFor(state, playerId);
        },

        apply(state: IdentityState, playerId: string, actionId: string): Step<IdentityState> {
            if (legalFor(state, playerId).some((action: LegalAction) => action.actionId === actionId) === false) {
                return { state, facts: [] };
            }
            return endTurn(state, "passed", IDENTITY_DECISIONS.turn);
        },

        onEvent(state: IdentityState, event: RoomEvent): Step<IdentityState> {
            if (event.type === "contentReady" && state.phase === "writing") {
                const seats: number = state.players.length;
                const chosen: Identity[] = identitiesToDeal(parseIdentities(event.text), decisions.identities, seats, random, state.players.map((player: CartridgePlayer) => player.name));
                const handed: Identity[] = shuffled(chosen, random);
                const dealt: Record<string, Identity> = Object.fromEntries(state.players.map((player: CartridgePlayer, seat: number) => [player.playerId, handed[seat] as Identity]));
                const text: string = `Name tags are out. Tell them in two short sentences: everyone's name tag is on everyone else's phone, so look at the others' and say nothing; then ${nameIn(state.players, state.waiting[0] ?? null)} goes first. Do not read any name tag out.`;
                return { state: { ...state, phase: "intro", dealt }, facts: because(publicFact("intro", text), IDENTITY_DECISIONS.identities), nextPhaseId: "intro", timers: { intro: decisions.introSeconds } };
            }
            if (event.type === "timerFired" && state.phase === "intro" && event.timerId === "intro") {
                const first: string | undefined = state.waiting[0];
                return first === undefined ? finish(state) : startTurn(state, first, IDENTITY_DECISIONS.intro);
            }
            if (event.type === "timerFired" && state.phase === "asking" && event.timerId === `hint${state.turnNumber}`) {
                return { state: { ...state, hinted: true }, facts: [] };
            }
            if (event.type === "timerFired" && state.phase === "asking" && event.timerId === `turn${state.turnNumber}`) {
                return endTurn(state, "clock", IDENTITY_DECISIONS.turn);
            }
            if (event.type === "timerFired" && state.phase === "between" && event.timerId === `between${state.turnNumber}`) {
                return advance(state);
            }
            if (event.type === "speechEnded" && state.phase === "asking" && event.playerId === state.current) {
                return heardAsker(state, event.text);
            }
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            return { state, facts: [] };
        },

        publicScene(state: IdentityState): Scene {
            const kicker: string = `Turn ${Math.min(state.turnNumber, state.turnCount)} of ${state.turnCount}`;
            const who: string = nameIn(state.players, state.current);
            if (state.phase === "writing") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: box.name }, { type: "text", text: "Writing the name tags…", emphasis: "whisper" }] };
            }
            if (state.phase === "intro") {
                return {
                    mood: "lobby",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: "Look at the others' name tags", kicker: box.name },
                        { type: "text", text: "Each of you can see everyone's but your own. Keep it to yourself.", emphasis: "large" },
                        { type: "timer", seconds: decisions.introSeconds, label: "until the first turn", running: true },
                    ],
                };
            }
            if (state.phase === "asking") {
                return {
                    mood: "tense",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: `${who}, who are you?`, kicker },
                        { type: "progress", label: "Questions asked", current: state.asked, max: decisions.questionsPerTurn, marks: "card" },
                        { type: "text", text: "Room, answer yes, no or sort of. Don't say the name.", emphasis: "large" },
                        { type: "timer", seconds: decisions.turnSeconds, label: `on the spot, turn ${state.turnNumber}`, running: true },
                    ],
                };
            }
            if (state.phase === "between") {
                const record: TurnRecord | undefined = state.records[state.current ?? ""];
                const identity: Identity | undefined = state.dealt[state.current ?? ""];
                const found: boolean = record?.result === "solved";
                const line: string = found === true ? `${who} found out in ${record?.questions ?? 0} ${record?.questions === 1 ? "question" : "questions"}. ${record?.points ?? 0} ${record?.points === 1 ? "point" : "points"}.` : `${who} didn't get there. A point for the story.`;
                return {
                    mood: found === true ? "victory" : "dawn",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: identity?.name ?? "", kicker: `${who} was` },
                        { type: "text", text: line, emphasis: "large" },
                        scoreboard("Points", state.players, state.scores),
                    ],
                };
            }
            const everything: SceneBlock[] = [{ type: "title", text: "Name tags off", kicker: box.name }, scoreboard("Points", state.players, state.scores), reveals(state)];
            return { mood: "victory", transition: "fade", blocks: everything };
        },

        privateControls(state: IdentityState, playerId: string): Control[] {
            if (state.phase === "writing") {
                return [{ type: "waiting", text: "Getting the name tags ready." }];
            }
            const mine: Identity | undefined = state.dealt[playerId];
            const seen: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => player.playerId !== playerId && state.dealt[player.playerId] !== undefined);
            const spot: CartridgePlayer | undefined = seen.find((player: CartridgePlayer) => player.playerId === state.current);
            const lead: Control[] = spot === undefined ? [] : [{ type: "roleCard", title: state.dealt[spot.playerId]?.name ?? "", body: `${spot.name} is on the spot. This is their name tag.`, secret: false }];
            const rest: Control[] = seen
                .filter((player: CartridgePlayer) => player.playerId !== state.current)
                .map((player: CartridgePlayer): Control => ({ type: "notice", text: `${player.name}: ${state.dealt[player.playerId]?.name ?? ""}`, tone: "info" }));
            const others: Control[] = [...lead, ...rest];
            if (state.phase === "end") {
                return [{ type: "waiting", text: "Look at the screen." }];
            }
            if (isOnTheSpot(state, playerId) === true) {
                const hint: Control[] = state.hinted === true && mine !== undefined ? [{ type: "notice", text: `A hint: you are ${KIND_PHRASES[mine.kind]}.`, tone: "info" }] : [];
                return [
                    { type: "notice", text: "You're on the spot. Hold to talk and ask the room a yes-or-no question.", tone: "info" },
                    ...hint,
                    { type: "buttons", options: [{ id: PASS_ACTION, label: "Pass this turn" }] },
                    { type: "waiting", text: `${questionsLeft(state)} questions left.` },
                ];
            }
            if (state.phase === "asking") {
                return [...others, { type: "waiting", text: `Answer ${nameIn(state.players, state.current)} out loud. Don't say the name.` }];
            }
            if (state.phase === "intro") {
                return [...others, { type: "waiting", text: "You can't see your own. Keep quiet about theirs." }];
            }
            return [...others, { type: "waiting", text: "Look at the screen." }];
        },

        hostFacts(state: IdentityState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase !== "asking") {
                return [];
            }
            return [publicFact("progress", `${nameIn(state.players, state.current)} has asked ${state.asked} of ${decisions.questionsPerTurn} questions.`)];
        },

        outcome(state: IdentityState): string | null {
            return state.phase === "end" ? "That's every turn." : null;
        },
    };

    return {
        cartridge,
        hidden(state: IdentityState): HiddenValue[] {
            const secrets: HiddenValue[] = [];
            for (const player of state.players) {
                const identity: Identity | undefined = state.dealt[player.playerId];
                if (identity === undefined || state.revealed.includes(player.playerId) === true) {
                    continue;
                }
                const seenBy: string[] = state.players.map((other: CartridgePlayer) => other.playerId).filter((id: string) => id !== player.playerId);
                for (const name of namesOf(identity)) {
                    secrets.push({ label: `${player.name}'s name tag`, text: name, seenBy });
                }
            }
            return secrets;
        },
    };
}

/**
 * The end-of-game list of who everyone was, as a tally-free block the TV can read.
 * @param state the state.
 * @returns the block.
 */
function reveals(state: IdentityState): SceneBlock {
    const rows: TallyRow[] = state.players.map((player: CartridgePlayer): TallyRow => ({ label: `${player.name} was ${state.dealt[player.playerId]?.name ?? "someone"}`, count: state.records[player.playerId]?.questions ?? 0 }));
    return { type: "tally", title: "Who everyone was, and the questions it took", rows };
}
