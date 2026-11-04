// Proves every room gets the showcase shelf, and only a room opened for testing sees the games on
// hold, read from what the host is told it can start in the lobby. Runs in text-only mode so a room
// opens no voice connection.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.GAME_ROOM_TEXT_ONLY = "1";
const { GAMES } = await import("../cartridges/index.ts");
const { HELD_BACK, showcaseShelf } = await import("../studio/shelf.ts");
const { RoomDirectory } = await import("./directory.ts");

describe("room directory shelves", () => {
    it("shows the five games with no parameters, hand-written ones first", () => {
        const shelf: string[] = showcaseShelf(GAMES).map((game) => game.manifest.id);
        assert.deepEqual(shelf.slice(0, 3), ["twentyDoors", "quizmaster", "werewolf"]);
        assert.deepEqual([...shelf.slice(3)].sort(), ["paintedWhispers", "samePage"].sort());
    });

    it("keeps the hand-written Twenty Doors, with its choice before the game", () => {
        const doors = showcaseShelf(GAMES).find((game) => game.manifest.id === "twentyDoors");
        assert.notEqual(doors?.startPick, undefined);
    });

    it("gives a blueprint game its how-to card from its how-to-play text", () => {
        const gate = showcaseShelf(GAMES).find((game) => game.manifest.id === "samePage");
        assert.deepEqual(gate?.startCard, gate?.howToPlay);
    });

    it("shows the games on hold, marked as testing, only to a room opened for testing", () => {
        const directory: InstanceType<typeof RoomDirectory> = new RoomDirectory("http://localhost:8740", showcaseShelf(GAMES), showcaseShelf(GAMES, true));
        const everyday = directory.create();
        const testing = directory.create(false, false, false, true);
        assert.ok(everyday !== null && testing !== null);
        assert.equal(everyday.brief().includes("paintedWhispers"), true);
        for (const held of Object.keys(HELD_BACK)) {
            assert.equal(everyday.brief().includes(held), false, held);
            assert.equal(testing.brief().includes(held), true, held);
        }
        assert.equal(testing.brief().includes("Testing."), true);
        everyday.close();
        testing.close();
    });
});
