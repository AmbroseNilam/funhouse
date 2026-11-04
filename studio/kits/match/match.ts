// The match kit: a match-the-crowd game. Each round the host puts one prompt to the table, everyone
// types a short answer in secret, and code groups matching answers into stacks of paper cards.
// You score for every other card in your stack; the card that sits alone wears the hat, and whoever
// holds the hat when the last round ends loses points. Code collects the answers, groups them,
// scores and moves the hat; the host writes the prompts from fixed stems and reads the stacks back,
// and never decides a match. Grouping runs in three steps, each only able to add merges: a local
// check (case, spelling, plurals, stems), then the room's answer-merging seam for every pair left,
// and, only when that seam gave no sign of life, one closed question to the host's model about the
// pairs that look alike. Silence from any step means "separate". Same Page is this kit.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../../shared/cartridge.ts";
import type { Control } from "../../../shared/controls.ts";
import type { BoardCell, Scene, SceneBlock, TallyRow } from "../../../shared/scene.ts";
import type { AnswerGroup, RoomEvent } from "../../../shared/timeline.ts";
import type { Turn } from "../../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../../shared/visibility.ts";
import { boxProblems, isWholeIn, type Box, type HiddenValue, type KitGame } from "../../kit/kit.ts";
import { because, frozenCopy } from "../../kit/primitives.ts";
import { isHostSafe, linesOf, oneLine, quoted, shuffled } from "../../kit/text.ts";
import { doubtedTexts, doubtsAmong, hatAfter, joinStacks, scoreStacks, stackCards, standIn, type Card, type Doubt, type Stack } from "./stacks.ts";

/** Whether a prompt is about anything at all or about the people at this table. */
export type PromptKind = "general" | "room";

/** One slot in the game: the fixed stem the host writes a prompt from. */
export interface PromptStem {
    kind: PromptKind;
    stem: string;
}

/** A prompt written in advance, used when the host's model writes nothing usable. */
export interface BankPrompt {
    kind: PromptKind;
    text: string;
}

/** Everything a creator may choose for a match game. */
export interface MatchDecisions {
    /** How many prompts one game plays. */
    promptsPerGame: number;
    /** The stems each game draws from, so a second game isn't the first one again. */
    stems: PromptStem[];
    /** The fallback prompts, at least as many of each kind as the stems use. */
    bank: BankPrompt[];
    /** Seconds to type a card. */
    writeSeconds: number;
    /** Seconds the stacks stay on the screen. */
    revealSeconds: number;
    /** Seconds the answer-merging seam gets before cards are stacked as they are. */
    settleSeconds: number;
    /** Seconds the one closed question gets, after the seam, before cards are stacked as they are. */
    askSeconds: number;
    /** Longest card, in characters. */
    answerLimit: number;
    /** What each card of a stack of exactly two scores. */
    pairPoints: number;
    /** What the hat costs whoever holds it at the end. */
    hatPenalty: number;
}

/** The phases of the kit. */
export type MatchPhase = "choosing" | "writing" | "settling" | "reveal" | "end";

/** What a finished round left behind, for the recap. */
export interface RoundRecord {
    prompt: string;
    /** The biggest stack's text and its size. */
    top: string;
    topSize: number;
}

/** The whole game, immutable between steps. */
export interface MatchState {
    phase: MatchPhase;
    players: CartridgePlayer[];
    /** The stems this game drew, in play order. */
    stems: PromptStem[];
    /** How many rounds each player's card matched someone else's. */
    matches: Record<string, number>;
    /** Whether a hat is in play: it is not with three players. */
    hatInPlay: boolean;
    /** Round number, starting at 1; 0 while the prompts are being written. */
    round: number;
    prompts: { kind: PromptKind; text: string }[];
    /** This round's cards, in seat order. */
    cards: Card[];
    /** Tries each player has used this round. */
    attempts: Record<string, number>;
    /** This round's stacks once cards are in. */
    stacks: Stack[];
    /** True once the closed question has been sent this round. */
    asked: boolean;
    /** The pairs that closed question is about. */
    doubts: Doubt[];
    hat: string | null;
    scores: Record<string, number>;
    /** What each player won this round. */
    gained: Record<string, number>;
    record: RoundRecord[];
    /** Who lost the hat's points, once the game is over. */
    hatLoser: string | null;
    /** How the game ended. */
    result: "played" | "tooFew" | null;
}

/** Decision ids a rehearsal names when it explains a moment. */
export const MATCH_DECISIONS: { prompts: string; stacks: string; score: string; hat: string; end: string } = {
    prompts: "stems",
    stacks: "mergeDuplicates",
    score: "pairPoints",
    hat: "hatPenalty",
    end: "stems",
};

/** The fewest people a match game can run with. */
export const MATCH_MINIMUM_PLAYERS: number = 3;

/** The fewest people at which the hat comes into play. */
const HAT_MINIMUM_PLAYERS: number = 4;

