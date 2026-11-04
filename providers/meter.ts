// Counts what every paid provider call costs, in dollars, against a daily allowance per network
// address and a daily ceiling for the whole site. Providers charge here themselves, so a new caller
// can't forget. Spending belongs to whoever opened the room, carried by withPayer. The day's totals
// are saved to disk so restarts don't reset them. If that store breaks, spending stops; rooms don't crash.
// Limits are off unless COST_LIMITS=1, so someone running their own copy sets their own.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Everything that costs money. */
export type Service = "spark" | "moderation" | "search" | "transcribe" | "voice" | "image" | "jev";

/** How far along a payer is: everything on, no new paintings, captions instead of voice, stopped. */
export type Stage = 0 | 1 | 2 | 3;

/** What the stages are called in the logs. */
const STAGE_NAMES: string[] = ["normal", "no new paintings", "captions only", "stopped"];

/**
 * What things cost, the one place prices live. Sources, all to recheck against the bills:
 * Spark: $1.25 in and $4.25 out per million, the published Muse Spark 1.1 price; 1.2 and 1.3 could
 * not be confirmed, so the figure is padded by half. Search: $2.50 per thousand queries as reported for Spark 1.1, doubled since the tokens it reads aren't all visible.
 * Transcribe: $0.18 an audio hour, from the hackathon notes. Image: about a cent, from probes,
 * padded to 1.5. Jev: $0.0011 a decision, the higher of two quotes. Voice: ElevenLabs Flash at $0.11
 * per thousand characters, a low paid-plan overage rate rounded up, and the same is used for OpenAI's voice.
 */
export const PRICES = {
    sparkInputPerToken: 1.875 / 1_000_000,
    sparkOutputPerToken: 6.375 / 1_000_000,
    searchPerCall: 0.005,
    transcribePerSecond: 0.18 / 3600,
    imagePerPicture: 0.015,
    jevPerCall: 0.0011,
    voicePerCharacter: 0.11 / 1000,
} as const;

/** Reads a number from the environment. */
function numberFrom(name: string, fallback: number): number {
    const value: number = Number(process.env[name] ?? "");
    return (process.env[name] ?? "") !== "" && Number.isFinite(value) === true && value >= 0 ? value : fallback;
}

/** One line each to change a limit. Read when asked, so a test can set them. */
function settings(): { on: boolean; judgeReserve: number; address: number; judge: number; site: number; paintingsOffAt: number; captionsAt: number; resetHour: number; directory: string; transcribeSecondsAddress: number; transcribeSecondsSite: number; jevCallsAddress: number; jevCallsSite: number } {
    return {
        on: process.env.COST_LIMITS === "1",
        address: numberFrom("COST_ADDRESS_DOLLARS", 3),
        judge: numberFrom("COST_JUDGE_DOLLARS", 10),
        judgeReserve: numberFrom("COST_JUDGE_RESERVE_DOLLARS", 5),
        site: numberFrom("COST_SITE_DOLLARS", 15),
        paintingsOffAt: numberFrom("COST_PAINTINGS_OFF_AT", 0.6),
        captionsAt: numberFrom("COST_CAPTIONS_AT", 0.9),
        resetHour: numberFrom("COST_RESET_UTC_HOUR", 8),
        directory: process.env.COST_DIR ?? "",
        transcribeSecondsAddress: numberFrom("COST_TRANSCRIBE_SECONDS_ADDRESS", 7200),
        transcribeSecondsSite: numberFrom("COST_TRANSCRIBE_SECONDS_SITE", 72000),
        jevCallsAddress: numberFrom("COST_JEV_CALLS_ADDRESS", 500),
        jevCallsSite: numberFrom("COST_JEV_CALLS_SITE", 5000),
    };
}

/** One payer's day. */
interface Account {
    dollars: number;
    pass: "judge" | "owner" | null;
    transcribeSeconds: number;
    jevCalls: number;
}

