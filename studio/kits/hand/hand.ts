// The hand kit: a card game of hands and a judge. Each round a prompt card with a gap is shown,
// every player but the judge plays one answer card from a hand dealt to their phone, the judge
// secretly picks the best, and the host reads the plays and reveals the pick. Code owns the deck,
// the deals, the judge's rotation, the clocks and the scores; the host only narrates facts and
// never judges, so it makes no rulings at all. There is no free text: every card is written ahead
// by the game, so nothing a player says or types reaches the screen or the host. Blank Verdict is
// this kit. A tone chosen at the start filters the deck: family cards only, or all of them.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow as SceneTallyRow } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { Turn } from "../../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../../shared/visibility.ts";
import { boxProblems, isWholeIn, squash, type Box, type HiddenValue, type KitGame } from "../../kit/kit.ts";
import { because, frozenCopy } from "../../kit/primitives.ts";

/** What a room asks of the cards. */
export type Tone = "family" | "party";

/** One answer card. */
export interface AnswerCard {
    /** Letters and digits, unique among all cards. */
    id: string;
    /** A short noun phrase that fits any gap. */
    text: string;
    /** Family cards play in every room; party cards only in a party room. */
    tone: Tone;
}

/** One prompt card; its text holds exactly one gap, written as three underscores. */
export interface PromptCard {
    id: string;
    text: string;
    tone: Tone;
}

/** Everything a creator may choose for a hand game. */
export interface HandDecisions {
    prompts: PromptCard[];
    answers: AnswerCard[];
    /** Cards in each hand. */
    handSize: number;
    /** Seconds the first player has to choose the tone before family is used. */
    toneSeconds: number;
    /** Seconds everyone has to play a card. */
    playSeconds: number;
    /** Seconds the judge has to choose once the host has read the plays. */
    judgeSeconds: number;
    /** Seconds the winning play stays up before the next round. */
    revealSeconds: number;
    /** Seconds the judge may not choose, before the host starts reading. */
    readBaseSeconds: number;
    /** Seconds added to that for each play the host reads. */
    readSecondsPerPlay: number;
    /** A table smaller than this goes round the judges twice. */
    doubleBelow: number;
    /** A hand game never has a give-up button; the field exists so the shelf can read it from any kit. */
    giveUpButton?: false;
}

/** The phases of the kit. */
export type HandPhase = "tone" | "playing" | "judging" | "reveal" | "end";

/** How a round was won. */
export type WonBy = "judge" | "clock" | "walkover";

/** Why the game ended. */
export type EndReason = "rounds" | "tooFew";

/** One card played, with who played it. */
export interface Play {
    playerId: string;
    /** Kept so the reveal can name them even if they have left. */
    name: string;
    cardId: string;
}

/** The whole game, immutable between steps. */
export interface HandState {
    phase: HandPhase;
    /** Everyone still at the table, in seat order. */
    players: CartridgePlayer[];
    /** Everyone dealt in at the start, in seat order; the judge's turn goes round it. */
    seats: string[];
    tone: Tone;
    /** Who chooses the tone. */
    chooserId: string;
    /** Rounds started so far. */
    round: number;
    /** Rounds the game runs for. */
    rounds: number;
    judgeId: string;
    /** The seat of the latest judge, or -1 before the first round. */
    judgeSeat: number;
    prompt: PromptCard | null;
    promptPile: string[];
    drawPile: string[];
    discard: string[];
    /** Each player's hand, by player id. */
    hands: Record<string, string[]>;
    /** Plays in the order they came in; shuffled when judging starts, so position tells nothing. */
    plays: Play[];
    /** True while the host reads the plays and the judge may not yet choose. */
    reading: boolean;
    /** The position in plays of the round's winner, once chosen. */
    winnerIndex: number | null;
    /** False in the beat between the judge choosing and the host revealing. */
    revealed: boolean;
    wonBy: WonBy | null;
    scores: Record<string, number>;
    /** The random source's state, so every step is a pure function of the one before. */
    rng: number;
    endReason: EndReason | null;
}

/** The prefix of the tone buttons' ids. */
export const TONE_PREFIX: string = "tone:";

/** The prefix of a card button's id. */
export const PLAY_PREFIX: string = "play:";

/** The prefix of the judge's button ids. */
export const PICK_PREFIX: string = "pick:";

/** The gap in a prompt. */
export const GAP: string = "___";

/** Fewest people who can play: a judge and two plays. */
export const FEWEST_PLAYERS: number = 3;

/** Seconds between the judge choosing and the host revealing the pick. */
export const BEAT_SECONDS: number = 3;

/** Decision ids a rehearsal names when it explains a moment. */
export const HAND_DECISIONS: { cards: string; tone: string; play: string; judge: string; reveal: string; read: string; rounds: string; table: string } = {
    cards: "cards",
    tone: "toneSeconds",
    play: "playSeconds",
    judge: "judgeSeconds",
    reveal: "revealSeconds",
    read: "readBaseSeconds",
    rounds: "doubleBelow",
    table: "players",
};

/** Longest answer card, in characters. */
const ANSWER_LIMIT: number = 60;

/** Longest prompt card, in characters. */
const PROMPT_LIMIT: number = 90;

