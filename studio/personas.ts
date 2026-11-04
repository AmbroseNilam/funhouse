// The paper players for each kit. Each persona is a way of playing that also scripts the judge,
// since a rehearsal has no model. Personas read the decisions, the rulings the phase allows and
// what each player may press, never hardcoded ids, so a valid game with renamed parts still
// rehearses. Between them they reach every ending a kit has.

import type { CartridgePlayer, LegalAction } from "../shared/cartridge.ts";
import type { IdentityBlueprint, PlantBlueprint, TapBlueprint } from "./blueprint.ts";
import type { AnswerDecision, AnswerRuling, GuessingDecisions, GuessingState } from "./kits/guessing.ts";
import { createIdentityGame, type Identity, type IdentityState } from "./kits/identity.ts";
import { createPlantGame, VOTE_PREFIX, type PlantState } from "./kits/plant.ts";
import { createFitsGame, FITS_PREFIX, type FitsDecisions, type FitsState } from "./kits/tap-fits.ts";
import type { KitGame } from "./kit/kit.ts";
import { seededRandom } from "./kit/primitives.ts";
import type { Glimpse, Move, Persona, RoleCheck, TraceEvent } from "./rehearse.ts";

/** Seconds a quiet table lets pass at a time. */
const QUIET_SECONDS: number = 30;

/**
 * Who speaks on a given move, going round the table.
 * @param players who is at the table.
 * @param turn the move number.
 * @returns their id.
 */
function speakerOf(players: readonly CartridgePlayer[], turn: number): string {
    return players[turn % Math.max(1, players.length)]?.playerId ?? "nobody";
}

/**
 * The first thing a player may press, or null.
 * @param glimpse what the persona sees.
 * @param playerId the player.
 * @returns the action id, or null.
 */
function firstAction<State>(glimpse: Glimpse<State>, playerId: string): string | null {
    const actions: LegalAction[] = glimpse.legal(playerId);
    return actions[0]?.actionId ?? null;
}

/**
 * The guessing kit's personas: one who finds it, one who gives up, one who never guesses right,
 * and one who chats between questions.
 * @param decisions the game's decisions.
 * @returns the personas.
 */
export function guessingPersonas(decisions: GuessingDecisions): Persona<GuessingState>[] {
    const answers: [string, AnswerDecision][] = Object.entries(decisions.answers);
    const spending: string[] = answers.filter(([, answer]: [string, AnswerDecision]) => answer.spends === true).map(([name]: [string, AnswerDecision]) => name);
    /**
     * A ruling that costs one of the count and the phase allows.
     * @param glimpse what the persona sees.
     * @param turn picks among them.
     * @returns the ruling.
     */
    const costly = (glimpse: Glimpse<GuessingState>, turn: number): string => {
        const allowed: string[] = spending.filter((name: string) => glimpse.rulings.includes(name) === true);
        return allowed[turn % Math.max(1, allowed.length)] ?? "no";
    };
    const say = (glimpse: Glimpse<GuessingState>, text: string, ruling: string | null): Move => ({ kind: "say", playerId: speakerOf(glimpse.players, glimpse.turn), text, ruling });
    return [
        {
            name: "the finder",
            move: (glimpse: Glimpse<GuessingState>): Move => (glimpse.turn >= 8 ? say(glimpse, "Is it the thing I think it is?", "correct") : say(glimpse, `Question ${glimpse.turn}?`, costly(glimpse, glimpse.turn))),
        },
        {
            name: "the giver-up",
            move(glimpse: Glimpse<GuessingState>): Move {
                if (glimpse.turn < 4) {
                    return say(glimpse, `Question ${glimpse.turn}?`, costly(glimpse, glimpse.turn));
                }
                const playerId: string = speakerOf(glimpse.players, glimpse.turn);
                const action: string | null = firstAction(glimpse, playerId);
                return action === null ? say(glimpse, "We give up.", "giveup") : { kind: "press", playerId, actionId: action };
            },
        },
        {
            name: "the stubborn one",
            move: (glimpse: Glimpse<GuessingState>): Move => say(glimpse, `Is it a wrong thing number ${glimpse.turn}?`, costly(glimpse, glimpse.turn)),
        },
        {
            name: "the chatterer",
            move: (glimpse: Glimpse<GuessingState>): Move => (glimpse.turn % 2 === 1 ? say(glimpse, "Did anyone feed the cat?", null) : say(glimpse, `Question ${glimpse.turn}?`, costly(glimpse, glimpse.turn))),
        },
    ];
}