/** What's saved. Addresses appear only as keyed hashes, and only for today. */
interface SavedDay {
    day: string;
    salt: string;
    byService: Partial<Record<Service, number>>;
    accounts: Record<string, Account>;
    unattributed: number;
}

/** Who pays for the work in progress. */
const PAYER: AsyncLocalStorage<string> = new AsyncLocalStorage<string>();

/** How often a changed day is written out. */
const FLUSH_MILLISECONDS: number = 2000;

let current: SavedDay | null = null;
let dirty: boolean = false;
let storeBroken: boolean = false;
let loadedBadFile: boolean = false;
let flushTimer: NodeJS.Timeout | null = null;
let siteStageSeen: Stage = 0;
const payerStagesSeen: Map<string, Stage> = new Map();

/** Writes one log line. Never holds an address, only the first characters of its keyed hash. */
function note(message: string): void {
    console.warn(`${new Date().toISOString()} [spend] ${message}`);
}

/** Today's name; the day turns over at the fixed reset hour. */
function dayName(now: number): string {
    return new Date(now - settings().resetHour * 3600000).toISOString().slice(0, 10);
}

/** The file the day is saved in. */
function storePath(): string {
    return join(settings().directory, "spend.json");
}

/** Whether what was read has every part the meter relies on. */
function isWholeDay(saved: SavedDay): boolean {
    const isFigures = (value: unknown): boolean => typeof value === "object" && value !== null && Object.values(value).every((figure: unknown) => typeof figure === "number");
    const accounts: unknown = saved.accounts;
    return typeof saved.salt === "string" && typeof saved.day === "string" && typeof saved.unattributed === "number" && isFigures(saved.byService)
        && typeof accounts === "object" && accounts !== null
        && Object.values(accounts).every((account: Account | null) => typeof account?.dollars === "number" && typeof account.transcribeSeconds === "number" && typeof account.jevCalls === "number");
}

/** Reads the saved day, or marks the store broken. A missing file is simply a first run. */
function load(): SavedDay {
    const fresh: SavedDay = { day: dayName(Date.now()), salt: randomBytes(32).toString("hex"), byService: {}, accounts: {}, unattributed: 0 };
    const settingsNow = settings();
    if (settingsNow.on === false) {
        return fresh;
    }
    if (settingsNow.directory === "") {
        storeBroken = true;
        note("COST_DIR is not set: spending stays off");
        return fresh;
    }
    if (flushTimer === null) {
        flushTimer = setInterval(() => { flushSpend(); }, FLUSH_MILLISECONDS);
        flushTimer.unref();
    }
    let text: string;
    try {
        text = readFileSync(storePath(), "utf8");
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            dirty = true;
            return fresh;
        }
        storeBroken = true;
        loadedBadFile = true;
        note("spend store can't be read: spending stays off");
        return fresh;
    }
    try {
        const saved: SavedDay = JSON.parse(text) as SavedDay;
        if (isWholeDay(saved) === false) {
            throw new Error("bad shape");
        }
        return saved;
    } catch {
        storeBroken = true;
        loadedBadFile = true;
        note("spend store is damaged: spending stays off until it is fixed or removed and the server restarted");
        return fresh;
    }
}

/** Gets today, starting a new one when the reset hour has passed. The salt stays, so hashes stay stable. */
function today(): SavedDay {
    current ??= load();
    const name: string = dayName(Date.now());
    if (current.day !== name) {
        note(`day ended: $${siteDollars(current).toFixed(2)} across ${Object.keys(current.accounts).length} addresses`);
        current = { day: name, salt: current.salt, byService: {}, accounts: {}, unattributed: 0 };
        payerStagesSeen.clear();
        siteStageSeen = 0;
        dirty = true;
    }
    return current;
}

/** The day's total for the whole site. */
function siteDollars(day: SavedDay): number {
    return Object.values(day.byService).reduce((sum: number, value: number) => sum + value, 0);
}

