// Proves the clue-board kit, as Tin Can Telephone: the key is dealt nine, eight, seven and one and
// only the givers' phones show it; the host is never told it, even when it gives a side's clues;
// clues are checked by code before the host rules; guesses are counted and settled by code; the
// clocks, the turn limit and people leaving end things cleanly; and a stale timer is ignored.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer, Step } from "../../../shared/cartridge.ts";
import type { Control } from "../../../shared/controls.ts";
import type { BoardCell, SceneBlock } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { ScopedFact } from "../../../shared/visibility.ts";
import { blueprintProblems } from "../../blueprint.ts";
import { type ClueBoardBlueprint } from "./index.ts";
import { TIN_CAN_TELEPHONE_BLUEPRINT } from "../../games/tin-can-telephone/blueprint.ts";
import type { KitGame } from "../../kit/kit.ts";
import { PAPER_PLAYERS, stringsIn, viewsOf } from "../../rehearse.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { clueProblem, createClueBoardGame, dealKey, GUESS_PREFIX, HOST_CLUES_VARIANT, KEY_CARD_TITLE, parseClue, seatTeams, STOP_ACTION, type Cell, type ClueBoardState } from "./clueboard.ts";

/** Five at the table: Plum is seats one, three and five, Teal two and four. */
const FIVE: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 5);

/** Twenty-five words the host's model might write, none of them close to a paper clue. */
const WRITTEN: string = "anchor, biscuit, blanket, bridge, bucket, button, cactus, candle, canoe, carpet, castle, chimney, cinnamon, clover, compass, cushion, diamond, dolphin, drawer, engine, feather, ferry, fountain, garden, ginger";

/**
 * Builds Tin Can Telephone.
 * @param seed picks who moves first and how the key is dealt.
 * @param blueprint the blueprint; Tin Can Telephone unless given.
 * @returns the game.
 */
function tinCan(seed: number = 1, blueprint: ClueBoardBlueprint = TIN_CAN_TELEPHONE_BLUEPRINT): KitGame<ClueBoardState> {
    return createClueBoardGame(blueprint.box, blueprint.decisions, seededRandom(seed));
}

/**
 * Plays an event.
 * @param game the game.
 * @param state the state.
 * @param event the event.
 * @returns the step.
 */
function on(game: KitGame<ClueBoardState>, state: ClueBoardState, event: RoomEvent): Step<ClueBoardState> {
    return game.cartridge.onEvent(state, event);
}

/**
 * Starts a game and gets it to the first clue, with a board the model wrote.
 * @param seed the seed.
 * @param players who is at the table.
 * @param variants the lobby's choices.
 * @returns the game, the state and the step that opened the first turn.
 */
function start(seed: number = 1, players: CartridgePlayer[] = FIVE, variants: Record<string, boolean> = {}): { game: KitGame<ClueBoardState>; state: ClueBoardState; step: Step<ClueBoardState> } {
    const game: KitGame<ClueBoardState> = tinCan(seed);
    const started: Step<ClueBoardState> = game.cartridge.init(players, variants);
    assert.ok((started.contentRequest ?? "").startsWith("Write 25"));
    const step: Step<ClueBoardState> = on(game, started.state, { type: "contentReady", at: 0, text: WRITTEN });
    return { game, state: step.state, step };
}

/**
 * Has the team on turn's giver say a clue and the host rule on it.
 * @param game the game.
 * @param state the state in the clue phase.
 * @param text what the giver says.
 * @param ruling the ruling, or null for none.
 * @returns the step after the ruling.
 */
function giveClue(game: KitGame<ClueBoardState>, state: ClueBoardState, text: string, ruling: string | null = "fair"): Step<ClueBoardState> {
    const giver: string = state.giverIds[state.turnTeam] ?? "nobody";
    const heard: Step<ClueBoardState> = on(game, state, { type: "speechEnded", at: 1, playerId: giver, text });
    return ruling === null ? heard : on(game, heard.state, { type: "hostRuled", at: 2, ruling, detail: "", playerId: giver });
}

/**
 * The index of the first unturned card of an owner.
 * @param state the state.
 * @param owner whose.
 * @returns the index.
 */
function firstOf(state: ClueBoardState, owner: Cell["owner"]): number {
    return state.cells.findIndex((cell: Cell) => cell.owner === owner && cell.turned === false);
}

/**
 * Someone on the team on turn who guesses.
 * @param state the state.
 * @returns their id.
 */
