// The line kit: a row of dated cards lies face up on the table in order, a new card comes out with its date
// hidden, and every player picks on their phone which gap in the row it belongs in. The card's date, the
// right gap, who was exact and who was one gap off, and the points are all code. The host never knows a
// card's date before the reveal, so it cannot hint; it reads the card, narrates the reveal from the
// date and the note it is given, and explains the surprising ones. Mind the Gap is this kit.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow as SceneTallyRow } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { Turn } from "../../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../../shared/visibility.ts";
import { boxProblems, isWholeIn, type Box, type HiddenValue, type KitGame } from "../../kit/kit.ts";
import { because, frozenCopy } from "../../kit/primitives.ts";

/** One card: something that happened or was invented, with the year it did. */
export interface LineCard {
    /** Letters only; names the card in a report. */
    id: string;
    /** What is on the card. No digits, so it can't give its date away. */
    name: string;
    /** The card in a few words, for a button: "the telephone". */
    short: string;
    /** The card in two or three words for the TV's list, which cuts a label off past about seventeen characters. */
    tag: string;
    /** The year. Whole, and shown only once the card is placed. */
    year: number;
    /** Where the year comes from, named well enough to check. */
    source: string;
    /** For a card people find surprising: one plain sentence saying why. Otherwise null. */
    surprise: string | null;
}

/** Everything a creator may choose for a line game. */
export interface LineDecisions {
    cards: LineCard[];
    /** Cards already in the row when the game starts. */
    startCards: number;
    /** New cards to place, one a round. */
    rounds: number;
    /** Seconds to pick a gap. */
    placeSeconds: number;
    /** Seconds the date stays up before the next card. */
    revealSeconds: number;
    /** True when the pause menu offers "We give up", which ends the game with the scores so far. */
    giveUpButton: boolean;
    /** Points for the right gap, and for a gap next to it. */
    points: { exact: number; adjacent: number };
}

/** The phases of the kit. */
export type LinePhase = "place" | "reveal" | "end";

/** How a game ended. */
export type LineResult = "played" | "stopped";

/** What one revealed card came to. */
export interface PlacedResult {
    /** The gap the card belongs in. */
    slot: number;
    exact: string[];
    adjacent: string[];
    gains: Record<string, number>;
}

/** The whole game, immutable between steps. */
export interface LineState {
    phase: LinePhase;
    /** Everyone who started, so names survive people leaving. */
    everyone: CartridgePlayer[];
    /** Everyone still at the table, in seat order. */
    players: CartridgePlayer[];
    /** Indexes into the card bank: the opening cards first, then one to place each round. */
    order: number[];
    /** The cards in the row, as indexes into the bank, earliest year first. */
    row: number[];
    /** The round being played, from zero. */
    round: number;
    /** The gap each player picked, from zero (before the first card) to the row's length (after the last). */
    picks: Record<string, number>;
    scores: Record<string, number>;
    last: PlacedResult | null;
    result: LineResult | null;
}

/** The pause action's id. */
export const LINE_GIVE_UP_ACTION: string = "giveup";

/** The prefix on a gap's option id. */
export const SLOT_PREFIX: string = "slot:";

/** Decision ids a rehearsal names when it explains a moment. */
export const LINE_DECISIONS: { cards: string; rounds: string; place: string; reveal: string; points: string; giveUp: string } = {
    cards: "cards",
    rounds: "rounds",
    place: "placeSeconds",
    reveal: "revealSeconds",
    points: "points",
    giveUp: "giveUp",
};

/** How a card is numbered in words, so no digit on the screen can be mistaken for a date. */
const ORDINALS: readonly string[] = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

