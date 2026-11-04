// A stand-in for the Meta Model API for runs with no model key, such as scripted games in a cloud
// session. It answers the room's two kinds of call locally: the content check says "allow", and the
// host's streamed reply repeats the last thing the game told it, or makes the one ruling the phase
// allows, or stays quiet. So the room's rules, filter code paths and screens run for real, and what
// the host was told shows up word for word in its captions. It is not a model and says nothing
// clever; it proves nothing about how the real host sounds.
//
// Run it, then start the room against it:
//   node tools/stub-model.ts &
//   META_BASE_URL=http://localhost:8750/v1 META_MODEL_API_KEY=stub GAME_ROOM_TEXT_ONLY=1 npm run room
// It prints no request content.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/** Port the stand-in listens on. */
const PORT: number = Number(process.env.STUB_MODEL_PORT ?? 8750);

/** What the room's request looks like, as far as this file reads it. */
interface ChatRequest {
    stream?: boolean;
    response_format?: unknown;
    messages?: { role?: string; content?: string }[];
}

/**
 * Reads a whole request body.
 * @param request the request.
 * @returns the text.
 */
async function bodyOf(request: IncomingMessage): Promise<string> {
    let text: string = "";
    for await (const chunk of request) {
        text += String(chunk);
    }
    return text;
}

/**
 * What the host says: the newest game fact, else the ruling the phase allows, else nothing.
 * @param request the room's request.
 * @returns the reply text.
 */
function replyTo(request: ChatRequest): string {
    const system: string = request.messages?.find((message) => message.role === "system")?.content ?? "";
    const user: string = request.messages?.findLast((message) => message.role === "user")?.content ?? "";
    const fresh: string = user.split("New, respond to this:\n")[1] ?? "";
    const facts: RegExpMatchArray[] = [...fresh.matchAll(/\(Game: ([^\n]*)\)(?=\n|$)/g)];
    const last: RegExpMatchArray | undefined = facts.at(-1);
    if (last?.[1] !== undefined) {
        return last[1];
    }
    return system.includes("[[locked]]") === true && fresh.trim() !== "" ? "[[locked]]" : "(quiet)";
}

createServer((request: IncomingMessage, response: ServerResponse) => {
    void bodyOf(request).then((text: string) => {
        const parsed: ChatRequest = JSON.parse(text) as ChatRequest;
        if (parsed.response_format !== undefined) {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict: "allow" }) } }] }));
            return;
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: replyTo(parsed) } }] })}\n\n`);
        response.end("data: [DONE]\n\n");
    });
}).listen(PORT, () => {
    console.warn(`Stand-in model on port ${PORT}.`);
});
