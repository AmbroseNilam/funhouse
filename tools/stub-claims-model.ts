// A stand-in for the Meta Model API that plays Three Claims' host, for scenario runs on a machine with
// no model key. It speaks just enough of the chat completions surface for the room: the filter's
// yes-or-no verdict, and a streamed host reply that follows the game's latest note the way the brief
// asks: one short question for a detail, a date, a place or a name, never a reason, one question per
// reply, a name for the player who asks, a tally at the reveal. It keeps every request it is sent, in
// memory only, and serves them at /__requests so the scenario can check what the room really told a
// host: the brief never held the lie before the reveal, and no reply was asked for two questions.
// It is not Muse Spark: a pass against it proves the room, the shelf and the game's rules and screens
// work together, and says nothing about the real host's questions or wording.
//
//   META_BASE_URL=http://localhost:8741/v1 META_MODEL_API_KEY=<any text> GAME_ROOM_TEXT_ONLY=1 STUDIO_SHOW_HELD=1 npm run room
//   node tools/stub-claims-model.ts
//   ROOM_STUDIO=1 node tools/scenarios/three-claims.ts
//
// It logs one word per request, never what was sent.

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
    response_format?: unknown;
}

/** One host request kept for the scenario. */
interface Seen {
    at: number;
    system: string;
    user: string;
}

/** Every host request, oldest first. */
const SEEN: Seen[] = [];

/** The last note the host replied to, so a spoken line with nothing new to answer gets (quiet). */
let lastNote: string = "";

/** What the host asks for each kind of question, one question, never a reason. */
const QUESTIONS: Record<string, string> = {
    "a small detail": "What did it look like?",
    "a date or a time of year": "When was that?",
    "a place": "Where was that?",
    "a name": "Who was there?",
};

/**
 * The question for what the game told the host to ask for.
 * @param note the game's note.
 * @returns one question, or an empty string.
 */
function questionFor(note: string): string {
    const wants: string | undefined = Object.keys(QUESTIONS).find((want: string) => note.includes(`Ask for ${want}`) === true);
    return wants === undefined ? "" : QUESTIONS[wants] ?? "";
}

/**
 * What the host says to the game's latest note.
 * @param note the note, without its parentheses.
 * @returns the reply.
 */
function hostReply(note: string): string {
    if (note === lastNote || note === "") {
        return "(quiet)";
    }
    lastNote = note;
    if (note.startsWith("Everyone is writing three claims") === true) {
        return "Three claims each, on your phones. One of them is a lie.";
    }
    const claimant: RegExpExecArray | null = /: (\S+) is the claimant\./.exec(note);
    if (claimant !== null) {
        return `${claimant[1] ?? ""}, you're up. ${questionFor(note)}`;
    }
    if (note.includes("Now ask your second question") === true) {
        return questionFor(note);
    }
    const asker: RegExpExecArray | null = /^(\S+) puts the next question to/.exec(note);
    if (asker !== null) {
        return `${asker[1] ?? ""}, you have a question. Hold your phone and ask.`;
    }
    const answerer: RegExpExecArray | null = /Tell (\S+) to answer/.exec(note);
    if (answerer !== null) {
        return `${answerer[1] ?? ""}, your answer.`;
    }
    if (note.startsWith("Voting is open") === true) {
        return "Pick the lie on your phones.";
    }
    const lie: RegExpExecArray | null = /^The lie was claim (\w): .*?”\. (.*?\.)/.exec(note);
    if (lie !== null) {
        return `Claim ${lie[1] ?? ""} was the lie. ${lie[2] ?? ""}`;
    }
    if (note.includes("left in the middle of their turn") === true) {
        return "That turn is off. On we go.";
    }
    if (note.startsWith("Too few") === true || note.startsWith("That was the last claimant") === true) {
        return "That's the table. Another round?";
    }
    return "(quiet)";
}

/**
 * The latest thing the game told the host.
 * @param user the host's turn prompt.
 * @returns the note, or an empty string.
 */
function latestNote(user: string): string {
    const notes: string[] = [...user.matchAll(/\(Game: ([\s\S]*?)\)(?=\n|$)/g)].map((match: RegExpMatchArray) => match[1] ?? "");
    return notes.at(-1) ?? "";
}

/**
 * Handles one request.
 * @param request the request.
 * @param response the response.
 */
function handle(request: IncomingMessage, response: ServerResponse): void {
    if (request.url === "/__requests") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(SEEN));
        return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    request.on("end", () => {
        const body: Body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Body;
        const system: string = body.messages?.find((message: Message) => message.role === "system")?.content ?? "";
        const user: string = body.messages?.findLast((message: Message) => message.role === "user")?.content ?? "";
        if (body.response_format !== undefined) {
            console.warn("verdict");
            response.writeHead(200, { "content-type": "application/json" });
            const verdict: string = user.includes(CLASSIFIER_BLOCK_MARKER) === true ? "block" : "allow";
            response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict }) } }] }));
            return;
        }
        console.warn(system.startsWith("You write content") === true ? "content" : "host");
        SEEN.push({ at: Date.now(), system, user });
        const text: string = system.startsWith("You write content") === true ? "" : hostReply(latestNote(user));
        setTimeout(() => {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
            response.end("data: [DONE]\n\n");
        }, THINK_MILLISECONDS);
    });
}

createServer(handle).listen(PORT, () => { console.warn(`stand-in model listening on ${PORT}`); });
