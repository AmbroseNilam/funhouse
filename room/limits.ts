// The limits that keep a public site affordable and fair. Anyone can open it without an account,
// so everything that costs money or memory is counted here. When a limit is hit the room stays
// up and simply does less; nothing here throws.

/** Most model replies, voice lines and pictures the whole server may spend in a day. */
const DAILY_BUDGET: Record<SpendKind, number> = { spark: 5000, voice: 2000, image: 200 };

/** How long a day of budget lasts. */
const BUDGET_PERIOD_MILLISECONDS: number = 86400000;

/** Most rooms one address may hold open; a household or office may host a few. */
const MAX_ROOMS_PER_ADDRESS: number = 4;

/** Most open connections from one address. */
const MAX_SOCKETS_PER_ADDRESS: number = 24;

/** Most open connections on the whole server. */
const MAX_SOCKETS: number = 500;

/** Wrong room codes an address may try in a minute before it has to wait. */
const MAX_CODE_MISSES_PER_MINUTE: number = 10;

/** How long an address waits after too many wrong room codes. */
const CODE_BLOCK_MILLISECONDS: number = 600000;

/** What costs money. */
export type SpendKind = "spark" | "voice" | "image";

/** Counts events in a rolling window of fixed length. */
export class RateWindow {
    private readonly limit: number;
    private readonly windowMilliseconds: number;
    private windowStart: number = 0;
    private count: number = 0;

    /**
     * Creates a window.
     * @param limit how many events a window allows.
     * @param windowMilliseconds how long a window lasts.
     */
    public constructor(limit: number, windowMilliseconds: number) {
        this.limit = limit;
        this.windowMilliseconds = windowMilliseconds;
    }

    /**
     * Counts one event.
     * @returns false when it's over the limit.
     */
    public allow(): boolean {
        const now: number = Date.now();
        if (now - this.windowStart >= this.windowMilliseconds) {
            this.windowStart = now;
            this.count = 0;
        }
        this.count += 1;
        return this.count <= this.limit;
    }
}

/** The whole server's daily spend. */
class SpendBudget {
    private readonly spent: Record<SpendKind, number> = { spark: 0, voice: 0, image: 0 };
    private periodStart: number = Date.now();

    /**
     * Records one paid call if the day's budget allows it.
     * @param kind what it costs.
     * @returns false when the budget is spent and the call shouldn't happen.
     */
    public spend(kind: SpendKind): boolean {
        this.rollOver();
        if (this.spent[kind] >= DAILY_BUDGET[kind]) {
            return false;
        }
        this.spent[kind] += 1;
        return true;
    }

    /**
     * Whether anything new should start today.
     * @returns false once model replies or voice lines have run out.
     */
    public hasRoom(): boolean {
        this.rollOver();
        return this.spent.spark < DAILY_BUDGET.spark && this.spent.voice < DAILY_BUDGET.voice;
    }

    /** Starts a fresh budget when a day has passed. */
    private rollOver(): void {
        if (Date.now() - this.periodStart < BUDGET_PERIOD_MILLISECONDS) {
            return;
        }
        this.periodStart = Date.now();
        this.spent.spark = 0;
        this.spent.voice = 0;
        this.spent.image = 0;
    }
}

/** The one budget this server spends from. */
export const BUDGET: SpendBudget = new SpendBudget();

/** Per-address counts, for connections, rooms and wrong codes. */
export class AddressLimits {
    private readonly sockets: Map<string, number> = new Map();
    private readonly rooms: Map<string, Set<string>> = new Map();
    private readonly misses: Map<string, RateWindow> = new Map();
    private readonly blockedUntil: Map<string, number> = new Map();
    private totalSockets: number = 0;

    /**
     * Counts a new connection.
     * @param address where it came from.
     * @returns false when it should be refused.
     */
    public openSocket(address: string): boolean {
        const count: number = this.sockets.get(address) ?? 0;
        if (this.totalSockets >= MAX_SOCKETS || count >= MAX_SOCKETS_PER_ADDRESS) {
            return false;
        }
        this.sockets.set(address, count + 1);
        this.totalSockets += 1;
        return true;
    }

    /**
     * Forgets a connection that closed.
     * @param address where it came from.
     */
    public closeSocket(address: string): void {
        const count: number = (this.sockets.get(address) ?? 1) - 1;
        this.totalSockets = Math.max(0, this.totalSockets - 1);
        if (count <= 0) {
            this.sockets.delete(address);
            return;
        }
        this.sockets.set(address, count);
    }

    /**
     * Whether this address may open another room.
     * @param address who's asking.
     * @param isOpen tells whether a room code is still open.
     * @returns false at the limit.
     */
    public mayOpenRoom(address: string, isOpen: (code: string) => boolean): boolean {
        const held: string[] = [...(this.rooms.get(address) ?? [])].filter(isOpen);
        this.rooms.set(address, new Set(held));
        return held.length < MAX_ROOMS_PER_ADDRESS;
    }

    /**
     * Notes a room this address opened.
     * @param address who.
     * @param code the room.
     */
    public roomOpened(address: string, code: string): void {
        this.rooms.set(address, (this.rooms.get(address) ?? new Set()).add(code));
    }

    /**
     * Whether this address is waiting after too many wrong codes.
     * @param address who.
     * @returns true while blocked.
     */
    public isBlocked(address: string): boolean {
        const until: number | undefined = this.blockedUntil.get(address);
        if (until === undefined) {
            return false;
        }
        if (Date.now() >= until) {
            this.blockedUntil.delete(address);
            return false;
        }
        return true;
    }

    /**
     * Counts a wrong room code.
     * @param address who tried it.
     */
    public codeMissed(address: string): void {
        const window: RateWindow = this.misses.get(address) ?? new RateWindow(MAX_CODE_MISSES_PER_MINUTE, 60000);
        this.misses.set(address, window);
        if (window.allow() === false) {
            this.blockedUntil.set(address, Date.now() + CODE_BLOCK_MILLISECONDS);
        }
    }

    /** Drops bookkeeping for addresses with nothing open, so this can't grow forever. */
    public sweep(): void {
        this.misses.clear();
        for (const address of this.rooms.keys()) {
            if (this.sockets.has(address) === false) {
                this.rooms.delete(address);
            }
        }
    }
}
