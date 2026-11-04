// Under the Cup, a tap game of hidden dice and bluffing. Every player rolls dice that only their own
// phone shows. Going round the table, each player raises a bid about how many dice show one face
// across every cup, or challenges the last bid. Code rolls the dice, orders the bids, counts the cups
// on a challenge, takes a die from the loser and removes players with none left. The host never sees
// a die until the cups are lifted: it is told the bids, the odds from the dice count alone, and then
// everything at the reveal, and it talks the table up and down. The host makes no rulings.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, PhaseSpec, Step } from "../../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { Turn } from "../../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../../shared/visibility.ts";
import { boxProblems, isWholeIn, type Box, type HiddenValue, type KitGame } from "../../kit/kit.ts";
import { because, frozenCopy } from "../../kit/primitives.ts";
import {
    beats, boldness, BOLDNESS_WORDS, chanceAtLeast, chancePerDie, clockOpening, countFace, faceChoices, faceWord, hasHigherPage, nextWithDice, numberWord, quantityChoices,
    rollDice, sayBid, type Bid,
} from "./tap-dice-rules.ts";
import { nameIn } from "./tap.ts";

/** Everything a creator may choose for an Under the Cup game. */
export interface DiceDecisions {
    style: "dice";
    /** Dice each player starts with. */
    startingDice: number;
    /** Whether a one counts as any face, except in a bid on ones. */
    wildOnes: boolean;
    /** Seconds a player has to bid or challenge before the clock decides. */
    bidSeconds: number;
    /** Seconds everyone has to look at their dice before bidding opens. */
    lookSeconds: number;
    /** Seconds between a challenge and the cups being lifted. */
    liftSeconds: number;
    /** Seconds the result stays up while the host talks. */
    revealSeconds: number;
    /** Challenges after which the game ends and the most dice wins. */
    maxRounds: number;
    /** Dice a challenger loses when the bid was exactly right. */
    exactLoss: number;
}

/** The phases of the game. */
export type DicePhase = "looking" | "bidding" | "lifting" | "reveal" | "end";

/** One cup, lifted. */
export interface Hand {
    playerId: string;
    name: string;
    dice: number[];
}

/** What a challenge found. Public once it exists. */
export interface Reveal {
    bid: Bid;
    bidderName: string;
    challengerName: string;
    /** Dice that counted towards the bid. */
    count: number;
    /** True when the bid was at least right. */
    held: boolean;
    loserId: string;
    loserName: string;
    lost: number;
    /** Dice the loser has left. */
    left: number;
    hands: Hand[];
}

/** The whole game, immutable between steps. */
export interface DiceState {
    phase: DicePhase;
    /** Everyone at the table, in seat order, including players who are out. */
    players: CartridgePlayer[];
    /** Dice each player has left. Public. */
    diceLeft: Record<string, number>;
    /** This round's rolled dice for players still in. Secret until the cups are lifted. */
    dice: Record<string, number[]>;
    /** Changes every time dice are rolled, so a stale clock is ignored. */
    serial: number;
    /** Challenges resolved so far. */
    challenges: number;
    /** Who bids first this round, or next round once a result is up. */
    starterId: string | null;
    bidderId: string | null;
    bid: Bid | null;
    bids: Bid[];
    /** The quantity the bidder has chosen and not yet paired with a face. Seen only by the bidder. */
    draft: number | null;
    /** Which page of quantities the bidder is looking at. Seen only by the bidder. */
    page: number;
    challengerId: string | null;
    reveal: Reveal | null;
    winnerIds: string[];
    /** Why the game ended, in a few plain words, once it has. */
    ending: string;
}

/** The prefix on a quantity button's option id. */
export const QUANTITY_PREFIX: string = "qty:";

/** The prefix on a face button's option id. */
export const FACE_PREFIX: string = "face:";

/** The option id of the challenge button. */
export const CHALLENGE_ACTION: string = "challenge";

/** The option ids of the buttons that page through quantities. */
export const HIGHER_ACTION: string = "higher";
export const LOWER_ACTION: string = "lower";

/** The option id of the button that takes back a chosen quantity. */
export const BACK_ACTION: string = "back";

/** Decision ids a rehearsal names when it explains a moment. */
export const DICE_DECISIONS: { dice: string; bid: string; look: string; lift: string; reveal: string; rounds: string; exact: string; wild: string } = {
    dice: "startingDice",
    bid: "bidSeconds",
    look: "lookSeconds",
    lift: "liftSeconds",
    reveal: "revealSeconds",
    rounds: "maxRounds",
    exact: "exactLoss",
    wild: "wildOnes",
};

/** What goes between one hand's dice on the TV, and between two hands sharing a line. */
export const HAND_SEPARATOR: string = " · ";
export const HANDS_GAP: string = "  |  ";