/** Letters, digits, spaces and a little punctuation: nothing that could open a bracket or a ruling. */
const CARD_PATTERN: RegExp = /^[\p{L}\p{N} '’,.:;&?-]+$/u;

/** Two ways to say how a round was won, for the host. */
const TONE_BRIEFS: Record<Tone, string> = {
    family: "Tonight is a family night: keep every joke clean and gentle.",
    party: "Tonight is a party night: you may be dry and rude about the plays and the situations, but never hateful, never about anyone's body, race, religion or sexuality, and never cruel to a person.",
};

/**
 * Checks answer or prompt text.
 * @param text the text.
 * @param limit the longest allowed.
 * @param gap true for a prompt, which must hold the gap once.
 * @returns true when it is acceptable.
 */
function isCardText(text: string, limit: number, gap: boolean): boolean {
    const plain: string = text.split(GAP).join("");
    const gaps: number = text.split(GAP).length - 1;
    const shape: boolean = gap === true ? gaps === 1 : gaps === 0;
    return shape === true && text.trim() === text && text.length <= limit && /[\p{L}]/u.test(plain) === true && CARD_PATTERN.test(plain) === true;
}

/**
 * Checks a hand game's decisions.
 * @param decisions the decisions.
 * @param maxPlayers the most players the box allows.
 * @returns the problems, in plain words.
 */
export function handProblems(decisions: HandDecisions, maxPlayers: number): string[] {
    const problems: string[] = [];
    if (isWholeIn(decisions.handSize, 3, 10) === false) {
        problems.push("A hand must hold a whole number of cards from 3 to 10.");
    }
    const seconds: [string, number, number, number][] = [
        ["tone", decisions.toneSeconds, 5, 60],
        ["play", decisions.playSeconds, 15, 180],
        ["judge", decisions.judgeSeconds, 10, 180],
        ["reveal", decisions.revealSeconds, 5, 60],
        ["read", decisions.readBaseSeconds, 0, 30],
        ["read per play", decisions.readSecondsPerPlay, 0, 15],
    ];
    for (const [name, value, low, high] of seconds) {
        if (isWholeIn(value, low, high) === false) {
            problems.push(`The ${name} time must be a whole number of seconds from ${low} to ${high}.`);
        }
    }
    if (isWholeIn(decisions.doubleBelow, 0, 12) === false) {
        problems.push("The table size that goes round twice must be a whole number from 0 to 12.");
    }
    const ids: string[] = [...decisions.answers, ...decisions.prompts].map((card: AnswerCard | PromptCard) => card.id);
    if (new Set(ids).size !== ids.length || ids.some((id: string) => /^[a-zA-Z0-9]+$/.test(id) === false) === true) {
        problems.push("Every card needs its own id of letters and digits.");
    }
    if (decisions.answers.some((card: AnswerCard) => isCardText(card.text, ANSWER_LIMIT, false) === false) === true) {
        problems.push("An answer card is empty, too long, holds a gap or uses characters a card may not.");
    }
    if (decisions.prompts.some((card: PromptCard) => isCardText(card.text, PROMPT_LIMIT, true) === false) === true) {
        problems.push("A prompt card is too long, uses characters a card may not, or does not hold the gap exactly once.");
    }
    for (const tone of ["family", "party"] as const) {
        const answers: number = decisions.answers.filter((card: AnswerCard) => tone === "party" || card.tone === "family").length;
        const prompts: number = decisions.prompts.filter((card: PromptCard) => tone === "party" || card.tone === "family").length;
        if (answers < maxPlayers * decisions.handSize + maxPlayers) {
            problems.push(`A ${tone} room needs at least ${maxPlayers * decisions.handSize + maxPlayers} answer cards to deal ${maxPlayers} full hands and refill them.`);
        }
        if (prompts < maxPlayers) {
            problems.push(`A ${tone} room needs at least ${maxPlayers} prompt cards.`);
        }
    }
    const texts: string[] = [...decisions.answers, ...decisions.prompts].map((card: AnswerCard | PromptCard) => squash(card.text));
    const inside: string[] = decisions.answers
        .filter((card: AnswerCard) => texts.filter((text: string) => text.includes(squash(card.text)) === true).length > 1)
        .map((card: AnswerCard) => card.id);
    if (inside.length > 0) {
        problems.push(`These cards sit inside another card's text: ${inside.slice(0, 5).join(", ")}.`);
    }
    return problems;
}

/**
 * Every problem with a hand blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function handBlueprintProblems(box: Box, decisions: HandDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...handProblems(decisions, box.maxPlayers)];
    if (box.minPlayers < FEWEST_PLAYERS) {
        problems.push("A hand game needs at least three people: a judge and two plays.");
    }
    return problems;
}

/**
 * Builds the manifest from the box, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 */
export function handManifest(box: Box): CartridgeManifest {
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're running ${box.name}, a card game. Every round the players answer a prompt card that has a gap in it,`,
            "each by playing one card from their own phone, and one player is the judge.",
            "You don't judge, you never pick, and you never hint which play is best or who played what: the judge's pick is secret until you're told it.",
            "Read cards exactly as you're given them, word for word, and say blank for the gap. Never invent a card, a score or a rule.",
            "Nobody types or speaks to play, so never ask anyone to. The scores are kept in code: use only the ones you're told.",
            "Your timing is the game. Short sentences. A beat before the funny part. Then stop.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            {
                id: "tone",
                hostBrief: "The first player is choosing on their phone whether tonight is family or party. When you're told, say so in one short line, then stop.",
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "playing",
                hostBrief: [
                    "You'll be told the round and the prompt card. Read the prompt once, with a beat after the gap, name the judge, and tell everyone else to pick the card on their phone that fits best.",
                    "Three short sentences at most. You don't know what anyone plays.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "judging",
                hostBrief: [
                    "You'll be told every play, in order. Read the prompt once, then each play as its number and the card, each its own short sentence, with nothing said between them.",
                    "After the last, one dry line, then tell the judge to choose on their phone. You don't know who played what.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "reveal",
                hostBrief: [
                    "First you'll be told the judge has chosen: one short line to hold the room, and you don't know which play won.",
                    "Then you'll be told the winner: read the winning sentence in full, say who played it, pause, and add one dry line about a play that lost. Then stop.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "end",
                hostBrief: "You'll be told the final scores. Say who won, give a kind dry line to whoever came last, and ask if they want another game. Three short sentences at most.",
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/** A random value and the source's next state. */
interface Drawn {
    value: number;
    rng: number;
}

/**
 * Draws one value from a random source's state, the same generator as the rest of Studio.
 * @param rng the source's state.
 * @returns a value in [0, 1) and the next state.
 */
function drawValue(rng: number): Drawn {
    const next: number = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return { value: next / 4294967296, rng: next };
}

/**
 * Shuffles a list without changing it.
 * @param items what to shuffle.
 * @param rng the random source's state.
 * @returns the shuffled copy and the source's next state.
 */
function shuffled<Item>(items: readonly Item[], rng: number): { items: Item[]; rng: number } {
    const copy: Item[] = [...items];
    let state: number = rng;
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const drawn: Drawn = drawValue(state);
        state = drawn.rng;
        const swap: number = Math.floor(drawn.value * (index + 1));
        const held: Item | undefined = copy[index];
        const other: Item | undefined = copy[swap];
        if (held !== undefined && other !== undefined) {
            copy[index] = other;
            copy[swap] = held;
        }
    }
    return { items: copy, rng: state };
}

/**
 * A prompt as the host says it: the gap becomes the word blank.
 * @param text the prompt's text.
 * @returns the spoken text.
 */
function spoken(text: string): string {
    return text.split(GAP).join("blank");
}

/**
 * Builds a hand game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions, cards included; copied likewise. Check them with handBlueprintProblems first.
 * @param random a function returning [0, 1): the first draw seeds the game's own random source.
 * @returns the game.
 */
export function createHandGame(givenBox: Box, givenDecisions: HandDecisions, random: () => number = Math.random): KitGame<HandState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: HandDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = handManifest(box);
    const answerById: Map<string, AnswerCard> = new Map(decisions.answers.map((card: AnswerCard) => [card.id, card]));
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const textOf = (cardId: string): string => answerById.get(cardId)?.text ?? "";
    const nameOf = (state: HandState, playerId: string): string => state.players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const scoreOf = (state: HandState, playerId: string): number => state.scores[playerId] ?? 0;
    const playable = (card: AnswerCard | PromptCard, tone: Tone): boolean => tone === "party" || card.tone === "family";
    const answerIds = (tone: Tone): string[] => decisions.answers.filter((card: AnswerCard) => playable(card, tone)).map((card: AnswerCard) => card.id);
    const promptIds = (tone: Tone): string[] => decisions.prompts.filter((card: PromptCard) => playable(card, tone)).map((card: PromptCard) => card.id);
    const fill = (prompt: PromptCard | null, cardId: string): string => (prompt?.text ?? GAP).split(GAP).join(textOf(cardId).replace(/[.?]+$/, ""));
    const pointWord = (amount: number): string => (amount === 1 ? "point" : "points");

    /**
     * Everyone who is meant to play this round: the table without the judge.
     * @param state the state.
     * @returns the players.
     */
    const askedToPlay = (state: HandState): CartridgePlayer[] => state.players.filter((player: CartridgePlayer) => player.playerId !== state.judgeId);

    /**
     * Everyone at the table, most points first, ties in seat order.
     * @param state the state.
     * @returns the players.
     */
    const ranked = (state: HandState): CartridgePlayer[] => {
        return [...state.players].sort((first: CartridgePlayer, second: CartridgePlayer) => scoreOf(state, second.playerId) - scoreOf(state, first.playerId));
    };

    /**
     * Seat order, best first, as a line for the host.
     * @param state the state.
     * @returns for example "Teacup 3, Spoon 1".
     */
    const standings = (state: HandState): string => {
        const rows: CartridgePlayer[] = ranked(state);
        return rows.map((player: CartridgePlayer) => `${player.name} ${scoreOf(state, player.playerId)}`).join(", ");
    };

    /**
     * Fills every hand back up from the deck, shuffling the discards in when it runs out.
     * @param state the state.
     * @returns the state with full hands.
     */
    const refill = (state: HandState): HandState => {
        const hands: Record<string, string[]> = {};
        let drawPile: string[] = [...state.drawPile];
        let discard: string[] = [...state.discard];
        let rng: number = state.rng;
        for (const player of state.players) {
            const hand: string[] = [...(state.hands[player.playerId] ?? [])];
            while (hand.length < decisions.handSize) {
                if (drawPile.length === 0) {
                    const mixed: { items: string[]; rng: number } = shuffled(discard, rng);
                    drawPile = mixed.items;
                    discard = [];
                    rng = mixed.rng;
                }
                const card: string | undefined = drawPile.shift();
                if (card === undefined) {
                    break;
                }
                hand.push(card);
            }
            hands[player.playerId] = hand;
        }
        return { ...state, hands, drawPile, discard, rng };
    };

    /**
     * Ends the game with the final scores.
     * @param state the state.
     * @param reason why it ended.
     * @param lead facts to tell the host first.
     * @returns the step.
     */
    const finish = (state: HandState, reason: EndReason, lead: ScopedFact[]): Step<HandState> => {
        const ended: HandState = { ...state, phase: "end", endReason: reason, plays: [], reading: false };
        const why: string = reason === "rounds" ? `That was the last of the ${state.rounds} rounds.` : "Too few people are left to play on.";
        const closing: string = "Say who won, give a kind dry line to whoever came last, and ask if they want another game.";
        const text: string = `${why} Final scores: ${standings(ended)}. ${outcomeLine(ended)} ${closing}`;
        return { state: ended, facts: [...lead, ...because(publicFact("game-over", text), HAND_DECISIONS.rounds)], nextPhaseId: "end" };
    };

    /**
     * Who won, from the scores of those still at the table.
     * @param state the state.
     * @returns one sentence.
     */
    function outcomeLine(state: HandState): string {
        const best: number = Math.max(0, ...state.players.map((player: CartridgePlayer) => scoreOf(state, player.playerId)));
        const leaders: string[] = state.players.filter((player: CartridgePlayer) => scoreOf(state, player.playerId) === best).map((player: CartridgePlayer) => player.name);
        if (best === 0) {
            return "Nobody scored a point.";
        }
        if (leaders.length > 1) {
            return `${leaders.join(" and ")} tie on ${best} ${pointWord(best)}.`;
        }
        return `${leaders[0] ?? "Someone"} wins with ${best} ${pointWord(best)}.`;
    }

    /**
     * Starts the next round, or ends the game when the rounds are done or the table is too small.
     * @param state the state between rounds.
     * @param lead facts to tell the host first.
     * @returns the step.
     */
    const nextRound = (state: HandState, lead: ScopedFact[]): Step<HandState> => {
        if (state.players.length < FEWEST_PLAYERS) {
            return finish(state, "tooFew", lead);
        }
        if (state.round >= state.rounds) {
            return finish(state, "rounds", lead);
        }
        let judgeSeat: number = state.judgeSeat;
        let judgeId: string = state.judgeId;
        for (let step = 1; step <= state.seats.length; step += 1) {
            const seat: number = (state.judgeSeat + step) % state.seats.length;
            const candidate: string = state.seats[seat] ?? "";
            if (state.players.some((player: CartridgePlayer) => player.playerId === candidate) === true) {
                judgeSeat = seat;
                judgeId = candidate;
                break;
            }
        }
        let promptPile: string[] = state.promptPile;
        let rng: number = state.rng;
        if (promptPile.length === 0) {
            const mixed: { items: string[]; rng: number } = shuffled(promptIds(state.tone), rng);
            promptPile = mixed.items;
            rng = mixed.rng;
        }
        const promptId: string | undefined = promptPile[0];
        const prompt: PromptCard | null = decisions.prompts.find((card: PromptCard) => card.id === promptId) ?? null;
        const dealt: HandState = refill({
            ...state,
            phase: "playing",
            round: state.round + 1,
            judgeId,
            judgeSeat,
            prompt,
            promptPile: promptPile.slice(1),
            plays: [],
            reading: false,
            winnerIndex: null,
            revealed: false,
            wonBy: null,
            rng,
        });
        const judge: string = nameOf(dealt, judgeId);
        const text: string = [
            `Round ${dealt.round} of ${dealt.rounds}. ${judge} is the judge.`,
            `The prompt card reads: "${spoken(prompt?.text ?? "")}".`,
            `Read it aloud once with a beat after the blank, then say ${judge} judges`,
            "and everyone else picks the card on their phone that fits best. Three short sentences at most.",
        ].join(" ");
        return { state: dealt, facts: [...lead, ...because(publicFact("round", text), HAND_DECISIONS.cards)], nextPhaseId: "playing", timers: { playing: decisions.playSeconds } };
    };

    /**
     * Throws the round away: cards go back to the hands that played them, or the discard if the
     * player has gone, and the next round starts.
     * @param state the state.
     * @param why what to tell the host.
     * @returns the step.
     */
    const voidRound = (state: HandState, why: string): Step<HandState> => {
        const hands: Record<string, string[]> = { ...state.hands };
        const discard: string[] = [...state.discard];
        for (const play of state.plays) {
            if (state.players.some((player: CartridgePlayer) => player.playerId === play.playerId) === true) {
                hands[play.playerId] = [...(hands[play.playerId] ?? []), play.cardId];
                continue;
            }
            discard.push(play.cardId);
        }
        const cleared: HandState = { ...state, hands, discard, plays: [], reading: false };
        const lead: ScopedFact[] = because(publicFact("void", `${why} No point this round. Say so in one short line, and the next round follows.`), HAND_DECISIONS.play);
        return nextRound(cleared, lead);
    };

    /**
     * Awards the round to a play and begins the reveal.
     * @param state the state in judging, or in playing with one play.
     * @param index the position of the winning play.
     * @param wonBy how it was won.
     * @returns the step.
     */
    const award = (state: HandState, index: number, wonBy: WonBy): Step<HandState> => {
        const winner: Play | undefined = state.plays[index];
        if (winner === undefined) {
            return { state, facts: [] };
        }
        const hands: Record<string, string[]> = { ...state.hands };
        for (const play of state.plays) {
            hands[play.playerId] = (hands[play.playerId] ?? []).filter((cardId: string) => cardId !== play.cardId);
        }
        const discard: string[] = [...state.discard, ...state.plays.map((play: Play) => play.cardId)];
        const next: HandState = { ...state, phase: "reveal", hands, discard, winnerIndex: index, wonBy, reading: false };
        if (wonBy === "walkover") {
            return reveal(next, [], true);
        }
        const beat: string = wonBy === "clock"
            ? "The judge ran out of time, so the lantern drew a play out of a hat. Say that in one short line to hold the room, and don't say which play won."
            : `${nameOf(state, state.judgeId)} has chosen. Say one short line to hold the room, such as that the verdict is in, and don't say which play won: you aren't told yet.`;
        return { state: next, facts: because(publicFact("chosen", beat), HAND_DECISIONS.judge), nextPhaseId: "reveal", timers: { beat: BEAT_SECONDS } };
    };

    /**
     * Shows the winning play and tells the host.
     * @param state the state in reveal.
     * @param lead facts to tell the host first.
     * @param entering true when this step also enters the phase.
     * @returns the step.
     */
    function reveal(state: HandState, lead: ScopedFact[], entering: boolean = false): Step<HandState> {
        const winner: Play | undefined = state.plays[state.winnerIndex ?? -1];
        if (winner === undefined) {
            return { state, facts: lead };
        }
        // The point lands only now, so nothing the host or the screen is shown during the beat gives the winner away.
        const here: boolean = state.players.some((player: CartridgePlayer) => player.playerId === winner.playerId);
        const scores: Record<string, number> = here === true ? { ...state.scores, [winner.playerId]: scoreOf(state, winner.playerId) + 1 } : state.scores;
        const shown: HandState = { ...state, revealed: true, scores };
        const others: string = shown.plays
            .map((play: Play, index: number) => ({ play, index }))
            .filter((entry: { play: Play; index: number }) => entry.index !== shown.winnerIndex)
            .map((entry: { play: Play; index: number }) => `${entry.play.name} played "${textOf(entry.play.cardId)}"`)
            .join("; ");
        const sentence: string = spoken(fill(shown.prompt, winner.cardId).replace(/\s+/g, " ")).replace(/\.$/, "");
        const total: number = scoreOf(shown, winner.playerId);
        const text: string = [
            shown.wonBy === "walkover" ? `Only ${winner.name} played a card.` : `The winning play: "${sentence}".`,
            `It was played by ${winner.name}, who now has ${total} ${pointWord(total)}.`,
            others === "" ? "" : `The plays that lost: ${others}.`,
            "Read the winning sentence in full, say who played it, pause, then one dry line about a play that lost. Then stop.",
        ].filter((part: string) => part !== "").join(" ");
        const fact: ScopedFact[] = because(publicFact("winner", text), HAND_DECISIONS.reveal);
        const timers: Record<string, number> = { reveal: decisions.revealSeconds };
        return entering === true ? { state: shown, facts: [...lead, ...fact], nextPhaseId: "reveal", timers } : { state: shown, facts: [...lead, ...fact], timers };
    }

    /**
     * Closes the playing phase: the plays go to the judge, or the round is thrown away.
     * @param state the state in playing.
     * @returns the step.
     */
    const closePlaying = (state: HandState): Step<HandState> => {
        if (state.plays.length === 0) {
            return voidRound(state, "Nobody played a card.");
        }
        if (state.plays.length === 1) {
            return award(state, 0, "walkover");
        }
        const mixed: { items: Play[]; rng: number } = shuffled(state.plays, state.rng);
        const readSeconds: number = decisions.readBaseSeconds + decisions.readSecondsPerPlay * mixed.items.length;
        const next: HandState = { ...state, phase: "judging", plays: mixed.items, rng: mixed.rng, reading: true };
        const numbered: string = mixed.items.map((play: Play, index: number) => `${index + 1}) "${textOf(play.cardId)}"`).join(" ");
        const judge: string = nameOf(state, state.judgeId);
        const text: string = [
            `Everyone has played. The prompt card: "${spoken(state.prompt?.text ?? "")}".`,
            `The plays, in this order: ${numbered}.`,
            `Read the prompt once, then each play as "Number" and its number, then the card, each its own short sentence.`,
            `After the last, one dry line, then tell ${judge} to choose on their phone.`,
        ].join(" ");
        return { state: next, facts: because(publicFact("plays", text), HAND_DECISIONS.read), nextPhaseId: "judging", timers: { read: readSeconds } };
    };

    /**
     * Whether everyone asked to play has.
     * @param state the state.
     * @returns true when they have.
     */
    const allPlayed = (state: HandState): boolean => {
        return askedToPlay(state).every((player: CartridgePlayer) => state.plays.some((play: Play) => play.playerId === player.playerId) === true);
    };

    /**
     * Applies the tone, builds the decks and starts the first round.
     * @param state the state in the tone phase.
     * @param tone the tone chosen, or the default if nobody chose.
     * @param decision the decision that settled it.
     * @returns the step.
     */
    const startGame = (state: HandState, tone: Tone, decision: string): Step<HandState> => {
        const answers: { items: string[]; rng: number } = shuffled(answerIds(tone), state.rng);
        const prompts: { items: string[]; rng: number } = shuffled(promptIds(tone), answers.rng);
        const deck: HandState = { ...state, tone, drawPile: answers.items, promptPile: prompts.items, discard: [], hands: {}, rng: prompts.rng };
        const told: string = `${tone === "party" ? "Party" : "Family"} night it is. ${TONE_BRIEFS[tone]} Say so in one short line.`;
        return nextRound(deck, because(publicFact("tone", told), decision));
    };

    /**
     * Someone left the table.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: HandState, playerId: string): Step<HandState> => {
        if (state.phase === "end" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false) {
            return { state, facts: [] };
        }
        const players: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => player.playerId !== playerId);
        const hands: Record<string, string[]> = { ...state.hands };
        const discard: string[] = [...state.discard, ...(hands[playerId] ?? [])];
        delete hands[playerId];
        const gone: HandState = { ...state, players, hands, discard, chooserId: state.chooserId === playerId ? players[0]?.playerId ?? "" : state.chooserId };
        if (players.length < FEWEST_PLAYERS) {
            return finish(gone, "tooFew", []);
        }
        if ((gone.phase === "playing" || gone.phase === "judging") && playerId === gone.judgeId) {
            return voidRound(gone, `${nameOf(state, playerId)}, the judge, left.`);
        }
        if (gone.phase === "playing" && allPlayed(gone) === true) {
            return closePlaying(gone);
        }
        return { state: gone, facts: [] };
    };

    /**
     * The judge's buttons, one per play.
     * @param state the state in judging.
     * @returns the options; disabled while the host is reading.
     */
    const pickOptions = (state: HandState): ControlOption[] => {
        return state.plays.map((play: Play, index: number): ControlOption => {
            return { id: `${PICK_PREFIX}${index}`, label: `${index + 1}. ${textOf(play.cardId)}`, disabled: state.reading };
        });
    };

    const cartridge: Cartridge<HandState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<HandState> {
            const seed: number = Math.floor(random() * 4294967296) >>> 0;
            const state: HandState = {
                phase: "tone",
                players,
                seats: players.map((player: CartridgePlayer) => player.playerId),
                tone: "family",
                chooserId: players[0]?.playerId ?? "",
                round: 0,
                rounds: players.length * (players.length < decisions.doubleBelow ? 2 : 1),
                judgeId: "",
                judgeSeat: -1,
                prompt: null,
                promptPile: [],
                drawPile: [],
                discard: [],
                hands: {},
                plays: [],
                reading: false,
                winnerIndex: null,
                revealed: false,
                wonBy: null,
                scores: Object.fromEntries(players.map((player: CartridgePlayer) => [player.playerId, 0])),
                rng: seed === 0 ? 1 : seed,
                endReason: null,
            };
            const text: string = `${nameOf(state, state.chooserId)} is choosing on their phone whether tonight is a family or a party night. Say so in one short line, then stop.`;
            return { state, facts: because(publicFact("choosing", text), HAND_DECISIONS.tone), nextPhaseId: "tone", timers: { tone: decisions.toneSeconds } };
        },

        phaseOf(state: HandState): string {
            return state.phase;
        },

        turn(state: HandState): Turn | null {
            if (state.phase === "tone") {
                return { kind: "one", playerId: state.chooserId, label: "Choosing the tone:" };
            }
            if (state.phase === "playing") {
                const ids: string[] = askedToPlay(state).map((player: CartridgePlayer) => player.playerId);
                return { kind: "everyone", playerIds: ids, doneIds: state.plays.map((play: Play) => play.playerId).filter((id: string) => ids.includes(id) === true), label: "Play a card on your phone" };
            }
            if (state.phase === "judging") {
                return { kind: "one", playerId: state.judgeId, label: "Judging:" };
            }
            return null;
        },

        roleOf(state: HandState, playerId: string): string {
            return playerId === state.judgeId ? "judge" : "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: HandState, playerId: string): LegalAction[] {
            if (state.phase === "tone" && playerId === state.chooserId) {
                return [{ actionId: `${TONE_PREFIX}family`, label: "Family night" }, { actionId: `${TONE_PREFIX}party`, label: "Party night" }];
            }
            if (state.phase === "playing" && playerId !== state.judgeId && state.plays.some((play: Play) => play.playerId === playerId) === false) {
                return (state.hands[playerId] ?? []).map((cardId: string): LegalAction => ({ actionId: `${PLAY_PREFIX}${cardId}`, label: textOf(cardId) }));
            }
            if (state.phase === "judging" && playerId === state.judgeId && state.reading === false) {
                return state.plays.map((play: Play, index: number): LegalAction => ({ actionId: `${PICK_PREFIX}${index}`, label: textOf(play.cardId) }));
            }
            return [];
        },

        apply(state: HandState, playerId: string, actionId: string): Step<HandState> {
            if (cartridge.legalActions(state, playerId).some((action: LegalAction) => action.actionId === actionId) === false) {
                return { state, facts: [] };
            }
            if (state.phase === "tone") {
                return startGame(state, actionId === `${TONE_PREFIX}party` ? "party" : "family", HAND_DECISIONS.tone);
            }
            if (state.phase === "playing") {
                const cardId: string = actionId.slice(PLAY_PREFIX.length);
                const hands: Record<string, string[]> = { ...state.hands, [playerId]: (state.hands[playerId] ?? []).filter((held: string) => held !== cardId) };
                const next: HandState = { ...state, hands, plays: [...state.plays, { playerId, name: nameOf(state, playerId), cardId }] };
                return allPlayed(next) === true ? closePlaying(next) : { state: next, facts: [] };
            }
            return award(state, Number(actionId.slice(PICK_PREFIX.length)), "judge");
        },

        onEvent(state: HandState, event: RoomEvent): Step<HandState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type !== "timerFired") {
                return { state, facts: [] };
            }
            if (event.timerId === "tone" && state.phase === "tone") {
                return startGame(state, "family", HAND_DECISIONS.tone);
            }
            if (event.timerId === "playing" && state.phase === "playing") {
                return closePlaying(state);
            }
            if (event.timerId === "read" && state.phase === "judging" && state.reading === true) {
                const text: string = `${nameOf(state, state.judgeId)} may choose now.`;
                return { state: { ...state, reading: false }, facts: because({ ...publicFact("choose", text), quiet: true }, HAND_DECISIONS.judge), timers: { judging: decisions.judgeSeconds } };
            }
            if (event.timerId === "judging" && state.phase === "judging" && state.reading === false) {
                const drawn: Drawn = drawValue(state.rng);
                return award({ ...state, rng: drawn.rng }, Math.floor(drawn.value * state.plays.length), "clock");
            }
            if (event.timerId === "beat" && state.phase === "reveal" && state.revealed === false) {
                return reveal(state, []);
            }
            if (event.timerId === "reveal" && state.phase === "reveal" && state.revealed === true) {
                return nextRound(state, []);
            }
            return { state, facts: [] };
        },

        publicScene(state: HandState): Scene {
            if (state.phase === "tone") {
                return {
                    mood: "lobby",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: box.name, kicker: "Before the first card" },
                        { type: "text", text: `${nameOf(state, state.chooserId)} chooses the tone on their phone: family or party.`, emphasis: "large" },
                        { type: "timer", seconds: decisions.toneSeconds, label: "or it's family", running: true },
                    ],
                };
            }
            const kicker: string = `Round ${state.round} of ${state.rounds}`;
            const prompt: string = state.prompt?.text ?? "";
            if (state.phase === "playing") {
                return {
                    mood: "tense",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: prompt, kicker },
                        { type: "text", text: `${nameOf(state, state.judgeId)} judges. Everyone else plays a card from their phone.`, emphasis: "large" },
                        { type: "progress", label: "Cards played", current: state.plays.length, max: askedToPlay(state).length, marks: "card" },
                        { type: "timer", seconds: decisions.playSeconds, label: "to play", running: true },
                    ],
                };
            }
            if (state.phase === "judging") {
                const plays: SceneBlock[] = state.plays.map((play: Play, index: number): SceneBlock => ({ type: "text", text: `${index + 1}. ${textOf(play.cardId)}`, emphasis: "large" }));
                const closing: SceneBlock = state.reading === true
                    ? { type: "text", text: `${nameOf(state, state.judgeId)} is listening.`, emphasis: "whisper" }
                    : { type: "timer", seconds: decisions.judgeSeconds, label: "to choose", running: true };
                return { mood: "tense", transition: "fade", blocks: [{ type: "title", text: prompt, kicker }, ...plays, closing] };
            }
            if (state.phase === "reveal") {
                const winner: Play | undefined = state.plays[state.winnerIndex ?? -1];
                if (state.revealed === false || winner === undefined) {
                    const plays: SceneBlock[] = state.plays.map((play: Play, index: number): SceneBlock => ({ type: "text", text: `${index + 1}. ${textOf(play.cardId)}` }));
                    return { mood: "tense", transition: "fade", blocks: [{ type: "title", text: prompt, kicker }, ...plays, { type: "text", text: "The verdict is in.", emphasis: "whisper" }] };
                }
                const rows: SceneTallyRow[] = state.players.map((player: CartridgePlayer): SceneTallyRow => {
                    return { label: player.name, count: scoreOf(state, player.playerId), highlight: player.playerId === winner.playerId };
                });
                return {
                    mood: "victory",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: fill(state.prompt, winner.cardId), kicker: `${winner.name} takes the round` },
                        { type: "text", text: state.wonBy === "clock" ? "The judge ran out of time, so it came out of a hat." : state.wonBy === "walkover" ? "The only play on the table." : `${nameOf(state, state.judgeId)} chose it.`, emphasis: "whisper" },
                        { type: "tally", title: "Points", rows },
                    ],
                };
            }
            const best: number = Math.max(0, ...state.players.map((player: CartridgePlayer) => scoreOf(state, player.playerId)));
            return {
                mood: "victory",
                transition: "fade",
                blocks: [
                    { type: "title", text: outcomeLine(state), kicker: state.endReason === "tooFew" ? "The table is too small to go on" : "Final points" },
                    { type: "tally", title: "Points", rows: ranked(state).map((player: CartridgePlayer): SceneTallyRow => ({ label: player.name, count: scoreOf(state, player.playerId), highlight: best > 0 && scoreOf(state, player.playerId) === best })) },
                ],
            };
        },

        privateControls(state: HandState, playerId: string): Control[] {
            const prompt: string = state.prompt?.text ?? "";
            if (state.phase === "tone") {
                if (playerId !== state.chooserId) {
                    return [{ type: "waiting", text: `${nameOf(state, state.chooserId)} is choosing the tone.` }];
                }
                return [{
                    type: "choice",
                    prompt: "Who is at the table tonight?",
                    options: [{ id: `${TONE_PREFIX}family`, label: "Family night: clean and silly" }, { id: `${TONE_PREFIX}party`, label: "Party night: rude, never hateful" }],
                    multiple: false,
                }];
            }
            if (state.phase === "playing") {
                if (playerId === state.judgeId) {
                    return [{ type: "notice", text: `You judge this round. ${prompt}`, tone: "info" }, { type: "waiting", text: "They are choosing their cards." }];
                }
                const played: Play | undefined = state.plays.find((play: Play) => play.playerId === playerId);
                if (played !== undefined) {
                    return [{ type: "notice", text: `You played: ${textOf(played.cardId)}`, tone: "info" }, { type: "waiting", text: "Waiting for the others." }];
                }
                const options: ControlOption[] = (state.hands[playerId] ?? []).map((cardId: string): ControlOption => ({ id: `${PLAY_PREFIX}${cardId}`, label: textOf(cardId) }));
                return [{ type: "choice", prompt, options, multiple: false }];
            }
            if (state.phase === "judging") {
                if (playerId === state.judgeId) {
                    return [{ type: "choice", prompt: state.reading === true ? `${prompt} Listen to the host read the plays.` : `${prompt} Pick the best.`, options: pickOptions(state), multiple: false }];
                }
                const mine: Play | undefined = state.plays.find((play: Play) => play.playerId === playerId);
                const line: string = mine === undefined ? "Watching the judging." : `Your play is in. ${nameOf(state, state.judgeId)} is choosing.`;
                return [{ type: "waiting", text: line }];
            }
            if (state.phase === "reveal") {
                const winner: Play | undefined = state.plays[state.winnerIndex ?? -1];
                return [{ type: "waiting", text: state.revealed === true && winner?.playerId === playerId ? "Yours won. One point." : "Look at the screen." }];
            }
            return [{ type: "waiting", text: "Look at the screen." }];
        },

        hostFacts(state: HandState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase === "tone") {
                return [];
            }
            const known: ScopedFact[] = [publicFact("tone", TONE_BRIEFS[state.tone]), publicFact("scores", `Scores: ${standings(state)}.`)];
            if (state.phase === "end") {
                return known;
            }
            known.push(publicFact("round", `Round ${state.round} of ${state.rounds}. ${nameOf(state, state.judgeId)} is the judge. The prompt: "${spoken(state.prompt?.text ?? "")}".`));
            if (state.phase === "judging") {
                known.push(publicFact("plays", `The plays, in order: ${state.plays.map((play: Play, index: number) => `${index + 1}) "${textOf(play.cardId)}"`).join(" ")}.`));
            }
            return known;
        },

        outcome(state: HandState): string | null {
            return state.phase === "end" ? outcomeLine(state) : null;
        },
    };

    return {
        cartridge,
        hidden(state: HandState): HiddenValue[] {
            if (state.phase === "end" || state.phase === "tone") {
                return [];
            }
            const cards: HiddenValue[] = Object.entries(state.hands).flatMap(([playerId, hand]: [string, string[]]) => {
                return hand.map((cardId: string): HiddenValue => ({ label: "a card in someone's hand", text: textOf(cardId), seenBy: [playerId] }));
            });
            if (state.phase === "playing") {
                return [...cards, ...state.plays.map((play: Play): HiddenValue => ({ label: "a card played face down", text: textOf(play.cardId), seenBy: [play.playerId] }))];
            }
            if (state.phase === "reveal" && state.revealed === true) {
                return cards;
            }
            // A name that sits inside a card on the table, such as Spoon beside a giant spoon, can't be told apart from the card.
            const shown: string = squash([state.prompt?.text ?? "", ...state.plays.map((play: Play) => textOf(play.cardId))].join(" "));
            const authors: HiddenValue[] = state.plays
                .filter((play: Play) => shown.includes(squash(play.name)) === false)
                .map((play: Play): HiddenValue => ({ label: "who played a card", text: play.name, seenBy: [play.playerId], near: textOf(play.cardId) }));
            return [...cards, ...authors];
        },
    };
}
