// Checks AI guests inside a real room with fake phones: a guest never keeps a room open, never takes
// the controller, comes and goes only between games, stays under its caps, gives way to a person, and
// is marked for the TV and the phone. Also that a room where nobody adds a guest looks as it always did.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, test } from "node:test";
import type WebSocket from "ws";

process.env.GAME_ROOM_TEXT_ONLY = "1";
process.env.META_BASE_URL = "http://localhost:9/v1";
process.env.META_MODEL_API_KEY = "stand-in";

const { GAMES } = await import("../cartridges/index.ts");
const { Room } = await import("./room.ts");
const { studioShelf } = await import("../studio/shelf.ts");

/** A phone or TV connection the room can't tell from a real one. */
class FakeSocket extends EventEmitter {
    public bufferedAmount: number = 0;
    public readonly sent: Record<string, unknown>[] = [];

    /**
     * Keeps what the room sent.
     * @param data the text.
     */
    public send(data: string): void {
        this.sent.push(JSON.parse(data) as Record<string, unknown>);
    }

    /** Nothing to close. */
    public close(): void {
        return;
    }

    /** Nothing to end. */
    public terminate(): void {
        return;
    }

    /**
     * Says something to the room.
     * @param message the message.
     */
    public say(message: Record<string, unknown>): void {
        this.emit("message", Buffer.from(JSON.stringify(message)), false);
    }

    /**
     * The newest message of a type.
     * @param type the type.
     * @returns it, if any.
     */
    public latest(type: string): Record<string, unknown> | undefined {
        return this.sent.findLast((message: Record<string, unknown>) => message.type === type);
    }
}

const rooms: InstanceType<typeof Room>[] = [];
after(() => {
    rooms.forEach((room: InstanceType<typeof Room>) => { room.close(); });
    setTimeout(() => { process.exit(0); }, 100).unref();
});

/**
 * Opens a room with a screen and one person in it.
 * @returns the room, the person's phone and the screen.
 */
function table(): { room: InstanceType<typeof Room>; phone: FakeSocket; screen: FakeSocket } {
    const room: InstanceType<typeof Room> = new Room("TEST", "http://localhost", studioShelf(GAMES, true));
    rooms.push(room);
    const screen: FakeSocket = new FakeSocket();
    room.attachScreen(screen as unknown as WebSocket);
    const phone: FakeSocket = new FakeSocket();
    room.attachPhone(phone as unknown as WebSocket);
    phone.say({ type: "hello", name: "Teacup" });
    return { room, phone, screen };
}

/**
 * The seats the TV was last told about.
 * @param screen the TV.
 * @returns the seats.
 */
function seatsOn(screen: FakeSocket): { name: string; guest: boolean; driving: boolean }[] {
    return (screen.latest("shell")?.view as { seats: { name: string; guest: boolean; driving: boolean }[] }).seats;
}

test("nobody adds a guest: no guest on the TV, nothing on the phone, the usual game page", () => {
    const { phone, screen } = table();
    assert.deepEqual(seatsOn(screen).map((seat) => seat.guest), [false]);
    const view = phone.latest("view")?.view as { guests: { seated: unknown[]; canAdd: boolean; canRemove: boolean } };
    assert.deepEqual(view.guests, { seated: [], canAdd: true, canRemove: false, agents: null }, "agents are off unless the server turns them on");
    phone.say({ type: "nav", action: { kind: "select" } });
    const shell = screen.latest("shell")?.view as { screen: string; menu: string[]; games: { id: string }[]; focus: number };
    assert.equal(shell.screen, "game");
    assert.deepEqual(shell.menu, ["Play", "Back to the shelf"], `${shell.games[0]?.id} takes no guests, so its page is unchanged`);
});

test("guests are labelled, capped at three, and the person keeps the controller", () => {
    const { phone, screen } = table();
    for (let press = 0; press < 5; press += 1) {
        phone.say({ type: "guest", action: "add" });
    }
    const seats = seatsOn(screen);
    assert.deepEqual(seats.map((seat) => seat.name), ["Teacup", "Pip the AI", "Bramble the AI", "Tuppence the AI"]);
    assert.deepEqual(seats.map((seat) => seat.guest), [false, true, true, true]);
    assert.deepEqual(seats.map((seat) => seat.driving), [true, false, false, false]);
    const view = phone.latest("view")?.view as { guests: { seated: { name: string }[]; canAdd: boolean; canRemove: boolean } };
    assert.equal(view.guests.seated.length, 3);
    assert.equal(view.guests.canAdd, false);
    assert.equal(view.guests.canRemove, true);
});

test("a guest doesn't keep a room open: when the last person leaves, the guests go too", () => {
    const { room, phone, screen } = table();
    phone.say({ type: "guest", action: "add" });
    phone.say({ type: "guest", action: "add" });
    assert.equal(room.hasPlayers(), true);
    phone.say({ type: "leave" });
    assert.equal(room.hasPlayers(), false);
    assert.deepEqual(seatsOn(screen), []);
});

