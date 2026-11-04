// Proves a room opened for Studio gets the Studio shelf and every other room keeps the plain one,
// read from what the host is told it can start in the lobby. Runs in text-only mode so a room
// opens no voice connection.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.GAME_ROOM_TEXT_ONLY = "1";
const { GAMES } = await import("../cartridges/index.ts");
const { HELD_BACK, studioShelf } = await import("../studio/shelf.ts");
const { RoomDirectory } = await import("./directory.ts");

describe("room directory shelves", () => {
    it("gives the Studio shelf only to a room opened for Studio", () => {
        const directory: InstanceType<typeof RoomDirectory> = new RoomDirectory("http://localhost:8740", GAMES, studioShelf(GAMES));
        const plain = directory.create();
        const studio = directory.create(false, false, false, true);
        assert.ok(plain !== null && studio !== null);
        assert.equal(plain.brief().includes("leadingQuestions"), false);
        assert.equal(studio.brief().includes("leadingQuestions"), true);
        assert.equal(plain.brief().includes("twentyDoors"), true);
        plain.close();
        studio.close();
    });

    it("gives every room the plain shelf when no Studio shelf is given", () => {
        const directory: InstanceType<typeof RoomDirectory> = new RoomDirectory("http://localhost:8740", GAMES);
        const room = directory.create(false, false, false, true);
        assert.ok(room !== null);
        assert.equal(room.brief().includes("leadingQuestions"), false);
        room.close();
    });

    it("shows the games on hold, marked as testing, only to a room opened for testing", () => {
        const directory: InstanceType<typeof RoomDirectory> = new RoomDirectory("http://localhost:8740", GAMES, studioShelf(GAMES), studioShelf(GAMES, true));
        const curated = directory.create(false, false, false, true);
        const testing = directory.create(false, false, false, true, true);
        assert.ok(curated !== null && testing !== null);
        for (const held of Object.keys(HELD_BACK)) {
            assert.equal(curated.brief().includes(held), false, held);
            assert.equal(testing.brief().includes(held), true, held);
            assert.equal(testing.brief().includes("Testing."), true);
        }
        curated.close();
        testing.close();
    });
});
