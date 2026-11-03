// Finds and makes rooms, so each host on a big screen gets a room of their own. A screen
// without a known code starts a new room; a phone must name one that exists. Rooms nobody is
// in are closed after a while, and the number open is capped because each costs provider calls.

import { log } from "./log.ts";
import { makeRoomCode, Room } from "./room.ts";

/** Most rooms open at once on this server. A room spends nothing until it's used, so open tabs mustn't lock anyone out. */
const MAX_ROOMS: number = 32;

/** How long a room may sit with nobody in it before it closes. */
const EMPTY_ROOM_MILLISECONDS: number = 300000;

/** How often empty rooms are looked for. */
const SWEEP_MILLISECONDS: number = 30000;

/** Every open room on this server. */
export class RoomDirectory {
    private readonly publicUrl: string;
    private readonly rooms: Map<string, Room> = new Map();
    private readonly emptySince: Map<string, number> = new Map();

    /**
     * Creates an empty directory and starts closing abandoned rooms.
     * @param publicUrl the base URL phones open, from PUBLIC_URL.
     */
    public constructor(publicUrl: string) {
        this.publicUrl = publicUrl;
        setInterval(() => { this.closeEmptyRooms(); }, SWEEP_MILLISECONDS).unref();
    }

    /**
     * Looks up an open room.
     * @param code the code as typed; case does not matter.
     * @returns the room, or undefined when none is open under that code.
     */
    public find(code: string): Room | undefined {
        return this.rooms.get(code.toUpperCase());
    }

    /**
     * Opens a new room with an unused code.
     * @param lively true to try the livelier host in this room.
     * @returns the room, or null when the server is at its limit.
     */
    public create(lively: boolean = false): Room | null {
        if (this.rooms.size >= MAX_ROOMS) {
            return null;
        }
        let code: string = makeRoomCode();
        while (this.rooms.has(code) === true) {
            code = makeRoomCode();
        }
        const room: Room = new Room(code, this.publicUrl, lively);
        this.rooms.set(code, room);
        log(`room ${code}`, `opened (${this.rooms.size} open)`);
        return room;
    }

    /** Closes rooms that have had nobody in them for long enough. */
    private closeEmptyRooms(): void {
        const now: number = Date.now();
        for (const [code, room] of this.rooms) {
            if (room.isEmpty() === false) {
                this.emptySince.delete(code);
                continue;
            }
            const since: number = this.emptySince.get(code) ?? now;
            this.emptySince.set(code, since);
            if (now - since < EMPTY_ROOM_MILLISECONDS) {
                continue;
            }
            room.close();
            this.rooms.delete(code);
            this.emptySince.delete(code);
            log(`room ${code}`, `closed (${this.rooms.size} open)`);
        }
    }
}
