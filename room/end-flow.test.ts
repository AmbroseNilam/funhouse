// The room's side of ending a game: what happens to the host, who a ruling can act for, and what a
// phone hears when it asks whether it's still connected. Three phones on fake sockets, no network.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { WebSocket } from "ws";
import { GAMES } from "../cartridges/index.ts";
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
}

/** The parts of a room these tests look into. */
interface RoomInside {
    shell: { view(): ShellView };
    host: { pending: string[]; interrupt(wasSpeaking: boolean): void };
    players: Map<string, unknown>;
}

describe("ending a game in a room", () => {
    let room: Room;
    let phones: FakeSocket[];
    let inside: RoomInside;
    const realFetch: typeof fetch = globalThis.fetch;

    /**
     * Takes every phone's seat id, in joining order.
     * @returns the ids.
     */
    function ids(): string[] {
        return [...inside.players.keys()];
    }

    /** Starts Twenty Doors, the first phone driving. */
    function startGame(): void {
        const target: number = inside.shell.view().games.findIndex((game) => game.id === "twentyDoors");
        phones[0]?.say({ type: "nav", action: { kind: "step", delta: target } });
        for (let step = 0; step < 5 && inside.shell.view().screen !== "play"; step += 1) {
            phones[0]?.say({ type: "nav", action: { kind: "select" } });
        }
        assert.equal(inside.shell.view().screen, "play");
    }

    beforeEach(() => {
        globalThis.fetch = (): Promise<Response> => Promise.resolve(new Response("{}", { status: 500 }));
        mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
        room = new Room("TEST", "http://localhost", GAMES.filter((game) => game.manifest.id === "twentyDoors"));
        inside = room as unknown as RoomInside;
        phones = [new FakeSocket(), new FakeSocket(), new FakeSocket()];
        phones.forEach((phone: FakeSocket, index: number) => {
            room.attachPhone(phone as unknown as WebSocket);
            phone.say({ type: "hello", name: ["Ana", "Ben", "Cy"][index] });
        });
    });

    afterEach(() => {
        mock.timers.reset();
        room.close();
        globalThis.fetch = realFetch;
    });

    it("stops the host and forgets what was waiting for it when a decided game goes back to the shelf", () => {
        startGame();
        phones[0]?.say({ type: "nav", action: { kind: "back" } });
        phones[0]?.say({ type: "nav", action: { kind: "choose", index: inside.shell.view().menu.indexOf("We give up") } });
        assert.equal(inside.shell.view().gameOver, true);
        const interrupted: boolean[] = [];
        const interrupt = inside.host.interrupt.bind(inside.host);
        inside.host.interrupt = (wasSpeaking: boolean): void => { interrupted.push(wasSpeaking); interrupt(wasSpeaking); };
        phones[0]?.say({ type: "nav", action: { kind: "choose", index: inside.shell.view().menu.indexOf("Back to the shelf") } });
        assert.equal(inside.shell.view().screen, "home");
        assert.equal(interrupted.length, 1);
        assert.deepEqual(inside.host.pending, []);
    });

    it("doesn't let the host's [[quit]] end a game for someone without the controller", () => {
        startGame();
        room.applyRuling("quit", "", ids()[1] ?? "");
        room.applyRuling("quit", "", ids()[1] ?? "");
        assert.equal(inside.shell.view().screen, "play");
    });

    it("doesn't let a [[quit]] with nobody behind it end a game", () => {
        startGame();
        room.applyRuling("quit", "", null);
        assert.equal(inside.shell.view().screen, "play");
    });

    it("holds the holder's [[quit]] to saying it twice", () => {
        startGame();
        room.applyRuling("quit", "", ids()[0] ?? "");
        assert.equal(inside.shell.view().screen, "play");
        room.applyRuling("quit", "", ids()[0] ?? "");
        assert.equal(inside.shell.view().screen, "home");
    });

    it("answers a phone coming back to the foreground with its current view, so it knows the line works", () => {
        startGame();
        const phone: FakeSocket | undefined = phones[1];
        assert.ok(phone !== undefined);
        const before: number = phone.sent.length;
        phone.say({ type: "presence", away: false });
        assert.equal(phone.sent.slice(before).some((message: RoomToPhoneMessage) => message.type === "view"), true);
    });

    it("sends every phone to the shelf when the holder confirms", () => {
        startGame();
        phones[0]?.say({ type: "nav", action: { kind: "back" } });
        phones[0]?.say({ type: "nav", action: { kind: "choose", index: inside.shell.view().menu.indexOf("End the game") } });
        phones[0]?.say({ type: "nav", action: { kind: "choose", index: 1 } });
        assert.equal(inside.shell.view().screen, "home");
        for (const phone of phones) {
            const last = phone.sent.filter((message: RoomToPhoneMessage) => message.type === "view").at(-1);
            assert.equal(last?.type === "view" ? last.view.pad.axis : null, "x");
            assert.deepEqual(last?.type === "view" ? last.view.controls : null, []);
        }
    });
});