/** Which answer rulings the plant kit spends a question on, as a persona would know them. */
const PLANT_ANSWERS: readonly AnswerRuling[] = ["yes", "no"];

/**
 * The plant kit's personas, between them reaching every ending: caught, got away with it, out of
 * questions, out of time, gave up, the Plant walking out, someone leaving mid-vote, and a vote
 * nobody finishes.
 * @returns the personas.
 */
export function plantPersonas(): Persona<PlantState>[] {
    /**
     * Someone who isn't the Plant, chosen by turn.
     * @param glimpse what the persona sees.
     * @param turn picks among them.
     * @returns their id.
     */
    const asker = (glimpse: Glimpse<PlantState>, turn: number): string => {
        const others: CartridgePlayer[] = glimpse.players.filter((player: CartridgePlayer) => player.playerId !== glimpse.state.plantId);
        return others[turn % Math.max(1, others.length)]?.playerId ?? glimpse.state.plantId;
    };
    const question = (glimpse: Glimpse<PlantState>, playerId: string): Move => ({ kind: "say", playerId, text: `Question ${glimpse.turn}?`, ruling: PLANT_ANSWERS[glimpse.turn % 2] ?? "no" });
    /**
     * The next voter who hasn't voted, voting by a rule, or a wait when everyone has.
     * @param glimpse what the persona sees.
     * @param choose picks a target from the voter's options.
     * @param skip voters who never vote.
     * @returns the move.
     */
    const vote = (glimpse: Glimpse<PlantState>, choose: (voterId: string, options: string[]) => string, skip: readonly string[] = []): Move => {
        const voter: string | undefined = glimpse.state.voters.find((id: string) => glimpse.state.votes[id] === undefined && skip.includes(id) === false);
        if (voter === undefined) {
            return { kind: "wait", seconds: 10 };
        }
        const options: string[] = glimpse.legal(voter).map((action: LegalAction) => action.actionId.slice(VOTE_PREFIX.length));
        return { kind: "press", playerId: voter, actionId: `${VOTE_PREFIX}${choose(voter, options)}` };
    };
    const waitToRead: Move = { kind: "wait", seconds: 5 };
    return [
        {
            name: "the steerer, caught",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return waitToRead;
                }
                if (glimpse.phase === "vote") {
                    return vote(glimpse, (voterId: string, options: string[]) => (voterId === glimpse.state.plantId ? options[0] ?? "" : glimpse.state.plantId));
                }
                if (glimpse.state.asked.length >= 5) {
                    return { kind: "say", playerId: glimpse.state.plantId, text: `Is it a ${glimpse.state.word}?`, ruling: "correct" };
                }
                return question(glimpse, glimpse.state.asked.length === 3 ? glimpse.state.plantId : asker(glimpse, glimpse.turn));
            },
        },
        {
            name: "the slippery Plant",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return waitToRead;
                }
                if (glimpse.phase === "vote") {
                    const finder: string = glimpse.state.finderId ?? "";
                    return vote(glimpse, (voterId: string, options: string[]) => (voterId === finder ? options.find((id: string) => id !== glimpse.state.plantId) ?? "" : finder));
                }
                if (glimpse.state.asked.length >= 6) {
                    return { kind: "say", playerId: asker(glimpse, 1), text: "Is it that?", ruling: "correct" };
                }
                return question(glimpse, asker(glimpse, glimpse.turn));
            },
        },
        {
            name: "the lost table",
            move: (glimpse: Glimpse<PlantState>): Move => (glimpse.phase === "choosing" ? waitToRead : question(glimpse, asker(glimpse, glimpse.turn))),
        },
        {
            name: "the quiet table",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "asking" && glimpse.turn > 30) {
                    return { kind: "press", playerId: asker(glimpse, 0), actionId: firstAction(glimpse, asker(glimpse, 0)) ?? "" };
                }
                return { kind: "wait", seconds: QUIET_SECONDS };
            },
        },
        {
            name: "the walkout",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return waitToRead;
                }
                return glimpse.state.asked.length >= 3 ? { kind: "leave", playerId: glimpse.state.plantId } : question(glimpse, asker(glimpse, glimpse.turn));
            },
        },
        {
            name: "the half-finished vote",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return waitToRead;
                }
                if (glimpse.phase === "vote") {
                    const late: string = asker(glimpse, 2);
                    return vote(glimpse, (_voterId: string, options: string[]) => options[0] ?? "", [late]);
                }
                if (glimpse.state.asked.length >= 2) {
                    return { kind: "say", playerId: asker(glimpse, 0), text: "Is it that?", ruling: "correct" };
                }
                return question(glimpse, asker(glimpse, glimpse.turn));
            },
        },
        {
            name: "the leaver mid-vote",
            move(glimpse: Glimpse<PlantState>): Move {
                if (glimpse.phase === "choosing") {
                    return waitToRead;
                }
                if (glimpse.phase === "vote") {
                    const leaver: string = asker(glimpse, 1);
                    const voted: number = Object.keys(glimpse.state.votes).length;
                    if (voted === glimpse.state.voters.length - 1 && glimpse.state.votes[leaver] === undefined) {
                        return { kind: "leave", playerId: leaver };
                    }
                    return vote(glimpse, (_voterId: string, options: string[]) => options[0] ?? "", [leaver]);
                }
                return glimpse.state.asked.length >= 2 ? { kind: "say", playerId: asker(glimpse, 0), text: "Is it that?", ruling: "correct" } : question(glimpse, asker(glimpse, glimpse.turn));
            },
        },
    ];
}