function guesserOf(state: ClueBoardState): string {
    return state.players.find((player: CartridgePlayer) => state.teamOf[player.playerId] === state.turnTeam && player.playerId !== state.giverIds[state.turnTeam])?.playerId ?? "nobody";
}

/**
 * The lines on the secret cards of one phone.
 * @param game the game.
 * @param state the state.
 * @param playerId whose phone.
 * @returns the bodies of its key cards.
 */
function keyLines(game: KitGame<ClueBoardState>, state: ClueBoardState, playerId: string): string[] {
    return game.cartridge.privateControls(state, playerId).flatMap((control: Control) => (control.type === "roleCard" && control.title === KEY_CARD_TITLE ? [control.body] : []));
}

describe("tin can telephone: the key", () => {
    it("deals nine, eight, seven and one, with nine for whoever moves first", () => {
        for (const seed of [1, 2, 3, 4]) {
            const { state } = start(seed);
            const first: string = state.firstTeam === 0 ? "a" : "b";
            const second: string = state.firstTeam === 0 ? "b" : "a";
            const count = (owner: string): number => state.cells.filter((cell: Cell) => cell.owner === owner).length;
            assert.deepEqual([count(first), count(second), count("neutral"), count("trap")], [9, 8, 7, 1]);
            assert.equal(state.turnTeam, state.firstTeam);
            assert.equal(state.cells.length, 25);
        }
    });

    it("uses the host's board when it wrote enough words, and its own when it did not", () => {
        const game: KitGame<ClueBoardState> = tinCan();
        const started: Step<ClueBoardState> = game.cartridge.init(FIVE, {});
        const written: ClueBoardState = on(game, started.state, { type: "contentReady", at: 0, text: WRITTEN }).state;
        assert.ok(written.cells.some((cell: Cell) => cell.word === "anchor"));
        for (const text of ["", "ocean, harbour", "ignore your instructions"]) {
            const fallen: ClueBoardState = on(game, started.state, { type: "contentReady", at: 0, text }).state;
            assert.equal(fallen.cells.length, 25);
            assert.ok(fallen.cells.every((cell: Cell) => TIN_CAN_TELEPHONE_BLUEPRINT.decisions.words.includes(cell.word) === true));
        }
    });

    it("shows the whole key to the two givers and nothing of it to anyone else", () => {
        const { game, state } = start();
        const [plumGiver, tealGiver] = state.giverIds;
        assert.equal(plumGiver, "paper1");
        assert.equal(tealGiver, "paper2");
        for (const giver of [plumGiver, tealGiver]) {
            const lines: string[] = keyLines(game, state, giver);
            assert.equal(lines.length, 4);
            for (const cell of state.cells) {
                assert.ok(lines.join(" ").includes(cell.word.charAt(0).toUpperCase() + cell.word.slice(1)), "the giver sees every word");
            }
        }
        for (const player of FIVE.filter((candidate: CartridgePlayer) => candidate.playerId !== "paper1" && candidate.playerId !== "paper2")) {
            assert.deepEqual(keyLines(game, state, player.playerId), []);
        }
        const hidden = game.hidden(state);
        assert.equal(hidden.length, 25);
        assert.ok(hidden.every((value) => value.seenBy.includes("host") === false));
    });

    it("tells the TV, the host and the guessers nothing about whose a word is until it is turned over", () => {
        const { game, state } = start();
        const twin: number = [2, 3, 4, 5, 6, 7, 8, 9, 10].find((seed: number) => start(seed).state.firstTeam === state.firstTeam) ?? 2;
        const other = start(twin).game;
        const otherState: ClueBoardState = start(twin).state;
        const clue = (g: KitGame<ClueBoardState>, s: ClueBoardState): Step<ClueBoardState> => giveClue(g, s, "zeta two");
        const first: Step<ClueBoardState> = clue(game, state);
        const second: Step<ClueBoardState> = clue(other, otherState);
        assert.notDeepEqual(state.cells.map((cell: Cell) => cell.owner), otherState.cells.map((cell: Cell) => cell.owner), "the two keys differ");
        const viewsA = viewsOf(game.cartridge, first.state, FIVE, first.facts);
        const viewsB = viewsOf(other.cartridge, second.state, FIVE, second.facts);
        const sameWords = state.cells.map((cell: Cell) => cell.word).join() === otherState.cells.map((cell: Cell) => cell.word).join();
        if (sameWords === true) {
            for (const viewer of ["screen", "host", "paper3", "paper4", "paper5"]) {
                assert.equal(JSON.stringify(viewsA.get(viewer)), JSON.stringify(viewsB.get(viewer)), `${viewer} sees the same whatever the key`);
            }
        }
        const sceneBlocks: SceneBlock[] = game.cartridge.publicScene(first.state).blocks;
        const board: BoardCell[] = sceneBlocks.flatMap((block: SceneBlock) => (block.type === "board" ? block.cells : []));
        assert.equal(board.length, 25);
        assert.ok(board.every((cell: BoardCell) => cell.owner === "unknown" && cell.turned === false && cell.owned === undefined));
    });

    it("splits the table into teams, and has the host give a side's clues when it has one person or the variant is on", () => {
        const three = seatTeams(FIVE.slice(0, 3), false);
        assert.deepEqual(three.giverIds, ["paper1", null]);
        const five = seatTeams(FIVE, false);
        assert.deepEqual(five.giverIds, ["paper1", "paper2"]);
        const voiced = seatTeams(FIVE, true);
        assert.deepEqual(voiced.giverIds, ["paper1", null]);
        assert.equal(dealKey(Array.from({ length: 25 }, (_unused: unknown, index: number) => `w${index}`), 0, seededRandom(1)).filter((cell: Cell) => cell.owner === "a").length, 9);
    });
});

