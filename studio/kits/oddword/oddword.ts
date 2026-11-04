// The odd-word kit: everyone is shown the secret word except one player, the Stray, who is shown only
// what kind of thing it is. The host writes a fresh category and word. In an order the code enforces,
// each player says one word about the secret, out loud or typed, for a set number of rounds; the Stray
// bluffs. Then everyone votes on who the Stray is, and a caught Stray gets one guess at the word, which
// the host rules on. The host knows the word and never who the Stray is. Code runs the order, the
// clocks, the one-word rule, the vote and the outcome. Stray Word is this kit.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { Turn } from "../../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../../shared/visibility.ts";
import { HOST_LINE_RULES, SAY_IT_ALOUD, boxProblems, isShortText, isWholeIn, rulingNameProblem, squash, type Box, type HiddenValue, type KitGame } from "../../kit/kit.ts";
import { because, dealOne, frozenCopy, pick, tally, type Tally } from "../../kit/primitives.ts";
import { guessMatches, singleWord, titleCase, tooClose } from "../../kit/words.ts";

/** A kind of thing and a word of that kind. */
export interface Entry {
    category: string;
    word: string;
}

/** Everything a creator may choose for an odd-word game. */
export interface OddWordDecisions {
    /** Categories and words to fall back on when the model can't write one; at least twenty. */
    entries: Entry[];
    /** How many words each player says. */
    rounds: number;
    /** Seconds everyone gets to read their card before the words start. */
    readSeconds: number;
    /** Seconds a player has to say their word. */
    clueSeconds: number;
    /** Seconds the vote stays open. */
    voteSeconds: number;
    /** Seconds a caught Stray has to name the word. */
    guessSeconds: number;
}

/** The phases of the kit. */
export type OddWordPhase = "dealing" | "clues" | "vote" | "guess" | "end";

/** How a round ended. */
export type OddWordResult = "caught" | "namedIt" | "slipped" | "strayLeft" | "emptied";

/** Why a word wasn't taken, shown only on the phone of the one who said it. */
export type Refusal = "" | "many" | "repeat" | "secret";

/** One word said. */
export interface Said {
    playerId: string;
    name: string;
    word: string;
    round: number;
}

/** The whole game, immutable between steps. */
export interface OddWordState {
    phase: OddWordPhase;
    /** Everyone still at the table, in seat order. */
    players: CartridgePlayer[];
    strayId: string;
    /** The kind of thing it is, shown to everyone; empty until the host has written it. */
    category: string;
    /** The word, once chosen; empty until then. */
    word: string;
    /** What to use if the host can't write one. */
    fallback: Entry;
    /** Who speaks, in order, starting with whoever was dealt the first word. */
    order: string[];
    /** Which of the order is up. */
    cursor: number;
    round: number;
    said: Said[];
    /** Why the last try wasn't taken, for the phone of the player who is up. */
    refusal: Refusal;
    /** Which try at a word this is, so every try has its own box. */
    tries: number;
    voters: string[];
    votes: Record<string, string>;
    guessHeard: boolean;
    result: OddWordResult | null;
    /** Kept at the end so the reveal shows names even if people have left. */
    strayName: string;
    accusedName: string;
}

/** The prefix on a vote's action id. */
export const ODD_VOTE_PREFIX: string = "vote:";

/** What the Stray's card is headed. */
export const STRAY_CARD_TITLE: string = "You're the stray";

/** The decision ids a rehearsal names when it explains a moment. */
export const ODD_DECISIONS: { entries: string; rounds: string; read: string; clue: string; vote: string; guess: string; left: string } = {
    entries: "entries", rounds: "rounds", read: "readSeconds", clue: "clueSeconds", vote: "voteSeconds", guess: "guessSeconds", left: "players",
};

/** Longest word accepted from the model. */
const WORD_LIMIT: number = 24;

/** What each ruling means, in the host's brief. Owned by the kit. */
const RULING_BRIEFS: Record<string, string> = {
    right: "the Stray's guess names the word, or a clear synonym of it. Write only [[right]] and nothing else; you'll be told what to say.",
    wrong: "the Stray's guess is some other word. Write only [[wrong]] and nothing else; you'll be told what to say.",
};

/**
 * Checks an entry's word: one or two plain words.
 * @param word the word.
 * @returns true when it can be the secret.
 */
