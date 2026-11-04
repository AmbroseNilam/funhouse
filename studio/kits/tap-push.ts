// Magpie Pockets, a push-your-luck tap game. Every player holds a pocket of trinkets drawn from one
// shared deck. Each beat everyone secretly chooses to draw or stay; one card is then flipped for
// everyone who drew. A trinket you already hold is a bust and the pocket scores nothing; staying
// banks the pocket. At the end of a round, the first to reach the target wins (highest if several).
// Code shuffles, flips, busts, banks and counts; the host only narrates what it is told, and never
// knows a choice before the flip.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { RosterEntry, Scene, SceneBlock } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Turn } from "../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { boxProblems, isShortText, isWholeIn, type Box, type HiddenValue, type KitGame } from "../kit/kit.ts";
import { because, frozenCopy } from "../kit/primitives.ts";
import { ballot, isUsableLine, linesToPlay, nameIn, parseLines, scoreboard } from "./tap.ts";

/** One kind of trinket in the deck. */
export interface PushCard {
    name: string;
    /** Points it adds to a pocket. */
    value: number;
    /** How many of this kind are in the deck. */
    copies: number;
}

/** Everything a creator may choose for a push-your-luck game. */
export interface PushDecisions {
    style: "push";
    /** Banked points that end the game at the end of a round. */
    target: number;
    /** Rounds after which the game ends whatever the scores. */
    maxRounds: number;
    /** Seconds to choose draw or stay. */
    chooseSeconds: number;
    /** Seconds each flip stays up while the host talks. */
    revealSeconds: number;
    /** Seconds the scores stay up at the end of a round. */
    roundEndSeconds: number;
    /** The kinds of trinket; a fresh deck of every copy is shuffled each round. */
    cards: PushCard[];
    /** Lines for the screen and the host to riff on while people choose, when the model writes too few. */
    lines: string[];
}

/** The phases of the game. */
export type PushPhase = "writing" | "choosing" | "reveal" | "end";

/** Where a player stands in the round. */
export type PushStanding = "in" | "stayed" | "bust";

/** What a player decided for a beat. */
export type PushChoice = "draw" | "stay";

/** The whole game, immutable between steps. */
export interface PushState {
    phase: PushPhase;
    players: CartridgePlayer[];
    lines: string[];
    /** Which round, from 0. */
    round: number;
    /** Beats played over the game; makes every clock's id unique. */
    beat: number;
    /** Cards flipped this round, the free first one included. */
    flips: number;
    /** What is left of this round's deck, next card first, as indexes into the cards. Never shown. */
    deck: number[];
    /** Kinds flipped this round, so a hidden check knows what is already on show. */
    seen: number[];
    /** Each player's pocket this round, as card indexes. */
    hands: Record<string, number[]>;
    standing: Record<string, PushStanding>;
    /** This beat's choices, by player id. Never shown. */
    choices: Record<string, PushChoice>;
    /** The card flipped most recently, or null before a round's first. */
    last: number | null;
    /** The card flipped at this reveal, or null when nobody drew. */
    flipped: number | null;
    /** Points banked this round, by player id. */
    roundBanked: Record<string, number>;
    /** What a bust cost, by player id, this round. */
    lost: Record<string, number>;
    /** Who banked, drew or busted at the latest reveal. */
    results: { playerId: string; result: "drew" | "stayed" | "bust" }[];
    roundOver: boolean;
    banked: Record<string, number>;
}

/** The prefix on a choice's action id. */
export const PUSH_PREFIX: string = "push:";

/** Decision ids a rehearsal names when it explains a moment. */
export const PUSH_DECISIONS: { target: string; rounds: string; choose: string; reveal: string; lines: string } = {
    target: "target",
    rounds: "maxRounds",
    choose: "chooseSeconds",
    reveal: "revealSeconds",
    lines: "lines",
};

/** How many tension lines a game keeps. */
const LINES_KEPT: number = 20;