/**
 * The plant kit's role check: the same game with the Plant dealt to each seat in turn, and a
 * script played the same way whoever it is: the word comes, reading ends, two questions are
 * asked and ruled, someone finds the word, and two people vote. Every view but the Plant's must
 * stay the same, through the vote and up to the reveal.
 * @param blueprint the game.
 * @returns the check.
 */
export function plantRoleCheck(blueprint: PlantBlueprint): RoleCheck<PlantState> {
    const script: TraceEvent[] = [
        { type: "contentReady", at: 0, text: "teapot" },
        { type: "timerFired", at: 10, timerId: "read" },
        { type: "speechEnded", at: 12, playerId: "paper1", text: "Is it metal?" },
        { type: "hostRuled", at: 13, ruling: "no", detail: "", playerId: "paper1" },
        { type: "speechEnded", at: 15, playerId: "paper2", text: "Is it in a kitchen?" },
        { type: "hostRuled", at: 16, ruling: "yes", detail: "", playerId: "paper2" },
        { type: "speechEnded", at: 18, playerId: "paper3", text: "Is it a teapot?" },
        { type: "hostRuled", at: 19, ruling: "correct", detail: "", playerId: "paper3" },
        { type: "input", playerId: "paper1", actionId: `${VOTE_PREFIX}paper2` },
        { type: "input", playerId: "paper2", actionId: `${VOTE_PREFIX}paper1` },
    ];
    return {
        deal(seat: number, players: readonly CartridgePlayer[]): KitGame<PlantState> {
            const draws: number[] = [0, (seat + 0.5) / players.length];
            return createPlantGame(blueprint.box, blueprint.decisions, () => draws.shift() ?? 0);
        },
        script,
    };
}

/**
 * Who Fits' personas: a table that taps at once, one where someone never taps so the clock runs
 * out, one where someone leaves mid-round, and one where nobody taps at all.
 * @returns the personas.
 */
