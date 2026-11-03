// Proves the blueprint Twenty Doors decides what the hand-written one decides. The same events,
// including overlapping replies, chat, a player speaking twice, rulings that name nobody waiting,
// and giving up, are fed to both, and every step's phase, doors, recorded questions, finder and
// outcome must match. The live scenario proves the rest with the real host.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTwentyDoors, type AskedQuestion, type TwentyDoorsState } from "../cartridges/twenty-doors/rules.ts";
import type { Cartridge, CartridgePlayer } from "../shared/cartridge.ts";
import type { RoomEvent } from "../shared/timeline.ts";
import { TWENTY_DOORS_BLUEPRINT } from "./games/twenty-doors.ts";
import type { KitGame } from "./kit/kit.ts";
import { createGuessingGame, type GuessingState, type SaidLine } from "./kits/guessing.ts";
import { PAPER_PLAYERS } from "./rehearse.ts";

/** Three at the table. */
const PLAYERS: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 3);

/** What both games must agree on after every step. */
interface Decided {
    phase: string;
    doors: number;
    asked: string[];
    finder: string | null;
    outcome: string | null;
}

/**
 * Says something.
 * @param playerId who.
 * @param text what.
 * @returns the event.
 */
function said(playerId: string, text: string): RoomEvent {
    return { type: "speechEnded", at: 0, playerId, text };
}

/**
 * The host rules.
 * @param ruling the ruling.
 * @param playerId who it was answering, or null.
 * @returns the event.
 */
function ruled(ruling: string, playerId: string | null): RoomEvent {
    return { type: "hostRuled", at: 0, ruling, detail: "", playerId };
}

/** The sequences both games play, each after the secret is chosen. */
const SEQUENCES: { name: string; events: RoomEvent[] }[] = [
    { name: "a late answer after another player's correct guess", events: [said("paper1", "Is it alive?"), said("paper2", "Is it a platypus?"), ruled("no", "paper1"), ruled("correct", "paper2")] },
    { name: "a ruling that names nobody waiting", events: [said("paper1", "Is it big?"), said("paper2", "Is it small?"), ruled("yes", "paper3"), ruled("no", null), ruled("sortof", "paper1")] },
    { name: "the same player twice, then chat", events: [said("paper1", "First?"), said("paper1", "Second?"), ruled("no", "paper1"), said("paper3", "Who wants tea?"), ruled("wrong", "paper2")] },
    { name: "a correct ruling naming nobody waiting", events: [said("paper2", "Is it a whisk?"), ruled("correct", "paper3")] },
    { name: "a correct ruling with no name", events: [said("paper2", "Is it a platypus?"), ruled("correct", null)] },
    { name: "rulings with nothing waiting, then giving up", events: [ruled("yes", "paper1"), ruled("correct", "paper1"), ruled("giveup", null)] },
];

/**
 * What the hand-written game decided.
 * @param game the rules.
 * @param state the state.
 * @returns the decisions.
 */
function handWritten(game: Cartridge<TwentyDoorsState>, state: TwentyDoorsState): Decided {
    const asked: string[] = state.asked.map((entry: AskedQuestion) => `${entry.asker}|${entry.question}|${entry.answer}`);
    return { phase: state.phase, doors: state.doorsOpened, asked, finder: state.finder, outcome: game.outcome(state) };
}

/**
 * What the blueprint game decided.
 * @param game the rules.
 * @param state the state.
 * @returns the decisions.
 */
function blueprint(game: Cartridge<GuessingState>, state: GuessingState): Decided {
    const asked: string[] = state.said.map((line: SaidLine) => `${line.speaker}|${line.text}|${line.answer}`);
    return { phase: state.phase, doors: state.count.used, asked, finder: state.finder, outcome: game.outcome(state) };
}

describe("blueprint and hand-written twenty doors decide the same", () => {
    for (const sequence of SEQUENCES) {
        it(sequence.name, () => {
            const original: Cartridge<TwentyDoorsState> = createTwentyDoors(() => 0);
            const copy: KitGame<GuessingState> = createGuessingGame(TWENTY_DOORS_BLUEPRINT.box, TWENTY_DOORS_BLUEPRINT.decisions, () => 0);
            const ready: RoomEvent = { type: "contentReady", at: 0, text: "" };
            let first: TwentyDoorsState = original.onEvent(original.init(PLAYERS, {}).state, ready).state;
            let second: GuessingState = copy.cartridge.onEvent(copy.cartridge.init(PLAYERS, {}).state, ready).state;
            assert.deepEqual(blueprint(copy.cartridge, second), handWritten(original, first), "after the secret is chosen");
            sequence.events.forEach((event: RoomEvent, index: number) => {
                first = original.onEvent(first, event).state;
                second = copy.cartridge.onEvent(second, event).state;
                assert.deepEqual(blueprint(copy.cartridge, second), handWritten(original, first), `after event ${index + 1}`);
            });
        });
    }
});
