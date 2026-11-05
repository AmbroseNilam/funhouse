// Finds and makes rooms, so each host on a big screen gets a room of their own. A screen
// without a known code starts a new room; a phone must name one that exists. Rooms nobody is
// in are closed after a while, and the number open is capped because each costs provider calls.

import type { InstalledGame } from "../cartridges/index.ts";
import { log } from "./log.ts";
import { makeRoomCode, Room } from "./room.ts";

/** How long a room that ran out is remembered, so someone can still enter a code for it. */
const RESTED_MEMORY_MILLISECONDS: number = 600000;

/** Most rooms open at once on this server. A room spends nothing until it's used, so open tabs mustn't lock anyone out. */
const MAX_ROOMS: number = Number(process.env.ROOM_LIMIT ?? "") || 32;

/** How long a room may sit with nobody in it before it closes. */
const EMPTY_ROOM_MILLISECONDS: number = 300000;

/** How long a room nobody ever sat in may stay after its screen has gone: long enough for a reload. */
const NEVER_SEATED_MILLISECONDS: number = 60000;

/** How long a screen may sit with no players before the room closes anyway; a TV left on mustn't hold one forever. */
const NO_PLAYERS_MILLISECONDS: number = 900000;

/** How long a room with people in it may go with nobody doing anything, when limits are on. */
const IDLE_MILLISECONDS: number = Number(process.env.COST_IDLE_MINUTES ?? 5) * 60000;

/** How long a room that ran out gets to finish its sentence before the stop screen. */
const REST_GRACE_MILLISECONDS: number = 12000;

/** How often rooms are checked against their allowance. */
const ALLOWANCE_CHECK_MILLISECONDS: number = 3000;

/** How often empty rooms are looked for. */
const SWEEP_MILLISECONDS: number = 30000;

/** Every open room on this server. */
export class RoomDirectory {
    private readonly publicUrl: string;
    private readonly games: InstalledGame[];
    private readonly testingGames: InstalledGame[];
    private readonly rooms: Map<string, Room> = new Map();
    private readonly emptySince: Map<string, number> = new Map();
    private readonly noPlayersSince: Map<string, number> = new Map();
    private readonly outSince: Map<string, number> = new Map();
    private readonly restedPayers: Map<string, string> = new Map();

    /**
     * Creates an empty directory and starts closing abandoned rooms.
     * @param publicUrl the base URL phones open, from PUBLIC_URL.
     * @param games what every new room has on its shelf.
     * @param testingGames what a room opened for testing has: the same plus the games still on hold; the same games unless given.
     */
    public constructor(publicUrl: string, games: InstalledGame[], testingGames: InstalledGame[] = games) {
        this.publicUrl = publicUrl;
        this.games = games;
        this.testingGames = testingGames;
        setInterval(() => { this.closeEmptyRooms(); }, SWEEP_MILLISECONDS).unref();
        setInterval(() => { this.checkAllowances(); }, ALLOWANCE_CHECK_MILLISECONDS).unref();
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
     * @param tapToTalk true to try tap-to-talk in this room.
     * @param fastReplies true to try the faster reply model in this room.
     * @param testing true to give this room the games still on hold too, each marked as testing.
     * @param payer who the room's spending is charged to.
     * @returns the room, or null when the server is at its limit.
     */
    public create(lively: boolean = false, tapToTalk: boolean = false, fastReplies: boolean = false, testing: boolean = false, payer: string = ""): Room | null {
        if (this.rooms.size >= MAX_ROOMS) {
            return null;
        }
        let code: string = makeRoomCode();
        while (this.rooms.has(code) === true) {
            code = makeRoomCode();
        }
        const room: Room = new Room(code, this.publicUrl, testing === true ? this.testingGames : this.games, lively, tapToTalk, fastReplies, payer);
        this.rooms.set(code, room);
        log(`room ${code}`, `opened (${this.rooms.size} open)`);
        return room;
    }

    /** Sends rooms that ran out to the stop screen after a moment, and closes rooms nobody is doing anything in. */
    /**
     * Who was paying for a room that recently closed for running out, so a code entered after can still lift them.
     * @param code the room's code.
     * @returns the payer, if it's still remembered.
     */
    public restedPayer(code: string): string | undefined {
        return this.restedPayers.get(code.toUpperCase());
    }

    /** Closes rooms out of allowance after their grace, and rooms nobody has acted in. */
    private checkAllowances(): void {
        const now: number = Date.now();
        for (const [code, room] of this.rooms) {
            if (room.isOutOfAllowance() === false) {
                this.outSince.delete(code);
            }
            if (room.isOutOfAllowance() === true) {
                this.outSince.set(code, this.outSince.get(code) ?? now);
            }
            const rested: boolean = now - (this.outSince.get(code) ?? now) >= REST_GRACE_MILLISECONDS;
            // A room with no players spends nothing and has its own rule, so a TV showing its code gets longer.
            const idle: boolean = process.env.COST_LIMITS === "1" && room.hasPlayers() === true && room.idleMilliseconds() >= IDLE_MILLISECONDS;
            if (rested === false && idle === false) {
                continue;
            }
            if (rested === true) {
                this.restedPayers.set(code, room.payer);
                setTimeout(() => { this.restedPayers.delete(code); }, RESTED_MEMORY_MILLISECONDS).unref();
            }
            room.turnEveryoneAway(rested);
            room.close();
            this.rooms.delete(code);
            this.outSince.delete(code);
            this.emptySince.delete(code);
            this.noPlayersSince.delete(code);
            log(`room ${code}`, `closed, ${rested === true ? "out of allowance" : "idle"} (${this.rooms.size} open)`);
        }
    }

    /** Closes rooms that have had nobody in them for long enough. */
    private closeEmptyRooms(): void {
        const now: number = Date.now();
        for (const [code, room] of this.rooms) {
            if (room.hasPlayers() === true) {
                this.emptySince.delete(code);
                this.noPlayersSince.delete(code);
                continue;
            }
            const noPlayersSince: number = this.noPlayersSince.get(code) ?? now;
            this.noPlayersSince.set(code, noPlayersSince);
            if (room.isEmpty() === false) {
                this.emptySince.delete(code);
            }
            if (room.isEmpty() === true) {
                this.emptySince.set(code, this.emptySince.get(code) ?? now);
            }
            const emptyLongEnough: boolean = now - (this.emptySince.get(code) ?? now) >= (room.neverSeated() === true ? NEVER_SEATED_MILLISECONDS : EMPTY_ROOM_MILLISECONDS);
            if (emptyLongEnough === false && now - noPlayersSince < NO_PLAYERS_MILLISECONDS) {
                continue;
            }
            room.turnEveryoneAway();
            room.close();
            this.rooms.delete(code);
            this.emptySince.delete(code);
            this.noPlayersSince.delete(code);
            log(`room ${code}`, `closed (${this.rooms.size} open)`);
        }
    }
}