/** Writes the day out if it changed. A failure stops spending until a write works again. */
export function flushSpend(): void {
    if (settings().on === false || loadedBadFile === true || settings().directory === "" || dirty === false) {
        return;
    }
    const temporary: string = `${storePath()}.tmp`;
    try {
        mkdirSync(settings().directory, { recursive: true });
        writeFileSync(temporary, JSON.stringify(today()));
        renameSync(temporary, storePath());
        dirty = false;
        if (storeBroken === true) {
            note("spend store is writable again");
        }
        storeBroken = false;
    } catch {
        if (storeBroken === false) {
            note("spend store can't be written: spending stops");
        }
        storeBroken = true;
    }
}

/**
 * Puts the rest of this request on someone's account.
 * @param payer the keyed hash from payerOf.
 */
export function enterPayer(payer: string): void {
    PAYER.enterWith(payer);
}

/**
 * Runs work on someone's account; timers and promises it starts stay on that account.
 * @param payer the keyed hash from payerOf.
 * @param work the work.
 * @returns what the work returns.
 */
export function withPayer<Result>(payer: string, work: () => Result): Result {
    return PAYER.run(payer, work);
}

/**
 * Turns an address into the name it's stored under. IPv6 counts by its /64, since one home or phone gets a whole block.
 * @param address the network address.
 * @returns the keyed hash.
 */
export function payerOf(address: string): string {
    const plain: string = address.replace(/^::ffff:/, "");
    const block: string = plain.includes(":") === true ? expandedIpv6(plain).slice(0, 4).join(":") : plain;
    return createHmac("sha256", today().salt).update(block).digest("hex").slice(0, 32);
}

/** Writes an IPv6 address out in full, so one block always hashes the same. */
function expandedIpv6(address: string): string[] {
    const [head = "", tail = ""] = address.split("%")[0]?.split("::") ?? [];
    const headParts: string[] = head === "" ? [] : head.split(":");
    const tailParts: string[] = tail === "" ? [] : tail.split(":");
    const zeros: string[] = new Array<string>(Math.max(0, 8 - headParts.length - tailParts.length)).fill("0");
    return [...headParts, ...zeros, ...tailParts].map((part: string) => part.toLowerCase().replace(/^0+(?=.)/, ""));
}

/** Gets an account, opening it at zero. */
function accountOf(day: SavedDay, payer: string): Account {
    const found: Account | undefined = day.accounts[payer];
    if (found !== undefined) {
        return found;
    }
    const opened: Account = { dollars: 0, pass: null, transcribeSeconds: 0, jevCalls: 0 };
    day.accounts[payer] = opened;
    return opened;
}

/** Which stage a fraction of an allowance puts someone at. */
function stageAt(fraction: number): Stage {
    const limits = settings();
    if (fraction >= 1) {
        return 3;
    }
    if (fraction >= limits.captionsAt) {
        return 2;
    }
    return fraction >= limits.paintingsOffAt ? 1 : 0;
}

/**
 * Where a payer stands: the worse of their own allowance and the site's. The owner pass is exempt
 * from both. A broken store stops everyone, the owner too, since nothing could be counted.
 * @param payer the payer; the current one when not given.
 * @returns the stage.
 */
export function stageOf(payer: string | undefined = PAYER.getStore()): Stage {
    const limits = settings();
    if (limits.on === false) {
        return 0;
    }
    const day: SavedDay = today();
    const account: Account | undefined = payer === undefined ? undefined : day.accounts[payer];
    if (storeBroken === true) {
        return 3;
    }
    if (account?.pass === "owner") {
        return 0;
    }
    const allowance: number = account?.pass === "judge" ? limits.judge : limits.address;
    const own: Stage = limits.address === 0 && account === undefined ? 0 : stageAt(allowance === 0 ? 1 : (account?.dollars ?? 0) / allowance);
    // Part of the ceiling is held back for judges, so someone burning through the public share can't lock them out.
    const siteLimit: number = account?.pass === "judge" ? limits.site : Math.max(0, limits.site - limits.judgeReserve);
    const site: Stage = stageAt(siteLimit === 0 ? 1 : siteDollars(day) / siteLimit);
    return Math.max(own, site) as Stage;
}