/** Players at or under which the TV gives every hand its own line; more share lines so the list stays above the lantern. */
const HAND_LINES_UP_TO: number = 5;

/**
 * Capitalises the first letter.
 * @param text any text.
 * @returns the text, started with a capital.
 */
function capital(text: string): string {
    return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

/** Largest table the bid buttons and the TV are laid out for. */
const MOST_PLAYERS: number = 8;

/** A bid at or under this chance is bold enough for the host to remark on without being asked. */
const REMARK_CHANCE: number = 0.15;

/**
 * Checks an Under the Cup game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function diceProblems(decisions: DiceDecisions): string[] {
    const problems: string[] = [];
    if (isWholeIn(decisions.startingDice, 2, 6) === false) {
        problems.push("Each player starts with a whole number of dice from 2 to 6.");
    }
    if (typeof decisions.wildOnes !== "boolean") {
        problems.push("Wild ones is on or off.");
    }
    const seconds: [number, number, number][] = [
        [decisions.bidSeconds, 10, 90],
        [decisions.lookSeconds, 3, 20],
        [decisions.liftSeconds, 2, 10],
        [decisions.revealSeconds, 6, 30],
    ];
    if (seconds.some(([value, low, high]: [number, number, number]) => isWholeIn(value, low, high) === false) === true) {
        problems.push("Bidding takes 10 to 90 seconds, looking 3 to 20, lifting the cups 2 to 10 and the reveal 6 to 30, in whole seconds.");
    }
    if (isWholeIn(decisions.maxRounds, 4, 30) === false) {
        problems.push("A game lasts a whole number of challenges from 4 to 30.");
    }
    if (isWholeIn(decisions.exactLoss, 1, 2) === false) {
        problems.push("A challenger who meets an exact bid loses 1 or 2 dice.");
    }
    return problems;
}

/**
 * Every problem with an Under the Cup blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function diceBlueprintProblems(box: Box, decisions: DiceDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...diceProblems(decisions)];
    if (box.minPlayers < 2) {
        problems.push("Under the Cup needs at least two people to bid against each other.");
    }
    if (box.maxPlayers > MOST_PLAYERS) {
        problems.push(`Under the Cup is laid out for at most ${MOST_PLAYERS} people.`);
    }
    return problems;
}

/**
 * Builds the manifest, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 */
export function diceManifest(box: Box): CartridgeManifest {
    const listening: Record<string, "muted"> = { "*": "muted" };
    const phases: PhaseSpec[] = [
        {
            id: "looking",
            hostBrief: "A round is starting. In one short line say which round it is, how many dice are out there, who bids first, and that every die is on a phone and nobody else's. Then reply exactly (quiet).",
            listening,
            hostMayInterject: false,
            silenceSeconds: 0,
        },
        {
            id: "bidding",
            hostBrief: [
                "Players are bidding, and most of the talk is theirs. Speak only when you're told something worth a line, such as a bold bid or the clock acting. Then one short dry line that teases the bid, never the person.",
                "Manner, not a script: \"Seven fours on twelve dice. Bold. Or lying.\" Otherwise reply exactly (quiet).",
                "If anyone asks what is in a cup, you don't know and you say so. Never guess a die.",
            ].join(" "),
            listening,
            hostMayInterject: false,
            hostMostlyQuiet: true,
            silenceSeconds: 0,
        },
        {
            id: "lifting",
            hostBrief: [
                "A challenge has been called and the cups are about to be lifted. You don't know the result.",
                "One short, slow line to build the moment: who called whom, and that nobody is breathing. Manner, not a script: \"Candle has called it. Hands off the cups.\" Don't say who is right.",
            ].join(" "),
            listening,
            hostMayInterject: false,
            silenceSeconds: 0,
        },
        {
            id: "reveal",
            hostBrief: [
                "The cups are up and you'll be told every die, the count, and who loses a die. Make a small show of it in two or three short sentences: count the matching dice out loud, give the verdict, name who loses a die and how many they have left.",
                "Manner, not a script: \"Count with me. A four, another four, a wild one. Three. The bid holds, and Candle pays for doubting it.\"",
                "If someone is out, say so with ceremony and kindness. Tease the bluff, never the person's looks, money, age or love life.",
            ].join(" "),
            listening,
            hostMayInterject: true,
            silenceSeconds: 0,
        },
        {
            id: "end",
            hostBrief: "The game is over. Two or three sentences: name the winner with a flourish, one gentle line about the best bluff or the bravest call of the night, and ask if they want another game.",
            listening,
            hostMayInterject: true,
            silenceSeconds: 0,
        },
    ];
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're hosting ${box.name}, a game of hidden dice. Everyone rolls dice that only their own phone shows.`,
            "Players take turns raising a bid about how many dice show one face across all the cups, or challenge the last bid. The loser of a challenge loses a die; the last player with dice wins.",
            "You never know anyone's dice until the cups are lifted, so you never guess, hint or ask. You are told the bids, the odds from the count of dice alone, and then everything at the reveal.",
            "Your tone: a card-room host with a dry smile. Talk the table up and down, build the tension before a reveal, and play the reveal for all it's worth.",
            "Tease bids and bluffs, never the person. No remarks about anyone's looks, body, money, age or love life. Short lines.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases,
    };
}