/**
 * Checks a push-your-luck game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function pushProblems(decisions: PushDecisions): string[] {
    const problems: string[] = [];
    if (isWholeIn(decisions.target, 10, 100) === false || isWholeIn(decisions.maxRounds, 2, 12) === false) {
        problems.push("The target is a whole number of points from 10 to 100 and the game plays 2 to 12 rounds.");
    }
    if (isWholeIn(decisions.chooseSeconds, 5, 40) === false || isWholeIn(decisions.revealSeconds, 2, 20) === false || isWholeIn(decisions.roundEndSeconds, 3, 30) === false) {
        problems.push("Choosing takes 5 to 40 seconds, a flip 2 to 20 and a round's scores 3 to 30, in whole seconds.");
    }
    const names: string[] = decisions.cards.map((card: PushCard) => card.name.toLowerCase());
    if (decisions.cards.length < 6 || decisions.cards.length > 14 || new Set(names).size !== names.length) {
        problems.push("There are 6 to 14 kinds of trinket, each with its own name.");
    }
    if (decisions.cards.some((card: PushCard) => isShortText(card.name) === false || isWholeIn(card.value, 1, 12) === false || isWholeIn(card.copies, 2, 4) === false) === true) {
        problems.push("Each trinket has a short plain name, a value from 1 to 12 and 2 to 4 copies.");
    }
    if (decisions.lines.length < 6 || decisions.lines.some((line: string) => isUsableLine(line) === false || line.includes("!") === true) === true) {
        problems.push("There must be at least six usable fallback lines, each short, plain and without shouting.");
    }
    return problems;
}

/**
 * Every problem with a push-your-luck blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function pushBlueprintProblems(box: Box, decisions: PushDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...pushProblems(decisions)];
    if (box.minPlayers < 3) {
        problems.push("A push-your-luck game needs at least three people to have a table to read.");
    }
    return problems;
}

/**
 * Builds the manifest, with every host line from the kit.
 * @param box the box.
 * @param decisions the decisions, for the target.
 * @returns the manifest.
 */
export function pushManifest(box: Box, decisions: PushDecisions): CartridgeManifest {
    const listening: Record<string, "holdToTalk"> = { "*": "holdToTalk" };
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're hosting ${box.name}. Everyone keeps a pocket of trinkets drawn from one shared deck.`,
            "Each beat they all secretly choose to draw or stay, then one card is flipped for everyone who drew.",
            `A trinket you already hold is a bust and the pocket scores nothing; staying banks the pocket. The first to bank ${decisions.target} by the end of a round wins.`,
            "Code shuffles, flips, busts and counts. You never know or guess what anyone chose before the flip, so never say who is staying.",
            "Your tone: dry, quick and delighted by greed. Before each call build a little suspense in one or two short sentences: name the biggest pocket and the odds you are given, nothing more.",
            "After a flip, cheer a bank, wince kindly at a bust, and keep moving. Tease the pocket, never the person. No remarks about anyone's looks, body, money, age or love life. Never use exclamation marks.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            { id: "writing", hostBrief: "The deck is being shuffled. One short line at most, then wait.", listening, hostMayInterject: false, silenceSeconds: 0 },
            { id: "choosing", hostBrief: "Players are choosing in secret. Say the line you were given, then reply exactly (quiet) unless someone speaks to you.", listening, hostMayInterject: false, silenceSeconds: 0 },
            { id: "reveal", hostBrief: "You'll be told the flip and what happened to each player. React in one or two short sentences, then build suspense for the next call if you are told the round goes on.", listening, hostMayInterject: true, silenceSeconds: 0 },
            { id: "end", hostBrief: "The game is over. Two sentences: congratulate the winner dryly and say something kind about the closest pocket. Then ask if they want another game.", listening, hostMayInterject: true, silenceSeconds: 0 },
        ],
    };
}

/**
 * Builds a push-your-luck game.
 * @param givenBox the box; copied.
 * @param givenDecisions the decisions; copied. Check them with pushBlueprintProblems first.
 * @param random a function returning [0, 1), for shuffling.
 * @returns the game.
 */