export function isUsableSecret(word: string): boolean {
    return word.length <= WORD_LIMIT && /^\p{L}[\p{L}'-]*( \p{L}[\p{L}'-]*)?$/u.test(word) === true;
}

/**
 * Checks an odd-word game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function oddWordProblems(decisions: OddWordDecisions): string[] {
    const problems: string[] = [];
    if (decisions.entries.length < 20) {
        problems.push("The game needs at least twenty words of its own.");
    }
    if (decisions.entries.some((entry: Entry) => isShortText(entry.category) === false || isUsableSecret(entry.word) === false) === true) {
        problems.push("Every entry needs a short category and a word of one or two plain words.");
    }
    if (new Set(decisions.entries.map((entry: Entry) => squash(entry.word))).size !== decisions.entries.length) {
        problems.push("The words must all be different.");
    }
    if (isWholeIn(decisions.rounds, 1, 3) === false) {
        problems.push("The rounds must be a whole number from 1 to 3.");
    }
    if (isWholeIn(decisions.readSeconds, 3, 30) === false || isWholeIn(decisions.clueSeconds, 15, 90) === false) {
        problems.push("Reading must be 3 to 30 seconds and each word 15 to 90, as whole numbers.");
    }
    if (isWholeIn(decisions.voteSeconds, 15, 120) === false || isWholeIn(decisions.guessSeconds, 15, 90) === false) {
        problems.push("The vote must last 15 to 120 seconds and the guess 15 to 90, as whole numbers.");
    }
    return problems;
}

/**
 * Every problem with an odd-word blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function oddWordBlueprintProblems(box: Box, decisions: OddWordDecisions): string[] {
    const problems: string[] = [...boxProblems(box, decisions.entries.map((entry: Entry) => entry.word)), ...oddWordProblems(decisions)];
    if (box.minPlayers < 4) {
        problems.push("An odd-word game needs at least four people, or three words is all anyone has to go on.");
    }
    if (box.maxPlayers > 10) {
        problems.push("Ten is the most: after that the words take too long to come round.");
    }
    return problems;
}

/**
 * Reads the category and word the host's model wrote, in the form "Category: X | Word: Y".
 * @param reply the model's reply.
 * @returns the entry, or null when it isn't usable.
 */
