// A stand-in for the Meta Model API that plays Cold Read's host, for scenario runs on a machine with
// no model key. It speaks just enough of the chat completions surface for the room: a streamed reply.
// Its host reads the board the game puts in its brief, asks the next question from a small fixed tree
// that depends on the last answer, and guesses when the answers say so, or when the game says the
// questions are gone. It is not Muse Spark: a pass against it proves the room, the shelf and the
// game's rules and screens work together, and says nothing about the real host's questions or wording.
//
//   META_BASE_URL=http://localhost:8741/v1 META_MODEL_API_KEY=stand-in GAME_ROOM_TEXT_ONLY=1 npm run room
//   STUB_PLAN=win node tools/stub-host-model.ts          (win: guesses right; lose: never does)
//   ROOM_STUDIO=1 node tools/scenarios/cold-read.ts
//
// STUB_THINK_MS slows its replies, to see the host thinking. It logs one word per request, never what was sent.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/** Where it listens. */
const PORT: number = Number(process.env.FAKE_META_PORT ?? 8741);

/** Whether the host gets it right ("win") or never does ("lose"). */
const PLAN: string = process.env.STUB_PLAN === "lose" ? "lose" : "win";

/** Milliseconds it takes to "think", so the room sees a thinking host. */
const THINK_MILLISECONDS: number = Number(process.env.STUB_THINK_MS ?? 40);

/** One chat message as far as this file reads it. */
interface Message {
    role: string;
    content: string;
}

/** A request body as far as this file reads it. */
interface Body {
    messages?: Message[];
}

/** One answer on the board. */
interface BoardLine {
    question: string;
    answer: string;
}

/** Questions the losing host asks after its first few, one per number asked. */
const FILLER_QUESTIONS: readonly string[] = [
    "Is it older than a hundred years?",
    "Could you carry it in one hand?",
    "Is it something you would find in a book?",
    "Does it make a sound?",
    "Would most people have seen one?",
    "Is it bigger than a bus?",
    "Is it mostly one colour?",
    "Does it need people to work?",
    "Is it famous in more than one country?",
    "Would you find one near a road?",
    "Does it have a name of its own?",
    "Is it used every single day?",
];

/**
 * The board in the host's brief, in order.
 * @param system the system prompt.
 * @returns each question and its winning answer.
 */
function boardOf(system: string): BoardLine[] {
    return [...system.matchAll(/^\d+\. (.+\?) (Yes|No|Sometimes|No answer) \(/gm)].map((match: RegExpMatchArray) => ({ question: match[1] ?? "", answer: match[2] ?? "" }));
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
 * The next question, from a small tree on the last answer.
 * @param board what has been asked.
 * @returns the question.
 */
function nextQuestion(board: BoardLine[]): string {
    const last: BoardLine | undefined = board.at(-1);
    if (last === undefined) {
        return "Is it something people made?";
    }
    if (board.length === 1) {
        return last.answer === "Yes" ? "Is it somewhere you could walk up to?" : "Is it found in the wild?";
    }
    if (board.length === 2) {
        return last.answer === "Yes" ? "Is it close to the sea?" : "Is it something that moves?";
    }
    if (board.length === 3) {
        return last.answer === "Yes" ? "Does it have a light at the top?" : "Is it bigger than a house?";
    }
    return FILLER_QUESTIONS[board.length - 4] ?? "Is it something I would like?";
}

/**
 * What the host says.
 * @param system the system prompt, with the brief.
 * @param user the turn prompt.
 * @returns the reply.
 */
function hostReply(system: string, user: string): string {
    const note: string = latestNote(user);
    const board: BoardLine[] = boardOf(system);
    if (system.includes("You're meeting the table") === true) {
        return "Evening. You choose something and keep it from me, and I find it by asking. Pick a category on your phones.";
    }
    if (system.includes("They're agreeing on the thing") === true) {
        return note.startsWith("They chose") === true ? "Good one. Settle on a single thing, keep your voices down, and tap when you have it. I'm studying the wall." : "(quiet)";
    }
    if (system.includes("You're the contestant") === true) {
        if (system.includes("A question is open") === true || note === "") {
            return "(quiet)";
        }
        if (note.includes("final guess") === true || note.includes("out of questions") === true) {
            return "[[guess: A windmill]] My final answer is a windmill, and I'll take the consequences.";
        }
        const lastThreeYes: boolean = board.length >= 3 && board.slice(-3).every((line: BoardLine) => line.answer === "Yes");
        if (PLAN === "win" && lastThreeYes === true) {
            return "[[guess: A lighthouse]] Built, by the sea, with a light on top. A lighthouse.";
        }
        const question: string = nextQuestion(board);
        return `[[ask: ${question}]] ${board.length === 0 ? "Right then." : "Noted."} ${question}`;
    }
    if (system.includes("Your final guess is up") === true) {
        return user.toLowerCase().includes("it was") === true ? "Ah. So that's what it was. I'd have liked one more question." : "(quiet)";
    }
    if (system.includes("The round is over") === true) {
        return note.includes("You got it") === true
            ? "Told you. Four questions and a lantern. Shall we go again?"
            : "Stumped, and I'm happy about it. Well played, all of you. Another round?";
    }
    return "(quiet)";
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
        console.warn("host");
        const text: string = hostReply(system, user);
        setTimeout(() => {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
            response.end("data: [DONE]\n\n");
        }, THINK_MILLISECONDS);
    });
}

createServer(handle).listen(PORT, () => { console.warn(`stand-in model listening on ${PORT}, plan ${PLAN}`); });
