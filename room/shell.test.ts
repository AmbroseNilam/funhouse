// Tests for the console rules: who decides for everyone during a game, and the choice before one.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { Seat, ShelfGame } from "../shared/shell.ts";
import { Shell, type ShellStage } from "./shell.ts";

/** Everything the stage is told. */
interface Told {
    started: { gameId: string; pick?: string | undefined }[];
    ended: number;
    pausedNow: boolean;
    pickLines: string[];
    over: boolean;
}

const GAME: ShelfGame = {
    id: "doors",
    name: "Doors",
    pitch: "",
    howToPlay: [],
    players: "",
    art: "",
    pauseActions: [],
    blocked: null,
    startPick: { prompt: "Which?", hostLine: "Choose.", choices: [{ id: "surprise", label: "Surprise me" }, { id: "a", label: "A" }, { id: "b", label: "B" }] },
    startCard: ["Do the thing."],
};

/**
 * Makes a console with three people, and a game that starts when told to.
 * @param told filled with what it asks of the room.
 * @returns the console.
 */
function shellWith(told: Told): Shell {
    const seat = (playerId: string, name: string): Omit<Seat, "driving"> => ({ playerId, name, colour: "", connected: true, talking: false, recording: false, out: false, phoneDown: false, watching: false });
    let shell: Shell | null = null;
    const stage: ShellStage = {
        games: () => [GAME],
        seats: () => [seat("a", "Ana"), seat("b", "Ben"), seat("c", "Cy")],
        startGame: (gameId: string, pick?: string) => { told.started.push({ gameId, pick }); shell?.gameStarted(gameId); },
        pickOpened: (line: string) => { told.pickLines.push(line); },
        endGame: () => { told.ended += 1; shell?.gameEnded(); },
        gameOver: () => told.over,
        focusChanged: () => undefined,
        refused: () => undefined,
        driverChanged: () => undefined,
        steppedOut: () => false,
        paused: (paused: boolean) => { told.pausedNow = paused; },
        gameAction: () => undefined,
        edge: () => undefined,
        changed: () => undefined,
    };
    shell = new Shell(stage);
    return shell;
}

/**
 * Takes the game from the shelf to playing, with Ana driving and the first choice.
 * @param shell the console.
 */
function startGame(shell: Shell): void {
    shell.act("a", { kind: "select" });
    shell.act("a", { kind: "select" });
    shell.act("a", { kind: "select" });
    shell.act("a", { kind: "select" });
}

