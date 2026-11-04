// The gallery kit: every player holds a private hand of cards the host paints. Each round one
// player is the storyteller. They pick a card from their hand and give a clue; everyone else puts
// in a card from their own hand that fits the clue; the played cards are shown on the TV one at a
// time; then everyone votes for the card they think was the storyteller's. Code deals the hands,
// keeps them private, runs every clock and does all the scoring: a clue that everyone finds or
// that nobody finds scores nothing for the storyteller, so it has to be neither too obvious nor too
// obscure. The host only talks about what code tells it. Clue Gallery is this kit.
//
// Pictures are painted ahead: a hand is asked for when it is dealt, in small waves so the provider
// is not hit all at once, and each card that is played is replaced, and the replacement asked for,
// as the vote opens, so it has the whole vote and the score to arrive. A phone cannot show a
// picture yet, so a hand is shown as words; the painting appears on the TV when a card is played.
// A card that is not painted by then is shown on the TV as its words, and a late painting replaces
// the words where it stands.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { Turn } from "../../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../../shared/visibility.ts";
import { boxProblems, isShortText, isWholeIn, type Box, type HiddenValue, type KitGame } from "../../kit/kit.ts";
import { cleanLine, isDrawingAddress, paintPrompt } from "../../kit/painting.ts";
import { because, frozenCopy, seededRandom, shuffle } from "../../kit/primitives.ts";

/** Points a round can give. */
export interface GalleryPoints {
    /** The storyteller, when some but not all of the others find their card. */
    storyteller: number;
    /** Each player who finds the storyteller's card, in the same case. */
    found: number;
    /** A player whose card was voted for, for each vote it got. */
    decoy: number;
    /** Each player but the storyteller when everyone or no one finds the card. */
    extremes: number;
}

/** Everything a creator may choose for a gallery game. */
export interface GalleryDecisions {
    /** What a card can show: a subject, a setting and a light are put together, so every card is new. */
    subjects: string[];
    settings: string[];
    lights: string[];
    /** Cards in each hand. */
    handSize: number;
    /** Rounds, one storyteller each; never more than there are players. */
    rounds: number;
    clueSeconds: number;
    playSeconds: number;
    voteSeconds: number;
    /** Seconds each played card stays up on the TV before the next. */
    spotlightSeconds: number;
    /** Seconds each part of the round's result stays up. */
    scoreSeconds: number;
    /** Most characters in a clue. */
    clueLimit: number;
    points: GalleryPoints;
    /** Seconds between waves of painting requests; 0 asks for the whole deal at once. */
    waveSeconds: number;
}

/** The phases of the kit. */
export type GalleryPhase = "clue" | "play" | "vote" | "score" | "end";

/** A card: its words, its painting once it exists, and what the painter is asked. */
export interface GalleryCard {
    id: string;
    caption: string;
    prompt: string;
    src: string | null;
}

/** How a round came out. */
export type RoundKind = "found" | "obvious" | "obscure" | "none";

/** What a round gave. */
export interface RoundResult {
    kind: RoundKind;
    tellerCardId: string;
    /** Players who found the storyteller's card. */
    finders: string[];
    /** Votes each played card got, by card id. */
    votesFor: Record<string, number>;
    /** Points each player got this round, by id. */
    gains: Record<string, number>;
}

/** The whole game, immutable between steps. */
export interface GalleryState {
    phase: GalleryPhase;
    players: CartridgePlayer[];
    gone: string[];
    /** A number the rest of the game's shuffles come from, so state alone replays them. */
    seed: number;
    /** Storyteller ids, one a round, in order. */
    tellers: string[];
    round: number;
    cards: Record<string, GalleryCard>;
    /** Card ids in each player's hand. */
    hands: Record<string, string[]>;
    /** Cards not yet dealt, in order. */
    deck: string[];
    /** The cards of the first deal in the order they are painted: the first of every hand, then the second, and so on. */
    waves: string[][];
    pickedId: string | null;
    clue: string;
    /** The card each player has put in this round, by player id. */
    plays: Record<string, string>;
    /** The played cards in the order the TV shows them. */
    spread: string[];
    spot: number;
    /** The card each voter chose, by voter id. */
    votes: Record<string, string>;
    scores: Record<string, number>;
    result: RoundResult | null;
    /** Which part of the result is showing. */
    beat: number;
}

/** Decision ids a rehearsal names when it explains a moment. */
export const GALLERY_DECISIONS: { cards: string; clue: string; play: string; vote: string; score: string; points: string; waves: string } = {
    cards: "handSize",
    clue: "clueSeconds",
    play: "playSeconds",
    vote: "voteSeconds",
    score: "points",
    points: "points",
    waves: "waveSeconds",
};

/** The prefix on the id of a button that picks the storyteller's card. */
export const PICK_PREFIX: string = "pick:";

/** The prefix on the id of a button that puts a card in. */
export const PLAY_PREFIX: string = "play:";

/** The prefix on the id of a button that votes for a card. */
export const VOTE_PREFIX: string = "vote:";