export function fitsPersonas(): Persona<FitsState>[] {
    /**
     * The next tapper who hasn't tapped, tapping their first choice, or a wait for the clock.
     * @param glimpse what the persona sees.
     * @param skip tappers who never tap.
     * @returns the move.
     */
    const tapNext = (glimpse: Glimpse<FitsState>, skip: readonly string[] = []): Move => {
        const tapper: string | undefined = glimpse.state.tappers.find((id: string) => glimpse.state.taps[id] === undefined && skip.includes(id) === false);
        const action: string | null = tapper === undefined ? null : firstAction(glimpse, tapper);
        return tapper === undefined || action === null ? { kind: "wait", seconds: 10 } : { kind: "press", playerId: tapper, actionId: action };
    };
    return [
        { name: "the quick table", move: (glimpse: Glimpse<FitsState>): Move => (glimpse.phase === "tapping" ? tapNext(glimpse) : { kind: "wait", seconds: 10 }) },
        { name: "the one who never taps", move: (glimpse: Glimpse<FitsState>): Move => (glimpse.phase === "tapping" ? tapNext(glimpse, [glimpse.players[0]?.playerId ?? ""]) : { kind: "wait", seconds: 10 }) },
        {
            name: "the one who leaves",
            move(glimpse: Glimpse<FitsState>): Move {
                const leaver: string | undefined = glimpse.players[1]?.playerId;
                if (glimpse.phase === "tapping" && glimpse.state.round === 1 && leaver !== undefined && glimpse.players.length > 3) {
                    return { kind: "leave", playerId: leaver };
                }
                return glimpse.phase === "tapping" ? tapNext(glimpse) : { kind: "wait", seconds: 10 };
            },
        },
        { name: "the table that never taps", move: (): Move => ({ kind: "wait", seconds: 15 }) },
    ];
}

/**
 * Who Fits' secrecy check: the same taps are played, except that one player taps someone else,
 * and nothing anyone else sees may change before the counts are shown. Only two people tap, so the
 * round stays open at any table size.
 * @param blueprint the game.
 * @returns the check.
 */
export function fitsTapCheck(blueprint: TapBlueprint & { decisions: FitsDecisions }): RoleCheck<FitsState> {
    const script: TraceEvent[] = [
        { type: "contentReady", at: 0, text: "" },
        { type: "input", playerId: "paper1", actionId: `${FITS_PREFIX}paper2` },
        { type: "input", playerId: "paper2", actionId: `${FITS_PREFIX}paper3` },
    ];
    return {
        deal(seat: number, players: readonly CartridgePlayer[]): KitGame<FitsState> {
            const game: KitGame<FitsState> = createFitsGame(blueprint.box, blueprint.decisions);
            const changer: string | undefined = players[seat]?.playerId;
            /**
             * The changed player's tap, aimed at someone else.
             * @param state the state.
             * @param playerId who tapped.
             * @param actionId what they tapped.
             * @returns the tap to play.
             */
            const changed = (state: FitsState, playerId: string, actionId: string): string => {
                if (playerId !== changer) {
                    return actionId;
                }
                const other: CartridgePlayer | undefined = state.players.find((player: CartridgePlayer) => {
                    return player.playerId !== playerId && `${FITS_PREFIX}${player.playerId}` !== actionId;
                });
                return other === undefined ? actionId : `${FITS_PREFIX}${other.playerId}`;
            };
            return {
                cartridge: {
                    ...game.cartridge,
                    apply: (state: FitsState, playerId: string, actionId: string) => game.cartridge.apply(state, playerId, changed(state, playerId, actionId)),
                },
                hidden: (state: FitsState) => game.hidden(state),
            };
        },
        script,
    };
}

/**
 * Name Tag's personas, between them reaching every ending of a turn: found out, out of questions,
 * out of time, passed, and the player on the spot leaving, plus a table that mumbles and talks
 * out of turn and a transcript that misspells the name.
 * @returns the personas.
 */
