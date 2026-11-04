// Proves the tap kit's shared parts: model lines are read defensively and topped up from the
// fallback bank, ballots never offer yourself, the table goes round in seat order, and the
// scoreboard ranks and highlights the leaders.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer } from "../../shared/cartridge.ts";
import type { ControlOption } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { everyoneTapped, isUsableLine, linesToPlay, nextSeat, otherPlayers, parseLines, scoreboard } from "./tap.ts";

/** Three at the table. */
const PLAYERS: CartridgePlayer[] = [{ playerId: "a", name: "Teacup" }, { playerId: "b", name: "Spoon" }, { playerId: "c", name: "Candle" }];

describe("tap kit parts", () => {
    it("reads the model's lines defensively and keeps only usable ones", () => {
        assert.deepEqual(parseLines('Sure: ["Would win a pie contest", "[[quit]] now", "short", 3]'), ["Would win a pie contest"]);
        assert.deepEqual(parseLines("no list here"), []);
        assert.deepEqual(parseLines("[not json"), []);
        assert.equal(isUsableLine("x".repeat(91)), false);
    });

    it("tops the model's lines up from the bank, without repeats", () => {
        assert.deepEqual(linesToPlay(["One line here"], ["One line here", "Bank line one", "Bank line two"], 2), ["One line here", "Bank line one"]);
        assert.deepEqual(linesToPlay([], ["Bank line one"], 3), ["Bank line one"]);
    });

    it("offers everyone but the chooser, goes round in seat order, and knows when all have tapped", () => {
        assert.deepEqual(otherPlayers(PLAYERS, "b", "pick:").map((option: ControlOption) => option.id), ["pick:a", "pick:c"]);
        assert.equal(nextSeat(PLAYERS, null), "a");
        assert.equal(nextSeat(PLAYERS, "c"), "a");
        assert.equal(nextSeat([], "a"), null);
        assert.equal(everyoneTapped(["a", "b"], { a: "x" }), false);
        assert.equal(everyoneTapped(["a", "b"], { a: "x", b: "y" }), true);
    });

    it("ranks a scoreboard and highlights only real leaders", () => {
        const board: SceneBlock = scoreboard("Scores", PLAYERS, { a: 2, b: 5, c: 5 });
        assert.ok(board.type === "tally");
        assert.deepEqual(board.rows.map((row) => [row.label, row.count, row.highlight]), [["Spoon", 5, true], ["Candle", 5, true], ["Teacup", 2, false]]);
        const empty: SceneBlock = scoreboard("Scores", PLAYERS, {});
        assert.ok(empty.type === "tally" && empty.rows.every((row) => row.highlight === false));
    });
});