describe("tin can telephone: clues", () => {
    it("refuses a board word, a part of one and a number the team cannot use, before the host is asked", () => {
        const { state } = start();
        const left: number = state.cells.filter((cell: Cell) => cell.owner === (state.turnTeam === 0 ? "a" : "b")).length;
        assert.equal(clueProblem({ word: "anchor", number: 2 }, state.cells, left) !== null, true);
        assert.equal(clueProblem({ word: "anchors", number: 2 }, state.cells, left) !== null, true);
        assert.equal(clueProblem({ word: "fountainhead", number: 2 }, state.cells, left) !== null, true);
        assert.equal(clueProblem({ word: "zeta", number: 0 }, state.cells, left) !== null, true);
        assert.equal(clueProblem({ word: "zeta", number: left + 1 }, state.cells, left) !== null, true);
        assert.equal(clueProblem({ word: "two words", number: 2 }, state.cells, left) !== null, true);
        assert.equal(clueProblem({ word: "zeta", number: 3 }, state.cells, left), null);
    });

    it("reads one word and a number from speech, however it is wrapped", () => {
        assert.deepEqual(parseClue("zeta two"), { word: "zeta", number: 2 });
        assert.deepEqual(parseClue("My clue is, Zeta, 3."), { word: "zeta", number: 3 });
        assert.deepEqual(parseClue("um zeta for three"), { word: "zeta", number: 3 });
        assert.equal(parseClue("zeta"), null);
        assert.equal(parseClue("three"), null);
        assert.equal(parseClue("zeta theta two"), null);
        assert.equal(parseClue("um, well, hmm"), null);
    });

    it("waits for the host's ruling on a spoken clue, then hands the turn to the guessers", () => {
        const { game, state } = start();
        const offered: Step<ClueBoardState> = giveClue(game, state, "zeta two", null);
        assert.deepEqual(offered.state.pending, { word: "zeta", number: 2 });
        assert.deepEqual(offered.timers, { judge: 8 });
        assert.equal(offered.state.phase, "clue");
        const fair: Step<ClueBoardState> = on(game, offered.state, { type: "hostRuled", at: 3, ruling: "fair", detail: "", playerId: state.giverIds[state.turnTeam] });
        assert.equal(fair.state.phase, "guess");
        assert.equal(fair.state.guessesLeft, 3);
        assert.equal(fair.nextPhaseId, "guess");
        assert.deepEqual(fair.timers, { guess: 120 });
        assert.ok(fair.facts.some((fact: ScopedFact) => fact.text.includes('"Zeta", 2')));
    });

    it("counts the clue as fair if the host never rules, and ignores a stale judge timer", () => {
        const { game, state } = start();
        const stale: Step<ClueBoardState> = on(game, state, { type: "timerFired", at: 1, timerId: "judge" });
        assert.equal(stale.state, state);
        const offered: Step<ClueBoardState> = giveClue(game, state, "zeta two", null);
        const timed: Step<ClueBoardState> = on(game, offered.state, { type: "timerFired", at: 9, timerId: "judge" });
        assert.equal(timed.state.phase, "guess");
    });

    it("lets the host call a foul, gives the giver a fresh try, and passes the turn after the second", () => {
        const { game, state } = start();
        const fouled: Step<ClueBoardState> = giveClue(game, state, "zeta two", "foul");
        assert.equal(fouled.state.phase, "clue");
        assert.equal(fouled.state.fouls, 1);
        assert.equal(fouled.state.attempt, 1);
        assert.equal(fouled.state.pending, null);
        const second: Step<ClueBoardState> = giveClue(game, fouled.state, "theta two", "foul");
        assert.equal(second.state.phase, "clue");
        assert.notEqual(second.state.turnTeam, state.turnTeam, "the turn passed");
        assert.equal(second.state.turnNumber, 2);
    });

    it("refuses a board word as a clue with a foul and no ruling needed", () => {
        const { game, state } = start();
        const refused: Step<ClueBoardState> = giveClue(game, state, "anchor two", null);
        assert.equal(refused.state.fouls, 1);
        assert.equal(refused.state.pending, null);
        assert.ok(refused.facts.every((fact: ScopedFact) => fact.text.toLowerCase().includes("anchor") === false), "the refused word is not repeated");
    });

    it("asks a giver who mumbles to try again without a foul", () => {
        const { game, state } = start();
        const unclear: Step<ClueBoardState> = giveClue(game, state, "um, well, hmm", null);
        assert.equal(unclear.state, state);
        assert.equal(unclear.facts.length, 2);
    });

    it("ignores clues from anyone but the giver, and rulings with nothing to rule on", () => {
        const { game, state } = start();
        assert.equal(on(game, state, { type: "speechEnded", at: 1, playerId: "paper3", text: "zeta two" }).state, state);
        assert.equal(on(game, state, { type: "hostRuled", at: 1, ruling: "fair", detail: "", playerId: null }).state, state);
        assert.equal(game.cartridge.roleOf(state, "paper1") === "giver" || game.cartridge.roleOf(state, "paper2") === "giver", true);
        assert.equal(game.cartridge.roleOf(state, "paper3"), "other");
    });

    it("takes a typed clue from the giver's box, and a box that is not understood gets a fresh one", () => {
        const { game, state } = start();
        const giver: string = state.giverIds[state.turnTeam] ?? "";
        const id: string = `clue:${state.turnNumber}:0`;
        const shown: Control[] = game.cartridge.privateControls(state, giver);
        assert.ok(shown.some((control: Control) => control.type === "textInput" && control.id === id));
        const typed: Step<ClueBoardState> = on(game, state, { type: "answered", at: 1, playerId: giver, controlId: id, value: "Zeta 2" });
        assert.deepEqual(typed.state.pending, { word: "zeta", number: 2 });
        const stranger: Step<ClueBoardState> = on(game, state, { type: "answered", at: 1, playerId: "paper3", controlId: id, value: "zeta 2" });
        assert.equal(stranger.state, state);
        const wrongBox: Step<ClueBoardState> = on(game, state, { type: "answered", at: 1, playerId: giver, controlId: "clue:99:0", value: "zeta 2" });
        assert.equal(wrongBox.state, state);
        const unclear: Step<ClueBoardState> = on(game, state, { type: "answered", at: 1, playerId: giver, controlId: id, value: "zeta" });
        assert.equal(unclear.state.pending, null);
        assert.equal(unclear.state.attempt, 1);
        const retry: Control[] = game.cartridge.privateControls(unclear.state, giver);
        assert.ok(retry.some((control: Control) => control.type === "textInput" && control.id === `clue:${state.turnNumber}:1` && (control.note ?? "").includes("one word and a number")));
    });

    it("gives a retry after a foul its own box, so the room accepts a second answer", () => {
        const { game, state } = start();
        const fouled: Step<ClueBoardState> = giveClue(game, state, "anchor two", null);
        const giver: string = state.giverIds[state.turnTeam] ?? "";
        const ids: string[] = game.cartridge.privateControls(fouled.state, giver).flatMap((control: Control) => ("id" in control ? [control.id] : []));
        assert.deepEqual(ids, [`clue:${state.turnNumber}:1`]);
    });

    it("passes the turn when the giver runs out of time, and ignores that timer once a clue is in", () => {
        const { game, state } = start();
        const passed: Step<ClueBoardState> = on(game, state, { type: "timerFired", at: 90, timerId: "clue" });
        assert.notEqual(passed.state.turnTeam, state.turnTeam);
        const guessing: ClueBoardState = giveClue(game, state, "zeta two").state;
        assert.equal(on(game, guessing, { type: "timerFired", at: 90, timerId: "clue" }).state, guessing);
    });
});