/**
 * Whether a paid call may start now, for the current payer.
 * @param service the call.
 * @returns false when it shouldn't happen.
 */
export function mayCharge(service: Service): boolean {
    const limits = settings();
    if (limits.on === false) {
        return true;
    }
    const payer: string | undefined = PAYER.getStore();
    const stage: Stage = stageOf(payer);
    if (stage === 3 || (service === "image" && stage >= 1) || (service === "voice" && stage >= 2)) {
        return false;
    }
    const day: SavedDay = today();
    const account: Account | undefined = payer === undefined ? undefined : day.accounts[payer];
    if (account?.pass === "owner") {
        return true;
    }
    const allSeconds: number = Object.values(day.accounts).reduce((sum: number, one: Account) => sum + one.transcribeSeconds, 0);
    const allCalls: number = Object.values(day.accounts).reduce((sum: number, one: Account) => sum + one.jevCalls, 0);
    if (service === "transcribe") {
        return (account?.transcribeSeconds ?? 0) < limits.transcribeSecondsAddress && allSeconds < limits.transcribeSecondsSite;
    }
    if (service === "jev") {
        return (account?.jevCalls ?? 0) < limits.jevCallsAddress && allCalls < limits.jevCallsSite;
    }
    return true;
}

/**
 * Records money spent, on the current payer. Takes a negative amount when an estimate is corrected.
 * @param service what it was.
 * @param dollars how much.
 * @param amounts usage counted against the per-service caps.
 * @param amounts.seconds audio seconds.
 * @param amounts.calls Jev calls.
 */
export function charge(service: Service, dollars: number, amounts: { seconds?: number; calls?: number } = {}): void {
    if (settings().on === false) {
        return;
    }
    const day: SavedDay = today();
    day.byService[service] = (day.byService[service] ?? 0) + dollars;
    dirty = true;
    const payer: string | undefined = PAYER.getStore();
    if (payer === undefined) {
        day.unattributed += dollars;
    }
    if (payer !== undefined) {
        const account: Account = accountOf(day, payer);
        account.dollars += dollars;
        account.transcribeSeconds += amounts.seconds ?? 0;
        account.jevCalls += amounts.calls ?? 0;
        noteStage(payer);
    }
    const site: Stage = stageAt(settings().site === 0 ? 1 : siteDollars(day) / settings().site);
    if (site > siteStageSeen) {
        siteStageSeen = site;
        const line: string = `site reached "${STAGE_NAMES[site] ?? ""}" at $${siteDollars(day).toFixed(2)} of $${settings().site}`;
        note(line);
        alertOwner(line);
    }
}

/** Logs when a payer moves to a later stage. */
function noteStage(payer: string): void {
    const stage: Stage = stageOf(payer);
    if (stage <= (payerStagesSeen.get(payer) ?? 0)) {
        return;
    }
    payerStagesSeen.set(payer, stage);
    note(`address ${payer.slice(0, 8)} reached "${STAGE_NAMES[stage] ?? ""}"`);
}