test("a guest can be sent home, by id or the newest", () => {
    const { phone, screen } = table();
    phone.say({ type: "guest", action: "add" });
    phone.say({ type: "guest", action: "add" });
    phone.say({ type: "guest", action: "add" });
    phone.say({ type: "guest", action: "remove" });
    assert.deepEqual(seatsOn(screen).map((seat) => seat.name), ["Teacup", "Pip the AI", "Bramble the AI"]);
    const view = phone.latest("view")?.view as { guests: { seated: { playerId: string }[] } };
    phone.say({ type: "guest", action: "remove", playerId: view.guests.seated[0]?.playerId });
    assert.deepEqual(seatsOn(screen).map((seat) => seat.name), ["Teacup", "Bramble the AI"]);
    phone.say({ type: "guest", action: "remove", playerId: "p1" });
    assert.equal(seatsOn(screen)[0]?.name, "Teacup", "a person can't be removed as a guest");
});

test("a person takes the last seat from a guest", () => {
    const { phone, screen, room } = table();
    phone.say({ type: "guest", action: "add" });
    phone.say({ type: "guest", action: "add" });
    for (let seat = 0; seat < 9; seat += 1) {
        const other: FakeSocket = new FakeSocket();
        room.attachPhone(other as unknown as WebSocket);
        other.say({ type: "hello", name: `Seat ${seat}` });
    }
    assert.equal(seatsOn(screen).length, 12);
    const late: FakeSocket = new FakeSocket();
    room.attachPhone(late as unknown as WebSocket);
    late.say({ type: "hello", name: "Late" });
    const seats = seatsOn(screen);
    assert.equal(seats.length, 12);
    assert.equal(seats.some((seat) => seat.name === "Late"), true);
    assert.equal(seats.filter((seat) => seat.guest === true).length, 1);
    assert.equal((phone.latest("view")?.view as { guests: { canAdd: boolean } }).guests.canAdd, false, "no guest over twelve seats");
});

test("a game that doesn't take guests is blocked until they're gone, with the way out on its page", () => {
    const { phone, screen } = table();
    phone.say({ type: "guest", action: "add" });
    phone.say({ type: "nav", action: { kind: "select" } });
    const shell = screen.latest("shell")?.view as { menu: string[]; games: { id: string; blocked: string | null; guestsWelcome: boolean }[] };
    assert.equal(shell.games[0]?.guestsWelcome, false);
    assert.match(shell.games[0].blocked ?? "", /AI guests can't play/);
    assert.deepEqual(shell.menu, ["Can't start yet", "Remove an AI guest", "Back to the shelf"]);
});

test("a game's page offers a guest only where it's welcome, and filling the table moves to Play", () => {
    const { phone, screen } = table();
    const shelf = screen.latest("shell")?.view as { games: { id: string }[] };
    const cup: number = shelf.games.findIndex((game) => game.id === "underTheCup");
    phone.say({ type: "nav", action: { kind: "step", delta: cup } });
    phone.say({ type: "nav", action: { kind: "select" } });
    const page = (): { menu: string[]; focus: number } => screen.latest("shell")?.view as { menu: string[]; focus: number };
    assert.deepEqual(page().menu, ["Can't start yet", "Add an AI guest", "Back to the shelf"]);
    phone.say({ type: "nav", action: { kind: "step", delta: 1 } });
    phone.say({ type: "nav", action: { kind: "select" } });
    assert.deepEqual(page().menu, ["Can't start yet", "Add an AI guest", "Back to the shelf"]);
    assert.equal(page().focus, 1);
    phone.say({ type: "nav", action: { kind: "select" } });
    assert.deepEqual(page().menu, ["Play", "Add an AI guest", "Back to the shelf"]);
    assert.equal(page().focus, 0);
    phone.say({ type: "guest", action: "add" });
    assert.deepEqual(page().menu, ["Play", "Remove an AI guest", "Back to the shelf"], "at the cap, the row turns to remove");
});

test("seats freeze for a game: nobody adds or removes a guest while one runs", () => {
    const { phone, screen } = table();
    phone.say({ type: "guest", action: "add" });
    phone.say({ type: "guest", action: "add" });
    const shelf = screen.latest("shell")?.view as { games: { id: string }[] };
    phone.say({ type: "nav", action: { kind: "step", delta: shelf.games.findIndex((game) => game.id === "whoFits") } });
    phone.say({ type: "nav", action: { kind: "select" } });
    phone.say({ type: "nav", action: { kind: "select" } });
    assert.equal((screen.latest("shell")?.view as { screen: string }).screen, "startCard");
    phone.say({ type: "nav", action: { kind: "select" } });
    assert.equal((screen.latest("shell")?.view as { screen: string }).screen, "play");
    phone.say({ type: "guest", action: "add" });
    phone.say({ type: "guest", action: "remove" });
    assert.equal(seatsOn(screen).length, 3);
    const view = phone.latest("view")?.view as { guests: { canAdd: boolean; canRemove: boolean } };
    assert.deepEqual([view.guests.canAdd, view.guests.canRemove], [false, false]);
    phone.say({ type: "leave" });
    assert.deepEqual(seatsOn(screen), [], "the game ends and the guests go when the last person leaves");
});
