// A stand-in for the Meta Model API, for running the room with no keys and no cost. It answers the
// three calls a picture game makes: it draws a small coloured picture after a delay, it says
// "allow" to the content classifier unless the line holds BLOCKME, and it streams a one-line
// reply for the host. GET /__stats lists what it was asked, so a scenario can check that a prompt
// held no blocked text and carried the house rule. This is test tooling: it keeps prompts in
// memory and answers on localhost only, so never point a real room at it.
//
//   STUB_PORT=8798 STUB_IMAGE_MS=300 node tools/stub-meta.ts
//   META_BASE_URL=http://127.0.0.1:8798/v1 META_MODEL_API_KEY=<any text> GAME_ROOM_TEXT_ONLY=1 GAME_ROOM_DRAW=1 npm run room
//
// STUB_IMAGE_MS is how long a picture takes (default 300). STUB_IMAGE_FAIL=1 makes every picture
// fail with a 500, as a refused or broken drawing does. STUB_IMAGE_FAIL_EVERY=3 fails each third.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { deflateSync } from "node:zlib";

/** Port the stub listens on. */
const PORT: number = Number(process.env.STUB_PORT ?? 8798);

/** Milliseconds a picture takes. */
const IMAGE_MILLISECONDS: number = Number(process.env.STUB_IMAGE_MS ?? 300);

/** Fail every picture, or every nth one. */
const FAIL_ALL: boolean = process.env.STUB_IMAGE_FAIL === "1";
const FAIL_EVERY: number = Number(process.env.STUB_IMAGE_FAIL_EVERY ?? 0);

/** Width and height of a stub picture. */
const SIZE: number = 96;

/** What the stub has been asked, for GET /__stats. Every prompt is kept in requests, including the ones it failed. */
interface Stats {
    images: { prompt: string; at: number; ms: number }[];
    requests: string[];
    failed: number;
    moderated: number;
    chats: number;
}

const stats: Stats = { images: [], requests: [], failed: 0, moderated: 0, chats: 0 };

/**
 * The checksum a PNG chunk ends with.
 * @param bytes the chunk's type and data.
 * @returns the CRC-32.
 */
function crc32(bytes: Buffer): number {
    let crc: number = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * One PNG chunk.
 * @param type its four-letter type.
 * @param data its data.
 * @returns the bytes.
 */
function chunk(type: string, data: Buffer): Buffer {
    const length: Buffer = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body: Buffer = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum: Buffer = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
}

/**
 * A small striped PNG whose colours come from the prompt, so different prompts look different.
 * @param prompt what was asked for.
 * @returns the PNG as base64.
 */
function picture(prompt: string): string {
    let hash: number = 7;
    for (const letter of prompt) {
        hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
    }
    const header: Buffer = Buffer.alloc(13);
    header.writeUInt32BE(SIZE, 0);
    header.writeUInt32BE(SIZE, 4);
    header.set([8, 2, 0, 0, 0], 8);
    const rows: Buffer[] = [];
    for (let y = 0; y < SIZE; y += 1) {
        const row: Buffer = Buffer.alloc(1 + SIZE * 3);
        for (let x = 0; x < SIZE; x += 1) {
            const band: number = Math.floor((x + y) / 16) % 2;
            row[1 + x * 3] = (hash >>> 16) & 0xff ^ (band === 1 ? 0x30 : 0);
            row[2 + x * 3] = (hash >>> 8) & 0xff;
            row[3 + x * 3] = hash & 0xff;
        }
        rows.push(row);
    }
    const png: Buffer = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
    return png.toString("base64");
}

/**
 * Reads a request body as JSON.
 * @param request the request.
 * @returns the parsed body, or an empty object.
 */
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const parts: Buffer[] = [];
    for await (const part of request) {
        parts.push(part as Buffer);
    }
    try {
        return JSON.parse(Buffer.concat(parts).toString("utf8")) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/**
 * Answers one call.
 * @param request the request.
 * @param response the response.
 */
async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path: string = (request.url ?? "").replace(/^\/v1/, "");
    if (request.method === "GET" && path === "/__stats") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(stats));
        return;
    }
    const body: Record<string, unknown> = await readBody(request);
    if (path === "/images/generations") {
        const prompt: string = typeof body.prompt === "string" ? body.prompt : "";
        const startedAt: number = Date.now();
        stats.requests.push(prompt);
        const asked: number = stats.requests.length;
        await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, IMAGE_MILLISECONDS); });
        if (FAIL_ALL === true || (FAIL_EVERY > 0 && asked % FAIL_EVERY === 0)) {
            stats.failed += 1;
            response.writeHead(500).end("{}");
            return;
        }
        stats.images.push({ prompt, at: startedAt, ms: Date.now() - startedAt });
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ b64_json: picture(prompt) }], output_format: "png" }));
        return;
    }
    if (path === "/chat/completions" && body.stream === true) {
        stats.chats += 1;
        const chunkText: string = JSON.stringify({ choices: [{ delta: { content: "Noted." } }] });
        response.writeHead(200, { "content-type": "text/event-stream" }).end(`data: ${chunkText}\n\ndata: [DONE]\n\n`);
        return;
    }
    if (path === "/chat/completions") {
        stats.moderated += 1;
        const text: string = JSON.stringify(body.messages ?? "");
        const verdict: string = text.includes("BLOCKME") ? "block" : "allow";
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict }) } }] }));
        return;
    }
    response.writeHead(404).end("{}");
}

createServer((request: IncomingMessage, response: ServerResponse) => { void handle(request, response); }).listen(PORT, "127.0.0.1", () => {
    console.warn(`stub Meta API on ${PORT}; pictures take ${IMAGE_MILLISECONDS} ms`);
});