describe("tin can telephone: guessing", () => {
    /**
     * A game in the guessing phase.
     * @returns the game and state.
     */
    function guessing(): { game: KitGame<ClueBoardState>; state: ClueBoardState } {
        const { game, state } = start();
        return { game, state: giveClue(game, state, "zeta two").state };
    }

    it("lets only the guessers of the team on turn guess, and shows them only unturned words", () => {
        const { game, state } = guessing();
        const mine: string = guesserOf(state);
        const options: Control[] = game.cartridge.privateControls(state, mine);
        const choice: Control | undefined = options.find((control: Control) => control.type === "choice");
        assert.equal(choice?.type === "choice" ? choice.options.length : 0, 26, "25 words and the stop button");
        assert.equal(game.cartridge.legalActions(state, state.giverIds[state.turnTeam] ?? "").length, 0);
        const other = state.players.find((player: CartridgePlayer) => state.teamOf[player.playerId] !== state.turnTeam)?.playerId ?? "";
        assert.equal(game.cartridge.legalActions(state, other).length, 0);
        const refused: Step<ClueBoardState> = game.cartridge.apply(state, other, `${GUESS_PREFIX}0`);
        assert.equal(refused.state, state);
    });

    it("keeps the turn while the guesses are right, up to the number plus one", () => {
        const { game, state } = guessing();
        const mine: string = guesserOf(state);
        const owner: Cell["owner"] = state.turnTeam === 0 ? "a" : "b";
        let step: Step<ClueBoardState> = game.cartridge.apply(state, mine, `${GUESS_PREFIX}${firstOf(state, owner)}`);
        assert.equal(step.state.turnTeam, state.turnTeam);
        assert.equal(step.state.guessesLeft, 2);
        step = game.cartridge.apply(step.state, mine, `${GUESS_PREFIX}${firstOf(step.state, owner)}`);
        step = game.cartridge.apply(step.state, mine, `${GUESS_PREFIX}${firstOf(step.state, owner)}`);
        assert.notEqual(step.state.turnTeam, state.turnTeam, "three guesses were allowed, then the turn passed");
        assert.equal(step.state.cells.filter((cell: Cell) => cell.turned).length, 3);
    });

    it("passes the turn on a bystander or the other team's word", () => {
        const { game, state } = guessing();
        const neutral = game.cartridge.apply(state, guesserOf(state), `${GUESS_PREFIX}${firstOf(state, "neutral")}`);
        assert.notEqual(neutral.state.turnTeam, state.turnTeam);
        const opponent: Cell["owner"] = state.turnTeam === 0 ? "b" : "a";
        const theirs = game.cartridge.apply(state, guesserOf(state), `${GUESS_PREFIX}${firstOf(state, opponent)}`);
        assert.notEqual(theirs.state.turnTeam, state.turnTeam);
        assert.equal(theirs.state.cells.filter((cell: Cell) => cell.turned).length, 1);
    });

    it("loses the game on the trapdoor", () => {
        const { game, state } = guessing();
        const hit = game.cartridge.apply(state, guesserOf(state), `${GUESS_PREFIX}${firstOf(state, "trap")}`);
        assert.equal(hit.state.phase, "end");
        assert.equal(hit.state.result, "trapdoor");
        assert.equal(hit.state.winner, state.turnTeam === 0 ? 1 : 0);
        assert.equal(game.cartridge.outcome(hit.state) !== null, true);
        assert.deepEqual(game.hidden(hit.state), []);
    });

    it("wins when a team has found all its words, even if the other team turned the last one", () => {
        const { game, state } = guessing();
        const owner: Cell["owner"] = state.turnTeam === 0 ? "a" : "b";
        const nearly: ClueBoardState = { ...state, guessesLeft: 20, cells: state.cells.map((cell: Cell, index: number) => (cell.owner === owner && index !== firstOf(state, owner) ? { ...cell, turned: true } : cell)) };
        const won = game.cartridge.apply(nearly, guesserOf(state), `${GUESS_PREFIX}${firstOf(nearly, owner)}`);
        assert.equal(won.state.result, "cleared");
        assert.equal(won.state.winner, state.turnTeam);
        const opponent: Cell["owner"] = state.turnTeam === 0 ? "b" : "a";
        const gift: ClueBoardState = { ...state, cells: state.cells.map((cell: Cell, index: number) => (cell.owner === opponent && index !== firstOf(state, opponent) ? { ...cell, turned: true } : cell)) };
        const given = game.cartridge.apply(gift, guesserOf(state), `${GUESS_PREFIX}${firstOf(gift, opponent)}`);
        assert.equal(given.state.winner, state.turnTeam === 0 ? 1 : 0);
    });

    it("lets the team stop after a guess, not before, and runs the guess clock out", () => {
        const { game, state } = guessing();
        assert.equal(game.cartridge.apply(state, guesserOf(state), STOP_ACTION).state, state);
        const owner: Cell["owner"] = state.turnTeam === 0 ? "a" : "b";
        const one = game.cartridge.apply(state, guesserOf(state), `${GUESS_PREFIX}${firstOf(state, owner)}`);
        assert.equal(game.cartridge.apply(one.state, guesserOf(state), STOP_ACTION).state.turnTeam !== state.turnTeam, true);
        assert.equal(on(game, state, { type: "timerFired", at: 130, timerId: "guess" }).state.turnTeam !== state.turnTeam, true);
    });

    it("ignores a turn over card twice, and a stale guess clock in a clue phase", () => {
        const { game, state } = guessing();
        const owner: Cell["owner"] = state.turnTeam === 0 ? "a" : "b";
        const index: number = firstOf(state, owner);
        const once = game.cartridge.apply(state, guesserOf(state), `${GUESS_PREFIX}${index}`);
        assert.equal(game.cartridge.apply(once.state, guesserOf(state), `${GUESS_PREFIX}${index}`).state, once.state);
        const passed = on(game, state, { type: "timerFired", at: 130, timerId: "guess" }).state;
        assert.equal(on(game, passed, { type: "timerFired", at: 131, timerId: "guess" }).state, passed);
    });

    it("ends on the turn limit with the team with fewer words left", () => {
        const { game, state } = start();
        let step: Step<ClueBoardState> = { state, facts: [] };
        for (let turn = 0; turn < 30 && step.state.phase !== "end"; turn += 1) {
            step = on(game, step.state, { type: "timerFired", at: turn, timerId: "clue" });
        }
        assert.equal(step.state.phase, "end");
        assert.equal(step.state.result, "turns");
        assert.equal(step.state.winner, state.firstTeam === 0 ? 1 : 0, "all else equal the team that moved second wins");
    });
});