export function identityPersonas(): Persona<IdentityState>[] {
    /**
     * Who is on the spot, or the first seat.
     * @param glimpse what the persona sees.
     * @returns their id.
     */
    const spotlight = (glimpse: Glimpse<IdentityState>): string => glimpse.state.current ?? glimpse.players[0]?.playerId ?? "nobody";
    /**
     * Someone at the table who is not on the spot.
     * @param glimpse what the persona sees.
     * @returns their id.
     */
    const bystander = (glimpse: Glimpse<IdentityState>): string => glimpse.players.find((player: CartridgePlayer) => player.playerId !== glimpse.state.current)?.playerId ?? "nobody";
    const question = (glimpse: Glimpse<IdentityState>, playerId: string): Move => ({ kind: "say", playerId, text: `Am I something number ${glimpse.turn}?`, ruling: null });
    const idle: Move = { kind: "wait", seconds: 10 };
    /**
     * Says who the spotlight player is, as a guess.
     * @param glimpse what the persona sees.
     * @param spell changes the name before it is said.
     * @returns the move.
     */
    const guess = (glimpse: Glimpse<IdentityState>, spell: (name: string) => string = (name: string): string => name): Move => {
        const identity: Identity | undefined = glimpse.state.dealt[spotlight(glimpse)];
        return { kind: "say", playerId: spotlight(glimpse), text: `Am I ${spell(identity?.name ?? "nobody")}?`, ruling: null };
    };
    const asking = (glimpse: Glimpse<IdentityState>): boolean => glimpse.phase === "asking";
    return [
        { name: "the quick table", move: (glimpse: Glimpse<IdentityState>): Move => (asking(glimpse) ? (glimpse.state.asked >= 2 ? guess(glimpse) : question(glimpse, spotlight(glimpse))) : idle) },
        { name: "the table that runs out of questions", move: (glimpse: Glimpse<IdentityState>): Move => (asking(glimpse) ? question(glimpse, spotlight(glimpse)) : idle) },
        { name: "the table that goes quiet", move: (glimpse: Glimpse<IdentityState>): Move => (asking(glimpse) ? { kind: "wait", seconds: 20 } : idle) },
        {
            name: "the table that passes",
            move(glimpse: Glimpse<IdentityState>): Move {
                const action: string | null = asking(glimpse) ? firstAction(glimpse, spotlight(glimpse)) : null;
                return action === null ? idle : { kind: "press", playerId: spotlight(glimpse), actionId: action };
            },
        },
        {
            name: "the one who walks out",
            move(glimpse: Glimpse<IdentityState>): Move {
                if (asking(glimpse) && glimpse.state.turnNumber === 2 && glimpse.state.asked >= 1) {
                    return { kind: "leave", playerId: spotlight(glimpse) };
                }
                return asking(glimpse) ? (glimpse.state.asked >= 1 ? guess(glimpse) : question(glimpse, spotlight(glimpse))) : idle;
            },
        },
        {
            name: "the mumbler",
            move(glimpse: Glimpse<IdentityState>): Move {
                if (asking(glimpse) === false) {
                    return idle;
                }
                if (glimpse.turn % 4 === 0) {
                    return { kind: "say", playerId: bystander(glimpse), text: `I think they are ${glimpse.state.dealt[spotlight(glimpse)]?.name ?? ""}`, ruling: null };
                }
                if (glimpse.turn % 4 === 1) {
                    return { kind: "say", playerId: spotlight(glimpse), text: "Um", ruling: null };
                }
                return glimpse.state.asked >= 2 ? guess(glimpse, (name: string): string => `${name.slice(0, name.length - 3)}${name.slice(name.length - 2)}`) : question(glimpse, spotlight(glimpse));
            },
        },
    ];
}

/**
 * Name Tag's secrecy check: the same game with the name tags dealt differently, and a script played
 * the same way: the tags come out, the intro ends, the player on the spot asks two questions and
 * the hint clock fires. The TV and the host must stay the same whichever tags were dealt.
 * Other phones see the tags by design, so they are not compared; the leak check on every step
 * already requires that the owner's own phone never shows theirs.
 * @param blueprint the game.
 * @returns the check.
 */
export function identityNameCheck(blueprint: IdentityBlueprint): RoleCheck<IdentityState> {
    const script: TraceEvent[] = [
        { type: "contentReady", at: 0, text: "" },
        { type: "timerFired", at: 12, timerId: "intro" },
        { type: "speechEnded", at: 14, playerId: "paper1", text: "Am I alive right now?" },
        { type: "speechEnded", at: 20, playerId: "paper1", text: "Could you hold me in your hand?" },
        { type: "timerFired", at: 40, timerId: "hint1" },
    ];
    return {
        deal(seat: number): KitGame<IdentityState> {
            return createIdentityGame(blueprint.box, blueprint.decisions, seededRandom(seat + 11));
        },
        script,
        publicOnly: true,
    };
}
