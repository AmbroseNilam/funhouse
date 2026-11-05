// Process entry point. Serves the built stages and the landing page as static files and
// routes WebSocket connections to rooms: /ws/screen for the public stage and /ws/phone for
// phones, each with a ?room= code. A screen without a known code opens a new room.

import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { Drawing } from "../providers/meta/image.ts";
import { buildInfoFrom, type BuildInfo } from "../shared/build-info.ts";
import type { RejectedReason } from "../shared/protocol.ts";
import { GAMES } from "../cartridges/index.ts";
import { showcaseShelf } from "../studio/shelf.ts";
import { serveAgent } from "./agent.ts";
import { RoomDirectory } from "./directory.ts";
import { roomOptions, type RoomOptions } from "./room-options.ts";
import { addressBlock, flushSpend, isOwnerCode, payerOf, redeemPass, spendSummary, stageOf, withPayer } from "../providers/meter.ts";
import { cameThroughTunnel, REFUSED_PAGE, regionRule } from "./geo.ts";
import { AddressLimits, BUDGET, RateWindow } from "./limits.ts";
import type { Room } from "./room.ts";

/** Port the room listens on inside its pod. */
const PORT: number = Number(process.env.PORT ?? 8740);

/** Base URL phones open; the QR code encodes it. */
const PUBLIC_URL: string = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

/** Where the built stages live, relative to the repository root. */
const STAGE_ROOTS: Record<string, string> = {
    screen: join(import.meta.dirname, "..", "screen", "dist"),
    phone: join(import.meta.dirname, "..", "phone", "dist"),
    landing: join(import.meta.dirname, "..", "landing", "dist"),
};

/** Media types for the static files the stages ship. */
const MEDIA_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".json": "application/json",
};

/** Largest message a stage may send: twice one 3,840-byte audio frame, or a short text. */
const MAX_MESSAGE_BYTES: number = 7680;

/** The site's own address, the only web page allowed to open these sockets. */
const PUBLIC_ORIGIN: string = new URL(PUBLIC_URL).origin;

/** An address the site used to live at, if any; visits there are sent to the current one. */
const OLD_HOST: string | undefined = process.env.OLD_HOST;