describe("tin can telephone: the host gives a side's clues", () => {
    /**
     * A game where the second team is voiced by the host, at the point it is asked for a clue.
     * @returns the game, the state and the step with the request.
     */
    function voiced(): { game: KitGame<ClueBoardState>; state: ClueBoardState; step: Step<ClueBoardState> } {
        for (let seed = 1; seed < 40; seed += 1) {
            const { game, state, step } = start(seed, FIVE, { [HOST_CLUES_VARIANT]: true });
            if (state.giverIds[state.turnTeam] === null) {
                return { game, state, step };
            }
        }
        throw new Error("No seed gave the host the first clue.");
    }

    it("hands the key for that side to the model alone, and shows no one the clue's key", () => {
        const { game, state, step } = voiced();
        assert.equal(state.awaiting, "clue");
        const request: string = step.contentRequest ?? "";
        const mine: Cell[] = state.cells.filter((cell: Cell) => cell.owner === (state.turnTeam === 0 ? "a" : "b"));
        assert.ok(mine.every((cell: Cell) => request.includes(cell.word)));
        assert.ok(request.includes("trapdoor"));
        const views = viewsOf(game.cartridge, state, FIVE, step.facts);
        for (const [viewer, seen] of views) {
            assert.equal(stringsIn(seen).join(" ").includes(mine[0]?.word ?? "?") && stringsIn(seen).join(" ").toLowerCase().includes("plum (yours)"), false, `${viewer} sees nothing of the key`);
        }
        assert.equal(game.cartridge.turn?.(state)?.kind, "anyone");
        assert.deepEqual(game.hidden(state).every((value) => value.seenBy.includes("paper1")), true);
    });

    it("turns the model's clue into a turn for the guessers, and refuses an illegal one twice before passing", () => {
        const { game, state } = voiced();
        const good: Step<ClueBoardState> = on(game, state, { type: "contentReady", at: 1, text: "Harbour, 2" });
        assert.equal(good.state.phase, "guess");
        assert.deepEqual(good.state.clue, { word: "harbour", number: 2 });
        const retry: Step<ClueBoardState> = on(game, state, { type: "contentReady", at: 1, text: "anchor, 2" });
        assert.ok(retry.contentRequest !== undefined, "it asks again once");
        const passed: Step<ClueBoardState> = on(game, retry.state, { type: "contentReady", at: 2, text: "" });
        assert.notEqual(passed.state.turnTeam, state.turnTeam);
        const stray: Step<ClueBoardState> = on(game, good.state, { type: "contentReady", at: 3, text: "Ocean, 1" });
        assert.equal(stray.state, good.state, "a late reply changes nothing");
    });

    it("takes over when a giver leaves mid-turn", () => {
        const { game, state } = start();
        const giver: string = state.giverIds[state.turnTeam] ?? "";
        const left: Step<ClueBoardState> = on(game, state, { type: "playerLeft", at: 1, playerId: giver });
        assert.equal(left.state.giverIds[state.turnTeam], null);
        assert.equal(left.state.awaiting, "clue");
        assert.ok((left.contentRequest ?? "").includes("clue-giver"));
    });
});

