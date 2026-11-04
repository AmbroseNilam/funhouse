// Serves tools/stub-host.ts as a Chat Completions endpoint, so the room can run whole games with no
// model key. Start it, then start the room pointed at it:
//   node tools/stub-model.ts
//   META_BASE_URL=http://localhost:8799 META_MODEL_API_KEY=stub GAME_ROOM_TEXT_ONLY=1 node room/server.ts
// It logs one line per request and never what was asked or answered.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stubAnswer } from "./stub-host.ts";

/** Where it listens. */
const PORT: number = Number(process.env.STUB_PORT ?? 8799);

/** How the body of a request reads, as far as the stub needs. */
interface StubRequest {
    messages?: { role: string; content: string }[];
    response_format?: unknown;
}

/**
 * Reads a whole request body.
 * @param request the request.
 * @returns the text.
 */
async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
}

/**
 * Answers one request.
 * @param request the request.
 * @param response the response.
 */
async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body: StubRequest = JSON.parse(await readBody(request)) as StubRequest;
    const answer: string = stubAnswer(body);
    if (body.response_format !== undefined) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
        return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`);
    response.write("data: [DONE]\n\n");
    response.end();
}

createServer((request: IncomingMessage, response: ServerResponse) => {
    handle(request, response).catch((error: unknown) => {
        console.warn(`stub model failed: ${error instanceof Error ? error.message : String(error)}`);
        response.writeHead(500);
        response.end();
    });
}).listen(PORT, () => { console.warn(`stub model on ${PORT}`); });