/** Headers on every page, so it can't be framed, sniffed or made to load anything else. */
const SECURITY_HEADERS: Record<string, string> = {
    "content-security-policy": [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "font-src 'self'",
        "img-src 'self' data:",
        `connect-src 'self' ${PUBLIC_ORIGIN.replace(/^http/, "ws")}`,
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join("; "),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "microphone=(self), screen-wake-lock=(self), fullscreen=(self), web-share=(self), clipboard-write=(self), camera=(self), geolocation=(), payment=()",
    "strict-transport-security": "max-age=15552000",
};

/** How often bookkeeping for departed addresses is cleared. */
const LIMITS_SWEEP_MILLISECONDS: number = 600000;

/** The build this server is, stamped in by the release. */
const BUILD: BuildInfo = buildInfoFrom(process.env);

/** Names the phone's current build, which changes whenever its page does. Empty when it hasn't been built. */
const PHONE_VERSION: string = await readFile(join(STAGE_ROOTS.phone ?? "", "index.html")).then(
    (page: Buffer) => createHash("sha256").update(page).digest("hex").slice(0, 16),
    () => "",
);

/** The local test mode opens many rooms from one address. */
const ROOM_LIMIT_ON: boolean = process.env.GAME_ROOM_TEXT_ONLY !== "1";

/** How often the server checks on every connection. Cloudflare closes one after 100 s idle. */
const HEARTBEAT_MILLISECONDS: number = 15000;

/** What each stage receives on a heartbeat, so it can tell when the server has gone quiet. */
const HEARTBEAT_MESSAGE: string = JSON.stringify({ type: "heartbeat" });

/** Every room gets the showcase shelf. See mayShowHeldGames for the level that adds the games still on hold. */
const directory: RoomDirectory = new RoomDirectory(PUBLIC_URL, showcaseShelf(GAMES), showcaseShelf(GAMES, true));
const limits: AddressLimits = new AddressLimits();
setInterval(() => { limits.sweep(); }, LIMITS_SWEEP_MILLISECONDS).unref();

/**
 * Who a request really came from. The tunnel is the only way in, and Cloudflare sets this header
 * itself, so a visitor can't fake it. Locally it's absent and the socket address is used.
 * @param request the request.
 * @returns the address.
 */
function addressOf(request: IncomingMessage): string {
    const direct: string = request.socket.remoteAddress ?? "unknown";
    const forwarded: string | string[] | undefined = request.headers["cf-connecting-ip"];
    // Every limit counts an IPv6 /64 as one, or a single home could take every room by changing its last digits.
    return addressBlock(cameThroughTunnel(direct) === true && typeof forwarded === "string" && isIP(forwarded) !== 0 ? forwarded : direct);
}

/** Requests refused since the last log line, by country. No addresses, nothing else. */
const refusedCounts: Map<string, number> = new Map();

/** How often those counts are logged. */
const REFUSED_LOG_MILLISECONDS: number = 3600000;

setInterval(() => {
    if (refusedCounts.size > 0) {
        console.warn(`${new Date().toISOString()} [geo] refused: ${[...refusedCounts].map(([country, count]) => `${country} ${count}`).join(", ")}`);
    }
    refusedCounts.clear();
}, REFUSED_LOG_MILLISECONDS).unref();

/**
 * Whether this request is from somewhere the site can't be offered, counting it if so.
 * @param request the request.
 * @returns true when it must be turned away.
 */
function isRefusedRegion(request: IncomingMessage): boolean {
    const { rule, country } = regionRule(request.headers, request.socket.remoteAddress);
    if (rule !== "refused") {
        return false;
    }
    refusedCounts.set(country, (refusedCounts.get(country) ?? 0) + 1);
    return true;
}

/** Tries at a code each address gets per hour. */
const PASS_TRIES_PER_HOUR: number = 10;

/** Longest code body accepted. */
const PASS_BODY_BYTES: number = 512;

/** Tries at a code, by address (an IPv6 /64 counts as one). Kept across rooms and tabs; a restart forgets them. Codes must be long enough that this barely matters. */
const passTries: Map<string, RateWindow> = new Map();
setInterval(() => { passTries.clear(); }, 3600000).unref();

/**
 * Takes a judge or owner code from a POST body, so it never sits in a URL or a log. It lifts the
 * address that sent it and, when a room is named, whoever opened that room.
 * @param request the request.
 * @param response the response.
 */
function servePass(request: IncomingMessage, response: ServerResponse): void {
    const address: string = addressOf(request);
    const tries: RateWindow = passTries.get(payerOf(address)) ?? new RateWindow(PASS_TRIES_PER_HOUR, 3600000);
    passTries.set(payerOf(address), tries);
    const fromElsewhere: boolean = request.headers.origin !== undefined && request.headers.origin !== PUBLIC_ORIGIN;
    if (fromElsewhere === true || tries.allow() === false) {
        response.writeHead(429).end();
        return;
    }
    let body: string = "";
    request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
        if (body.length > PASS_BODY_BYTES) {
            request.destroy();
        }
    });
    request.on("end", () => {
        const parsed: { code?: unknown; room?: unknown } | null = (() => {
            try {
                return JSON.parse(body) as { code?: unknown; room?: unknown } | null;
            } catch {
                return null;
            }
        })();
        const room: Room | undefined = typeof parsed?.room === "string" ? directory.find(parsed.room) : undefined;
        const rested: string | undefined = typeof parsed?.room === "string" ? directory.restedPayer(parsed.room) : undefined;
        const payers: string[] = [payerOf(address), ...(room === undefined ? [] : [room.payer]), ...(rested === undefined ? [] : [rested])];
        const pass: string | null = typeof parsed?.code === "string" ? redeemPass(parsed.code, payers) : null;
        response.writeHead(pass === null ? 403 : 200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ ok: pass !== null }));
    });
}

/**
 * Shows the owner today's spending. The code goes in a header, which Cloudflare and this server don't log.
 * @param request the request.
 * @param response the response.
 */
function serveOwnerSpend(request: IncomingMessage, response: ServerResponse): void {
    const code: string | string[] | undefined = request.headers["x-owner-code"];
    const address: string = addressOf(request);
    const tries: RateWindow = passTries.get(payerOf(address)) ?? new RateWindow(PASS_TRIES_PER_HOUR, 3600000);
    passTries.set(payerOf(address), tries);
    if (typeof code !== "string" || tries.allow() === false || isOwnerCode(code) === false) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(spendSummary(), null, 2));
}

/**
 * Decides whether a URL unlocks the games still on hold. They stay off unless the server has
 * STUDIO_ALL=1 and a STUDIO_ALL_KEY, and the URL says ?studio=all with that key.
 * @param url the address the screen connected with.
 * @returns true when this room may show the games on hold.
 */