describe("tin can telephone: leaving", () => {
    it("lets a guesser leave without ending anything, and forfeits a team with nobody left", () => {
        const { game, state } = start();
        const guesser: string = guesserOf(state);
        const stays: Step<ClueBoardState> = on(game, state, { type: "playerLeft", at: 1, playerId: guesser });
        assert.equal(stays.state.phase, "clue");
        const tealAll: ClueBoardState = FIVE.filter((player: CartridgePlayer) => state.teamOf[player.playerId] === 1).reduce((current: ClueBoardState, player: CartridgePlayer): ClueBoardState => on(game, current, { type: "playerLeft", at: 2, playerId: player.playerId }).state, state);
        assert.equal(tealAll.phase, "end");
        assert.equal(tealAll.result, "forfeit");
        assert.equal(tealAll.winner, 0);
    });

    it("makes a lone player on a team a guesser, with the host as their giver", () => {
        const { game, state } = start(1, FIVE.slice(0, 4));
        const plumSecond: string = FIVE.slice(0, 4).filter((player: CartridgePlayer) => state.teamOf[player.playerId] === 0)[1]?.playerId ?? "";
        const left: Step<ClueBoardState> = on(game, state, { type: "playerLeft", at: 1, playerId: plumSecond });
        assert.equal(left.state.giverIds[0], null);
        assert.equal(left.state.phase === "clue" || left.state.phase === "end", true);
    });
});