/**
 * The letter a card wears on the ballot. Its place in the shuffled spread is all a ballot button
 * says, so reading the button tells nobody whose card it is.
 * @param spread the cards in the order they are shown.
 * @param cardId a card.
 * @returns its letter.
 */
export function ballotLetter(spread: readonly string[], cardId: string): string {
    return String.fromCharCode(65 + Math.max(0, spread.indexOf(cardId)));
}

/** The id of the control a storyteller types a clue into. */
export const CLUE_PREFIX: string = "clue:";

/** The prefix on the id of the picture asked for a card. */
export const CARD_PICTURE_PREFIX: string = "card-";

/** Fewest players: with two there is nobody to fool. */
const MIN_PLAYERS: number = 3;

/** Most players: the room draws at most this many pictures a game. */
const MAX_PLAYERS: number = 6;

/** Most pictures the room draws for one room. */
export const ROOM_PICTURE_LIMIT: number = 40;

/** Fewest of each thing a creator must list, so cards don't repeat. */
const MIN_SUBJECTS: number = 12;

/** Longest subject, setting or light. */
const PART_LIMIT: number = 40;

/**
 * The most pictures a game of the largest size asks for: a full hand each, then a replacement for
 * every card played in every round but the last.
 * @param players how many players.
 * @param decisions the decisions.
 * @returns the count.
 */
export function picturesAsked(players: number, decisions: GalleryDecisions): number {
    const rounds: number = Math.min(decisions.rounds, players);
    return players * (decisions.handSize + rounds - 1);
}

/**
 * Checks a gallery game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function galleryProblems(decisions: GalleryDecisions): string[] {
    const problems: string[] = [];
    for (const [name, parts, least] of [["subjects", decisions.subjects, MIN_SUBJECTS], ["settings", decisions.settings, MIN_SUBJECTS], ["lights", decisions.lights, 3]] as const) {
        if (parts.length < least) {
            problems.push(`There must be at least ${least} ${name}.`);
        }
        if (parts.some((part: string) => isShortText(part) === false || part.length > PART_LIMIT || cleanLine(part, PART_LIMIT) !== part) === true) {
            problems.push(`Every one of the ${name} must be a short plain phrase.`);
        }
    }
    const numbers: [string, number, number, number][] = [
        ["Cards in a hand", decisions.handSize, 3, 6],
        ["Rounds", decisions.rounds, 2, 6],
        ["The clue time", decisions.clueSeconds, 20, 180],
        ["The play time", decisions.playSeconds, 15, 120],
        ["The vote time", decisions.voteSeconds, 20, 180],
        ["The time on each card", decisions.spotlightSeconds, 3, 15],
        ["The result time", decisions.scoreSeconds, 3, 20],
        ["A clue's length", decisions.clueLimit, 10, 60],
    ];
    for (const [name, value, low, high] of numbers) {
        if (isWholeIn(value, low, high) === false) {
            problems.push(`${name} must be a whole number from ${low} to ${high}.`);
        }
    }
    if (decisions.waveSeconds !== 0 && isWholeIn(decisions.waveSeconds, 1, 15) === false) {
        problems.push("The gap between painting waves must be 0, or a whole number of seconds from 1 to 15.");
    }
    const points: Record<string, number> = { ...decisions.points };
    for (const [name, value] of Object.entries(points)) {
        if (isWholeIn(value, 0, 9) === false) {
            problems.push(`The points for ${name} must be a whole number from 0 to 9.`);
        }
    }
    if (decisions.points.storyteller <= decisions.points.extremes) {
        problems.push("A storyteller must be worth more when the clue works than when it doesn't, or there is nothing to aim for.");
    }
    return problems;
}

/**
 * Every problem with a gallery blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function galleryBlueprintProblems(box: Box, decisions: GalleryDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...galleryProblems(decisions)];
    if (box.minPlayers < MIN_PLAYERS || box.maxPlayers > MAX_PLAYERS) {
        const reason: string = `with two there's nobody to fool, and more than ${MAX_PLAYERS} is more cards than the room paints`;
        problems.push(`A gallery needs from ${MIN_PLAYERS} to ${MAX_PLAYERS} people: ${reason}.`);
    }
    const asked: number = picturesAsked(box.maxPlayers, decisions);
    if (asked > ROOM_PICTURE_LIMIT) {
        problems.push(`A full table would ask for ${asked} pictures, and the room draws at most ${ROOM_PICTURE_LIMIT}.`);
    }
    return problems;
}

/**
 * Builds the manifest, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 */