/** Longest prompt, in characters. */
const PROMPT_CHARACTER_LIMIT: number = 70;

/** The most pairs the closed question carries, so one reply stays short. */
const ASK_PAIR_LIMIT: number = 4;

/** Seconds the host's model has to write the prompts before the bank is used. */
const CHOOSE_SECONDS: number = 20;

/** Two answers any working merge seam must call the same, sent along as a sign of life. One made-up word, so no real card can look like them. */
const SIGN_OF_LIFE: readonly [string, string] = ["quillbeam", "quillbeams"];

/** A different way to read each prompt after the first, so the rounds don't sound alike. */
const PROMPT_SHAPES: readonly string[] = [
    "Read the prompt word for word, with nothing around it.",
    "Say two or three dry words of your own, then read the prompt word for word.",
    "Read the prompt word for word, then add two or three dry words.",
    "Say next, or something as short, then read the prompt word for word.",
];

/**
 * Checks a match game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function matchProblems(decisions: MatchDecisions): string[] {
    const problems: string[] = [];
    if (decisions.stems.length < 1 || decisions.stems.length > 40) {
        problems.push("A match game needs from 1 to 40 prompt stems.");
    }
    if (isWholeIn(decisions.promptsPerGame, 1, Math.min(12, decisions.stems.length)) === false) {
        problems.push("The prompts in a game must be a whole number, at most 12, and no more than there are stems.");
    }
    for (const kind of ["general", "room"] as const) {
        const needed: number = decisions.stems.filter((stem: PromptStem) => stem.kind === kind).length;
        const have: number = decisions.bank.filter((prompt: BankPrompt) => prompt.kind === kind).length;
        if (have < needed) {
            problems.push(`The fallback bank needs at least ${needed} ${kind} prompts.`);
        }
    }
    const unsafeStem: boolean = decisions.stems.some((stem: PromptStem) => isHostSafe(stem.stem, PROMPT_CHARACTER_LIMIT) === false);
    const unsafeBank: boolean = decisions.bank.some((prompt: BankPrompt) => isHostSafe(prompt.text, PROMPT_CHARACTER_LIMIT) === false);
    if (unsafeStem === true || unsafeBank === true) {
        problems.push("Every stem and bank prompt must be short plain text that passes the content check.");
    }
    if (new Set(decisions.bank.map((prompt: BankPrompt) => prompt.text.toLowerCase())).size !== decisions.bank.length) {
        problems.push("The fallback bank repeats a prompt.");
    }
    const numbers: [string, number, number, number][] = [
        ["Writing time", decisions.writeSeconds, 5, 120],
        ["Reveal time", decisions.revealSeconds, 3, 60],
        ["The wait for the merging seam", decisions.settleSeconds, 1, 10],
        ["The wait for the closed question", decisions.askSeconds, 1, 15],
        ["The longest answer", decisions.answerLimit, 8, 60],
        ["Points for a pair", decisions.pairPoints, 1, 5],
        ["The hat's cost", decisions.hatPenalty, 0, 10],
    ];
    for (const [label, value, low, high] of numbers) {
        if (isWholeIn(value, low, high) === false) {
            problems.push(`${label} must be a whole number from ${low} to ${high}.`);
        }
    }
    return problems;
}

/**
 * Every problem with a match blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function matchBlueprintProblems(box: Box, decisions: MatchDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...matchProblems(decisions)];
    if (box.minPlayers < MATCH_MINIMUM_PLAYERS) {
        problems.push("A match game needs at least three people, or nothing could match.");
    }
    return problems;
}

/**
 * Builds the manifest from the box, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 */