describe("the console", () => {
    let told: Told;

    beforeEach(() => {
        told = { started: [], ended: 0, pausedNow: false, pickLines: [], over: false };
        mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000000 });
    });

    afterEach(() => {
        mock.timers.reset();
    });

    it("asks for a choice before a game, with the first ready, and the host told once", () => {
        const shell = shellWith(told);
        shell.act("a", { kind: "select" });
        shell.act("a", { kind: "select" });
        assert.equal(shell.view().screen, "pick");
        assert.equal(shell.view().axis, "x");
        assert.deepEqual(shell.view().menu, ["Surprise me", "A", "B"]);
        assert.equal(shell.view().focus, 0);
        assert.deepEqual(told.pickLines, ["Choose."]);
        assert.deepEqual(told.started, []);
    });

    it("starts with what was chosen", () => {
        const shell = shellWith(told);
        shell.act("a", { kind: "select" });
        shell.act("a", { kind: "select" });
        shell.act("a", { kind: "step", delta: 1 });
        shell.act("a", { kind: "select" });
        assert.equal(shell.view().screen, "startCard");
        shell.act("a", { kind: "select" });
        assert.deepEqual(told.started, [{ gameId: "doors", pick: "a" }]);
        assert.equal(shell.view().screen, "play");
    });

    it("takes the highlighted choice after 15 s, and a slide gives more time", () => {
        const shell = shellWith(told);
        shell.act("a", { kind: "select" });
        shell.act("a", { kind: "select" });
        mock.timers.tick(14000);
        shell.act("a", { kind: "step", delta: 2 });
        mock.timers.tick(14000);
        assert.deepEqual(told.started, []);
        mock.timers.tick(1000);
        assert.equal(shell.view().screen, "startCard");
        assert.deepEqual(told.started, []);
        mock.timers.tick(25000);
        assert.deepEqual(told.started, [{ gameId: "doors", pick: "b" }]);
    });

    it("shows the how-to card on every phone, only the holder skips it, and a replay doesn't repeat it", () => {
        const shell = shellWith(told);
        shell.act("a", { kind: "select" });
        shell.act("a", { kind: "select" });
        shell.act("a", { kind: "select" });
        assert.deepEqual(shell.pad("c", "").startCard, ["Do the thing."]);
        assert.equal(shell.view().screen, "startCard");
        shell.act("a", { kind: "back" });
        assert.equal(shell.view().screen, "pick");
        shell.act("a", { kind: "select" });
        assert.deepEqual(told.started, [{ gameId: "doors", pick: "surprise" }], "the card was already seen");
        shell.gameEnded();
        told.started.length = 0;
        shell.act("a", { kind: "select" });
        shell.act("a", { kind: "select" });
        shell.act("a", { kind: "select" });
        assert.deepEqual(told.started, [{ gameId: "doors", pick: "surprise" }]);
    });

    it("doesn't take a choice once someone has gone back or the room has closed", () => {
        const shell = shellWith(told);
        shell.act("a", { kind: "select" });
        shell.act("a", { kind: "select" });
        shell.act("a", { kind: "back" });
        mock.timers.tick(20000);
        assert.deepEqual(told.started, []);
        shell.act("a", { kind: "select" });
        shell.close();
        mock.timers.tick(20000);
        assert.deepEqual(told.started, []);
    });

    it("lets only the controller holder pause, even after a long quiet", () => {
        const shell = shellWith(told);
        startGame(shell);
        mock.timers.tick(60000);
        shell.act("b", { kind: "back" });
        assert.equal(shell.view().screen, "play");
        assert.equal(shell.pad("b", "").backLabel, null);
        assert.equal(shell.pad("a", "").backLabel, "Pause");
        assert.equal(shell.claimForGame("b"), false);
        assert.equal(shell.driverName(), "Ana");
    });

    it("names who paused for everyone, and only the holder resumes", () => {
        const shell = shellWith(told);
        startGame(shell);
        shell.act("a", { kind: "back" });
        assert.equal(told.pausedNow, true);
        assert.equal(shell.view().pausedBy, "Ana");
        assert.equal(shell.pad("c", "").pausedBy, "Ana");
        assert.equal(shell.pad("c", "").canDrive, false);
        shell.act("c", { kind: "back" });
        assert.equal(shell.view().screen, "pause");
        shell.act("a", { kind: "back" });
        assert.equal(shell.view().screen, "play");
        assert.equal(told.pausedNow, false);
        assert.equal(shell.view().pausedBy, "");
    });

    it("asks only the holder before ending for everyone, and nobody else can answer", () => {
        const shell = shellWith(told);
        startGame(shell);
        shell.act("a", { kind: "back" });
        const row: number = shell.view().menu.indexOf("End the game");
        shell.act("a", { kind: "choose", index: row });
        assert.equal(shell.view().screen, "confirmEnd");
        assert.equal(shell.pad("a", "").confirmEnd, true);
        assert.equal(shell.pad("b", "").confirmEnd, false);
        shell.act("b", { kind: "choose", index: 1 });
        assert.equal(told.ended, 0);
        shell.act("a", { kind: "choose", index: 0 });
        assert.equal(shell.view().screen, "pause");
        assert.equal(told.ended, 0);
        shell.act("a", { kind: "choose", index: row });
        shell.act("a", { kind: "choose", index: 1 });
        assert.equal(told.ended, 1);
    });

    it("leaves nobody stranded after a game: the shelf is anyone's at once", () => {
        const shell = shellWith(told);
        startGame(shell);
        shell.gameEnded();
        assert.equal(shell.view().screen, "home");
        assert.equal(shell.view().pausedBy, "");
        for (const playerId of ["a", "b", "c"]) {
            assert.equal(shell.pad(playerId, "").canDrive, true);
            assert.equal(shell.pad(playerId, "").canSelect, true);
        }
    });

    it("ignores a choice that isn't on the menu", () => {
        const shell = shellWith(told);
        startGame(shell);
        shell.act("a", { kind: "back" });
        shell.act("a", { kind: "choose", index: 99 });
        shell.act("a", { kind: "choose", index: -1 });
        shell.act("a", { kind: "choose", index: 0.5 });
        assert.equal(shell.view().screen, "pause");
    });
});