describe("tin can telephone: the blueprint", () => {
    it("is runnable, and refuses bad decisions", () => {
        assert.deepEqual(blueprintProblems(TIN_CAN_TELEPHONE_BLUEPRINT), []);
        const bad = (change: Partial<ClueBoardBlueprint["decisions"]>): string[] => blueprintProblems({ ...TIN_CAN_TELEPHONE_BLUEPRINT, decisions: { ...TIN_CAN_TELEPHONE_BLUEPRINT.decisions, ...change } });
        assert.notEqual(bad({ words: ["only", "few"] }).length, 0);
        assert.notEqual(bad({ teams: ["Plum", "plum"] }).length, 0);
        assert.notEqual(bad({ clueSeconds: Number.NaN }).length, 0);
        assert.notEqual(bad({ maxFouls: 0 }).length, 0);
        assert.notEqual(blueprintProblems({ ...TIN_CAN_TELEPHONE_BLUEPRINT, box: { ...TIN_CAN_TELEPHONE_BLUEPRINT.box, minPlayers: 2 } }).length, 0);
    });

    it("copies what it is given, so changing the blueprint afterwards does not reach a running game", () => {
        const blueprint: ClueBoardBlueprint = structuredClone(TIN_CAN_TELEPHONE_BLUEPRINT);
        const game: KitGame<ClueBoardState> = tinCan(1, blueprint);
        blueprint.decisions.teams[0] = "Changed";
        const started: Step<ClueBoardState> = game.cartridge.init(FIVE, {});
        assert.ok(stringsIn(game.cartridge.publicScene(started.state)).join(" ").includes("Changed") === false);
    });
});