function mayShowHeldGames(url: URL): boolean {
    const key: string = process.env.STUDIO_ALL_KEY ?? "";
    if (process.env.STUDIO_ALL !== "1" || key === "" || url.searchParams.get("studio") !== "all") {
        return false;
    }
    const expected: Buffer = createHash("sha256").update(key).digest();
    const given: Buffer = createHash("sha256").update(url.searchParams.get("key") ?? "").digest();
    return timingSafeEqual(expected, given);
}

/**
 * Opens a room for an address, if it and the day's budget allow.
 * @param address who's asking.
 * @param lively true for the lively host.
 * @param tapToTalk true for tap-to-talk.
 * @param fastReplies true when it's being opened to try the faster reply model.
 * @param testing true when the Studio shelf also shows the games still on hold.
 * @returns the room, or null.
 */
function openRoom(address: string, lively: boolean, tapToTalk: boolean, fastReplies: boolean, testing: boolean): Room | null {
    const within: boolean = ROOM_LIMIT_ON === false || limits.mayOpenRoom(address, (code: string) => directory.find(code) !== undefined);
    if (within === false || BUDGET.hasRoom() === false) {
        return null;
    }
    const payer: string = payerOf(address);
    const room: Room | null = withPayer(payer, () => directory.create(lively, tapToTalk, fastReplies, testing, payer));
    if (room !== null) {
        limits.roomOpened(address, room.code);
    }
    return room;
}

/**
 * Tells a stage it can't come in and hangs up.
 * @param socket the stage's WebSocket.
 * @param reason why.
 */
function turnAway(socket: WebSocket, reason: RejectedReason): void {
    socket.send(JSON.stringify({ type: "rejected", reason }));
    socket.close(4004, reason);
}

/**
 * Serves one static file from a stage's build output, refusing paths outside it.
 * @param request the HTTP request.
 * @param response the HTTP response.
 */
async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url: URL = new URL(request.url ?? "/", "http://room");
    if (url.pathname === "/terms" || url.pathname === "/privacy" || url.pathname === "/terms/" || url.pathname === "/privacy/") {
        response.writeHead(302, { location: `/landing/${url.pathname.replaceAll("/", "")}/` }).end();
        return;
    }
    if (url.pathname === "/favicon.ico") {
        response.writeHead(302, { location: "/landing/brand/favicon-32.png" }).end();
        return;
    }
    if (url.pathname === "/version") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(BUILD));
        return;
    }
    if (url.pathname === "/phone-version") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(PHONE_VERSION);
        return;
    }
    const drawing: RegExpExecArray | null = /^\/drawings\/([A-Z]+)\/([0-9a-f]+)$/.exec(url.pathname);
    if (drawing !== null) {
        if (regionRule(request.headers, request.socket.remoteAddress).rule === "noPaintings") {
            response.writeHead(404).end();
            return;
        }
        const found: Drawing | undefined = directory.find(drawing[1] ?? "")?.drawing(drawing[2] ?? "");
        if (found === undefined) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, { "content-type": found.mediaType, "cache-control": "private, max-age=3600" }).end(found.bytes);
        return;
    }
    const [, stage, ...rest] = (url.pathname === "/" ? "/landing/" : url.pathname).split("/");
    const root: string | undefined = STAGE_ROOTS[stage ?? ""];
    if (root === undefined) {
        response.writeHead(404).end("Not found.");
        return;
    }
    const requested: string = decodeURIComponent(rest.join("/"));
    const relative: string = requested === "" || requested.endsWith("/") ? `${requested}index.html` : requested;
    const file: string = join(root, normalize(relative));
    if (file.startsWith(root) === false) {
        response.writeHead(403).end();
        return;
    }
    try {
        const body: Buffer = await readFile(file);
        const caching: Record<string, string> = extname(file) === ".html" ? { "cache-control": "no-cache" } : {};
        response.writeHead(200, { "content-type": MEDIA_TYPES[extname(file)] ?? "application/octet-stream", ...caching }).end(body);
    } catch {
        response.writeHead(404).end("Not found. Run npm run build first.");
    }
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        response.setHeader(name, value);
    }
    if (OLD_HOST !== undefined && request.headers.host === OLD_HOST) {
        response.writeHead(301, { location: `${PUBLIC_ORIGIN}${request.url ?? "/"}` }).end();
        return;
    }
    if (isRefusedRegion(request) === true) {
        response.setHeader("content-security-policy", "default-src 'none'");
        response.writeHead(451, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(REFUSED_PAGE);
        return;
    }
    const path: string = (request.url ?? "/").split("?")[0] ?? "/";
    if (path === "/pass" && request.method === "POST") {
        servePass(request, response);
        return;
    }
    if (path === "/resting") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ resting: stageOf(payerOf(addressOf(request))) === 3 }));
        return;
    }
    if (path === "/owner/spend") {
        serveOwnerSpend(request, response);
        return;
    }
    serveAgent(request, response, PUBLIC_URL, addressOf(request), limits).then((served: boolean) => (served === true ? undefined : serveStatic(request, response))).catch((error: unknown) => {
        console.error("static serve failed:", error instanceof Error ? error.message : String(error));
        response.writeHead(500).end();
    });
});