export function parseEntry(reply: string): Entry | null {
    const match: RegExpExecArray | null = /Category:\s*([^|\n]+?)\s*\|\s*Word:\s*([^\n]+)/i.exec(reply);
    const category: string = (match?.[1] ?? "").trim().replace(/[."!?]+$/g, "");
    const word: string = (match?.[2] ?? "").trim().replace(/[."!?]+$/g, "").toLowerCase();
    if (isShortText(category) === false || isUsableSecret(word) === false || tooClose(category, word) === true) {
        return null;
    }
    return { category: category.charAt(0).toLowerCase() + category.slice(1), word };
}

/**
 * Builds the manifest from the box, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 * @throws when a kit ruling name is reserved, which would be a bug in the kit.
 */
export function oddWordManifest(box: Box): CartridgeManifest {
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
            `You're running ${box.name}. You chose a secret word and everyone but one player was shown it; that player, the Stray, was only told what kind of thing it is.`,
            "You know the word and you never know who the Stray is, so never guess, hint or joke about who it might be.",
            "Never say the word, spell it, rhyme it or hint at its letters until you're told the round is over.",
            "The order of words, the clocks and the vote are the game's, never yours to change. You say what you're told, briefly, and you judge the Stray's last guess.",
            HOST_LINE_RULES,
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            {
                id: "dealing",
                hostBrief: "Everyone is reading a card on their phone. Until you're told the word is ready, say one short line that you're choosing them a word. Don't explain the game yet. When you're told it's ready, explain in two short sentences: everyone has the same secret word except one of them, and each person says one word about it. Then stop.",
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "clues",
                hostBrief: "Players are saying one word each, in turn. Say what you're told to say about a new round; otherwise reply exactly (quiet) to anything you hear. Never comment on a word, never say whose word sounds suspicious.",
                listening: { up: "holdToTalk", "*": "muted" },
                hostMayInterject: false,
                hostMostlyQuiet: true,
                silenceSeconds: 0,
            },
            {
                id: "vote",
                hostBrief: "The room is voting on its phones for who the Stray is. When you're told to, call the vote in one dry line, with a little theatre. Then reply exactly (quiet).",
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "guess",
                hostBrief: [
                    "When you're told who the vote pinned, say it in one line with some relish, and tell them they get one guess.",
                    "Then the Stray names the word, out loud or typed. If they speak, rule right or wrong against the real word you know, in one go, and nothing else.",
                    "A near miss is wrong unless it's a plain synonym. Never hint how close they were.",
                ].join(" "),
                listening: { up: "holdToTalk", "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
                hostRulings: { ...RULING_BRIEFS },
            },
            {
                id: "end",
                hostBrief: "You'll be told the word, who the Stray was and how it ended. In about 25 words: the word, who the Stray was, and one dry remark that makes the Stray look good whether they were caught or not. Then ask if they want another round. Always speak here, never reply (quiet).",
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Builds an odd-word game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with oddWordBlueprintProblems first.
 * @param random a function returning [0, 1): the first draw picks the fallback entry, the second deals the Stray, the third who speaks first.
 * @returns the game.
 */
export function createOddWordGame(givenBox: Box, givenDecisions: OddWordDecisions, random: () => number = Math.random): KitGame<OddWordState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: OddWordDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = oddWordManifest(box);
    const publicFact = (kind: string, text: string, quiet: boolean = false): ScopedFact => ({ scope: { kind: "public" }, kind, text, ...(quiet === true ? { quiet: true } : {}) });
    const nameOf = (state: OddWordState, playerId: string | null): string => state.players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const idsOf = (state: OddWordState): string[] => state.players.map((player: CartridgePlayer) => player.playerId);
    const secretOf = (state: OddWordState): string => (state.word === "" ? state.fallback.word : state.word);
    const upId = (state: OddWordState): string | null => (state.phase === "clues" ? state.order[state.cursor] ?? null : null);

    /**
     * Ends the round with the reveal.
     * @param state the state.
     * @param result how it ended.
     * @param text what to tell the host.
     * @param decision the decision that ended it.
     * @returns the step.
     */
    const finish = (state: OddWordState, result: OddWordResult, text: string, decision: string): Step<OddWordState> => {
        const ended: OddWordState = { ...state, phase: "end", word: secretOf(state), category: state.category === "" ? state.fallback.category : state.category, result, strayName: nameOf(state, state.strayId) };
        return { state: ended, facts: because(publicFact("game-over", `${text} ${SAY_IT_ALOUD}`), decision), nextPhaseId: "end" };
    };

    /**
     * Opens the vote.
     * @param state the state after the last word.
     * @returns the step.
     */
    const openVote = (state: OddWordState): Step<OddWordState> => {
        const next: OddWordState = { ...state, phase: "vote", voters: idsOf(state), votes: {}, refusal: "" };
        const text: string = `Every word is in. Call the vote in one line: everyone votes on their phone for who the Stray is. ${SAY_IT_ALOUD}`;
        return { state: next, facts: because(publicFact("vote", text), ODD_DECISIONS.rounds), nextPhaseId: "vote", timers: { vote: decisions.voteSeconds } };
    };

    /**
     * Moves to the next speaker, the next round or the vote.
     * @param state the state with the cursor still on the last speaker, or already past the end.
     * @param cursor where the next speaker is in the order.
     * @param said the words said so far.
     * @returns the step.
     */
    const advance = (state: OddWordState, cursor: number, said: Said[]): Step<OddWordState> => {
        const moved: OddWordState = { ...state, said, refusal: "", tries: 0 };
        if (cursor < state.order.length) {
            return { state: { ...moved, cursor }, facts: [], timers: { turn: decisions.clueSeconds } };
        }
        if (state.round >= decisions.rounds) {
            return openVote({ ...moved, cursor });
        }
        const round: number = state.round + 1;
        const text: string = `Round ${round} of ${decisions.rounds}. Say so in a few words, and that ${nameOf(state, state.order[0] ?? null)} goes first again. ${SAY_IT_ALOUD}`;
        return { state: { ...moved, round, cursor: 0 }, facts: because(publicFact("round", text), ODD_DECISIONS.rounds), timers: { turn: decisions.clueSeconds } };
    };

    /**
     * Takes a word from whoever is up.
     * @param state the state.
     * @param playerId who said it.
     * @param raw what they said or typed.
     * @returns the step.
     */
    const take = (state: OddWordState, playerId: string, raw: string): Step<OddWordState> => {
        const word: string | null = singleWord(raw, true);
        if (word === null) {
            return { state: { ...state, refusal: "many", tries: state.tries + 1 }, facts: [] };
        }
        if (state.said.some((line: Said) => squash(line.word) === squash(word)) === true) {
            return { state: { ...state, refusal: "repeat", tries: state.tries + 1 }, facts: [] };
        }
        if (playerId !== state.strayId && tooClose(word, secretOf(state)) === true) {
            return { state: { ...state, refusal: "secret", tries: state.tries + 1 }, facts: [] };
        }
        const said: Said[] = [...state.said, { playerId, name: nameOf(state, playerId), word, round: state.round }];
        return advance(state, state.cursor + 1, said);
    };

    /**
     * Counts the vote and moves on: nobody pinned or the wrong person ends it; the Stray gets a guess.
     * @param state the state in the vote.
     * @returns the step.
     */
    const resolve = (state: OddWordState): Step<OddWordState> => {
        const counted: Tally = tally(state.votes, idsOf(state));
        const accusedId: string | undefined = counted.tied === false ? counted.leaders[0] : undefined;
        const stray: string = nameOf(state, state.strayId);
        if (accusedId === state.strayId) {
            const next: OddWordState = { ...state, phase: "guess", accusedName: stray, guessHeard: false };
            const text: string = `The vote pinned ${stray}, who was the Stray. They get one guess at the word. Tell them so in a line; never hint at it. ${SAY_IT_ALOUD}`;
            return { state: next, facts: because(publicFact("guess", text), ODD_DECISIONS.vote), nextPhaseId: "guess", timers: { guess: decisions.guessSeconds } };
        }
        const accused: string = accusedId === undefined ? "" : nameOf(state, accusedId);
        const how: string = accusedId === undefined ? "The vote was split, so nobody was pinned." : `The vote pinned ${accused}, who wasn't the Stray.`;
        return finish({ ...state, accusedName: accused }, "slipped", `${how} ${stray} was the Stray and got away with it. The word was ${secretOf(state)}.`, ODD_DECISIONS.vote);
    };

    /**
     * The Stray named the word.
     * @param state the state.
     * @returns the step.
     */
    const named = (state: OddWordState): Step<OddWordState> => {
        const text: string = `${nameOf(state, state.strayId)}, the Stray, was pinned but named the word: ${secretOf(state)}. The Stray wins anyway. Say so in two short sentences.`;
        return finish(state, "namedIt", text, ODD_DECISIONS.guess);
    };

    /**
     * The Stray's guess was wrong, or never came.
     * @param state the state.
     * @param how what happened, for the host.
     * @returns the step.
     */
    const missed = (state: OddWordState, how: string): Step<OddWordState> => {
        const text: string = `${nameOf(state, state.strayId)}, the Stray, was pinned and ${how}, so the room wins. The word was ${secretOf(state)}.`;
        return finish(state, "caught", text, ODD_DECISIONS.guess);
    };

    /**
     * Someone left. The Stray leaving ends the round; anyone else is gone from the order.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: OddWordState, playerId: string): Step<OddWordState> => {
        if (state.phase === "end" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return { state, facts: [] };
        }
        if (playerId === state.strayId) {
            return finish(state, "strayLeft", `The Stray left, so the round is over. The word was ${secretOf(state)}.`, ODD_DECISIONS.left);
        }
        const players: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => player.playerId !== playerId);
        const order: string[] = state.order.filter((id: string) => id !== playerId);
        const index: number = state.order.indexOf(playerId);
        const cursor: number = index >= 0 && index < state.cursor ? state.cursor - 1 : state.cursor;
        const next: OddWordState = { ...state, players, order, cursor, voters: state.voters.filter((id: string) => id !== playerId) };
        if (players.length < 4) {
            return finish(next, "emptied", `Too few people were left to play, so the round is over. The word was ${secretOf(state)}.`, ODD_DECISIONS.left);
        }
        if (state.phase === "vote") {
            const reopened: OddWordState = { ...next, votes: {}, voters: idsOf(next) };
            return { state: reopened, facts: because(publicFact("revote", `${nameOf(state, playerId)} left, so the vote starts again. Tell them in one line to vote again.`), ODD_DECISIONS.vote), timers: { vote: decisions.voteSeconds } };
        }
        if (state.phase !== "clues" || index !== state.cursor) {
            return { state: next, facts: [] };
        }
        return advance({ ...next, refusal: "" }, cursor, state.said);
    };

    /**
     * Someone is up and stalls: their turn is skipped, quietly, and the TV moves on.
     * @param state the state.
     * @returns the step.
     */
    const skipped = (state: OddWordState): Step<OddWordState> => {
        const fact: ScopedFact[] = because(publicFact("skipped", `${nameOf(state, upId(state))} took too long, so they pass.`, true), ODD_DECISIONS.clue);
        const step: Step<OddWordState> = advance(state, state.cursor + 1, state.said);
        return { ...step, facts: [...fact, ...step.facts] };
    };

    const cartridge: Cartridge<OddWordState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<OddWordState> {
            const fallback: Entry = pick(decisions.entries, random);
            const strayId: string = dealOne(players, random);
            const firstId: string = dealOne(players, random);
            const first: number = players.findIndex((player: CartridgePlayer) => player.playerId === firstId);
            const order: string[] = [...players.slice(first), ...players.slice(0, first)].map((player: CartridgePlayer) => player.playerId);
            const state: OddWordState = {
                phase: "dealing", players, strayId, category: "", word: "", fallback, order, cursor: 0, round: 1, said: [], refusal: "", tries: 0,
                voters: [], votes: {}, guessHeard: false, result: null, strayName: "", accusedName: "",
            };
            const request: string = [
                "Choose one secret word for a party game where each player says one word about it. It must be one everyday thing most adults know,",
                "something with lots of things you could say about it, and not the first thing anyone would pick.",
                "Reply in exactly this form and nothing else: Category: <what kind of thing it is, a few words, such as 'a thing in a kitchen'> | Word: <the word, at most two words>",
            ].join(" ");
            return { state, facts: [], nextPhaseId: "dealing", contentRequest: request };
        },

        phaseOf(state: OddWordState): string {
            return state.phase;
        },

        turn(state: OddWordState): Turn | null {
            if (state.phase === "dealing") {
                return { kind: "secret", label: "Look at your phone" };
            }
            if (state.phase === "clues") {
                return { kind: "one", playerId: upId(state) ?? state.strayId, label: "Says a word:" };
            }
            if (state.phase === "vote") {
                return { kind: "everyone", playerIds: state.voters, doneIds: Object.keys(state.votes), label: "Vote on your phone" };
            }
            return null;
        },

        roleOf(state: OddWordState, playerId: string): string {
            if (state.phase === "clues") {
                return upId(state) === playerId ? "up" : "quiet";
            }
            return state.phase === "guess" && playerId === state.strayId ? "up" : "quiet";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: OddWordState, playerId: string): LegalAction[] {
            if (state.phase !== "vote" || state.voters.includes(playerId) === false || state.votes[playerId] !== undefined) {
                return [];
            }
            return idsOf(state).filter((id: string) => id !== playerId).map((id: string): LegalAction => ({ actionId: `${ODD_VOTE_PREFIX}${id}`, label: nameOf(state, id) }));
        },

        apply(state: OddWordState, playerId: string, actionId: string): Step<OddWordState> {
            if (cartridge.legalActions(state, playerId).some((action: LegalAction) => action.actionId === actionId) === false) {
                return { state, facts: [] };
            }
            const next: OddWordState = { ...state, votes: { ...state.votes, [playerId]: actionId.slice(ODD_VOTE_PREFIX.length) } };
            return next.voters.every((voter: string) => next.votes[voter] !== undefined) === true ? resolve(next) : { state: next, facts: [] };
        },

        onEvent(state: OddWordState, event: RoomEvent): Step<OddWordState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "contentReady" && state.phase === "dealing" && state.word === "") {
                const written: Entry | null = parseEntry(event.text);
                const entry: Entry = written ?? state.fallback;
                const text: string = `The word is ready and everyone has their card. Explain the game now, then say it's ${entry.category}, and that ${nameOf(state, state.order[0] ?? null)} goes first. There are ${decisions.rounds} ${decisions.rounds === 1 ? "round" : "rounds"}.`;
                return { state: { ...state, category: entry.category, word: entry.word }, facts: because(publicFact("ready", text), ODD_DECISIONS.entries), timers: { read: decisions.readSeconds } };
            }
            if (event.type === "timerFired" && event.timerId === "read" && state.phase === "dealing" && state.word !== "") {
                return { state: { ...state, phase: "clues" }, facts: because(publicFact("clues", "Words are open. Say it's the first word, in a few words.", true), ODD_DECISIONS.read), nextPhaseId: "clues", timers: { turn: decisions.clueSeconds } };
            }
            if (event.type === "timerFired" && event.timerId === "turn" && state.phase === "clues") {
                return skipped(state);
            }
            if (event.type === "timerFired" && event.timerId === "vote" && state.phase === "vote") {
                return resolve(state);
            }
            if (event.type === "timerFired" && event.timerId === "guess" && state.phase === "guess") {
                return missed(state, "ran out of time");
            }
            if (state.phase === "clues") {
                const spoken: boolean = event.type === "speechEnded" && event.playerId === upId(state);
                const typed: boolean = event.type === "answered" && event.playerId === upId(state) && event.controlId === `word:${state.said.length}:${state.tries}` && typeof event.value === "string";
                if (spoken === true && event.type === "speechEnded") {
                    return take(state, event.playerId, event.text);
                }
                return typed === true && event.type === "answered" ? take(state, event.playerId, String(event.value)) : { state, facts: [] };
            }
            if (state.phase !== "guess") {
                return { state, facts: [] };
            }
            if (event.type === "speechEnded" && event.playerId === state.strayId && event.text.trim().length >= 3) {
                return { state: { ...state, guessHeard: true }, facts: [] };
            }
            if (event.type === "answered" && event.playerId === state.strayId && event.controlId === "guess" && typeof event.value === "string") {
                return guessMatches(secretOf(state), event.value) === true ? named(state) : missed(state, "guessed wrong");
            }
            if (event.type === "hostRuled" && state.guessHeard === true) {
                if (event.ruling === "right") {
                    return named(state);
                }
                return event.ruling === "wrong" ? missed(state, "guessed wrong") : { state, facts: [] };
            }
            return { state, facts: [] };
        },

        publicScene(state: OddWordState): Scene {
            if (state.phase === "dealing") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: box.name }, { type: "text", text: "Look at your phone. Keep it to yourself.", emphasis: "large" }] };
            }
            if (state.phase === "clues") {
                const blocks: SceneBlock[] = [
                    { type: "title", text: `${nameOf(state, upId(state))} says a word`, kicker: `Round ${state.round} of ${decisions.rounds}. It's ${state.category}` },
                    { type: "timer", seconds: decisions.clueSeconds, label: "to say it", running: true },
                ];
                return { mood: "tense", transition: "fade", blocks: [...blocks, ...saidBlocks(state)] };
            }
            if (state.phase === "vote" || state.phase === "guess") {
                const head: SceneBlock = state.phase === "vote"
                    ? { type: "title", text: "Who is the stray?", kicker: "Vote on your phone" }
                    : { type: "title", text: `${nameOf(state, state.strayId)} is the stray`, kicker: "One guess" };
                const tail: SceneBlock = state.phase === "vote"
                    ? { type: "timer", seconds: decisions.voteSeconds, label: "to vote", running: true }
                    : { type: "timer", seconds: decisions.guessSeconds, label: "to name the word", running: true };
                return { mood: "tense", transition: "fade", blocks: [head, ...saidBlocks(state), tail] };
            }
            const kickers: Record<OddWordResult, string> = { caught: "Caught", namedIt: "Caught, and named the word", slipped: "Got away with it", strayLeft: "The stray left", emptied: "Too few left" };
            const blocks: SceneBlock[] = [
                { type: "title", text: titleCase(state.word), kicker: kickers[state.result ?? "emptied"] },
                { type: "text", text: `${state.strayName} was the stray.`, emphasis: "large" },
            ];
            const strayWon: boolean = state.result === "namedIt" || state.result === "slipped";
            return { mood: strayWon === true ? "defeat" : "victory", transition: "fade", blocks };
        },

        privateControls(state: OddWordState, playerId: string): Control[] {
            if (state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
                return [];
            }
            const isStray: boolean = playerId === state.strayId;
            const category: string = state.category === "" ? "something" : state.category;
            const card: Control = isStray === true
                ? { type: "roleCard", title: STRAY_CARD_TITLE, body: `Everyone else knows the word. All you know is that it's ${category}. Blend in.`, secret: true }
                : { type: "roleCard", title: state.word === "" ? "Your word is coming" : `Your word: ${titleCase(state.word)}`, body: `It's ${category}. One of you doesn't have it.`, secret: true };
            if (state.phase === "dealing") {
                return [card];
            }
            if (state.phase === "clues") {
                const before: Control[] = state.said.length === 0 ? [] : [{ type: "notice", text: `Said so far: ${state.said.map((line: Said) => titleCase(line.word)).join(", ")}`, tone: "info" }];
                if (upId(state) !== playerId) {
                    return [card, ...before, { type: "waiting", text: `${nameOf(state, upId(state))} is up.` }];
                }
                const notes: Record<Refusal, string> = {
                    "": "Hold and say one word, or type it.",
                    many: "One word only. Try again.",
                    repeat: "Somebody already said that. Another word.",
                    secret: "Too close to the secret. Another word.",
                };
                return [card, ...before, { type: "textInput", id: `word:${state.said.length}:${state.tries}`, prompt: "Your word", placeholder: "one word", maxLength: 20, note: notes[state.refusal] }];
            }
            if (state.phase === "vote") {
                const options: ControlOption[] = cartridge.legalActions(state, playerId).map((action: LegalAction): ControlOption => ({ id: action.actionId, label: action.label }));
                if (options.length === 0) {
                    return [card, { type: "waiting", text: state.voters.includes(playerId) === true ? "Voted." : "Watching the vote." }];
                }
                return [card, { type: "choice", prompt: "Who is the stray?", options, multiple: false }];
            }
            if (state.phase === "guess") {
                if (isStray === false) {
                    return [card, { type: "waiting", text: "The stray is guessing." }];
                }
                return [card, { type: "textInput", id: "guess", prompt: "What is the word?", placeholder: "the word", maxLength: 40, note: "Hold and say it, or type it." }];
            }
            const line: Record<OddWordResult, string> = {
                caught: "They caught you, and you missed the word.",
                namedIt: "You named the word.",
                slipped: "You got away with it.",
                strayLeft: "",
                emptied: "",
            };
            return [{ type: "waiting", text: isStray === true ? line[state.result ?? "emptied"] : "Look at the screen." }];
        },

        hostFacts(state: OddWordState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.word === "" || state.phase === "end") {
                return [];
            }
            return [
                { scope: { kind: "host" }, kind: "word", text: `The word is: ${state.word}.` },
                { scope: { kind: "public" }, kind: "category", text: `It is ${state.category}.` },
            ];
        },

        outcome(state: OddWordState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            const stray: string = state.strayName;
            const results: Record<OddWordResult, string> = {
                caught: `The room caught ${stray}.`,
                namedIt: `${stray} was caught but named the word.`,
                slipped: `${stray} got away with it.`,
                strayLeft: "The stray left.",
                emptied: "Too few people were left.",
            };
            return results[state.result ?? "emptied"];
        },
    };

    /**
     * The words said so far for the TV, one line per round, each word beside who said it.
     * @param state the state.
     * @returns the text blocks.
     */
    function saidBlocks(state: OddWordState): SceneBlock[] {
        const rounds: number[] = [...new Set(state.said.map((line: Said) => line.round))];
        return rounds.map((round: number): SceneBlock => ({ type: "text", text: state.said.filter((line: Said) => line.round === round).map((line: Said) => `${line.name}: ${titleCase(line.word)}`).join(" · ") }));
    }

    return {
        cartridge,
        hidden(state: OddWordState): HiddenValue[] {
            if (state.phase === "end") {
                return [];
            }
            const insiders: string[] = ["host", ...idsOf(state).filter((id: string) => id !== state.strayId)];
            const word: HiddenValue = { label: "the word", text: secretOf(state), seenBy: insiders };
            if (state.phase === "guess") {
                return [word];
            }
            const card: HiddenValue = { label: "the Stray's card", text: STRAY_CARD_TITLE, seenBy: [state.strayId] };
            const who: HiddenValue[] = [nameOf(state, state.strayId), state.strayId].map((text: string): HiddenValue => ({ label: "who the Stray is", text, seenBy: [state.strayId], near: "stray" }));
            return [word, card, ...who];
        },
    };
}