export function matchManifest(box: Box): CartridgeManifest {
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're running ${box.name}. Each round you put one prompt to the table and everyone types a short answer in secret on their phone.`,
            "The rules stack matching answers together, and players score for matching the room.",
            "You never see an answer until the cards are turned, and you never decide whether two answers match, who scored or who has the hat; the rules do, and you are only told.",
            "The joke is always on the answer, never on a person. Never say who wrote which answer, and never say a score. Dry and warm. Short.",
            "Everyone here has already joined, so never tell anyone to scan a code or join. Never use the same line twice.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            { id: "choosing", hostBrief: "The prompts are being written. Say nothing until you are told the first one.", listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
            {
                id: "writing",
                hostBrief: [
                    "You'll be given the prompt. Read it word for word, because it's on the screen too, and do what you're told about the clock.",
                    "Then stop; they are typing in silence. Never guess at answers.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            { id: "settling", hostBrief: "The cards are being stacked. Stay quiet.", listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
            {
                id: "reveal",
                hostBrief: [
                    "You'll be given the stacks, biggest first, and the answers that sat alone. Name the biggest stack in one short line,",
                    "then say one line about the odd answer: about the answer itself, never about who wrote it. If everything matched, say the table is of one mind.",
                    "If nothing matched, say that. Two sentences, three at most. Never name a player. Never say a score. Then stop; the next prompt comes by itself.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "end",
                hostBrief: [
                    "You'll be told the final scores, who won, and whether the hat cost anyone points. In about 25 words, with the scores left to the screen:",
                    "name the winner or winners, say the hat's cost plainly and kindly only if you were told one applied, and offer another game. Warm, not salesy. Always speak here, never reply (quiet).",
                ].join(" "),
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Builds a match game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with matchBlueprintProblems first.
 * @param random a function returning [0, 1), used to choose fallback prompts.
 * @returns the game.
 */
export function createMatchGame(givenBox: Box, givenDecisions: MatchDecisions, random: () => number = Math.random): KitGame<MatchState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: MatchDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = matchManifest(box);
    const total: number = decisions.promptsPerGame;
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const nameOf = (state: MatchState, playerId: string | null): string => state.players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const ofCount = (amount: number, one: string, many: string): string => (amount === 1 ? one : many);
    const promptOf = (state: MatchState): string => state.prompts[state.round - 1]?.text ?? "";
    const cardOf = (state: MatchState, playerId: string): Card | undefined => state.cards.find((card: Card) => card.playerId === playerId);
    const textsOf = (state: MatchState): ((stack: Stack) => string[]) => (stack: Stack): string[] => stack.flatMap((playerId: string) => cardOf(state, playerId)?.text ?? []);
    const controlId = (state: MatchState, playerId: string): string => `card:${state.round}:${state.attempts[playerId] ?? 0}`;
    const seatOf = (state: MatchState, playerId: string): number => state.players.findIndex((player: CartridgePlayer) => player.playerId === playerId);
    const inSeatOrder = (state: MatchState, cards: readonly Card[]): Card[] => {
        return [...cards].sort((first: Card, second: Card) => seatOf(state, first.playerId) - seatOf(state, second.playerId));
    };

    /**
     * What a stack is called on the screen and to the host: its shortest card's words.
     * @param state the state.
     * @param stack the stack.
     * @returns the text.
     */
    const stackText = (state: MatchState, stack: Stack): string => standIn(textsOf(state)(stack));

    /**
     * The stacks biggest first, lone cards last, ties in seat order.
     * @param stacks the stacks.
     * @returns a sorted copy.
     */
    const biggestFirst = (stacks: readonly Stack[]): Stack[] => [...stacks].sort((first: Stack, second: Stack) => second.length - first.length);

    /**
     * Draws this game's stems, so a second game at the same table isn't the first one again. About a quarter
     * are about the room, and the rest general, in a fresh order.
     * @returns the stems, in play order.
     */
    const drawStems = (): PromptStem[] => {
        const room: PromptStem[] = shuffled(decisions.stems.filter((stem: PromptStem) => stem.kind === "room"), random);
        const general: PromptStem[] = shuffled(decisions.stems.filter((stem: PromptStem) => stem.kind === "general"), random);
        const roomCount: number = Math.min(room.length, Math.round(total / 4));
        const taken: PromptStem[] = [...room.slice(0, roomCount), ...general.slice(0, total - roomCount)];
        return shuffled([...taken, ...room.slice(roomCount)].slice(0, total), random);
    };

    /**
     * Picks one prompt per stem: the host's line where it is usable, else a fresh bank prompt of the same kind.
     * @param stems the stems this game drew.
     * @param written the lines the host's model wrote, or none.
     * @returns the prompts, in play order.
     */
    const choosePrompts = (stems: readonly PromptStem[], written: readonly string[]): { kind: PromptKind; text: string }[] => {
        const taken: Set<string> = new Set();
        const spare: Record<PromptKind, string[]> = {
            general: shuffled(decisions.bank.filter((prompt: BankPrompt) => prompt.kind === "general"), random).map((prompt: BankPrompt) => prompt.text),
            room: shuffled(decisions.bank.filter((prompt: BankPrompt) => prompt.kind === "room"), random).map((prompt: BankPrompt) => prompt.text),
        };
        return stems.map((stem: PromptStem, place: number) => {
            const line: string = oneLine(written[place] ?? "", PROMPT_CHARACTER_LIMIT);
            const usable: boolean = line !== "" && isHostSafe(line, PROMPT_CHARACTER_LIMIT) === true && taken.has(line.toLowerCase()) === false;
            const text: string = usable === true ? line : spare[stem.kind].find((candidate: string) => taken.has(candidate.toLowerCase()) === false) ?? spare[stem.kind][0] ?? "";
            taken.add(text.toLowerCase());
            return { kind: stem.kind, text };
        });
    };

    /**
     * Starts a round: the prompt goes up and everyone's hands are empty.
     * @param before the state the round follows.
     * @param round the round number.
     * @returns the step.
     */
    const startRound = (before: MatchState, round: number): Step<MatchState> => {
        const state: MatchState = { ...before, phase: "writing", round, cards: [], attempts: {}, stacks: [], asked: false, doubts: [], gained: {} };
        const text: string = [
            `Prompt ${round} of ${total}: ${quoted(promptOf(state))}.`,
            round === 1
                ? `Read the prompt word for word, then say they have ${decisions.writeSeconds} seconds to match the room. You don't know any answers.`
                : `${PROMPT_SHAPES[round % PROMPT_SHAPES.length] ?? ""} Say nothing about the clock or matching, because the screen shows that. You don't know any answers.`,
        ].join(" ");
        return { state, facts: because(publicFact("prompt", text), MATCH_DECISIONS.prompts), nextPhaseId: "writing", timers: { [`write${round}`]: decisions.writeSeconds } };
    };

    /**
     * The final scores as a sentence the host can read from.
     * @param state the state at the end.
     * @returns the text.
     */
    const finalText = (state: MatchState): string => {
        const scoreOf = (player: CartridgePlayer): number => state.scores[player.playerId] ?? 0;
        const ranked: CartridgePlayer[] = [...state.players].sort((first: CartridgePlayer, second: CartridgePlayer) => scoreOf(second) - scoreOf(first));
        const best: number = state.scores[ranked[0]?.playerId ?? ""] ?? 0;
        const winners: string = ranked.filter((player: CartridgePlayer) => (state.scores[player.playerId] ?? 0) === best).map((player: CartridgePlayer) => player.name).join(" and ");
        const scores: string = ranked.map((player: CartridgePlayer) => `${player.name} ${state.scores[player.playerId] ?? 0}`).join(", ");
        const hat: string = state.hatLoser === null ? "" : ` The hat ended with ${nameOf(state, state.hatLoser)}, which cost ${decisions.hatPenalty} ${ofCount(decisions.hatPenalty, "point", "points")}.`;
        const hatAsk: string = state.hatLoser === null ? "" : " the hat in a kind word,";
        const lead: string = state.result === "tooFew" ? "Too few people were left to go on. " : "";
        return `${lead}The game is over. Final scores: ${scores}. Most points: ${winners}. ${whyWon(state, scoreRows(state))}${hat} Say who won and why,${hatAsk} and offer another game.${state.hatInPlay === true ? "" : " There is no hat at this table, so never mention one."}`;
    };

    /**
     * Says in a line why the winner won.
     * @param state the state at the end.
     * @param rows the final scores, best first.
     * @returns the line.
     */
    function whyWon(state: MatchState, rows: readonly TallyRow[]): string {
        const leaders: string[] = rows.filter((row: TallyRow) => row.highlight === true).map((row: TallyRow) => row.label);
        const matchesOf = (name: string): number => state.matches[state.players.find((player: CartridgePlayer) => player.name === name)?.playerId ?? ""] ?? 0;
        const top: number = rows[0]?.count ?? 0;
        if (leaders.length === 0) {
            return "Nobody matched the room this time.";
        }
        const only: string = leaders[0] ?? "";
        if (leaders.length === 1) {
            return `${only} matched the room ${matchesOf(only)} ${matchesOf(only) === 1 ? "time" : "times"}, for ${top} ${top === 1 ? "point" : "points"}.`;
        }
        return `${leaders.join(" and ")} tied on ${top} ${top === 1 ? "point" : "points"}.`;
    }

    /**
     * Ends the game: the hat's cost lands, once.
     * @param before the state.
     * @param result how it ended.
     * @returns the step.
     */
    const endGame = (before: MatchState, result: "played" | "tooFew"): Step<MatchState> => {
        const holder: string | null = before.hatInPlay === true && before.players.some((player: CartridgePlayer) => player.playerId === before.hat) === true ? before.hat : null;
        const scores: Record<string, number> = holder === null ? before.scores : { ...before.scores, [holder]: (before.scores[holder] ?? 0) - decisions.hatPenalty };
        const state: MatchState = { ...before, phase: "end", scores, hatLoser: holder, result, cards: [], stacks: [], gained: {} };
        return { state, facts: because(publicFact("game-over", finalText(state)), MATCH_DECISIONS.end), nextPhaseId: "end" };
    };

    /**
     * Turns the cards over: scores the stacks, moves the hat and tells the host what is on the table.
     * @param before the state in writing or settling.
     * @param given the final stacks; a stack emptied by someone leaving is dropped.
     * @returns the step.
     */
    const turnOver = (before: MatchState, given: readonly Stack[]): Step<MatchState> => {
        const stacks: Stack[] = given.filter((stack: Stack) => stack.length > 0);
        const gained: Record<string, number> = scoreStacks(stacks, decisions.pairPoints);
        const scores: Record<string, number> = { ...before.scores };
        for (const [playerId, points] of Object.entries(gained)) {
            scores[playerId] = (scores[playerId] ?? 0) + points;
        }
        const hat: string | null = before.hatInPlay === true ? hatAfter(before.hat, stacks) : null;
        const ordered: Stack[] = biggestFirst(stacks);
        const state: MatchState = { ...before, phase: "reveal", stacks: ordered, scores, gained, hat, asked: false, doubts: [] };
        const top: Stack | undefined = ordered[0];
        const record: RoundRecord = { prompt: promptOf(state), top: top === undefined ? "" : stackText(state, top), topSize: top?.length ?? 0 };
        const matches: Record<string, number> = { ...before.matches };
        for (const playerId of stacks.filter((stack: Stack) => stack.length > 1).flat()) {
            matches[playerId] = (matches[playerId] ?? 0) + 1;
        }
        const next: MatchState = { ...state, matches, record: [...before.record, record] };
        const moved: boolean = hat !== null && hat !== before.hat;
        return { state: next, facts: because(publicFact("reveal", revealText(next, moved)), MATCH_DECISIONS.stacks), nextPhaseId: "reveal", timers: { [`reveal${next.round}`]: decisions.revealSeconds } };
    };

    /**
     * What the host is told when the cards turn.
     * @param state the state in reveal.
     * @param moved whether the hat passed to a new card.
     * @returns the text.
     */
    function revealText(state: MatchState, moved: boolean): string {
        if (state.cards.length === 0) {
            return "Nobody wrote a card this round. Say so lightly and move on.";
        }
        const matched: string[] = state.stacks.filter((stack: Stack) => stack.length > 1).map((stack: Stack) => `${quoted(stackText(state, stack))} with ${stack.length} cards`);
        const alone: string[] = state.stacks.filter((stack: Stack) => stack.length === 1).map((stack: Stack) => quoted(stackText(state, stack)));
        return [
            "The cards are turned.",
            matched.length === 0 ? "Nothing matched." : `Stacks, biggest first: ${matched.join("; ")}.`,
            alone.length === 0 ? "No card sat alone." : `Cards that sat alone: ${alone.join("; ")}.`,
            moved === true ? "The hat passed to the odd card." : "",
            "Say the biggest stack in a short line, then one line about the odd answer, never about who wrote it. Never name a player or a score.",
        ].filter((part: string) => part !== "").join(" ");
    }

    /**
     * Asks the host's model one closed question about the pairs the seam joined or that look alike.
     * Nothing but its yes joins two stacks, so a silent model only means fewer merges.
     * @param state the state in settling.
     * @param doubts the pairs.
     * @returns the step.
     */
    const askSpark = (state: MatchState, doubts: Doubt[]): Step<MatchState> => {
        const texts = textsOf(state);
        const lines: string[] = doubts.map(([first, second]: Doubt, place: number) => {
            const firstTexts: string[] = texts(state.stacks[first] ?? []);
            const secondTexts: string[] = texts(state.stacks[second] ?? []);
            const [one, other] = doubtedTexts(firstTexts, secondTexts) ?? [standIn(firstTexts), standIn(secondTexts)];
            return `${state.round}.${place + 1} ${quoted(one)} and ${quoted(other)}`;
        });
        const request: string = [
            `The prompt was ${quoted(promptOf(state))}. For each pair below, say yes only if both of these are true.`,
            "Someone could give each answer to this prompt, even as a joke. And friends at a party would happily count the two as a match: a spelling variant, a plural, another form of the word, extra small words, an abbreviation, a synonym, or nearly the same idea in other words, as with sleep and sleeping in, or coffee and drinking coffee.",
            "Be generous, because matching is the fun of the game. But things that are merely related are different answers, such as cat and dog, beach and ocean, or a blanket and a sweater.",
            `Reply with one line per pair and nothing else, in the form "${state.round}.1 yes" or "${state.round}.2 no".`,
            ...lines,
        ].join("\n");
        return { state: { ...state, asked: true, doubts }, facts: [], contentRequest: request, timers: { [`ask${state.round}`]: decisions.askSeconds } };
    };

    /**
     * Reads the reply to the closed question: a pair is the same only when its line says yes.
     * @param reply the model's reply.
     * @param state the state in settling.
     * @returns the pairs said to be the same.
     */
    const sameFrom = (reply: string, state: MatchState): Doubt[] => {
        const said: Set<number> = new Set();
        for (const line of reply.split(/\r?\n/)) {
            const match: RegExpMatchArray | null = line.trim().match(/^(\d+)\.(\d+)\s*[:\-–]?\s*(yes|same)\b/i);
            if (match !== null && Number(match[1]) === state.round) {
                said.add(Number(match[2]) - 1);
            }
        }
        return state.doubts.filter((_doubt: Doubt, place: number) => said.has(place) === true);
    };

    /**
     * Closes the writing: stacks the cards locally, then asks the merging seam about what is left.
     * @param state the state in writing.
     * @returns the step.
     */
    const closeWriting = (state: MatchState): Step<MatchState> => {
        const cards: Card[] = inSeatOrder(state, state.cards);
        const stacks: Stack[] = stackCards(cards);
        const ready: MatchState = { ...state, cards, stacks };
        if (cards.length < 2 || stacks.length < 2) {
            return turnOver(ready, stacks);
        }
        const answers: string[] = [...stacks.map((stack: Stack) => stackText(ready, stack)), ...SIGN_OF_LIFE];
        return {
            state: { ...ready, phase: "settling" },
            facts: [],
            nextPhaseId: "settling",
            timers: { [`settle${state.round}`]: decisions.settleSeconds },
            mergeRequest: { id: `merge${state.round}`, question: promptOf(state), answers },
        };
    };

    /**
     * Takes the merging seam's answer. What it joined, and what looks alike if it was silent, goes to the
     * closed question, so two different models must agree before two different answers stack.
     * @param state the state in settling.
     * @param groups what the seam grouped.
     * @returns the step.
     */
    const afterSeam = (state: MatchState, groups: readonly AnswerGroup[]): Step<MatchState> => {
        const count: number = state.stacks.length;
        const alive: boolean = groups.some((group: AnswerGroup) => group.indexes.includes(count) === true && group.indexes.includes(count + 1) === true);
        const same: Doubt[] = groups.flatMap((group: AnswerGroup): Doubt[] => {
            const members: number[] = group.indexes.filter((index: number) => index < count);
            const [first, ...rest] = members;
            return first === undefined ? [] : rest.map((other: number): Doubt => [first, other]);
        });
        const lookAlike: Doubt[] = alive === true ? [] : doubtsAmong(state.stacks, textsOf(state));
        const isSeamPair = (pair: Doubt): boolean => same.some(([first, second]: Doubt) => (first === pair[0] && second === pair[1]) || (first === pair[1] && second === pair[0]));
        const doubts: Doubt[] = [...same, ...lookAlike.filter((pair: Doubt) => isSeamPair(pair) === false)].slice(0, ASK_PAIR_LIMIT);
        return doubts.length === 0 ? turnOver(state, state.stacks) : askSpark(state, doubts);
    };

    /**
     * Moves on once every present player has a card.
     * @param state the state in writing.
     * @returns the step.
     */
    const settleWriting = (state: MatchState): Step<MatchState> => {
        return state.players.every((player: CartridgePlayer) => cardOf(state, player.playerId) !== undefined) === true ? closeWriting(state) : { state, facts: [] };
    };

    /**
     * Takes a typed card. A card the local check refuses costs a try and the phone gets a fresh box.
     * @param state the state in writing.
     * @param playerId who wrote it.
     * @param value what they typed, already through the room's filter.
     * @returns the step.
     */
    const takeCard = (state: MatchState, playerId: string, value: string): Step<MatchState> => {
        const text: string = oneLine(value, decisions.answerLimit);
        if (text === "" || isHostSafe(text, decisions.answerLimit) === false) {
            return { state: { ...state, attempts: { ...state.attempts, [playerId]: (state.attempts[playerId] ?? 0) + 1 } }, facts: [] };
        }
        return settleWriting({ ...state, cards: [...state.cards, { playerId, text }] });
    };

    /**
     * Someone left. Their card goes with them, the hat is let go if it was theirs, and the game ends if too few remain.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: MatchState, playerId: string): Step<MatchState> => {
        if (state.phase === "end" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return { state, facts: [] };
        }
        const players: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => player.playerId !== playerId);
        const without = (stack: Stack): Stack => stack.filter((id: string) => id !== playerId);
        const cleaned: MatchState = {
            ...state,
            players,
            cards: state.cards.filter((card: Card) => card.playerId !== playerId),
            stacks: state.stacks.map(without),
            hat: state.hat === playerId ? null : state.hat,
        };
        if (players.length < MATCH_MINIMUM_PLAYERS) {
            return endGame(cleaned, "tooFew");
        }
        return cleaned.phase === "writing" ? settleWriting(cleaned) : { state: cleaned, facts: [] };
    };

    /**
     * Moves from a finished reveal to the next prompt, or to the end.
     * @param state the state in reveal.
     * @returns the step.
     */
    const afterReveal = (state: MatchState): Step<MatchState> => (state.round < total ? startRound(state, state.round + 1) : endGame(state, "played"));

    /**
     * The TV's cards for a reveal: one paper card per stack, the hat's card in wine.
     * @param state the state in reveal.
     * @returns the cells, each with unique text.
     */
    const cellsFor = (state: MatchState): BoardCell[] => {
        const used: Set<string> = new Set();
        const alone: number = state.stacks.filter((stack: Stack) => stack.length === 1).length;
        return state.stacks.map((stack: Stack): BoardCell => {
            let text: string = stackText(state, stack);
            while (used.has(text) === true) {
                text = `${text}\u200b`;
            }
            used.add(text);
            const wearsHat: boolean = stack.length === 1 && state.hat !== null && stack[0] === state.hat && alone === 1;
            const owned: string = stack.length === 1 ? (wearsHat === true ? "alone, wears the hat" : "alone") : `stack of ${stack.length}`;
            return { text, owner: wearsHat === true ? "a" : "unknown", turned: wearsHat, owned };
        });
    };

    /**
     * Everyone's running total, best first.
     * @param state the state.
     * @returns the rows.
     */
    const scoreRows = (state: MatchState): TallyRow[] => {
        const rows: TallyRow[] = state.players.map((player: CartridgePlayer): TallyRow => ({ label: player.name, count: state.scores[player.playerId] ?? 0 }));
        const top: number = Math.max(0, ...rows.map((row: TallyRow) => row.count));
        return rows.sort((first: TallyRow, second: TallyRow) => second.count - first.count).map((row: TallyRow) => ({ ...row, highlight: row.count === top && top > 0 }));
    };

    const cartridge: Cartridge<MatchState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<MatchState> {
            const drawn: PromptStem[] = drawStems();
            const state: MatchState = {
                phase: "choosing",
                stems: drawn,
                matches: {},
                players,
                hatInPlay: players.length >= HAT_MINIMUM_PLAYERS,
                round: 0,
                prompts: [],
                cards: [],
                attempts: {},
                stacks: [],
                asked: false,
                doubts: [],
                hat: null,
                scores: Object.fromEntries(players.map((player: CartridgePlayer) => [player.playerId, 0])),
                gained: {},
                record: [],
                hatLoser: null,
                result: null,
            };
            const request: string = [
                `Write ${total} prompts for a party game in which everyone types a short answer and tries to match the rest of the table.`,
                "One prompt for each stem below, in order, one per line, no numbering, no quotation marks, nothing else.",
                "Each prompt is one sentence of at most ten words that has many plausible short answers, where the most popular answer is easy to guess. No real people, no named brands, no politics, no religion, nothing sexual.",
                "Write each as a plain, natural question or phrase a friend would say out loud, a little funny. Keep the grammar simple.",
                ...drawn.map((stem: PromptStem, place: number) => `Stem ${place + 1}${stem.kind === "room" ? " (about the people at this table, as a group)" : ""}: ${stem.stem}`),
            ].join("\n");
            return { state, facts: [], nextPhaseId: "choosing", contentRequest: request, timers: { choose: CHOOSE_SECONDS } };
        },

        phaseOf(state: MatchState): string {
            return state.phase;
        },

        turn(state: MatchState): Turn | null {
            if (state.phase !== "writing") {
                return null;
            }
            return { kind: "everyone", playerIds: state.players.map((player: CartridgePlayer) => player.playerId), doneIds: state.cards.map((card: Card) => card.playerId), label: "Type your card" };
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(): LegalAction[] {
            return [];
        },

        apply(state: MatchState): Step<MatchState> {
            return { state, facts: [] };
        },

        onEvent(state: MatchState, event: RoomEvent): Step<MatchState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "contentReady" && state.phase === "choosing" && state.prompts.length === 0) {
                return startRound({ ...state, prompts: choosePrompts(state.stems, linesOf(event.text)) }, 1);
            }
            if (event.type === "contentReady" && state.phase === "settling" && state.asked === true) {
                const joined: Stack[] = joinStacks(state.stacks, sameFrom(event.text, state));
                return turnOver(state, joined);
            }
            if (event.type === "answersMerged" && state.phase === "settling" && state.asked === false && event.id === `merge${state.round}`) {
                return afterSeam(state, event.groups);
            }
            if (event.type === "answered" && state.phase === "writing" && typeof event.value === "string") {
                const present: boolean = state.players.some((player: CartridgePlayer) => player.playerId === event.playerId);
                if (present === false || cardOf(state, event.playerId) !== undefined || event.controlId !== controlId(state, event.playerId)) {
                    return { state, facts: [] };
                }
                return takeCard(state, event.playerId, event.value);
            }
            if (event.type !== "timerFired") {
                return { state, facts: [] };
            }
            if (event.timerId === "choose" && state.phase === "choosing" && state.prompts.length === 0) {
                return startRound({ ...state, prompts: choosePrompts(state.stems, []) }, 1);
            }
            if (event.timerId === `write${state.round}` && state.phase === "writing") {
                return closeWriting(state);
            }
            if (event.timerId === `settle${state.round}` && state.phase === "settling" && state.asked === false) {
                return turnOver(state, state.stacks);
            }
            if (event.timerId === `ask${state.round}` && state.phase === "settling" && state.asked === true) {
                return turnOver(state, state.stacks);
            }
            if (event.timerId === `reveal${state.round}` && state.phase === "reveal") {
                return afterReveal(state);
            }
            return { state, facts: [] };
        },

        publicScene(state: MatchState): Scene {
            const kicker: string = `Prompt ${state.round} of ${total}`;
            if (state.phase === "choosing") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: box.name }, { type: "text", text: "Getting the prompts ready.", emphasis: "large" }] };
            }
            if (state.phase === "writing" || state.phase === "settling") {
                const blocks: SceneBlock[] = [{ type: "title", text: promptOf(state), kicker }];
                if (state.phase === "writing") {
                    blocks.push({ type: "text", text: "Type what you think the room will say.", emphasis: "large" });
                    blocks.push({ type: "progress", label: "Cards in", current: state.cards.length, max: state.players.length, marks: "card" });
                    blocks.push({ type: "drain", seconds: decisions.writeSeconds, key: `write-${state.round}-${promptOf(state)}` });
                    return { mood: "neutral", transition: "fade", blocks };
                }
                blocks.push({ type: "text", text: "Stacking the cards.", emphasis: "large" });
                return { mood: "tense", transition: "fade", blocks };
            }
            if (state.phase === "reveal") {
                const blocks: SceneBlock[] = [{ type: "title", text: promptOf(state), kicker }];
                const board: SceneBlock = { type: "board", columns: Math.min(4, Math.max(1, state.stacks.length)), cells: cellsFor(state) };
                blocks.push(state.cards.length === 0 ? { type: "text", text: "No cards this round.", emphasis: "large" } : board);
                blocks.push({ type: "tally", title: "Points", rows: scoreRows(state) });
                return { mood: "dawn", transition: "fade", blocks };
            }
            const rows: TallyRow[] = scoreRows(state);
            const hatLine: string = state.hatLoser === null ? "" : ` The hat ended with ${nameOf(state, state.hatLoser)}: minus ${decisions.hatPenalty}.`;
            const leaders: string[] = rows.filter((row: TallyRow) => row.highlight === true).map((row: TallyRow) => row.label);
            const heading: string = leaders.length === 0 ? "Final scores" : leaders.length === 1 ? `${leaders[0] ?? ""} wins` : `${leaders.join(" and ")} tie`;
            const blocks: SceneBlock[] = [{ type: "title", text: heading, kicker: state.result === "tooFew" ? "The table got small" : "Final scores" }];
            blocks.push({ type: "text", text: whyWon(state, rows), emphasis: "large" });
            blocks.push({ type: "text", text: `Every other card in your stack is a point, and a pair scores two each.${hatLine}` });
            blocks.push({ type: "tally", title: "Points", rows });
            return { mood: "victory", transition: "fade", blocks };
        },

        privateControls(state: MatchState, playerId: string): Control[] {
            if (state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false || state.phase === "end") {
                return [{ type: "waiting", text: state.phase === "end" ? "That's the game." : "Look at the screen." }];
            }
            if (state.phase === "choosing") {
                return [{ type: "waiting", text: "The prompts are on their way." }];
            }
            if (state.phase === "settling") {
                return [{ type: "waiting", text: "The cards are being stacked." }];
            }
            if (state.phase === "reveal") {
                const won: number = state.gained[playerId] ?? 0;
                const wears: string = state.hat === playerId ? " You have the hat." : "";
                return [{ type: "waiting", text: `${won === 0 ? "No match this round." : `You scored ${won}.`}${wears}` }];
            }
            const clock: Control = { type: "drain", seconds: decisions.writeSeconds, key: `write-${state.round}-${promptOf(state)}` };
            if (cardOf(state, playerId) !== undefined) {
                return [{ type: "waiting", text: "Your card is in." }, clock];
            }
            const field: Control = { type: "textInput", id: controlId(state, playerId), prompt: promptOf(state), placeholder: "what will the room say", maxLength: decisions.answerLimit };
            return (state.attempts[playerId] ?? 0) > 0 ? [clock, { ...field, note: "Try another one." }] : [clock, field];
        },

        hostFacts(state: MatchState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase === "end" || state.round === 0) {
                return [];
            }
            const facts: ScopedFact[] = [publicFact("round", `It is prompt ${state.round} of ${total}.`)];
            if (state.phase === "reveal") {
                facts.push(publicFact("stacks", revealText(state, false)));
            }
            return facts;
        },

        outcome(state: MatchState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            const rows: TallyRow[] = scoreRows(state);
            return `Most points: ${rows.filter((row: TallyRow) => row.highlight === true).map((row: TallyRow) => row.label).join(" and ")}.`;
        },
    };

    return {
        cartridge,
        hidden(state: MatchState): HiddenValue[] {
            if (state.phase !== "writing" && state.phase !== "settling") {
                return [];
            }
            return state.cards.map((card: Card): HiddenValue => ({ label: "a card before the reveal", text: card.text, seenBy: [card.playerId], wholeWord: true }));
        },
    };
}