const sockets: WebSocketServer = new WebSocketServer({
    server,
    maxPayload: MAX_MESSAGE_BYTES,
    // Scripts send no Origin and could fake one anyway, and they're held to the same limits. This stops other websites using their visitors' browsers.
    verifyClient: (info: { origin?: string; req: IncomingMessage }) => isRefusedRegion(info.req) === false && (info.origin === undefined || info.origin === PUBLIC_ORIGIN),
});

/** Sockets that answered the last heartbeat. */
const answered: WeakSet<WebSocket> = new WeakSet();

// Every heartbeat keeps idle connections alive through Cloudflare, ends any socket that stopped
// answering so its seat can be held properly, and tells each stage the server is still there.
setInterval(() => {
    for (const socket of sockets.clients) {
        if (answered.has(socket) === false) {
            socket.terminate();
            continue;
        }
        answered.delete(socket);
        socket.ping();
        socket.send(HEARTBEAT_MESSAGE);
    }
}, HEARTBEAT_MILLISECONDS).unref();
sockets.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    // An oversized or malformed frame raises an error on the socket, and ws closes it; without
    // a listener that error would end the process and every room with it.
    socket.on("error", (error: Error) => { console.warn(`socket error: ${error.message}`); });
    answered.add(socket);
    socket.on("pong", () => { answered.add(socket); });
    const address: string = addressOf(request);
    if (limits.openSocket(address) === false) {
        socket.close(1013, "too many connections");
        return;
    }
    socket.on("close", () => { limits.closeSocket(address); });
    const noPaintings: boolean = regionRule(request.headers, request.socket.remoteAddress).rule === "noPaintings";
    const url: URL | null = URL.canParse(request.url ?? "/", "http://room") === true ? new URL(request.url ?? "/", "http://room") : null;
    if (url === null) {
        socket.close(1008, "bad address");
        return;
    }
    const existing: Room | undefined = directory.find(url.searchParams.get("room") ?? "");
    if (url.pathname === "/ws/screen") {
        // A screen asking for a room that's gone is told so, or it would end up in a new room with its phones left behind.
        // Wrong codes count here as they do for phones, or this would be a free way to try every code.
        const wantsRoom: boolean = (url.searchParams.get("room") ?? "") !== "";
        if (wantsRoom === true && (existing === undefined || limits.isBlocked(address) === true)) {
            limits.codeMissed(address);
            turnAway(socket, "roomClosed");
            return;
        }
        const showHeld: boolean = mayShowHeldGames(url);
        const options: RoomOptions = roomOptions(url.searchParams);
        if (existing === undefined && stageOf(payerOf(address)) === 3) {
            turnAway(socket, "resting");
            return;
        }
        const room: Room | null = existing ?? openRoom(address, options.lively, options.tapToTalk, options.fastReplies, showHeld);
        if (room === null) {
            turnAway(socket, "noRoomsFree");
            return;
        }
        if (noPaintings === true) {
            room.stopPaintings();
        }
        room.attachScreen(socket, existing === undefined);
        return;
    }
    if (url.pathname === "/ws/phone") {
        if (existing === undefined || limits.isBlocked(address) === true) {
            limits.codeMissed(address);
            turnAway(socket, "unknownRoom");
            return;
        }
        if (noPaintings === true) {
            existing.stopPaintings();
        }
        existing.attachPhone(socket);
        return;
    }
    socket.close(1008, "use /ws/screen or /ws/phone");
});

// One room's bug must not end every other room's game.
process.on("uncaughtException", (error: Error) => { console.error("uncaught:", error.stack ?? error.message); });
process.on("unhandledRejection", (reason: unknown) => { console.error("unhandled:", reason instanceof Error ? reason.stack ?? reason.message : String(reason)); });

// A release stops the container this way; the day's totals go to disk first.
process.on("SIGTERM", () => {
    flushSpend();
    process.exit(0);
});

server.listen(PORT, () => {
    console.warn(`listening on http://localhost:${PORT}  public: ${PUBLIC_URL}  build: ${BUILD.commit} ${BUILD.builtAt}`);
});