/** The characters a card's name, short name, source or surprise may use. */
const LINE_PATTERN: RegExp = /^[\p{L}\p{N} '’,.;:?()/–-]+$/u;

/**
 * Finds the gap a year belongs in.
 * @param years the years of the cards in the row, earliest first.
 * @param year the new card's year.
 * @returns the gap, from zero to the row's length.
 */
export function slotFor(years: readonly number[], year: number): number {
    return years.filter((other: number) => other < year).length;
}

/**
 * Works out who placed a card exactly, who was one gap off, and what everyone won. The only place a round is scored.
 * @param picks each player's gap.
 * @param slot the right gap.
 * @param points what each is worth.
 * @returns the result.
 */
export function scorePicks(picks: Readonly<Record<string, number>>, slot: number, points: LineDecisions["points"]): PlacedResult {
    const players: string[] = Object.keys(picks);
    const exact: string[] = players.filter((playerId: string) => picks[playerId] === slot);
    const adjacent: string[] = players.filter((playerId: string) => Math.abs((picks[playerId] ?? -9) - slot) === 1);
    const gains: Record<string, number> = {};
    for (const playerId of exact) {
        gains[playerId] = points.exact;
    }
    for (const playerId of adjacent) {
        gains[playerId] = points.adjacent;
    }
    return { slot, exact, adjacent, gains: Object.fromEntries(Object.entries(gains).filter(([, gain]: [string, number]) => gain > 0)) };
}

/**
 * Names a gap for a button, with the years of the cards either side so nobody has to look up.
 * @param row the cards in the row, earliest first.
 * @param cards the card bank.
 * @param slot the gap.
 * @returns the label.
 */
export function slotLabel(row: readonly number[], cards: readonly LineCard[], slot: number): string {
    const before: LineCard | undefined = cards[row[slot - 1] ?? -1];
    const after: LineCard | undefined = cards[row[slot] ?? -1];
    const named = (card: LineCard): string => `${card.short} (${card.year})`;
    if (before === undefined && after !== undefined) {
        return `Before ${named(after)}`;
    }
    if (after === undefined && before !== undefined) {
        return `After ${named(before)}`;
    }
    return before === undefined || after === undefined ? "Anywhere" : `Between ${named(before)} and ${named(after)}`;
}

/**
 * The words for a gap in the middle of a sentence: only the first letter drops to lower case, so names keep theirs.
 * @param label a gap's label.
 * @returns the label for a sentence.
 */
export function inSentence(label: string): string {
    return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/**
 * Checks one card.
 * @param card the card.
 * @returns the problems, in plain words.
 */
function cardProblems(card: LineCard): string[] {
    const problems: string[] = [];
    const named: string = `Card ${card.id}`;
    if (/^[a-zA-Z]+$/.test(card.id) === false) {
        problems.push("A card's id must be letters only.");
    }
    if (card.name.length < 6 || card.name.length > 56 || LINE_PATTERN.test(card.name) === false || /\d/.test(card.name) === true) {
        problems.push(`${named} needs a name of 6 to 56 plain characters with no digits.`);
    }
    if (card.short.length < 3 || card.short.length > 30 || LINE_PATTERN.test(card.short) === false || /\d/.test(card.short) === true) {
        problems.push(`${named} needs a short name of 3 to 30 plain characters with no digits.`);
    }
    if (card.tag.length < 3 || card.tag.length > 17 || LINE_PATTERN.test(card.tag) === false || /\d/.test(card.tag) === true) {
        problems.push(`${named} needs a tag of 3 to 17 plain characters with no digits.`);
    }
    if (isWholeIn(card.year, 1000, 2100) === false) {
        problems.push(`${named} needs a whole year from 1000 to 2100.`);
    }
    for (const [field, text] of [["source", card.source], ["surprise", card.surprise ?? "A plain placeholder line."]] as const) {
        if (text.trim().length < 8 || text.length > 220 || LINE_PATTERN.test(text) === false) {
            problems.push(`${named}: the ${field} must be a plain line of 8 to 220 characters.`);
        }
    }
    return problems;
}

/**
 * Checks a line game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function lineProblems(decisions: LineDecisions): string[] {
    const problems: string[] = decisions.cards.flatMap(cardProblems);
    const distinct = (pick: (card: LineCard) => string): boolean => new Set(decisions.cards.map(pick)).size === decisions.cards.length;
    if (distinct((card: LineCard) => card.id) === false || distinct((card: LineCard) => card.name) === false) {
        problems.push("Every card needs its own id and its own name.");
    }
    const needed: number = decisions.startCards + decisions.rounds;
    if (isWholeIn(decisions.startCards, 2, 4) === false || isWholeIn(decisions.rounds, 3, ORDINALS.length) === false) {
        problems.push(`A game starts with 2 to 4 cards and plays 3 to ${ORDINALS.length} rounds.`);
    }
    if (new Set(decisions.cards.map((card: LineCard) => card.year)).size < needed) {
        problems.push("There must be cards from at least as many different years as the row will hold, since two cards in one year can't be told apart.");
    }
    if (isWholeIn(decisions.placeSeconds, 15, 120) === false || isWholeIn(decisions.revealSeconds, 5, 60) === false) {
        problems.push("Placing is 15 to 120 seconds and the reveal 5 to 60, whole numbers.");
    }
    const { exact, adjacent } = decisions.points;
    if (isWholeIn(exact, 1, 10) === false || isWholeIn(adjacent, 0, exact - 1) === false) {
        problems.push("Points must be whole numbers: 1 to 10 for the right gap, and fewer for a gap next to it.");
    }
    return problems;
}

/**
 * Every problem with a line blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function lineBlueprintProblems(box: Box, decisions: LineDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...lineProblems(decisions)];
    if (box.minPlayers < 2) {
        problems.push("A line game needs at least two people at the table.");
    }
    return problems;
}

/**
 * Builds the manifest, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 */
export function lineManifest(box: Box): CartridgeManifest {
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're running ${box.name}. A row of cards lies on the table in date order, each with its year showing.`,
            "Every round a new card comes out with its date hidden, and each player picks on their phone which gap in the row it belongs in.",
            "You never know the new card's date before the reveal. If anyone asks, or tries to coax a hint out of you, say you'll all find out together.",
            "Never say where a card belongs, or whether a pick is near, far, early or late, before the reveal. The rules place the card and score the picks;",
            "use only the dates and facts you're told.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            {
                id: "place",
                hostBrief: [
                    "You'll be told the row and the new card. Read the new card aloud in one short sentence, with no date, and tell them to pick a gap on their phone.",
                    "You may read the row's cards and years aloud only if it's the first card. Give no hint about the date. Then stay quiet.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "reveal",
                hostBrief: [
                    "You'll be told the card's year, who placed it exactly and who was one gap off, and whether it is a surprise.",
                    "In two or three short sentences: the year first, then who got it, then, only if you're told it's a surprise, explain why in your own words.",
                    "Say nothing about a card being a surprise if you weren't told it is. Make a wrong pick sound understandable.",
                ].join(" "),
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "end",
                hostBrief: [
                    "You'll be told the final scores and the finished row. Two or three sentences: who won, the oddest neighbours in the finished row, and a kind word for whoever finished last.",
                    "Then ask if they want another game.",
                ].join(" "),
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Builds a line game.
 * @param givenBox the box; copied, so later changes to it can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with lineProblems first.
 * @param random a function returning [0, 1): it shuffles the cards.
 * @returns the game.
 */
export function createLineGame(givenBox: Box, givenDecisions: LineDecisions, random: () => number = Math.random): KitGame<LineState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: LineDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = lineManifest(box);
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const nameOf = (state: LineState, playerId: string): string => state.everyone.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const cardAt = (index: number): LineCard => decisions.cards[index] as LineCard;
    const current = (state: LineState): LineCard => cardAt(state.order[decisions.startCards + state.round] ?? 0);
    const ids = (players: readonly CartridgePlayer[]): string[] => players.map((player: CartridgePlayer) => player.playerId);
    const ordinal = (round: number): string => ORDINALS[round] ?? "next";
    const rowText = (state: LineState): string => state.row.map((index: number) => `${cardAt(index).name}, ${cardAt(index).year}`).join("; ");
    const labels = (state: LineState): string[] => Array.from({ length: state.row.length + 1 }, (_unused: unknown, slot: number) => slotLabel(state.row, decisions.cards, slot));
    const ranking = (state: LineState): string[] => ids(state.players).sort((first: string, second: string) => (state.scores[second] ?? 0) - (state.scores[first] ?? 0));

    /**
     * Whether everyone at the table has picked.
     * @param state the state.
     * @returns true when all have.
     */
    const allPicked = (state: LineState): boolean => state.players.length > 0 && state.players.every((player: CartridgePlayer) => state.picks[player.playerId] !== undefined);

    /**
     * Puts a new card out.
     * @param state the state with the round set.
     * @param decision the decision behind it.
     * @returns the step.
     */
    const deal = (state: LineState, decision: string): Step<LineState> => {
        const card: LineCard = current(state);
        const next: LineState = { ...state, phase: "place", picks: {}, last: null };
        const opening: string = state.round === 0 ? ` The row on the table, earliest first: ${rowText(state)}. Read it out.` : "";
        const text: string = `This is the ${ordinal(state.round)} new card: "${card.name}".${opening} Read the card, with no date, and tell them to pick a gap on their phone.`;
        return { state: next, facts: because(publicFact("card", text), decision), nextPhaseId: "place", timers: { place: decisions.placeSeconds } };
    };

    /**
     * Ends the game with the standings and the finished row.
     * @param state the state.
     * @param result how it ended.
     * @param decision the decision behind it.
     * @returns the step.
     */
    const finish = (state: LineState, result: LineResult, decision: string): Step<LineState> => {
        const ended: LineState = { ...state, phase: "end", result };
        const standings: string = ranking(ended).map((playerId: string) => `${nameOf(ended, playerId)} ${ended.scores[playerId] ?? 0}`).join(", ");
        const text: string = [
            `${result === "stopped" ? "They stopped early." : "That was the last card."} Final scores, best first: ${standings}.`,
            `The finished row, earliest first: ${rowText(ended)}. Give the result, then ask if they want another game.`,
        ].join(" ");
        return { state: ended, facts: because(publicFact("game-over", text), decision), nextPhaseId: "end" };
    };

    /**
     * Places the card, scores the picks and shows the date.
     * @param state the state in placing.
     * @returns the step.
     */
    const reveal = (state: LineState): Step<LineState> => {
        const card: LineCard = current(state);
        const slot: number = slotFor(state.row.map((index: number) => cardAt(index).year), card.year);
        const result: PlacedResult = scorePicks(state.picks, slot, decisions.points);
        const scores: Record<string, number> = { ...state.scores };
        for (const [playerId, gain] of Object.entries(result.gains)) {
            scores[playerId] = (scores[playerId] ?? 0) + gain;
        }
        const cardIndex: number = state.order[decisions.startCards + state.round] ?? 0;
        const row: number[] = [...state.row.slice(0, slot), cardIndex, ...state.row.slice(slot)];
        const next: LineState = { ...state, phase: "reveal", row, scores, last: result };
        const names = (list: string[]): string => (list.length === 0 ? "nobody" : list.map((playerId: string) => nameOf(state, playerId)).join(" and "));
        const text: string = [
            `The card "${card.name}" belongs in the year ${card.year}.`,
            `Exactly right: ${names(result.exact)}. One gap off: ${names(result.adjacent)}.`,
            card.surprise === null ? "" : `This one surprises people. Explain it in your own words: ${card.surprise}`,
        ].filter((line: string) => line !== "").join(" ");
        return { state: next, facts: because(publicFact("placed", text), LINE_DECISIONS.points), nextPhaseId: "reveal", timers: { reveal: decisions.revealSeconds } };
    };

    /**
     * Someone left.
     * @param state the state.
     * @param playerId who.
     * @returns the step.
     */
    const left = (state: LineState, playerId: string): Step<LineState> => {
        if (state.phase === "end" || ids(state.players).includes(playerId) === false) {
            return { state, facts: [] };
        }
        const players: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => player.playerId !== playerId);
        const { [playerId]: _pick, ...picks } = state.picks;
        const next: LineState = { ...state, players, picks: state.phase === "place" ? picks : state.picks };
        if (players.length === 0) {
            return finish(next, "stopped", LINE_DECISIONS.giveUp);
        }
        return next.phase === "place" && allPicked(next) === true ? reveal(next) : { state: next, facts: [] };
    };

    const cartridge: Cartridge<LineState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<LineState> {
            const shuffled: number[] = decisions.cards.map((_card: LineCard, index: number) => index);
            for (let index = shuffled.length - 1; index > 0; index -= 1) {
                const swap: number = Math.floor(random() * (index + 1));
                [shuffled[index], shuffled[swap]] = [shuffled[swap] as number, shuffled[index] as number];
            }
            const order: number[] = [];
            const years: Set<number> = new Set();
            for (const index of shuffled) {
                const year: number = cardAt(index).year;
                if (years.has(year) === false && order.length < decisions.startCards + decisions.rounds) {
                    years.add(year);
                    order.push(index);
                }
            }
            const row: number[] = order.slice(0, decisions.startCards).sort((first: number, second: number) => cardAt(first).year - cardAt(second).year);
            const state: LineState = {
                phase: "place",
                everyone: players,
                players,
                order,
                row,
                round: 0,
                picks: {},
                scores: Object.fromEntries(players.map((player: CartridgePlayer) => [player.playerId, 0])),
                last: null,
                result: null,
            };
            return deal(state, LINE_DECISIONS.cards);
        },

        phaseOf(state: LineState): string {
            return state.phase;
        },

        turn(state: LineState): Turn | null {
            if (state.phase === "place") {
                return { kind: "everyone", playerIds: ids(state.players), doneIds: Object.keys(state.picks), label: "Pick a gap on your phone" };
            }
            return null;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: LineState, playerId: string): LegalAction[] {
            const actions: LegalAction[] = [];
            if (state.phase === "place" && ids(state.players).includes(playerId) === true && state.picks[playerId] === undefined) {
                actions.push(...labels(state).map((label: string, slot: number) => ({ actionId: `${SLOT_PREFIX}${slot}`, label })));
            }
            if (state.phase === "place" && decisions.giveUpButton === true) {
                actions.push({ actionId: LINE_GIVE_UP_ACTION, label: "We give up" });
            }
            return actions;
        },

        apply(state: LineState, playerId: string, actionId: string): Step<LineState> {
            if (state.phase !== "place") {
                return { state, facts: [] };
            }
            if (decisions.giveUpButton === true && actionId === LINE_GIVE_UP_ACTION) {
                return finish(state, "stopped", LINE_DECISIONS.giveUp);
            }
            const slot: number = Number(actionId.slice(SLOT_PREFIX.length));
            const valid: boolean = actionId.startsWith(SLOT_PREFIX) === true && /^\d+$/.test(actionId.slice(SLOT_PREFIX.length)) === true && slot <= state.row.length;
            if (valid === false || ids(state.players).includes(playerId) === false || state.picks[playerId] !== undefined) {
                return { state, facts: [] };
            }
            const next: LineState = { ...state, picks: { ...state.picks, [playerId]: slot } };
            return allPicked(next) === true ? reveal(next) : { state: next, facts: [] };
        },

        onEvent(state: LineState, event: RoomEvent): Step<LineState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "timerFired" && event.timerId === "place" && state.phase === "place") {
                return reveal(state);
            }
            if (event.type === "timerFired" && event.timerId === "reveal" && state.phase === "reveal") {
                return state.round + 1 >= decisions.rounds ? finish(state, "played", LINE_DECISIONS.rounds) : deal({ ...state, round: state.round + 1 }, LINE_DECISIONS.rounds);
            }
            return { state, facts: [] };
        },

        publicScene(state: LineState): Scene {
            const standings: SceneTallyRow[] = ranking(state).map((playerId: string): SceneTallyRow => ({ label: nameOf(state, playerId), count: state.scores[playerId] ?? 0 }));
            const table = (highlight: LineCard | null): SceneTallyRow[] => state.row.map((index: number): SceneTallyRow => {
                return { label: cardAt(index).tag, count: cardAt(index).year, highlight: highlight !== null && cardAt(index) === highlight };
            });
            if (state.phase === "place") {
                const card: LineCard = current(state);
                return {
                    mood: "neutral",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: card.name, kicker: `The ${ordinal(state.round)} card` },
                        { type: "tally", title: "On the table, earliest first", rows: table(null) },
                        { type: "timer", seconds: decisions.placeSeconds, label: "to pick", running: true },
                    ],
                };
            }
            if (state.phase === "reveal") {
                const card: LineCard = current(state);
                const result: PlacedResult | null = state.last;
                const names = (list: string[]): string => list.map((playerId: string) => nameOf(state, playerId)).join(", ");
                const verdict: string = result === null || result.exact.length === 0 ? "Nobody had the right gap." : `Right gap: ${names(result.exact)}.`;
                const blocks: SceneBlock[] = [
                    { type: "title", text: card.name, kicker: `It was ${card.year}` },
                    { type: "tally", title: "The row, earliest first", rows: table(card) },
                    { type: "text", text: verdict, emphasis: "large" },
                ];
                if (card.surprise !== null) {
                    blocks.push({ type: "text", text: card.surprise });
                }
                return { mood: "victory", transition: "fade", blocks };
            }
            const top: number = standings[0]?.count ?? 0;
            return {
                mood: "victory",
                transition: "fade",
                blocks: [
                    { type: "title", text: "Final scores", kicker: box.name },
                    { type: "tally", title: "Best first", rows: standings.map((row: SceneTallyRow): SceneTallyRow => ({ ...row, highlight: row.count === top && top > 0 })) },
                    { type: "tally", title: "The finished row", rows: table(null) },
                ],
            };
        },

        privateControls(state: LineState, playerId: string): Control[] {
            const seated: boolean = ids(state.players).includes(playerId) === true;
            if (state.phase === "place") {
                const picked: number | undefined = state.picks[playerId];
                if (seated === false || picked !== undefined) {
                    return [{ type: "waiting", text: picked === undefined ? "Watching." : `You put it ${inSentence(slotLabel(state.row, decisions.cards, picked))}. Waiting for the others.` }];
                }
                const options: ControlOption[] = labels(state).map((label: string, slot: number): ControlOption => ({ id: `${SLOT_PREFIX}${slot}`, label }));
                return [{ type: "choice", prompt: `${current(state).name}. Where does it go?`, options, multiple: false }];
            }
            const gain: number = state.last?.gains[playerId] ?? 0;
            const score: number = state.scores[playerId] ?? 0;
            if (state.phase === "reveal") {
                const how: string = state.last?.exact.includes(playerId) === true ? "Right gap." : state.last?.adjacent.includes(playerId) === true ? "One gap off." : "Not that time.";
                return [{ type: "waiting", text: `${how} ${gain > 0 ? `You won ${gain} ${gain === 1 ? "point" : "points"}. ` : ""}You're on ${score}.` }];
            }
            return [{ type: "waiting", text: `You finished on ${score}. Look at the screen.` }];
        },

        hostFacts(state: LineState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase === "end") {
                return [];
            }
            const card: LineCard = current(state);
            if (state.phase === "reveal") {
                return [
                    { scope: { kind: "public" }, kind: "row", text: `The row now, earliest first: ${rowText(state)}.` },
                    { scope: { kind: "host" }, kind: "year", text: `"${card.name}" belongs in ${card.year}. Source: ${card.source}.` },
                ];
            }
            return [
                { scope: { kind: "public" }, kind: "row", text: `The row on the table, earliest first: ${rowText(state)}.` },
                { scope: { kind: "public" }, kind: "card", text: `The new card is "${card.name}".` },
                { scope: { kind: "host" }, kind: "unknown", text: "You do not know the new card's year. Don't guess it, hint at it or react to anyone's pick." },
            ];
        },

        outcome(state: LineState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            const top: number = Math.max(0, ...Object.values(state.scores));
            const winners: string[] = ranking(state).filter((playerId: string) => (state.scores[playerId] ?? 0) === top).map((playerId: string) => nameOf(state, playerId));
            return top === 0 ? "Nobody scored." : `${winners.join(" and ")} won with ${top}.`;
        },
    };

    return {
        cartridge,
        hidden(state: LineState): HiddenValue[] {
            if (state.phase !== "place") {
                return [];
            }
            const card: LineCard = current(state);
            const year: HiddenValue = { label: "the new card's year", text: String(card.year), seenBy: [] };
            // Two players with the same pick see the same words on their own phones, which is no leak.
            const shared = (slot: number): boolean => Object.values(state.picks).filter((other: number) => other === slot).length > 1;
            const alone: [string, number][] = Object.entries(state.picks).filter(([, slot]: [string, number]) => shared(slot) === false);
            const picks: HiddenValue[] = alone.map(([playerId, slot]: [string, number]): HiddenValue => ({
                label: "a player's pick",
                text: `You put it ${inSentence(slotLabel(state.row, decisions.cards, slot))}.`,
                seenBy: [playerId],
            }));
            return [year, ...picks];
        },
    };
}