/** Tells the owner, when a webhook is set. A failure is only logged; the logs always have the line. */
function alertOwner(line: string): void {
    const url: string = process.env.COST_ALERT_URL ?? "";
    if (url === "") {
        return;
    }
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Funhouse: ${line}`, content: `Funhouse: ${line}` }), signal: AbortSignal.timeout(5000) })
        .catch(() => { note("alert couldn't be sent"); });
}

/**
 * Compares a code in constant time, hashing first so the length doesn't show.
 * @param given what was typed.
 * @param expected the real code; empty never matches.
 * @returns true on a match.
 */
function codeMatches(given: string, expected: string): boolean {
    if (expected === "") {
        return false;
    }
    return timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(expected).digest());
}

/**
 * Checks a code against the owner's.
 * @param given what was sent.
 * @returns true on a match.
 */
export function isOwnerCode(given: string): boolean {
    return codeMatches(given, process.env.COST_OWNER_CODE ?? "");
}

/**
 * Applies a pass to some payers for the rest of the day, if the code is right.
 * @param given what was typed.
 * @param payers who gets it.
 * @returns which pass it was, or null.
 */
export function redeemPass(given: string, payers: string[]): "judge" | "owner" | null {
    const judge: boolean = codeMatches(given, process.env.COST_JUDGE_CODE ?? "");
    const owner: boolean = isOwnerCode(given);
    if (judge === false && owner === false) {
        return null;
    }
    const pass: "judge" | "owner" = owner === true ? "owner" : "judge";
    const day: SavedDay = today();
    for (const payer of payers) {
        const account: Account = accountOf(day, payer);
        account.pass = account.pass === "owner" ? "owner" : pass;
        note(`address ${payer.slice(0, 8)} has a pass`);
    }
    dirty = true;
    return pass;
}

/**
 * Whether this payer holds the owner's pass, which also keeps an idle room open for recording.
 * @param payer the payer.
 * @returns true when it does.
 */
export function holdsOwnerPass(payer: string): boolean {
    return settings().on === true && today().accounts[payer]?.pass === "owner";
}

/**
 * Today's figures for the owner, with hashes shortened and no addresses.
 * @returns the summary.
 */
export function spendSummary(): Record<string, unknown> {
    const day: SavedDay = today();
    const accounts: Account[] = Object.values(day.accounts);
    return {
        day: day.day,
        limitsOn: settings().on,
        storeBroken,
        siteDollars: Number(siteDollars(day).toFixed(4)),
        siteCeiling: settings().site,
        byService: day.byService,
        unattributed: Number(day.unattributed.toFixed(4)),
        addresses: accounts.length,
        top: Object.entries(day.accounts).sort((first, second) => second[1].dollars - first[1].dollars).slice(0, 10).map(([payer, account]) => ({ payer: payer.slice(0, 8), dollars: Number(account.dollars.toFixed(4)), pass: account.pass, audioSeconds: Math.round(account.transcribeSeconds), jevCalls: account.jevCalls })),
    };
}

/** Forgets everything in memory, for tests that restart the meter. */
export function resetMeterForTest(): void {
    current = null;
    dirty = false;
    storeBroken = false;
    loadedBadFile = false;
    siteStageSeen = 0;
    payerStagesSeen.clear();
    if (flushTimer !== null) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
}

/**
 * Charges a chat request's estimate before it goes out, so racing rooms can't overrun on trust.
 * @param service which service it's billed under.
 * @param inputCharacters how long the prompt is.
 * @returns a function that replaces the estimate with real usage, once.
 */
export function chargeChatEstimate(service: Service, inputCharacters: number): (usage: unknown) => void {
    const estimate: number = Math.ceil(inputCharacters / 3) * PRICES.sparkInputPerToken + 300 * PRICES.sparkOutputPerToken;
    charge(service, estimate);
    const startedOn: string = today().day;
    let settled: boolean = false;
    return (usage: unknown): void => {
        const counted = usage as { prompt_tokens?: unknown; completion_tokens?: unknown; input_tokens?: unknown; output_tokens?: unknown } | null | undefined;
        const input: unknown = counted?.prompt_tokens ?? counted?.input_tokens;
        const output: unknown = counted?.completion_tokens ?? counted?.output_tokens;
        if (settled === true || typeof input !== "number" || typeof output !== "number") {
            return;
        }
        settled = true;
        // Yesterday's estimate is yesterday's; a correction mustn't hand today extra allowance.
        if (today().day !== startedOn) {
            return;
        }
        charge(service, input * PRICES.sparkInputPerToken + output * PRICES.sparkOutputPerToken - estimate);
    };
}
