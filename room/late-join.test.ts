// Someone who sits down after a game began only watches it: they're told so, nothing in the game is
// theirs to touch, and nothing private reaches them. Fake sockets, no network.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { WebSocket } from "ws";
import { GAMES } from "../cartridges/index.ts";
import type { PhoneView } from "../shared/controls.ts";
import type { RoomToPhoneMessage } from "../shared/protocol.ts";
import type { ShellView } from "../shared/shell.ts";
import { Room } from "./room.ts";

/** A socket that records what it was sent. */
class FakeSocket extends EventEmitter {
    public readonly readyState: number = 1;
    public readonly bufferedAmount: number = 0;
    public readonly sent: RoomToPhoneMessage[] = [];

    /**
     * Records a message.
     * @param data the message.
     */
    public send(data: string): void {
        this.sent.push(JSON.parse(data) as RoomToPhoneMessage);
    }

    /** Does nothing, as nothing is really connected. */
    public close(): void {
        return;
    }

    /** Does nothing, as nothing is really connected. */
    public terminate(): void {
        return;
    }

    /**
     * Delivers a message from the phone.
     * @param message what it sent.
     */
    public say(message: object): void {
        this.emit("message", Buffer.from(JSON.stringify(message)), false);
    }

    /**
     * The newest view sent here.
     * @returns the view.
     */
    public view(): PhoneView {
        const last: RoomToPhoneMessage | undefined = this.sent.filter((message: RoomToPhoneMessage) => message.type === "view").at(-1);
        assert.ok(last?.type === "view");
        return last.view;
    }
}

/** The parts of a room these tests look into. */
interface RoomInside {
    shell: { view(): ShellView };
    game: { event(event: { type: string; playerId?: string }): void; input(playerId: string, value: string): void };
    host: { pending: string[] };
    players: Map<string, unknown>;
    lastJoinNoticeAt: number;
    passToGame(player: unknown, said: string): void;
}

describe("sitting down during a game", () => {
    let room: Room;
    let inside: RoomInside;
    let players: FakeSocket[];
    const realFetch: typeof fetch = globalThis.fetch;

    /**
     * Sits a phone down.
     * @param name who.
     * @returns its socket.
     */
    function sit(name: string): FakeSocket {
        const phone: FakeSocket = new FakeSocket();
        room.attachPhone(phone as unknown as WebSocket);
        phone.say({ type: "hello", name });
        return phone;
    }

    /**
     * Opens a game, the first phone driving.
     * @param id the game.
     */
    function startGame(id: string): void {
        const target: number = inside.shell.view().games.findIndex((game) => game.id === id);
        players[0]?.say({ type: "nav", action: { kind: "step", delta: target } });
        for (let step = 0; step < 5 && inside.shell.view().screen !== "play"; step += 1) {
            players[0]?.say({ type: "nav", action: { kind: "select" } });
        }
        assert.equal(inside.shell.view().screen, "play");
    }

    beforeEach(() => {
        globalThis.fetch = (): Promise<Response> => Promise.resolve(new Response("{}", { status: 500 }));
        mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
        room = new Room("TEST", "http://localhost", GAMES);
        inside = room as unknown as RoomInside;
        players = ["Ana", "Ben", "Cy", "Dee"].map(sit);
    });

    afterEach(() => {
        mock.timers.reset();
        room.close();
        globalThis.fetch = realFetch;
    });

    for (const id of ["twentyDoors", "quizmaster", "werewolf"]) {
        it(`shows a late joiner nothing to act on, and nothing private, in ${id}`, () => {
            startGame(id);
            const late: FakeSocket = sit("Lou");
            const view: PhoneView = late.view();
            assert.equal(view.pad.watching, true);
            assert.deepEqual(view.controls, []);
            assert.equal(view.turn, null);
            assert.equal(view.pad.canSelect, false);
        });
    }

    it("tells the host a late joiner is only watching, so it doesn't deal them in", () => {
        startGame("twentyDoors");
        inside.host.pending.length = 0;
        inside.lastJoinNoticeAt = 0;
        sit("Lou");
        assert.match(inside.host.pending.at(-1) ?? "", /Lou joined the room and is only watching/);
    });

    it("doesn't let a late joiner's press reach the game", () => {
        startGame("quizmaster");
        const pressed: string[] = [];
        const input = inside.game.input.bind(inside.game);
        inside.game.input = (playerId: string, value: string): void => { pressed.push(value); input(playerId, value); };
        const late: FakeSocket = sit("Lou");
        late.say({ type: "input", input: { value: "surprise", controlIndex: 0 } });
        late.say({ type: "answer", controlId: "topic", value: "dogs" });
        assert.deepEqual(pressed, []);
    });

    it("lets the host hear a late joiner as someone watching, and keeps it from the game", () => {
        startGame("twentyDoors");
        sit("Lou");
        const seen: { type: string; playerId?: string }[] = [];
        const event = inside.game.event.bind(inside.game);
        inside.game.event = (given: { type: string; playerId?: string }): void => { seen.push(given); event(given); };
        inside.host.pending.length = 0;
        inside.passToGame([...inside.players.values()].at(-1), "Is it a dog?");
        assert.deepEqual(seen.filter((given) => given.type === "speechEnded"), []);
        assert.match(inside.host.pending.at(-1) ?? "", /only watching/);
    });

    it("tells a late joiner when the game on screen is already over, and stops calling them a watcher at the shelf", () => {
        startGame("twentyDoors");
        players[0]?.say({ type: "nav", action: { kind: "back" } });
        players[0]?.say({ type: "nav", action: { kind: "choose", index: inside.shell.view().menu.indexOf("We give up") } });
        const late: FakeSocket = sit("Lou");
        assert.equal(late.view().pad.watching, true);
        assert.equal(late.view().pad.gameOver, true);
        players[0]?.say({ type: "nav", action: { kind: "choose", index: inside.shell.view().menu.indexOf("Back to the shelf") } });
        assert.equal(late.view().pad.watching, false);
    });
});
