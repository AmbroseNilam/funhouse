// A stand-in for the Meta Model API, for scenario runs on a machine with no model key. It speaks just
// enough of the chat completions surface for the room: a yes-or-no verdict for the text filter's
// classifier, content for the game ("write prompts", "write facts", "write one answer") and a host
// that repeats whatever the game last told it. That host is the worst case on purpose: if the game
// ever tells the host something private, the TV's caption shows it and the scenario fails. It is not
// Muse Spark. A pass against it proves the room, the filter's local layer, the shelf and the game's
// rules and screens work together; it proves nothing about the real host's wording or judgement.
//
//   META_BASE_URL=http://localhost:8741/v1 META_MODEL_API_KEY=stand-in GAME_ROOM_TEXT_ONLY=1 npm run room
//   node tools/fake-meta.ts
//   ROOM_STUDIO=1 node tools/scenarios/two-takes.ts
//
// It logs one line per request kind, never what was sent.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { CLASSIFIER_BLOCK_MARKER } from "./stand-in-marker.ts";

/** Where it listens. */
const PORT: number = Number(process.env.FAKE_META_PORT ?? 8741);

/** Milliseconds it takes to "think", so the room sees a thinking host. */
const THINK_MILLISECONDS: number = 40;

/** One chat message as far as this file reads it. */
interface Message {
    role: string;
    content: string;
}

/** A request body as far as this file reads it. */
interface Body {
    messages?: Message[];
    stream?: boolean;
    response_format?: unknown;
}

/** Prompts for a head-to-head game. */
const PROMPT_POOL: readonly string[] = [
    "A bad name for a lighthouse cat",
    "The worst thing to hear from a hot air balloon",
    "A rejected flavour of toothpaste",
    "What the moon says about the sun",
    "A rule at a very polite zoo",
    "The sequel to a nap",
    "A suspicious thing to find in a sock drawer",
    "A pigeon's resignation letter, first line",
];

/**
 * What the game's model would write for a content request, by what the request asks for.
 * @param prompt the request.
 * @returns the text.
 */
export function contentFor(prompt: string): string {
    const prompts: RegExpMatchArray | null = /Write (\d+) prompts/.exec(prompt);
    if (prompts !== null) {
        return PROMPT_POOL.slice(0, Number(prompts[1])).join("\n");
    }
    return "";
}

/**
 * What the host says: the last thing the game told it, word for word.
 * @param user the host's turn prompt.
 * @returns the reply.
 */
function hostReply(user: string): string {
    const notes: string[] = [...user.matchAll(/\(Game: ([\s\S]*?)\)(?=\n|$)/g)].map((match: RegExpMatchArray) => match[1] ?? "");
    return notes.at(-1) ?? "(quiet)";
}

/**
 * Answers the filter's classifier.
 * @param user the request's user message, JSON with the line.
 * @returns the reply body.
 */
function verdictFor(user: string): unknown {
    const blocked: boolean = user.includes(CLASSIFIER_BLOCK_MARKER);
    return { choices: [{ message: { content: JSON.stringify({ verdict: blocked === true ? "block" : "allow" }) } }] };
}

/**
 * Handles one request.
 * @param request the request.
 * @param response the response.
 */
function handle(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    request.on("end", () => {
        const body: Body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Body;
        const system: string = body.messages?.find((message: Message) => message.role === "system")?.content ?? "";
        const user: string = body.messages?.findLast((message: Message) => message.role === "user")?.content ?? "";
        if (body.response_format !== undefined) {
            console.warn("verdict");
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify(verdictFor(user)));
            return;
        }
        const writing: boolean = system.startsWith("You write content");
        console.warn(writing === true ? "content" : "host");
        const text: string = writing === true ? contentFor(user) : hostReply(user);
        setTimeout(() => {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
            response.end("data: [DONE]\n\n");
        }, THINK_MILLISECONDS);
    });
}

createServer(handle).listen(PORT, () => { console.warn(`fake model listening on ${PORT}`); });
