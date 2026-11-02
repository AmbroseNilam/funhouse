// Process entry point. Serves the two built stages as static files and routes WebSocket
// connections to the room: /ws/screen for the public stage and /ws/phone for phones. One
// room per process for now; a room directory comes when more than one is needed.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { makeRoomCode, Room } from "./room.ts";

/** Port the room listens on inside its pod. */
const PORT: number = Number(process.env.PORT ?? 8740);

/** Base URL phones open; the QR code encodes it. */
const PUBLIC_URL: string = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

/** Where the built stages live, relative to the repository root. */
const STAGE_ROOTS: Record<string, string> = {
    screen: join(import.meta.dirname, "..", "screen", "dist"),
    phone: join(import.meta.dirname, "..", "phone", "dist"),
};

/** Media types for the static files the stages ship. */
const MEDIA_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".json": "application/json",
};

const room: Room = new Room(makeRoomCode(), PUBLIC_URL);

/**
 * Serves one static file from a stage's build output, refusing paths outside it.
 * @param request the HTTP request.
 * @param response the HTTP response.
 */
async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url: URL = new URL(request.url ?? "/", "http://room");
    if (url.pathname === "/") {
        response.writeHead(302, { location: "/screen/" }).end();
        return;
    }
    const [, stage, ...rest] = url.pathname.split("/");
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

const sockets: WebSocketServer = new WebSocketServer({ server });
sockets.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const path: string = new URL(request.url ?? "/", "http://room").pathname;
    if (path === "/ws/screen") {
        room.attachScreen(socket);
        return;
    }
    if (path === "/ws/phone") {
        room.attachPhone(socket);
        return;
    }
    socket.close(1008, "use /ws/screen or /ws/phone");
});

server.listen(PORT, () => {
    console.warn(`room ${room.code} listening on http://localhost:${PORT}  screen: /screen/  phones: ${PUBLIC_URL}/phone/?room=${room.code}`);
});