export function galleryManifest(box: Box): CartridgeManifest {
    const quiet = { "*": "muted" } as const;
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're running ${box.name}. Everyone holds a hand of cards you painted. Each round one player is the storyteller.`,
            "They pick a card and give a clue, the others put in a card that fits, and everyone votes for the card they think was the storyteller's.",
            "You never see anyone's hand and you never know which card is the storyteller's until the result. Don't guess, hint or react to a card before it is shown.",
            "Say only what you're told to, in a few warm, dry words. The scores are code's: never work them out yourself.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            { id: "clue", hostBrief: "When you're told the game has begun, explain in three short sentences, then stay quiet. After that, say nothing until the result.", listening: quiet, hostMayInterject: false, silenceSeconds: 0 },
            { id: "play", hostBrief: "Cards are going in. Stay quiet.", listening: quiet, hostMayInterject: false, silenceSeconds: 0 },
            { id: "vote", hostBrief: "The cards are on the screen one at a time and people are voting. Stay quiet.", listening: quiet, hostMayInterject: false, silenceSeconds: 0 },
            {
                id: "score",
                hostBrief: "You'll be told how the round came out. Say it in one or two short sentences: who found it, and whether the clue was too easy, too strange or just right. Don't repeat the numbers.",
                listening: quiet,
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "end",
                hostBrief: "You'll be told the final points. Congratulate whoever is in front, kindly, and say one thing that was funny about the game. Then ask if they want another.",
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * Builds a gallery game.
 * @param givenBox the box; copied, so later changes can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with galleryProblems first.
 * @param random a function returning [0, 1): used once, to deal the hands and set the order.
 * @returns the game.
 */
export function createGalleryGame(givenBox: Box, givenDecisions: GalleryDecisions, random: () => number = Math.random): KitGame<GalleryState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: GalleryDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = galleryManifest(box);
    const publicFact = (kind: string, text: string, quiet: boolean = false): ScopedFact => ({ scope: { kind: "public" }, kind, text, ...(quiet === true ? { quiet: true } : {}) });
    const present = (state: GalleryState): CartridgePlayer[] => state.players.filter((player: CartridgePlayer) => state.gone.includes(player.playerId) === false);
    const nameOf = (state: GalleryState, playerId: string): string => state.players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const tellerOf = (state: GalleryState): string => state.tellers[state.round] ?? "";
    const letter = (state: GalleryState, cardId: string): string => String.fromCharCode(65 + Math.max(0, state.spread.indexOf(cardId)));
    const cardOf = (state: GalleryState, cardId: string | null | undefined): GalleryCard | undefined => (cardId === null || cardId === undefined ? undefined : state.cards[cardId]);
    const quoted = (text: string): string => `“${text}”`;
    const lastRound = (state: GalleryState): boolean => state.round >= state.tellers.length - 1;
    const upper = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

    /**
     * Who may vote this round: everyone present but the storyteller who put a card in.
     * @param state the state.
     * @returns their ids.
     */
    const votersOf = (state: GalleryState): string[] => {
        return present(state).map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== tellerOf(state) && state.plays[id] !== undefined);
    };

    /**
     * Whose cards the table is still waiting on in the play phase.
     * @param state the state.
     * @returns their ids.
     */
    const awaitingPlay = (state: GalleryState): string[] => {
        return present(state).map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== tellerOf(state) && state.plays[id] === undefined);
    };
    const rankedPlayers = (state: GalleryState): CartridgePlayer[] => {
        return [...state.players].sort((first: CartridgePlayer, second: CartridgePlayer) => (state.scores[second.playerId] ?? 0) - (state.scores[first.playerId] ?? 0));
    };

    /**
     * Starts a round, or ends the game when the rounds are done or too few are left.
     * @param state the state, with round set to the one to start.
     * @returns the step.
     */
    const beginRound = (state: GalleryState): Step<GalleryState> => {
        const here: CartridgePlayer[] = present(state);
        if (state.round >= state.tellers.length || here.length < MIN_PLAYERS) {
            return finish(state);
        }
        const teller: string = tellerOf(state);
        if (state.gone.includes(teller) === true) {
            return beginRound({ ...state, round: state.round + 1 });
        }
        const next: GalleryState = { ...state, phase: "clue", pickedId: null, clue: "", plays: {}, spread: [], spot: 0, votes: {}, result: null, beat: 0 };
        const intro: string = [
            `The game has begun. ${nameOf(state, teller)} is the first storyteller. Explain in three short sentences: the storyteller picks a card and gives a clue,`,
            "everyone else puts in a card from their own hand that fits it, and then everyone votes for the card they think was the storyteller's.",
            "A clue that everyone finds, or that nobody finds, scores the storyteller nothing. The cards are words on phones and paintings on the screen. Then stay quiet.",
        ].join(" ");
        const facts: ScopedFact[] = state.round === 0 ? because(publicFact("begin", intro), GALLERY_DECISIONS.clue) : because(publicFact("round", `Round ${state.round + 1} begins with ${nameOf(state, teller)} as the storyteller.`, true), GALLERY_DECISIONS.clue);
        return { state: next, facts, nextPhaseId: "clue", timers: { [`clue:${state.round}`]: decisions.clueSeconds } };
    };

    /**
     * Opens the vote: shows the played cards one at a time and asks for a replacement for each.
     * @param state the state, with every play in.
     * @returns the step.
     */
    const beginVote = (state: GalleryState): Step<GalleryState> => {
        const played: string[] = Object.values(state.plays);
        const spread: string[] = shuffle(played, seededRandom(state.seed + state.round * 7919));
        const refill: { state: GalleryState; draws: { id: string; prompt: string }[] } = replace(state, lastRound(state) === false);
        const next: GalleryState = { ...refill.state, phase: "vote", spread, spot: 0, votes: {} };
        const facts: ScopedFact[] = because(publicFact("vote", "Every card is in and the vote is open.", true), GALLERY_DECISIONS.vote);
        return {
            state: next,
            facts,
            nextPhaseId: "vote",
            timers: { [`vote:${state.round}`]: decisions.voteSeconds, [`spot:${state.round}:0`]: decisions.spotlightSeconds },
            draws: refill.draws,
        };
    };

    /**
     * Gives each player who put a card in a new one from the deck, and asks for its painting.
     * @param state the state.
     * @param mayDeal false on the last round, where nobody needs another card.
     * @returns the state with the new hands, and the pictures to ask for.
     */
    const replace = (state: GalleryState, mayDeal: boolean): { state: GalleryState; draws: { id: string; prompt: string }[] } => {
        if (mayDeal === false) {
            return { state, draws: [] };
        }
        const hands: Record<string, string[]> = { ...state.hands };
        let deck: string[] = [...state.deck];
        const draws: { id: string; prompt: string }[] = [];
        for (const playerId of Object.keys(state.plays)) {
            const dealt: string | undefined = deck[0];
            if (dealt === undefined || state.gone.includes(playerId) === true) {
                continue;
            }
            deck = deck.slice(1);
            hands[playerId] = [...(hands[playerId] ?? []), dealt];
            draws.push({ id: `${CARD_PICTURE_PREFIX}${dealt}`, prompt: state.cards[dealt]?.prompt ?? "" });
        }
        return { state: { ...state, hands, deck }, draws };
    };

    /**
     * Scores the vote and shows the result.
     * @param state the state in the vote, or in a round that was cut short.
     * @param abandoned true when the storyteller left, so nobody scores.
     * @returns the step.
     */
    const score = (state: GalleryState, abandoned: boolean): Step<GalleryState> => {
        const teller: string = tellerOf(state);
        const tellerCard: string = state.plays[teller] ?? "";
        const voters: string[] = Object.keys(state.votes);
        const finders: string[] = voters.filter((id: string) => state.votes[id] === tellerCard);
        const votesFor: Record<string, number> = {};
        for (const cardId of Object.values(state.votes)) {
            votesFor[cardId] = (votesFor[cardId] ?? 0) + 1;
        }
        const gains: Record<string, number> = {};
        for (const player of state.players) {
            gains[player.playerId] = 0;
        }
        const kind: RoundKind = abandoned === true || voters.length === 0 || tellerCard === "" ? "none" : finders.length === voters.length ? "obvious" : finders.length === 0 ? "obscure" : "found";
        if (kind === "found") {
            gains[teller] = decisions.points.storyteller;
            for (const id of finders) {
                gains[id] = (gains[id] ?? 0) + decisions.points.found;
            }
        }
        if (kind === "obvious" || kind === "obscure") {
            for (const id of voters) {
                gains[id] = (gains[id] ?? 0) + decisions.points.extremes;
            }
        }
        if (kind !== "none") {
            for (const [playerId, cardId] of Object.entries(state.plays)) {
                if (playerId !== teller) {
                    gains[playerId] = (gains[playerId] ?? 0) + (votesFor[cardId] ?? 0) * decisions.points.decoy;
                }
            }
        }
        const scores: Record<string, number> = {};
        for (const player of state.players) {
            scores[player.playerId] = (state.scores[player.playerId] ?? 0) + (gains[player.playerId] ?? 0);
        }
        const result: RoundResult = { kind, tellerCardId: tellerCard, finders, votesFor, gains };
        const next: GalleryState = { ...state, phase: "score", result, scores, beat: 0 };
        const told: string = {
            found: `${nameOf(state, teller)}'s clue ${quoted(state.clue)} worked: ${finders.length} of ${voters.length} found the card. Just right.`,
            obvious: `${nameOf(state, teller)}'s clue ${quoted(state.clue)} was found by everyone: too easy, so the storyteller scores nothing and the rest get points.`,
            obscure: `${nameOf(state, teller)}'s clue ${quoted(state.clue)} was found by no one: too strange, so the storyteller scores nothing and the rest get points.`,
            none: "The round ended without a result. Say so in a few words and move on.",
        }[kind];
        return { state: next, facts: because(publicFact("result", `${told} Say it in one or two short sentences.`), GALLERY_DECISIONS.score), nextPhaseId: "score", timers: { [`beat:${state.round}:0`]: decisions.scoreSeconds } };
    };

    /**
     * Ends the game with the final points.
     * @param state the state.
     * @returns the step.
     */
    const finish = (state: GalleryState): Step<GalleryState> => {
        const ranked: CartridgePlayer[] = rankedPlayers(state);
        const standings: string = ranked.map((player: CartridgePlayer) => `${player.name} ${state.scores[player.playerId] ?? 0}`).join(", ");
        const next: GalleryState = { ...state, phase: "end", result: null };
        return { state: next, facts: because(publicFact("game-over", `The game is over. Final points: ${standings}.`), GALLERY_DECISIONS.score), nextPhaseId: "end" };
    };

    /**
     * Someone left.
     * @param state the state.
     * @param playerId who.
     * @returns the step.
     */
    const left = (state: GalleryState, playerId: string): Step<GalleryState> => {
        if (state.phase === "end" || state.players.some((player: CartridgePlayer) => player.playerId === playerId) === false || state.gone.includes(playerId) === true) {
            return { state, facts: [] };
        }
        const votes: Record<string, string> = Object.fromEntries(Object.entries(state.votes).filter(([voter]: [string, string]) => voter !== playerId));
        const next: GalleryState = { ...state, gone: [...state.gone, playerId], votes };
        if (present(next).length < MIN_PLAYERS) {
            return finish(next);
        }
        if (next.phase === "score") {
            return { state: next, facts: [] };
        }
        if (playerId === tellerOf(next)) {
            return next.phase === "vote" ? score(next, true) : score({ ...next, plays: {}, votes: {} }, true);
        }
        if (next.phase === "play" && awaitingPlay(next).length === 0) {
            return beginVote(next);
        }
        if (next.phase === "vote" && votersOf(next).every((id: string) => next.votes[id] !== undefined) === true) {
            return score(next, false);
        }
        return { state: next, facts: [] };
    };

    /**
     * Puts a card into the round for a player and takes it from their hand.
     * @param state the state.
     * @param playerId who.
     * @param cardId the card.
     * @returns the state.
     */
    const putIn = (state: GalleryState, playerId: string, cardId: string): GalleryState => ({
        ...state,
        plays: { ...state.plays, [playerId]: cardId },
        hands: { ...state.hands, [playerId]: (state.hands[playerId] ?? []).filter((held: string) => held !== cardId) },
    });

    /**
     * Asks for the next wave of pictures.
     * @param state the state.
     * @param wave which wave: the nth card of each hand.
     * @returns the pictures to ask for.
     */
    const waveDraws = (state: GalleryState, wave: number): { id: string; prompt: string }[] => {
        return (state.waves[wave] ?? []).flatMap((cardId: string) => {
            const card: GalleryCard | undefined = cardOf(state, cardId);
            return card === undefined || card.src !== null ? [] : [{ id: `${CARD_PICTURE_PREFIX}${card.id}`, prompt: card.prompt }];
        });
    };

    const cartridge: Cartridge<GalleryState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<GalleryState> {
            const rounds: number = Math.min(decisions.rounds, players.length);
            const seed: number = Math.floor(random() * 2147483647);
            const pairs: string[][] = decisions.subjects.flatMap((subject: string) => decisions.settings.map((setting: string) => [subject, setting] as string[]));
            const wanted: number = players.length * (decisions.handSize + rounds);
            const chosen: string[][] = shuffle(pairs, random).slice(0, wanted);
            const cards: Record<string, GalleryCard> = {};
            const ids: string[] = chosen.map(([subject, setting]: string[], index: number) => {
                const light: string = decisions.lights[Math.floor(random() * decisions.lights.length)] ?? "warm";
                const id: string = `c${index + 1}`;
                const caption: string = upper(`${subject} ${setting}`);
                cards[id] = { id, caption, prompt: paintPrompt(`${subject} ${setting}, in ${light} light`), src: null };
                return id;
            });
            const hands: Record<string, string[]> = {};
            players.forEach((player: CartridgePlayer, seat: number) => {
                hands[player.playerId] = ids.slice(seat * decisions.handSize, (seat + 1) * decisions.handSize);
            });
            const tellers: string[] = shuffle(players, random).slice(0, rounds).map((player: CartridgePlayer) => player.playerId);
            const scores: Record<string, number> = Object.fromEntries(players.map((player: CartridgePlayer) => [player.playerId, 0]));
            const dealt: GalleryState = {
                phase: "clue",
                players,
                gone: [],
                seed,
                tellers,
                round: 0,
                cards,
                hands,
                deck: ids.slice(players.length * decisions.handSize),
                waves: Array.from({ length: decisions.handSize }, (_unused: unknown, wave: number) => players.map((player: CartridgePlayer) => hands[player.playerId]?.[wave] ?? "")),
                pickedId: null,
                clue: "",
                plays: {},
                spread: [],
                spot: 0,
                votes: {},
                scores,
                result: null,
                beat: 0,
            };
            const first: Step<GalleryState> = beginRound(dealt);
            const waves: number = decisions.waveSeconds === 0 ? 1 : decisions.handSize;
            const allWaves: { id: string; prompt: string }[] = Array.from({ length: decisions.handSize }, (_unused: unknown, wave: number) => waveDraws(dealt, wave)).flat();
            const draws: { id: string; prompt: string }[] = decisions.waveSeconds === 0 ? allWaves : waveDraws(dealt, 0);
            const timers: Record<string, number> = { ...first.timers };
            for (let wave = 1; wave < waves && decisions.waveSeconds > 0; wave += 1) {
                timers[`wave:${wave}`] = wave * decisions.waveSeconds;
            }
            return { ...first, draws, timers };
        },

        phaseOf(state: GalleryState): string {
            return state.phase;
        },

        turn(state: GalleryState): Turn | null {
            if (state.phase === "clue") {
                return { kind: "one", playerId: tellerOf(state), label: state.pickedId === null ? "Choosing a card" : "Giving a clue" };
            }
            if (state.phase === "play") {
                const needed: string[] = present(state).map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== tellerOf(state));
                return { kind: "everyone", playerIds: needed, doneIds: needed.filter((id: string) => state.plays[id] !== undefined), label: "Put a card in" };
            }
            if (state.phase === "vote") {
                const voters: string[] = votersOf(state);
                return { kind: "everyone", playerIds: voters, doneIds: voters.filter((id: string) => state.votes[id] !== undefined), label: "Vote on your phone" };
            }
            return null;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: GalleryState, playerId: string): LegalAction[] {
            const hand: string[] = state.hands[playerId] ?? [];
            const label = (cardId: string): string => state.cards[cardId]?.caption ?? "";
            if (state.gone.includes(playerId) === true) {
                return [];
            }
            if (state.phase === "clue" && playerId === tellerOf(state) && state.pickedId === null) {
                return hand.map((cardId: string) => ({ actionId: `${PICK_PREFIX}${cardId}`, label: label(cardId) }));
            }
            if (state.phase === "play" && playerId !== tellerOf(state) && state.plays[playerId] === undefined) {
                return hand.map((cardId: string) => ({ actionId: `${PLAY_PREFIX}${cardId}`, label: label(cardId) }));
            }
            if (state.phase === "vote" && votersOf(state).includes(playerId) === true && state.votes[playerId] === undefined) {
                const others: string[] = state.spread.filter((cardId: string) => cardId !== state.plays[playerId]);
                return others.map((cardId: string) => ({ actionId: `${VOTE_PREFIX}${ballotLetter(state.spread, cardId)}`, label: `Card ${letter(state, cardId)}` }));
            }
            return [];
        },

        apply(state: GalleryState, playerId: string, actionId: string): Step<GalleryState> {
            const allowed: boolean = this.legalActions(state, playerId).some((action: LegalAction) => action.actionId === actionId);
            if (allowed === false) {
                return { state, facts: [] };
            }
            if (actionId.startsWith(PICK_PREFIX) === true) {
                return { state: { ...state, pickedId: actionId.slice(PICK_PREFIX.length) }, facts: [] };
            }
            if (actionId.startsWith(PLAY_PREFIX) === true) {
                const next: GalleryState = putIn(state, playerId, actionId.slice(PLAY_PREFIX.length));
                return awaitingPlay(next).length === 0 ? beginVote(next) : { state: next, facts: [] };
            }
            const voted: string | undefined = state.spread[actionId.slice(VOTE_PREFIX.length).charCodeAt(0) - 65];
            if (voted === undefined) {
                return { state, facts: [] };
            }
            const next: GalleryState = { ...state, votes: { ...state.votes, [playerId]: voted } };
            return votersOf(next).every((id: string) => next.votes[id] !== undefined) === true ? score(next, false) : { state: next, facts: [] };
        },

        onEvent(state: GalleryState, event: RoomEvent): Step<GalleryState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "answered" && state.phase === "clue") {
                const clue: string = typeof event.value === "string" ? cleanLine(event.value, decisions.clueLimit) : "";
                const card: string | null = state.pickedId;
                if (event.playerId !== tellerOf(state) || event.controlId !== `${CLUE_PREFIX}${state.round}` || card === null || clue === "") {
                    return { state, facts: [] };
                }
                const played: GalleryState = putIn({ ...state, clue }, event.playerId, card);
                const next: GalleryState = { ...played, phase: "play" };
                const told: ScopedFact[] = because(publicFact("clue", `The storyteller's clue is ${quoted(clue)}.`, true), GALLERY_DECISIONS.play);
                return { state: next, facts: told, nextPhaseId: "play", timers: { [`play:${state.round}`]: decisions.playSeconds } };
            }
            if (event.type === "drawingReady" && event.id.startsWith(CARD_PICTURE_PREFIX) === true && isDrawingAddress(event.src) === true) {
                const card: GalleryCard | undefined = state.cards[event.id.slice(CARD_PICTURE_PREFIX.length)];
                if (card === undefined || card.src !== null) {
                    return { state, facts: [] };
                }
                return { state: { ...state, cards: { ...state.cards, [card.id]: { ...card, src: event.src } } }, facts: [] };
            }
            if (event.type !== "timerFired") {
                return { state, facts: [] };
            }
            const [kind = "", first = "", second = ""] = event.timerId.split(":");
            const round: number = Number(first);
            if (kind === "wave" && state.phase !== "end") {
                return { state, facts: [], draws: waveDraws(state, round) };
            }
            if (kind === "clue" && round === state.round && state.phase === "clue") {
                return score({ ...state, plays: {}, votes: {} }, true);
            }
            if (kind === "play" && round === state.round && state.phase === "play") {
                let forced: GalleryState = state;
                for (const playerId of awaitingPlay(state)) {
                    const card: string | undefined = forced.hands[playerId]?.[0];
                    forced = card === undefined ? forced : putIn(forced, playerId, card);
                }
                return beginVote(forced);
            }
            if (kind === "spot" && round === state.round && state.phase === "vote" && Number(second) === state.spot) {
                const spot: number = (state.spot + 1) % Math.max(1, state.spread.length);
                return { state: { ...state, spot }, facts: [], timers: { [`spot:${state.round}:${spot}`]: decisions.spotlightSeconds } };
            }
            if (kind === "vote" && round === state.round && state.phase === "vote") {
                return score(state, false);
            }
            if (kind === "beat" && round === state.round && state.phase === "score" && Number(second) === state.beat) {
                if (state.beat === 0) {
                    return { state: { ...state, beat: 1 }, facts: [], timers: { [`beat:${state.round}:1`]: decisions.scoreSeconds } };
                }
                return beginRound({ ...state, round: state.round + 1 });
            }
            return { state, facts: [] };
        },

        publicScene(state: GalleryState): Scene {
            return sceneOf(state);
        },

        privateControls(state: GalleryState, playerId: string): Control[] {
            if (state.gone.includes(playerId) === true) {
                return [{ type: "waiting", text: "You've left this game." }];
            }
            const options = (actions: LegalAction[]): ControlOption[] => actions.map((action: LegalAction): ControlOption => ({ id: action.actionId, label: action.label }));
            const actions: LegalAction[] = this.legalActions(state, playerId);
            const teller: string = tellerOf(state);
            if (state.phase === "clue" && playerId === teller) {
                const picked: GalleryCard | undefined = cardOf(state, state.pickedId);
                if (picked === undefined) {
                    return [{ type: "buttons", prompt: "Pick a card for your clue.", options: options(actions) }];
                }
                return [
                    { type: "notice", text: `Your card: ${picked.caption}`, tone: "secret" },
                    {
                        type: "textInput",
                        id: `${CLUE_PREFIX}${state.round}`,
                        prompt: "Give a clue for your card.",
                        placeholder: "A word or a short phrase",
                        maxLength: decisions.clueLimit,
                        note: "Not so clear that everyone finds it, and not so strange that no one does.",
                    },
                ];
            }
            if (state.phase === "clue") {
                return [{ type: "waiting", text: `${nameOf(state, teller)} is choosing a card and a clue.` }];
            }
            if (state.phase === "play" && actions.length > 0) {
                return [{ type: "buttons", prompt: `The clue is ${quoted(state.clue)}. Which card fits it?`, options: options(actions) }];
            }
            if (state.phase === "play") {
                return [{ type: "waiting", text: "Your card is in. The others are choosing." }];
            }
            if (state.phase === "vote" && actions.length > 0) {
                return [{ type: "buttons", prompt: `The clue is ${quoted(state.clue)}. Which card was ${nameOf(state, teller)}'s?`, options: options(actions) }];
            }
            if (state.phase === "vote") {
                return [{ type: "waiting", text: playerId === teller ? "The others are voting. Watch the screen." : "Your vote is in." }];
            }
            return [{ type: "waiting", text: `You have ${state.scores[playerId] ?? 0} ${state.scores[playerId] === 1 ? "point" : "points"}. Watch the screen.` }];
        },

        hostFacts(state: GalleryState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase === "end") {
                return [];
            }
            return [publicFact("round", `Round ${state.round + 1} of ${state.tellers.length}.`, true)];
        },

        outcome(state: GalleryState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            const best: number = Math.max(0, ...Object.values(state.scores));
            const front: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => (state.scores[player.playerId] ?? 0) === best);
            const leaders: string[] = front.map((player: CartridgePlayer) => player.name);
            return `${leaders.join(" and ")} finished in front with ${best}.`;
        },
    };

    /**
     * The picture or, failing that, the words of a card, as a TV block.
     * @param state the state.
     * @param card the card.
     * @param caption what to caption a picture with.
     * @returns the blocks.
     */
    function showCard(card: GalleryCard | undefined, caption: string): SceneBlock[] {
        if (card === undefined) {
            return [];
        }
        if (card.src !== null) {
            return [{ type: "image", src: card.src, ...(caption === "" ? {} : { caption }) }];
        }
        return [{ type: "text", text: card.caption, emphasis: "large" }, { type: "text", text: "Still being painted.", emphasis: "whisper" }];
    }

    /**
     * The TV for the current phase.
     * @param state the state.
     * @returns the scene.
     */
    function sceneOf(state: GalleryState): Scene {
        const teller: string = nameOf(state, tellerOf(state));
        const round: string = `Round ${state.round + 1} of ${state.tellers.length}`;
        if (state.phase === "clue") {
            return {
                mood: "neutral",
                transition: "fade",
                blocks: [
                    { type: "title", text: box.name, kicker: round },
                    { type: "text", text: `${teller} is the storyteller. Choosing a card and a clue.`, emphasis: "large" },
                    { type: "timer", seconds: decisions.clueSeconds, label: `for ${teller}`, running: true },
                ],
            };
        }
        if (state.phase === "play") {
            const needed: number = present(state).length - 1;
            return {
                mood: "tense",
                transition: "fade",
                blocks: [
                    { type: "title", text: quoted(state.clue), kicker: `${teller}'s clue` },
                    { type: "progress", label: "Cards in", current: Object.keys(state.plays).length - 1, max: needed, marks: "card" },
                    { type: "timer", seconds: decisions.playSeconds, label: "to put a card in", running: true },
                ],
            };
        }
        if (state.phase === "vote") {
            const cardId: string | undefined = state.spread[state.spot];
            const voters: string[] = votersOf(state);
            return {
                mood: "tense",
                transition: "fade",
                blocks: [
                    { type: "title", text: cardId === undefined ? "Vote" : `Card ${letter(state, cardId)}`, kicker: `The clue: ${quoted(state.clue)}` },
                    ...showCard(cardOf(state, cardId), ""),
                    { type: "progress", label: "Votes in", current: Object.keys(state.votes).length, max: voters.length, marks: "card" },
                ],
            };
        }
        if (state.phase === "score" && state.result !== null) {
            const result: RoundResult = state.result;
            if (state.beat === 0) {
                const verdict: Record<RoundKind, string> = {
                    found: `${result.finders.length} found it. Just right.`,
                    obvious: "Everyone found it. Too easy, so the storyteller scores nothing.",
                    obscure: "No one found it. Too strange, so the storyteller scores nothing.",
                    none: "The round was cut short.",
                };
                const card: GalleryCard | undefined = cardOf(state, result.tellerCardId);
                return {
                    mood: "victory",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: result.kind === "none" ? round : `${teller}'s card`, kicker: `The clue: ${quoted(state.clue)}` },
                        ...showCard(card, card === undefined ? "" : `Card ${letter(state, card.id)}`),
                        { type: "text", text: verdict[result.kind], emphasis: "large" },
                    ],
                };
            }
            return {
                mood: "victory",
                transition: "fade",
                blocks: [{ type: "title", text: "Points", kicker: round }, { type: "tally", title: "After this round", rows: standings(state, true) }],
            };
        }
        const best: number = Math.max(0, ...Object.values(state.scores));
        return {
            mood: "victory",
            transition: "fade",
            blocks: [{ type: "title", text: "Final points", kicker: box.name }, { type: "tally", title: "Points", rows: standings(state, false).map((row: TallyRow) => ({ ...row, highlight: row.count === best })) }],
        };
    }

    /**
     * The points table, highest first.
     * @param state the state.
     * @param showGains true to show what each player got this round.
     * @returns the rows.
     */
    function standings(state: GalleryState, showGains: boolean): TallyRow[] {
        const ranked: CartridgePlayer[] = rankedPlayers(state);
        return ranked.map((player: CartridgePlayer): TallyRow => {
            const gain: number = state.result?.gains[player.playerId] ?? 0;
            const shown: boolean = showGains === true && gain > 0;
            return { label: shown === true ? `${player.name} +${gain}` : player.name, count: state.scores[player.playerId] ?? 0, highlight: shown };
        });
    }

    return {
        cartridge,
        hidden(state: GalleryState): HiddenValue[] {
            if (state.phase === "end") {
                return [];
            }
            const values: HiddenValue[] = [];
            for (const player of state.players) {
                for (const cardId of state.hands[player.playerId] ?? []) {
                    values.push({ label: `a card in ${player.name}'s hand`, text: state.cards[cardId]?.caption ?? "", seenBy: [player.playerId] });
                }
            }
            const inPlay: boolean = state.phase === "clue" || state.phase === "play";
            const picked: GalleryCard | undefined = cardOf(state, state.pickedId);
            if (picked !== undefined && state.phase === "clue") {
                values.push({ label: "the storyteller's chosen card", text: picked.caption, seenBy: [tellerOf(state)] });
            }
            if (inPlay === true && state.phase === "play") {
                for (const [playerId, cardId] of Object.entries(state.plays)) {
                    values.push({ label: "a card put in", text: state.cards[cardId]?.caption ?? "", seenBy: [playerId] });
                }
            }
            if (state.phase === "vote") {
                for (const [playerId, cardId] of Object.entries(state.plays)) {
                    values.push({ label: "who put a card in", text: nameOf(state, playerId), seenBy: [playerId], near: state.cards[cardId]?.caption ?? "" });
                }
            }
            return values;
        },
    };
}