/**
 * Builds an Under the Cup game.
 * @param givenBox the box; copied.
 * @param givenDecisions the decisions; copied. Check them with diceBlueprintProblems first.
 * @param random a function returning [0, 1); it rolls every die.
 * @returns the game.
 */
export function createDiceGame(givenBox: Box, givenDecisions: DiceDecisions, random: () => number = Math.random): KitGame<DiceState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: DiceDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = diceManifest(box);

    /**
     * A public fact and the decision behind it.
     * @param kind the fact's kind.
     * @param text what the host may narrate.
     * @param decision the decision id.
     * @param quiet true when the host should know it but not react aloud.
     * @returns the fact and its reason.
     */
    const publicFact = (kind: string, text: string, decision: string, quiet: boolean = false): ScopedFact[] => {
        const fact: ScopedFact = { scope: { kind: "public" }, kind, text };
        return because(quiet === true ? { ...fact, quiet: true } : fact, decision);
    };

    /**
     * Everyone still holding dice, in seat order.
     * @param state the state.
     * @returns the players.
     */
    const inPlay = (state: DiceState): CartridgePlayer[] => state.players.filter((player: CartridgePlayer) => (state.diceLeft[player.playerId] ?? 0) > 0);

    /**
     * Dice on the table.
     * @param state the state.
     * @returns the total.
     */
    const totalDice = (state: DiceState): number => inPlay(state).reduce((total: number, player: CartridgePlayer) => total + (state.diceLeft[player.playerId] ?? 0), 0);

    /**
     * Seat ids in order.
     * @param state the state.
     * @returns the ids.
     */
    const seatsOf = (state: DiceState): string[] => state.players.map((player: CartridgePlayer) => player.playerId);

    /**
     * Who has how many dice, in words, for the host.
     * @param state the state.
     * @returns for example "Teacup 3, Spoon 2".
     */
    const countsSaid = (state: DiceState): string => inPlay(state).map((player: CartridgePlayer) => `${player.name} ${state.diceLeft[player.playerId] ?? 0}`).join(", ");

    /**
     * The bid as a sentence fragment with its odds, from the count of dice alone.
     * @param state the state.
     * @param bid the bid.
     * @returns for example "four fives, a stretch with 11 dice on the table (about 20 in 100, from the dice count only)".
     */
    const bidWithOdds = (state: DiceState, bid: Bid): { text: string; chance: number } => {
        const total: number = totalDice(state);
        const chance: number = chanceAtLeast(total, chancePerDie(bid.face, decisions.wildOnes), bid.quantity);
        const percent: number = Math.round(chance * 100);
        const grade: string = BOLDNESS_WORDS[boldness(chance)];
        return { text: `${sayBid(bid.quantity, bid.face)}, ${grade} with ${total} dice on the table (about ${percent} in 100, from the dice count only)`, chance };
    };

    /**
     * Rolls every cup and opens a round.
     * @param state the state, with diceLeft and players already right.
     * @param starterId who bids first.
     * @param decision the decision that opened it.
     * @param preface a sentence to put before the round, or an empty string.
     * @returns the step.
     */
    const open = (state: DiceState, starterId: string, decision: string, preface: string): Step<DiceState> => {
        const serial: number = state.serial + 1;
        const dice: Record<string, number[]> = {};
        for (const player of inPlay(state)) {
            dice[player.playerId] = rollDice(state.diceLeft[player.playerId] ?? 0, random);
        }
        const next: DiceState = {
            ...state,
            phase: "looking",
            serial,
            dice,
            starterId,
            bidderId: starterId,
            bid: null,
            bids: [],
            draft: null,
            page: 0,
            challengerId: null,
            reveal: null,
        };
        const round: string = `A new round begins, number ${state.challenges + 1}, with ${totalDice(next)} dice on the table: ${countsSaid(next)}.`;
        const text: string = `${preface}${round} Every die is on its owner's phone and you know none of them. ${nameIn(state.players, starterId)} bids first.`;
        return { state: next, facts: publicFact("round", text, decision), nextPhaseId: "looking", timers: { [`look${serial}`]: decisions.lookSeconds } };
    };

    /**
     * Records a bid and passes the turn.
     * @param state the state while bidding.
     * @param bid the bid, already known to be legal.
     * @param byClock true when the clock made it for a player who ran out of time.
     * @returns the step.
     */
    const place = (state: DiceState, bid: Bid, byClock: boolean): Step<DiceState> => {
        const bids: Bid[] = [...state.bids, bid];
        const bidderId: string | null = nextWithDice(seatsOf(state), state.diceLeft, bid.playerId);
        const next: DiceState = { ...state, bid, bids, bidderId, draft: null, page: 0 };
        const odds: { text: string; chance: number } = bidWithOdds(state, bid);
        const who: string = nameIn(state.players, bid.playerId);
        const lead: string = byClock === true ? `The clock ran out on ${who}, so a bid went in for them: ` : `${who} bids `;
        const text: string = `${lead}${odds.text}. ${nameIn(state.players, bidderId)} is up. Tease the bid, never the person.`;
        const quiet: boolean = byClock === false && odds.chance > REMARK_CHANCE;
        return { state: next, facts: publicFact("bid", text, DICE_DECISIONS.bid, quiet), timers: { [`bid${state.serial}.${bids.length}`]: decisions.bidSeconds } };
    };

    /**
     * Calls the standing bid. The cups stay down for a moment.
     * @param state the state while bidding, with a bid standing.
     * @param byClock true when the clock made the call.
     * @returns the step.
     */
    const challenge = (state: DiceState, byClock: boolean): Step<DiceState> => {
        const standing: Bid | null = state.bid;
        if (standing === null || state.bidderId === null) {
            return { state, facts: [] };
        }
        const next: DiceState = { ...state, phase: "lifting", challengerId: state.bidderId, draft: null, page: 0 };
        const caller: string = nameIn(state.players, state.bidderId);
        const lead: string = byClock === true ? `The clock ran out on ${caller}, so the call was made for them: they challenge` : `${caller} challenges`;
        const called: string = `${lead} ${nameIn(state.players, standing.playerId)}'s bid of ${sayBid(standing.quantity, standing.face)}.`;
        const text: string = `${called} The cups are about to be lifted and nobody, you included, knows what is under them. Build the moment; do not guess the result.`;
        return { state: next, facts: publicFact("challenge", text, DICE_DECISIONS.bid), nextPhaseId: "lifting", timers: { [`lift${state.serial}`]: decisions.liftSeconds } };
    };

    /**
     * Ends the game.
     * @param state the state.
     * @param ending why, in a few plain words.
     * @returns the step.
     */
    const finish = (state: DiceState, ending: string): Step<DiceState> => {
        const standing: CartridgePlayer[] = inPlay(state);
        const most: number = Math.max(0, ...standing.map((player: CartridgePlayer) => state.diceLeft[player.playerId] ?? 0));
        const winners: CartridgePlayer[] = standing.filter((player: CartridgePlayer) => (state.diceLeft[player.playerId] ?? 0) === most);
        const winnerIds: string[] = winners.map((player: CartridgePlayer) => player.playerId);
        const next: DiceState = { ...state, phase: "end", winnerIds, ending, bidderId: null, draft: null, page: 0 };
        const names: string = winners.map((player: CartridgePlayer) => player.name).join(" and ");
        const text: string = names === "" ? `${ending} Nobody is left at the table.` : `${ending} ${names} win${winners.length === 1 ? "s" : ""} with ${most} ${most === 1 ? "die" : "dice"} left. Make it a send-off.`;
        return { state: next, facts: publicFact("game-over", text, DICE_DECISIONS.rounds), nextPhaseId: "end" };
    };

    /**
     * Lifts the cups: counts, takes a die and says what it found.
     * @param state the state while lifting.
     * @returns the step.
     */
    const resolve = (state: DiceState): Step<DiceState> => {
        const standing: Bid | null = state.bid;
        if (standing === null || state.challengerId === null) {
            return { state, facts: [] };
        }
        const hands: Hand[] = inPlay(state).map((player: CartridgePlayer): Hand => {
            const cup: number[] = [...(state.dice[player.playerId] ?? [])].sort((first: number, second: number) => first - second);
            return { playerId: player.playerId, name: player.name, dice: cup };
        });
        const count: number = countFace(hands.map((hand: Hand) => hand.dice), standing.face, decisions.wildOnes);
        const held: boolean = count >= standing.quantity;
        const loserId: string = held === true ? state.challengerId : standing.playerId;
        const lost: number = held === true && count === standing.quantity ? decisions.exactLoss : 1;
        const left: number = Math.max(0, (state.diceLeft[loserId] ?? 0) - lost);
        const diceLeft: Record<string, number> = { ...state.diceLeft, [loserId]: left };
        const reveal: Reveal = {
            bid: standing,
            bidderName: nameIn(state.players, standing.playerId),
            challengerName: nameIn(state.players, state.challengerId),
            count,
            held,
            loserId,
            loserName: nameIn(state.players, loserId),
            lost,
            left,
            hands,
        };
        const after: DiceState = { ...state, diceLeft, challenges: state.challenges + 1 };
        const starterId: string | null = left > 0 ? loserId : nextWithDice(seatsOf(after), diceLeft, loserId);
        const next: DiceState = { ...after, phase: "reveal", reveal, starterId, bidderId: null, draft: null, page: 0 };
        const cups: string = hands.map((hand: Hand) => `${hand.name} ${hand.dice.join(" ")}`).join("; ");
        const wild: string = decisions.wildOnes === true && standing.face !== 1 ? ", counting ones as wild" : "";
        const verdict: string = held === true
            ? `${count === standing.quantity ? "Dead on" : "The bid held"}: ${count} ${faceWord(standing.face, count !== 1)}${wild}. ${reveal.challengerName} was wrong to challenge`
            : `The bid fell short: only ${count} ${faceWord(standing.face, count !== 1)}${wild}. ${reveal.bidderName} was bluffing`;
        const fate: string = left === 0
            ? `${reveal.loserName} loses ${lost === 1 ? "a die" : `${numberWord(lost)} dice`} and is out of the game`
            : `${reveal.loserName} loses ${lost === 1 ? "a die" : `${numberWord(lost)} dice`} and has ${left} left`;
        const called: string = `${reveal.challengerName} challenged ${reveal.bidderName}'s bid of ${sayBid(standing.quantity, standing.face)}.`;
        const text: string = `The cups are up. ${called} Under the cups: ${cups}. ${verdict}. ${fate}. Count them out slowly, then give the verdict.`;
        return { state: next, facts: publicFact("reveal", text, DICE_DECISIONS.exact), nextPhaseId: "reveal", timers: { [`reveal${state.serial}`]: decisions.revealSeconds } };
    };

    /**
     * What follows a reveal: the next round, or the end.
     * @param state the state while the result is up.
     * @returns the step.
     */
    const afterReveal = (state: DiceState): Step<DiceState> => {
        if (inPlay(state).length < 2) {
            return finish(state, "Only one player has dice left.");
        }
        if (state.challenges >= decisions.maxRounds) {
            return finish(state, `That was challenge ${decisions.maxRounds}, the last of the night.`);
        }
        const starterId: string | null = state.starterId ?? nextWithDice(seatsOf(state), state.diceLeft, null);
        return starterId === null ? finish(state, "Nobody is left.") : open(state, starterId, DICE_DECISIONS.reveal, "");
    };

    /**
     * Someone left. A round in progress is void and rolled again; a result on show carries on;
     * the game ends if fewer than two are left with dice.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const someoneLeft = (state: DiceState, playerId: string): Step<DiceState> => {
        const name: string = nameIn(state.players, playerId);
        const hadDice: boolean = (state.diceLeft[playerId] ?? 0) > 0;
        const diceLeft: Record<string, number> = Object.fromEntries(Object.entries(state.diceLeft).filter(([id]: [string, number]) => id !== playerId));
        const dice: Record<string, number[]> = Object.fromEntries(Object.entries(state.dice).filter(([id]: [string, number[]]) => id !== playerId));
        const seatsBefore: string[] = seatsOf(state);
        const stripped: DiceState = { ...state, players: state.players.filter((player: CartridgePlayer) => player.playerId !== playerId), diceLeft, dice };
        if (state.phase === "end") {
            return { state: stripped, facts: [] };
        }
        if (inPlay(stripped).length < 2) {
            return finish(stripped, hadDice === true ? `${name} left the table.` : "Only one player has dice left.");
        }
        const following: string | null = nextWithDice(seatsBefore, diceLeft, playerId);
        if (hadDice === false) {
            return { state: stripped, facts: [] };
        }
        if (state.phase === "reveal") {
            return { state: state.starterId === playerId ? { ...stripped, starterId: following } : stripped, facts: [] };
        }
        return following === null ? finish(stripped, "Nobody is left.") : open(stripped, following, DICE_DECISIONS.dice, `${name} left the table, so this round is void and every die is rolled again. `);
    };

    /**
     * The standing bid, said plainly.
     * @param state the state.
     * @returns for example "Spoon bid four fives", or an empty string with no bid.
     */
    const standingSaid = (state: DiceState): string => (state.bid === null ? "" : `${nameIn(state.players, state.bid.playerId)} bid ${sayBid(state.bid.quantity, state.bid.face)}.`);

    /**
     * The buttons the player who is bidding is offered: quantities to raise to, then faces.
     * @param state the state.
     * @param playerId the player.
     * @returns the raise options and the challenge option, kept apart so a thumb can't hit one for the other.
     */
    const bidOptions = (state: DiceState, playerId: string): { raise: ControlOption[]; challenge: ControlOption[] } => {
        if (state.phase !== "bidding" || state.bidderId !== playerId) {
            return { raise: [], challenge: [] };
        }
        if (state.draft !== null) {
            const faces: ControlOption[] = faceChoices(state.draft, state.bid).map((face: number): ControlOption => {
                return { id: `${FACE_PREFIX}${face}`, label: capital(faceWord(face, true)) };
            });
            return { raise: [...faces, { id: BACK_ACTION, label: "Back" }], challenge: [] };
        }
        const total: number = totalDice(state);
        const quantities: ControlOption[] = quantityChoices(state.bid, total, state.page).map((quantity: number): ControlOption => {
            return { id: `${QUANTITY_PREFIX}${quantity}`, label: String(quantity) };
        });
        const paging: ControlOption[] = [
            ...(hasHigherPage(state.bid, total, state.page) === true ? [{ id: HIGHER_ACTION, label: "More" }] : []),
            ...(state.page > 0 ? [{ id: LOWER_ACTION, label: "Fewer" }] : []),
        ];
        const called: ControlOption[] = state.bid === null ? [] : [{ id: CHALLENGE_ACTION, label: `Challenge ${nameIn(state.players, state.bid.playerId)}` }];
        return { raise: [...quantities, ...paging], challenge: called };
    };

    /**
     * What a player may press now.
     * @param state the state.
     * @param playerId the player.
     * @returns the actions.
     */
    const legalFor = (state: DiceState, playerId: string): LegalAction[] => {
        const options: { raise: ControlOption[]; challenge: ControlOption[] } = bidOptions(state, playerId);
        return [...options.raise, ...options.challenge].map((option: ControlOption): LegalAction => ({ actionId: option.id, label: option.label }));
    };

    /**
     * A player's rolled dice as the secret card shows them.
     * @param state the state.
     * @param playerId the player.
     * @returns the control, or null when they hold none or none are rolled.
     */
    const diceCard = (state: DiceState, playerId: string): Control | null => {
        const mine: number[] | undefined = state.dice[playerId];
        if (mine === undefined || state.phase === "reveal" || state.phase === "end") {
            return null;
        }
        return { type: "roleCard", title: `Your ${mine.length === 1 ? "die" : "dice"}`, body: mine.join("   "), secret: true };
    };

    const cartridge: Cartridge<DiceState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<DiceState> {
            const diceLeft: Record<string, number> = Object.fromEntries(players.map((player: CartridgePlayer): [string, number] => [player.playerId, decisions.startingDice]));
            const state: DiceState = {
                phase: "looking",
                players,
                diceLeft,
                dice: {},
                serial: 0,
                challenges: 0,
                starterId: null,
                bidderId: null,
                bid: null,
                bids: [],
                draft: null,
                page: 0,
                challengerId: null,
                reveal: null,
                winnerIds: [],
                ending: "",
            };
            const first: string | undefined = players[0]?.playerId;
            return first === undefined ? finish(state, "Nobody came to the table.") : open(state, first, DICE_DECISIONS.dice, "");
        },

        phaseOf(state: DiceState): string {
            return state.phase;
        },

        outOf(state: DiceState): string[] {
            return state.players.filter((player: CartridgePlayer) => (state.diceLeft[player.playerId] ?? 0) === 0).map((player: CartridgePlayer) => player.playerId);
        },

        turn(state: DiceState): Turn | null {
            return state.phase === "bidding" && state.bidderId !== null ? { kind: "one", playerId: state.bidderId, label: state.bid === null ? "Open the bidding" : "Raise or challenge" } : null;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: DiceState, playerId: string): LegalAction[] {
            return legalFor(state, playerId);
        },

        apply(state: DiceState, playerId: string, actionId: string): Step<DiceState> {
            if (legalFor(state, playerId).some((action: LegalAction) => action.actionId === actionId) === false) {
                return { state, facts: [] };
            }
            if (actionId === CHALLENGE_ACTION) {
                return challenge(state, false);
            }
            if (actionId === BACK_ACTION) {
                return { state: { ...state, draft: null }, facts: [] };
            }
            if (actionId === HIGHER_ACTION || actionId === LOWER_ACTION) {
                return { state: { ...state, page: Math.max(0, state.page + (actionId === HIGHER_ACTION ? 1 : -1)) }, facts: [] };
            }
            if (actionId.startsWith(QUANTITY_PREFIX) === true) {
                return { state: { ...state, draft: Number(actionId.slice(QUANTITY_PREFIX.length)) }, facts: [] };
            }
            const bid: Bid = { playerId, quantity: state.draft ?? 0, face: Number(actionId.slice(FACE_PREFIX.length)) };
            return beats(bid.quantity, bid.face, state.bid) === true ? place(state, bid, false) : { state, facts: [] };
        },

        onEvent(state: DiceState, event: RoomEvent): Step<DiceState> {
            if (event.type === "playerLeft" && state.players.some((player: CartridgePlayer) => player.playerId === event.playerId) === true) {
                return someoneLeft(state, event.playerId);
            }
            if (event.type !== "timerFired") {
                return { state, facts: [] };
            }
            if (state.phase === "looking" && event.timerId === `look${state.serial}` && state.bidderId !== null) {
                const next: DiceState = { ...state, phase: "bidding" };
                const text: string = `Bidding is open. ${nameIn(state.players, state.bidderId)} goes first.`;
                return { state: next, facts: publicFact("bidding", text, DICE_DECISIONS.look, true), nextPhaseId: "bidding", timers: { [`bid${state.serial}.0`]: decisions.bidSeconds } };
            }
            if (state.phase === "bidding" && event.timerId === `bid${state.serial}.${state.bids.length}` && state.bidderId !== null) {
                if (state.bid !== null) {
                    return challenge(state, true);
                }
                const opening: { quantity: number; face: number } = clockOpening(totalDice(state));
                return place(state, { playerId: state.bidderId, ...opening }, true);
            }
            if (state.phase === "lifting" && event.timerId === `lift${state.serial}`) {
                return resolve(state);
            }
            if (state.phase === "reveal" && event.timerId === `reveal${state.serial}`) {
                return afterReveal(state);
            }
            return { state, facts: [] };
        },

        publicScene(state: DiceState): Scene {
            const round: string = `Round ${state.challenges + (state.phase === "reveal" || state.phase === "end" ? 0 : 1)}`;
            const left = (heading: string): SceneBlock => ({ type: "text", text: `${heading}: ${state.players.map((player: CartridgePlayer) => `${player.name} ${state.diceLeft[player.playerId] ?? 0}`).join(", ")}`, emphasis: "whisper" });
            if (state.phase === "looking") {
                return {
                    mood: "night",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: "Look at your dice", kicker: round },
                        { type: "text", text: `${totalDice(state)} dice under the cups. Press and hold your phone to peek.`, emphasis: "large" },
                        left("Dice left"),
                        { type: "timer", seconds: decisions.lookSeconds, label: "until bidding opens", running: true },
                    ],
                };
            }
            if (state.phase === "bidding") {
                const bidder: string = nameIn(state.players, state.bidderId);
                const earlier: string = state.bids.slice(-4, -1).map((bid: Bid) => `${nameIn(state.players, bid.playerId)} ${sayBid(bid.quantity, bid.face)}`).join(", ");
                const blocks: SceneBlock[] = [
                    state.bid === null
                        ? { type: "title", text: "Opening bid", kicker: `${totalDice(state)} dice on the table, ${round.toLowerCase()}` }
                        : { type: "title", text: capital(sayBid(state.bid.quantity, state.bid.face)), kicker: `${nameIn(state.players, state.bid.playerId)} bid, ${totalDice(state)} dice on the table` },
                    { type: "text", text: state.bid === null ? `${bidder} opens the bidding.` : `${bidder}: raise it or challenge.`, emphasis: "large" },
                ];
                if (earlier !== "") {
                    blocks.push({ type: "text", text: `Before that: ${earlier}`, emphasis: "whisper" });
                }
                blocks.push(left("Dice left"), { type: "timer", seconds: decisions.bidSeconds, label: `for ${bidder}`, running: true });
                return { mood: "tense", transition: "cut", blocks };
            }
            if (state.phase === "lifting") {
                const standing: Bid | null = state.bid;
                return {
                    mood: "tense",
                    transition: "dim",
                    blocks: [
                        { type: "title", text: "Cups up", kicker: `${nameIn(state.players, state.challengerId)} challenged ${nameIn(state.players, standing?.playerId ?? null)}` },
                        { type: "text", text: standing === null ? "" : `The bid: ${sayBid(standing.quantity, standing.face)}.`, emphasis: "large" },
                        left("Dice left"),
                    ],
                };
            }
            if (state.phase === "reveal" && state.reveal !== null) {
                const reveal: Reveal = state.reveal;
                const shown: string[] = reveal.hands.map((hand: Hand) => `${hand.name}: ${hand.dice.join(HAND_SEPARATOR)}`);
                const perLine: number = shown.length <= HAND_LINES_UP_TO ? 1 : 2;
                const rows: SceneBlock[] = [];
                for (let index = 0; index < shown.length; index += perLine) {
                    rows.push({ type: "text", text: shown.slice(index, index + perLine).join(HANDS_GAP), emphasis: "normal" });
                }
                return {
                    mood: "dawn",
                    transition: "slide",
                    blocks: [
                        { type: "title", text: reveal.held === true ? "The bid held" : "A bluff", kicker: `${reveal.bidderName} bid ${sayBid(reveal.bid.quantity, reveal.bid.face)}` },
                        { type: "text", text: `${reveal.count} counted. ${reveal.loserName} ${reveal.left === 0 ? "is out" : `loses ${reveal.lost === 1 ? "a die" : `${numberWord(reveal.lost)} dice`}`}.`, emphasis: "large" },
                        ...rows,
                        left("Dice left"),
                    ],
                };
            }
            const winners: string = state.players.filter((player: CartridgePlayer) => state.winnerIds.includes(player.playerId)).map((player: CartridgePlayer) => player.name).join(" and ");
            return {
                mood: "victory",
                transition: "fade",
                blocks: [{ type: "title", text: winners === "" ? "No winner" : `${winners} won`, kicker: box.name }, { type: "text", text: state.ending, emphasis: "large" }, left("Dice at the end")],
            };
        },

        privateControls(state: DiceState, playerId: string): Control[] {
            if ((state.diceLeft[playerId] ?? 0) === 0 && state.players.some((player: CartridgePlayer) => player.playerId === playerId) === true && state.phase !== "end") {
                return [{ type: "waiting", text: "You're out. Watch the cups." }];
            }
            const card: Control | null = diceCard(state, playerId);
            const controls: Control[] = card === null ? [] : [card];
            if (state.phase === "looking") {
                return [...controls, { type: "waiting", text: "Hold the card to peek. Bidding opens soon." }];
            }
            if (state.phase === "lifting") {
                return [...controls, { type: "waiting", text: "Cups up. Look at the screen." }];
            }
            if (state.phase === "reveal" && state.reveal !== null) {
                const lost: boolean = state.reveal.loserId === playerId;
                return [{ type: "notice", text: lost === true ? `You lose ${state.reveal.lost === 1 ? "a die" : `${numberWord(state.reveal.lost)} dice`}.` : `${state.reveal.loserName} loses a die.`, tone: "info" }, { type: "waiting", text: "Look at the screen." }];
            }
            if (state.phase === "end") {
                return [{ type: "waiting", text: "That's the game." }];
            }
            const options: { raise: ControlOption[]; challenge: ControlOption[] } = bidOptions(state, playerId);
            if (options.raise.length === 0 && options.challenge.length === 0) {
                const standing: Control[] = state.bid === null ? [] : [{ type: "notice", text: standingSaid(state), tone: "info" }];
                return [...controls, ...standing, { type: "waiting", text: `Waiting for ${nameIn(state.players, state.bidderId)} to bid.` }];
            }
            const prompt: string = state.draft !== null
                ? `${capital(numberWord(state.draft))} of which number?`
                : state.bid === null
                    ? `You open. How many dice show the same number, across every cup? ${totalDice(state)} on the table.`
                    : `${standingSaid(state)} Raise to how many?`;
            const challenge: Control[] = options.challenge.length === 0 ? [] : [{ type: "buttons", options: options.challenge }];
            return [...controls, ...challenge, { type: "buttons", prompt, options: options.raise }];
        },

        hostFacts(state: DiceState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase === "end") {
                return [];
            }
            const table: string = `${totalDice(state)} dice on the table: ${countsSaid(state)}.`;
            const bidding: string = state.phase === "bidding" ? ` ${nameIn(state.players, state.bidderId)} is up. ${state.bid === null ? "No bid yet." : `${standingSaid(state)} Odds: ${bidWithOdds(state, state.bid).text}.`}` : "";
            return [{ scope: { kind: "public" }, kind: "table", text: `${table}${bidding}` }];
        },

        outcome(state: DiceState): string | null {
            return state.phase === "end" ? state.ending : null;
        },
    };

    return {
        cartridge,
        hidden(state: DiceState): HiddenValue[] {
            if (state.phase === "reveal" || state.phase === "end") {
                return [];
            }
            const owners: CartridgePlayer[] = state.players.filter((player: CartridgePlayer) => (state.dice[player.playerId]?.length ?? 0) >= 3);
            return owners.map((player: CartridgePlayer): HiddenValue => ({ label: `${player.name}'s dice`, text: (state.dice[player.playerId] ?? []).join(" "), seenBy: [player.playerId], near: player.name }));
        },
    };
}
