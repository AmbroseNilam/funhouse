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
    /** Who's at the table, when a test changes it. */
    seats?: Omit<Seat, "driving">[];
    /** Who the room was told has the controller now. */
    driverNames?: string[];
}

const GAME: ShelfGame = {
    guestsWelcome: false,
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
 * Makes one seat, connected and playing.
 * @param playerId who.
 * @param name their name.
 * @returns the seat.
 */
function seat(playerId: string, name: string): Omit<Seat, "driving"> {
    return { playerId, name, colour: "", connected: true, talking: false, recording: false, out: false, phoneDown: false, watching: false, guest: false, agent: false };
}

/**
 * Makes a console with three people, and a game that starts when told to.
 * @param told filled with what it asks of the room.
 * @returns the console.
 */
function shellWith(told: Told): Shell {
    let shell: Shell | null = null;
    const stage: ShellStage = {
        games: () => [GAME],
        seats: () => told.seats ?? [seat("a", "Ana"), seat("b", "Ben"), seat("c", "Cy")],
        startGame: (gameId: string, pick?: string) => { told.started.push({ gameId, pick }); shell?.gameStarted(gameId); },
        pickOpened: (line: string) => { told.pickLines.push(line); },
        endGame: () => { told.ended += 1; shell?.gameEnded(); },
        gameOver: () => told.over,
        focusChanged: () => undefined,
        refused: () => undefined,
        driverChanged: (name: string) => { told.driverNames?.push(name); },
        steppedOut: () => false,
        paused: (paused: boolean) => { told.pausedNow = paused; },
        gameAction: () => undefined,
        edge: () => undefined,
        changed: () => undefined,
        mayAddGuest: () => false,
        addGuest: () => undefined,
        removeGuest: () => undefined,
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
        mock.timers.tick(1000);
        shell.act("a", { kind: "choose", index: row });
        shell.act("a", { kind: "choose", index: 1 });
        assert.equal(told.ended, 1);
    });

    /**
     * Takes a running game to the question about ending it, with Ana being asked.
     * @param shell the console.
     */
    function askToEnd(shell: Shell): void {
        startGame(shell);
        shell.act("a", { kind: "back" });
        shell.act("a", { kind: "choose", index: shell.view().menu.indexOf("End the game") });
        assert.equal(shell.pad("a", "").confirmEnd, true);
    }

    it("stops asking about ending after about 8 s, with the game still paused", () => {
        const shell = shellWith(told);
        askToEnd(shell);
        mock.timers.tick(7500);
        assert.equal(shell.view().screen, "confirmEnd");
        mock.timers.tick(1000);
        assert.equal(shell.view().screen, "pause");
        assert.equal(shell.pad("a", "").confirmEnd, false);
        assert.equal(shell.view().pausedBy, "Ana");
        assert.equal(told.ended, 0);
        assert.equal(told.pausedNow, true);
    });

    it("gives the question its full time each time, and a late timer doesn't touch the shelf", () => {
        const shell = shellWith(told);
        askToEnd(shell);
        mock.timers.tick(6000);
        shell.act("a", { kind: "choose", index: 0 });
        mock.timers.tick(1000);
        shell.act("a", { kind: "choose", index: shell.view().menu.indexOf("End the game") });
        mock.timers.tick(6000);
        assert.equal(shell.view().screen, "confirmEnd");
        shell.act("a", { kind: "choose", index: 1 });
        assert.equal(told.ended, 1);
        mock.timers.tick(20000);
        assert.equal(shell.view().screen, "home");
    });

    it("doesn't pass the question on when the holder leaves mid-question", () => {
        const shell = shellWith(told);
        told.driverNames = [];
        askToEnd(shell);
        told.seats = [seat("b", "Ben"), seat("c", "Cy")];
        shell.seatsChanged();
        assert.equal(shell.isDriving("b"), true);
        assert.deepEqual(told.driverNames, ["Ben"]);
        assert.equal(shell.view().screen, "pause");
        assert.equal(shell.pad("b", "").confirmEnd, false);
        assert.equal(shell.pad("b", "").backLabel, "Resume");
        assert.equal(shell.view().pausedBy, "Ana");
    });

    it("drops the question when someone takes a dropped holder's controller, and doesn't act on that touch", () => {
        const shell = shellWith(told);
        askToEnd(shell);
        told.seats = [{ ...seat("a", "Ana"), connected: false }, seat("b", "Ben"), seat("c", "Cy")];
        shell.act("b", { kind: "choose", index: 1 });
        assert.equal(told.ended, 0);
        assert.equal(shell.isDriving("b"), true);
        assert.equal(shell.view().screen, "pause");
        assert.equal(shell.pad("b", "").confirmEnd, false);
    });

    it("hands the controller to someone playing, not someone watching or out", () => {
        const shell = shellWith(told);
        told.driverNames = [];
        startGame(shell);
        told.seats = [{ ...seat("d", "Dee"), watching: true }, { ...seat("e", "Eli"), out: true }, seat("c", "Cy")];
        shell.seatsChanged();
        assert.equal(shell.isDriving("c"), true);
        assert.deepEqual(told.driverNames, ["Cy"]);
    });

    it("lets only one of two phones pressing End at once be asked, once the holder has dropped", () => {
        const shell = shellWith(told);
        startGame(shell);
        shell.act("a", { kind: "back" });
        const row: number = shell.view().menu.indexOf("End the game");
        told.seats = [{ ...seat("a", "Ana"), connected: false }, seat("b", "Ben"), seat("c", "Cy")];
        shell.act("b", { kind: "choose", index: row });
        shell.act("c", { kind: "choose", index: row });
        assert.equal(shell.pad("b", "").confirmEnd, true);
        assert.equal(shell.pad("c", "").confirmEnd, false);
        shell.act("c", { kind: "choose", index: 1 });
        assert.equal(told.ended, 0);
    });

    it("doesn't let a double tap on the end button carry on to the shelf", () => {
        const shell = shellWith(told);
        askToEnd(shell);
        shell.act("a", { kind: "choose", index: 1 });
        shell.act("a", { kind: "choose", index: 1 });
        assert.equal(told.ended, 1);
        assert.equal(shell.view().screen, "home");
        mock.timers.tick(1000);
        shell.act("a", { kind: "select" });
        assert.equal(shell.view().screen, "game");
    });

    it("doesn't let a double tap on Keep playing also resume", () => {
        const shell = shellWith(told);
        askToEnd(shell);
        shell.act("a", { kind: "choose", index: 0 });
        shell.act("a", { kind: "select" });
        assert.equal(shell.view().screen, "pause");
        assert.equal(told.pausedNow, true);
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

    it("lets someone in the game take over a pause from a holder who's only watching", () => {
        const seats = [
            { playerId: "a", name: "Ana", colour: "", connected: true, talking: false, recording: false, out: false, phoneDown: false, watching: false, guest: false, agent: false },
            { playerId: "b", name: "Ben", colour: "", connected: true, talking: false, recording: false, out: false, phoneDown: false, watching: false, guest: false, agent: false },
        ];
        const shell: Shell = new Shell({
            games: () => [],
            seats: () => seats,
            startGame: () => undefined,
            pickOpened: () => undefined,
            endGame: () => undefined,
            gameOver: () => false,
            focusChanged: () => undefined,
            refused: () => undefined,
            driverChanged: () => undefined,
            steppedOut: () => false,
            paused: () => undefined,
            gameAction: () => undefined,
            edge: () => undefined,
            changed: () => undefined,
            mayAddGuest: () => false,
            addGuest: () => undefined,
            removeGuest: () => undefined,
        });
        shell.seatsChanged();
        shell.gameStarted("doors");
        seats[0] = { ...seats[0], watching: true } as typeof seats[number];
        assert.equal(shell.driverName(), "Ana");
        assert.equal(shell.pad("b", "").canDrive, true);
        shell.act("b", { kind: "back" });
        assert.equal(shell.view().pausedBy, "Ben");
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