export function createPushGame(givenBox: Box, givenDecisions: PushDecisions, random: () => number = Math.random): KitGame<PushState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: PushDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = pushManifest(box, decisions);
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });

    /**
     * A card as the screen writes it.
     * @param index the card's index.
     * @returns its name and value.
     */
    const cardText = (index: number): string => `${decisions.cards[index]?.name ?? "Something"} (${decisions.cards[index]?.value ?? 0})`;

    /**
     * What a pocket is worth.
     * @param hand the cards in it.
     * @returns the points.
     */
    const worth = (hand: readonly number[]): number => hand.reduce((total: number, index: number) => total + (decisions.cards[index]?.value ?? 0), 0);

    /**
     * How many cards left in the deck would bust a player.
     * @param state the state.
     * @param playerId the player.
     * @returns the count.
     */
    const dangerous = (state: PushState, playerId: string): number => {
        const hand: number[] = state.hands[playerId] ?? [];
        return state.deck.filter((index: number) => hand.includes(index) === true).length;
    };

    /**
     * A shuffled deck of every copy of every card.
     * @returns the card indexes.
     */
    const shuffledDeck = (): number[] => {
        const deck: number[] = decisions.cards.flatMap((card: PushCard, index: number) => Array.from({ length: card.copies }, (): number => index));
        for (let position = deck.length - 1; position > 0; position -= 1) {
            const other: number = Math.floor(random() * (position + 1));
            const held: number = deck[position] ?? 0;
            deck[position] = deck[other] ?? 0;
            deck[other] = held;
        }
        return deck;
    };

    /**
     * The players still choosing this round.
     * @param state the state.
     * @returns their ids.
     */
    const stillIn = (state: PushState): string[] => state.players.filter((player: CartridgePlayer) => state.standing[player.playerId] === "in").map((player: CartridgePlayer) => player.playerId);

    /**
     * Names joined the way a person says them.
     * @param state the state.
     * @param ids the players.
     * @returns "A", "A and B" or "A, B and C".
     */
    const namesOf = (state: PushState, ids: readonly string[]): string => {
        const names: string[] = ids.map((id: string) => nameIn(state.players, id));
        return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
    };

    /**
     * The player or players with the most banked.
     * @param state the state.
     * @returns their ids, and the score.
     */
    const leaders = (state: PushState): { ids: string[]; score: number } => {
        const score: number = Math.max(0, ...state.players.map((player: CartridgePlayer) => state.banked[player.playerId] ?? 0));
        const tied: string[] = state.players.filter((player: CartridgePlayer) => (state.banked[player.playerId] ?? 0) === score).map((player: CartridgePlayer) => player.playerId);
        return { ids: score === 0 ? [] : tied, score };
    };

    /**
     * The line to put up while people choose.
     * @param state the state.
     * @returns a line from the model's or the bank.
     */
    const tensionLine = (state: PushState): string => state.lines[(state.round * 7 + state.beat) % Math.max(1, state.lines.length)] ?? "";

    /**
     * The stakes in words for the host: the biggest pockets and their odds, from code.
     * @param state the state.
     * @returns a sentence, or an empty string when nobody is in.
     */
    const stakes = (state: PushState): string => {
        const ranked: string[] = stillIn(state).sort((first: string, second: string) => worth(state.hands[second] ?? []) - worth(state.hands[first] ?? []));
        const parts: string[] = ranked.slice(0, 3).map((id: string): string => {
            const odds: number = Math.round((100 * dangerous(state, id)) / Math.max(1, state.deck.length));
            return `${nameIn(state.players, id)} holds ${worth(state.hands[id] ?? [])} with a ${odds} percent chance the next card busts them`;
        });
        return parts.length === 0 ? "" : `${parts.join("; ")}.`;
    };

    /**
     * What happens at the end of a beat's reveal, in words for the host.
     * @param state the state after the flip.
     * @returns a sentence.
     */
    const resultWords = (state: PushState): string => {
        const group = (result: "drew" | "stayed" | "bust"): string[] => state.results.filter((row) => row.result === result).map((row) => row.playerId);
        const parts: string[] = [];
        if (state.flipped !== null) {
            parts.push(`The card flipped is the ${cardText(state.flipped)}.`);
        }
        const busted: string[] = group("bust");
        if (busted.length > 0) {
            parts.push(`${busted.map((id: string) => `${nameIn(state.players, id)} busted and lost ${state.lost[id] ?? 0}`).join("; ")}.`);
        }
        const stayed: string[] = group("stayed");
        if (stayed.length > 0) {
            parts.push(`${stayed.map((id: string) => `${nameIn(state.players, id)} stayed and banked ${state.roundBanked[id] ?? 0}`).join("; ")}.`);
        }
        const drew: string[] = group("drew");
        if (drew.length > 0) {
            parts.push(`${namesOf(state, drew)} drew safely.`);
        }
        if (state.flipped === null) {
            parts.push("Nobody drew.");
        }
        return parts.join(" ");
    };

    /**
     * Opens a round: a fresh deck, and the first card flipped free for everyone.
     * @param state the state.
     * @param round which round.
     * @param decision the decision that opened it.
     * @returns the step.
     */
    const openRound = (state: PushState, round: number, decision: string): Step<PushState> => {
        const deck: number[] = shuffledDeck();
        const first: number = deck.shift() ?? 0;
        const ids: string[] = state.players.map((player: CartridgePlayer) => player.playerId);
        const next: PushState = {
            ...state,
            phase: "choosing",
            round,
            beat: state.beat + 1,
            flips: 1,
            deck,
            seen: [first],
            hands: Object.fromEntries(ids.map((id: string): [string, number[]] => [id, [first]])),
            standing: Object.fromEntries(ids.map((id: string): [string, PushStanding] => [id, "in"])),
            choices: {},
            last: first,
            flipped: null,
            roundBanked: {},
            lost: {},
            results: [],
            roundOver: false,
        };
        const text: string = [
            `Round ${round + 1}. Everyone starts with the ${cardText(first)}, flipped free.`,
            `First to ${decisions.target} banked wins at the end of a round.`,
            "Tell them to draw or stay, in one or two short sentences, and build a little suspense.",
            `A line to use or riff on: ${tensionLine(next)}`,
        ].join(" ");
        return { state: next, facts: because(publicFact("round", text), decision), nextPhaseId: "choosing", timers: { [`choose${next.beat}`]: decisions.chooseSeconds } };
    };

    /**
     * Ends the game with the scores.
     * @param state the state.
     * @returns the step.
     */
    const finish = (state: PushState): Step<PushState> => {
        const top: { ids: string[]; score: number } = leaders(state);
        const text: string =
            top.ids.length === 0
                ? "The game is over and nobody banked a single point. Be kind about it."
                : `The game is over. ${namesOf(state, top.ids)} ${top.ids.length === 1 ? "wins" : "share the win"} with ${top.score} banked.`;
        return { state: { ...state, phase: "end" }, facts: because(publicFact("game-over", text), PUSH_DECISIONS.target), nextPhaseId: "end" };
    };

    /**
     * Settles a beat: stayers bank, one card is flipped for everyone who drew, repeats bust.
     * @param state the state while choosing.
     * @param decision the decision behind it.
     * @returns the step, in the reveal phase.
     */
    const resolve = (state: PushState, decision: string): Step<PushState> => {
        const hands: Record<string, number[]> = { ...state.hands };
        const standing: Record<string, PushStanding> = { ...state.standing };
        const banked: Record<string, number> = { ...state.banked };
        const roundBanked: Record<string, number> = { ...state.roundBanked };
        const lost: Record<string, number> = { ...state.lost };
        const results: { playerId: string; result: "drew" | "stayed" | "bust" }[] = [];
        const choosing: string[] = stillIn(state);
        const drawing: string[] = choosing.filter((id: string) => state.choices[id] === "draw" && state.deck.length > 0);
        for (const id of choosing.filter((candidate: string) => drawing.includes(candidate) === false)) {
            const points: number = worth(hands[id] ?? []);
            standing[id] = "stayed";
            banked[id] = (banked[id] ?? 0) + points;
            roundBanked[id] = points;
            results.push({ playerId: id, result: "stayed" });
        }
        const card: number | undefined = drawing.length === 0 ? undefined : state.deck[0];
        for (const id of drawing) {
            const hand: number[] = hands[id] ?? [];
            if (card !== undefined && hand.includes(card) === true) {
                lost[id] = worth(hand);
                hands[id] = [];
                standing[id] = "bust";
                results.push({ playerId: id, result: "bust" });
                continue;
            }
            hands[id] = card === undefined ? hand : [...hand, card];
            results.push({ playerId: id, result: "drew" });
        }
        const next: PushState = {
            ...state,
            phase: "reveal",
            beat: state.beat + 1,
            flips: card === undefined ? state.flips : state.flips + 1,
            deck: card === undefined ? state.deck : state.deck.slice(1),
            seen: card === undefined || state.seen.includes(card) === true ? state.seen : [...state.seen, card],
            hands,
            standing,
            banked,
            roundBanked,
            lost,
            choices: {},
            last: card ?? state.last,
            flipped: card ?? null,
            results,
        };
        const roundOver: boolean = stillIn(next).length === 0;
        const finished: PushState = { ...next, roundOver };
        const leader: { ids: string[]; score: number } = leaders(finished);
        const tail: string = roundOver
            ? `The round is over. ${leader.ids.length === 0 ? "Nobody has banked yet." : `${namesOf(finished, leader.ids)} lead${leader.ids.length === 1 ? "s" : ""} with ${leader.score} of ${decisions.target}.`} Wrap it up in one short line.`
            : [
                  `Still choosing: ${namesOf(finished, stillIn(finished))}. ${stakes(finished)}`,
                  "Build suspense for the next call in one or two short sentences, then tell them to choose.",
                  `A line to use or riff on: ${tensionLine(finished)}`,
              ].join(" ");
        const text: string = `${resultWords(finished)} ${tail}`;
        return {
            state: finished,
            facts: because(publicFact("reveal", text), decision),
            nextPhaseId: "reveal",
            timers: { [`reveal${finished.beat}`]: roundOver ? decisions.roundEndSeconds : decisions.revealSeconds },
        };
    };

    /**
     * Moves on after a reveal: another beat, the next round, or the end.
     * @param state the state while revealing.
     * @returns the step.
     */
    const advance = (state: PushState): Step<PushState> => {
        if (state.roundOver === true || stillIn(state).length === 0) {
            const top: { ids: string[]; score: number } = leaders(state);
            if (top.score >= decisions.target || state.round + 1 >= decisions.maxRounds || state.players.length === 0) {
                return finish(state);
            }
            return openRound(state, state.round + 1, PUSH_DECISIONS.rounds);
        }
        const next: PushState = { ...state, phase: "choosing", beat: state.beat + 1, flipped: null, choices: {}, results: [] };
        return { state: next, facts: [], nextPhaseId: "choosing", timers: { [`choose${next.beat}`]: decisions.chooseSeconds } };
    };

    /**
     * Someone left: their pocket goes, and the beat settles at once if everyone left has chosen.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: PushState, playerId: string): Step<PushState> => {
        const without = <Value>(record: Readonly<Record<string, Value>>): Record<string, Value> => {
            return Object.fromEntries(Object.entries(record).filter(([id]: [string, Value]) => id !== playerId));
        };
        const next: PushState = {
            ...state,
            players: state.players.filter((player: CartridgePlayer) => player.playerId !== playerId),
            hands: without(state.hands),
            standing: without(state.standing),
            choices: without(state.choices),
            results: state.results.filter((row) => row.playerId !== playerId),
        };
        if (next.phase === "choosing" && next.players.length > 0 && stillIn(next).every((id: string) => next.choices[id] !== undefined) === true) {
            return resolve(next, PUSH_DECISIONS.choose);
        }
        return { state: next, facts: [] };
    };

    /**
     * What a player may choose now: once a beat, while still in.
     * @param state the state.
     * @param playerId the player.
     * @returns the actions.
     */
    const legalFor = (state: PushState, playerId: string): LegalAction[] => {
        if (state.phase !== "choosing" || state.standing[playerId] !== "in" || state.choices[playerId] !== undefined) {
            return [];
        }
        return [
            { actionId: `${PUSH_PREFIX}draw`, label: "Draw a card" },
            { actionId: `${PUSH_PREFIX}stay`, label: `Stay and bank ${worth(state.hands[playerId] ?? [])}` },
        ];
    };

    /**
     * One chip for a player on the TV, in seat order: their pocket, or what became of it.
     * @param state the state.
     * @param playerId the player.
     * @returns the chip.
     */
    const chipFor = (state: PushState, playerId: string): RosterEntry => {
        const name: string = nameIn(state.players, playerId);
        if (state.standing[playerId] === "stayed") {
            return { playerId, name, speaking: false, muted: false, badge: `banked ${state.roundBanked[playerId] ?? 0}` };
        }
        if (state.standing[playerId] === "bust") {
            return { playerId, name, speaking: false, muted: false, badge: `bust, lost ${state.lost[playerId] ?? 0}` };
        }
        const hand: number[] = state.hands[playerId] ?? [];
        return { playerId, name, speaking: false, muted: false, badge: `${hand.map((index: number) => decisions.cards[index]?.name ?? "").join(", ")} (${worth(hand)})` };
    };

    /**
     * Who leads and what the target is, as one line.
     * @param state the state.
     * @returns the line.
     */
    const standingLine = (state: PushState): string => {
        const top: { ids: string[]; score: number } = leaders(state);
        return top.ids.length === 0 ? `Nobody has banked yet. First to ${decisions.target} wins.` : `${namesOf(state, top.ids)} ${top.ids.length === 1 ? "leads" : "lead"} with ${top.score} banked. First to ${decisions.target} wins.`;
    };

    const cartridge: Cartridge<PushState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<PushState> {
            const state: PushState = {
                phase: "writing",
                players,
                lines: [],
                round: 0,
                beat: 0,
                flips: 0,
                deck: [],
                seen: [],
                hands: {},
                standing: {},
                choices: {},
                last: null,
                flipped: null,
                roundBanked: {},
                lost: {},
                results: [],
                roundOver: false,
                banked: {},
            };
            const request: string = [
                "Write 12 short lines for a dry, delighted party host to say while players secretly decide whether to draw another card or stay and bank their points.",
                "Each is under 80 characters, about greed, nerve or luck, with no names, no card names, no exclamation marks, and nothing about anyone's looks, money, age or love life.",
                "Reply with only a JSON array of strings.",
            ].join(" ");
            return { state, facts: [], nextPhaseId: "writing", contentRequest: request };
        },

        phaseOf(state: PushState): string {
            return state.phase;
        },

        turn(state: PushState): Turn | null {
            return state.phase === "choosing" ? { kind: "everyone", playerIds: stillIn(state), doneIds: Object.keys(state.choices), label: "Draw or stay" } : null;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: PushState, playerId: string): LegalAction[] {
            return legalFor(state, playerId);
        },

        apply(state: PushState, playerId: string, actionId: string): Step<PushState> {
            if (legalFor(state, playerId).some((action: LegalAction) => action.actionId === actionId) === false) {
                return { state, facts: [] };
            }
            const choice: PushChoice = actionId === `${PUSH_PREFIX}draw` ? "draw" : "stay";
            const next: PushState = { ...state, choices: { ...state.choices, [playerId]: choice } };
            return stillIn(next).every((id: string) => next.choices[id] !== undefined) === true ? resolve(next, PUSH_DECISIONS.choose) : { state: next, facts: [] };
        },

        onEvent(state: PushState, event: RoomEvent): Step<PushState> {
            if (event.type === "contentReady" && state.phase === "writing") {
                const lines: string[] = linesToPlay(parseLines(event.text).filter((line: string) => line.includes("!") === false), decisions.lines, LINES_KEPT);
                return openRound({ ...state, lines }, 0, PUSH_DECISIONS.lines);
            }
            if (event.type === "timerFired" && state.phase === "choosing" && event.timerId === `choose${state.beat}`) {
                return resolve(state, PUSH_DECISIONS.choose);
            }
            if (event.type === "timerFired" && state.phase === "reveal" && event.timerId === `reveal${state.beat}`) {
                return advance(state);
            }
            if (event.type === "playerLeft" && state.players.some((player: CartridgePlayer) => player.playerId === event.playerId) === true) {
                return left(state, event.playerId);
            }
            return { state, facts: [] };
        },

        publicScene(state: PushState): Scene {
            if (state.phase === "writing") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: box.name }, { type: "text", text: "Shuffling the deck…", emphasis: "whisper" }] };
            }
            const kicker: string = `Round ${state.round + 1} of ${decisions.maxRounds}`;
            if (state.phase === "end") {
                const top: { ids: string[]; score: number } = leaders(state);
                const title: string = top.ids.length === 0 ? "Empty pockets all round" : `${namesOf(state, top.ids)} ${top.ids.length === 1 ? "takes" : "take"} the pocket`;
                return { mood: "victory", transition: "fade", blocks: [{ type: "title", text: title, kicker: box.name }, scoreboard("Banked", state.players, state.banked)] };
            }
            const pockets: SceneBlock = { type: "roster", players: state.players.map((player: CartridgePlayer): RosterEntry => chipFor(state, player.playerId)) };
            if (state.phase === "choosing") {
                return {
                    mood: "tense",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: "Draw or stay?", kicker: `${kicker}, card ${state.flips}, ${state.deck.length} left` },
                        pockets,
                        { type: "text", text: standingLine(state), emphasis: "whisper" },
                        { type: "timer", seconds: decisions.chooseSeconds, label: "to choose", running: true },
                    ],
                };
            }
            if (state.roundOver === true) {
                return {
                    mood: "dawn",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: `Round ${state.round + 1} is over`, kicker: box.name },
                        { type: "text", text: state.flipped === null ? "Everyone stayed." : `The last card was the ${cardText(state.flipped)}.`, emphasis: "large" },
                        scoreboard(`Banked, first to ${decisions.target}`, state.players, state.banked),
                    ],
                };
            }
            return {
                mood: "dawn",
                transition: "fade",
                blocks: [
                    { type: "title", text: state.flipped === null ? "Nobody drew" : `Flipped: ${cardText(state.flipped)}`, kicker: `${kicker}, card ${state.flips}` },
                    pockets,
                    { type: "text", text: standingLine(state), emphasis: "whisper" },
                ],
            };
        },

        privateControls(state: PushState, playerId: string): Control[] {
            const hand: number[] = state.hands[playerId] ?? [];
            const pocket: string = hand.length === 0 ? "Empty." : hand.map((index: number) => decisions.cards[index]?.name ?? "").join(", ");
            if (legalFor(state, playerId).length > 0) {
                const odds: string = `${dangerous(state, playerId)} of the ${state.deck.length} cards left would bust you.`;
                return [{ type: "roleCard", title: `Your pocket: ${worth(hand)}`, body: `${pocket}. ${odds}`, secret: false }, ballot("Draw or stay?", legalFor(state, playerId).map((action: LegalAction) => ({ id: action.actionId, label: action.label })))];
            }
            const card = (title: string, body: string): Control[] => [{ type: "roleCard", title, body, secret: false }];
            if (state.phase === "choosing" && state.standing[playerId] === "in") {
                return card("Locked in", `You chose to ${state.choices[playerId] ?? "stay"}. The flip is coming.`);
            }
            if (state.phase === "choosing" || state.phase === "reveal") {
                if (state.standing[playerId] === "bust") {
                    return card("Bust", `You lost ${state.lost[playerId] ?? 0}. You are back in next round.`);
                }
                if (state.standing[playerId] === "stayed") {
                    return card(`Banked ${state.roundBanked[playerId] ?? 0}`, "Watching the rest.");
                }
                return card(`Your pocket: ${worth(hand)}`, `${pocket}. Look at the screen.`);
            }
            return card(state.phase === "writing" ? "Shuffling the deck" : `You banked ${state.banked[playerId] ?? 0}`, "Look at the screen.");
        },

        hostFacts(state: PushState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase !== "choosing") {
                return [];
            }
            return [{ scope: { kind: "public" }, kind: "progress", text: `${Object.keys(state.choices).length} of ${stillIn(state).length} have chosen.` }];
        },

        outcome(state: PushState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            const top: { ids: string[]; score: number } = leaders(state);
            return top.ids.length === 0 ? "Nobody banked a point." : top.score >= decisions.target ? "Someone reached the target." : "The rounds ran out.";
        },
    };

    return {
        cartridge,
        hidden(state: PushState): HiddenValue[] {
            const next: number | undefined = state.phase === "end" ? undefined : state.deck[0];
            if (next === undefined || state.seen.includes(next) === true) {
                return [];
            }
            return [{ label: "the next card", text: decisions.cards[next]?.name ?? "", seenBy: [] }];
        },
    };
}
