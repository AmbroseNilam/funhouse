// Process entry point. Serves the built stages and the landing page as static files and
// routes WebSocket connections to rooms: /ws/screen for the public stage and /ws/phone for
// phones, each with a ?room= code. A screen without a known code opens a new room.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { Drawing } from "../providers/meta/image.ts";
import type { RejectedReason } from "../shared/protocol.ts";
import { RoomDirectory } from "./directory.ts";
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
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".json": "application/json",
};

/** Largest message a stage may send: well above one 3,840-byte audio frame or a short text. */
const MAX_MESSAGE_BYTES: number = 65536;

/** How often the server checks on every connection. Cloudflare closes one after 100 s idle. */
const HEARTBEAT_MILLISECONDS: number = 30000;

/** What each stage receives on a heartbeat, so it can tell when the server has gone quiet. */
const HEARTBEAT_MESSAGE: string = JSON.stringify({ type: "heartbeat" });

const directory: RoomDirectory = new RoomDirectory(PUBLIC_URL);

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
    const drawing: RegExpExecArray | null = /^\/drawings\/([A-Z]+)\/([0-9a-f]+)$/.exec(url.pathname);
    if (drawing !== null) {
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
        response.writeHead(200, { "content-type": MEDIA_TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
        response.writeHead(404).end("Not found. Run npm run build first.");
    }
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    serveStatic(request, response).catch((error: unknown) => {
        console.error("static serve failed:", error instanceof Error ? error.message : String(error));
        response.writeHead(500).end();
    });
});

const sockets: WebSocketServer = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

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
    const url: URL | null = URL.canParse(request.url ?? "/", "http://room") === true ? new URL(request.url ?? "/", "http://room") : null;
    if (url === null) {
        socket.close(1008, "bad address");
        return;
    }
    const existing: Room | undefined = directory.find(url.searchParams.get("room") ?? "");
    if (url.pathname === "/ws/screen") {
        const room: Room | null = existing ?? directory.create();
        if (room === null) {
            turnAway(socket, "noRoomsFree");
            return;
        }
        room.attachScreen(socket);
        return;
    }
    if (url.pathname === "/ws/phone") {
        if (existing === undefined) {
            turnAway(socket, "unknownRoom");
            return;
        }
        existing.attachPhone(socket);
        return;
    }
    socket.close(1008, "use /ws/screen or /ws/phone");
});

// One room's bug must not end every other room's game.
process.on("uncaughtException", (error: Error) => { console.error("uncaught:", error.stack ?? error.message); });
process.on("unhandledRejection", (reason: unknown) => { console.error("unhandled:", reason instanceof Error ? reason.stack ?? reason.message : String(reason)); });

server.listen(PORT, () => {
    console.warn(`listening on http://localhost:${PORT}  public: ${PUBLIC_URL}`);
});
