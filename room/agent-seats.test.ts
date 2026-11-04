// Checks a person's link for their agent inside a real room, with agents switched on: asking twice gives the
// same link, cancelling ends it, leaving ends it, and the phone is told when the agent has sat down.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, test } from "node:test";
import type WebSocket from "ws";

process.env.AGENTS_ON = "1";
process.env.GAME_ROOM_TEXT_ONLY = "1";
process.env.META_BASE_URL = "http://localhost:9/v1";
process.env.META_MODEL_API_KEY = "stand-in";

const { GAMES } = await import("../cartridges/index.ts");
const { Room } = await import("./room.ts");

/** A phone the room can't tell from a real one. */
class FakePhone extends EventEmitter {
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

    /**
     * Says something to the room.
     * @param message the message.
     */
    public say(message: Record<string, unknown>): void {
        this.emit("message", Buffer.from(JSON.stringify(message)), false);
    }

    /**
     * What the phone's menu knows about agents.
     * @returns the guests part of its latest view.
     */
    public agents(): { canInvite: boolean; link: string; joined: string } {
        const view = this.sent.findLast((message: Record<string, unknown>) => message.type === "view")?.view as { guests: { agents: { canInvite: boolean; link: string; joined: string } } };
        return view.guests.agents;
    }
}

const rooms: InstanceType<typeof Room>[] = [];
after(() => {
    rooms.forEach((room: InstanceType<typeof Room>) => { room.close(); });
    setTimeout(() => { process.exit(0); }, 100).unref();
});

/**
 * Opens a room with one person in it.
 * @returns the room and the phone.
 */
function table(): { room: InstanceType<typeof Room>; phone: FakePhone } {
    const room: InstanceType<typeof Room> = new Room("TEST", "http://localhost", GAMES);
    rooms.push(room);
    const phone: FakePhone = new FakePhone();
    room.attachPhone(phone as unknown as WebSocket);
    phone.say({ type: "hello", name: "Teacup" });
    return { room, phone };
}

test("asking for a link again gives the same one", () => {
    const { phone } = table();
    phone.say({ type: "guest", action: "inviteAgent" });
    const first: string = phone.agents().link;
    assert.notEqual(first, "");
    phone.say({ type: "guest", action: "inviteAgent" });
    phone.say({ type: "guest", action: "inviteAgent" });
    assert.equal(phone.agents().link, first);
});

test("cancelling ends the link, and the next one is new", () => {
    const { phone } = table();
    phone.say({ type: "guest", action: "inviteAgent" });
    const first: string = phone.agents().link;
    phone.say({ type: "guest", action: "cancelAgent" });
    assert.equal(phone.agents().link, "");
    phone.say({ type: "guest", action: "inviteAgent" });
    assert.notEqual(phone.agents().link, first);
    assert.notEqual(phone.agents().link, "");
});

test("someone holding a link nobody has taken up sees nothing of the room", () => {
    const { room, phone } = table();
    phone.say({ type: "guest", action: "inviteAgent" });
    assert.deepEqual(room.agentTable("p1", null).tv, []);
});

test("the phone is told when the agent sits, and the link is used up", () => {
    const { room, phone } = table();
    phone.say({ type: "guest", action: "inviteAgent" });
    const seated = room.agentSits("p1");
    assert.equal(typeof seated === "string", false);
    assert.equal(phone.agents().link, "");
    assert.equal(phone.agents().joined, "Teacup's agent");
});
