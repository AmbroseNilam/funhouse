// A rule-based stand-in for the host's model, used to run whole games through the real room when no
// model key is available. It answers the three kinds of request the room makes: content the game asks
// for, a yes-or-no check of typed text, and the host's reply to what just happened. It reads only the
// prompts the room sends, as the real model would, and writes short plain lines and the rulings a
// game's brief allows. It is test tooling: it proves the room, the rules and the screens work end to
// end, and says nothing about how well Muse Spark hosts. Every run that uses it must say so.

/** Words the stub "writes" for a clue-board game's grid; none is close to a clue the scenarios use. */
const STUB_GRID: string = "anchor, biscuit, blanket, bridge, bucket, button, cactus, candle, canoe, carpet, castle, chimney, cinnamon, clover, compass, cushion, diamond, dolphin, drawer, engine, feather, ferry, fountain, garden, ginger";

/** Which rulings the brief offers, read from its "Rulings you may make now" list. */
function offeredRulings(system: string): string[] {
    return [...system.matchAll(/^- \[\[([a-zA-Z]+)\]\]/gm)].map((match: RegExpMatchArray) => match[1] ?? "");
}

/**
 * The lines the room marked as new for this turn.
 * @param user the user message.
 * @returns the new lines, one per entry.
 */
function newLines(user: string): string[] {
    const marker: string = "New, respond to this:\n";
    const at: number = user.lastIndexOf(marker);
    return at < 0 ? [] : user.slice(at + marker.length).split("\n");
}

/**
 * Writes content a game asked for.
 * @param prompt the game's request.
 * @returns the reply, or null when this stub doesn't know the request.
 */
function contentFor(prompt: string): string | null {
    if (prompt.startsWith("Write 25") === true) {
        return STUB_GRID;
    }
    if (prompt.includes("You are the clue-giver") === true) {
        return "harbour, 2";
    }
    if (prompt.startsWith("Choose one secret word for a party game where each player says one word") === true) {
        return "Category: a thing in a kitchen | Word: kettle";
    }
    if (prompt.startsWith("Pick one place") === true) {
        return "Place: Lighthouse | Roles: keeper, sailor, painter, tourist, engineer, cook, inspector, fisher";
    }
    return null;
}

/**
 * What the stub host says and rules for one turn.
 * @param system the host's system prompt, with the game's brief.
 * @param user the turn prompt.
 * @returns the reply text, rulings first.
 */
export function hostReply(system: string, user: string): string {
    const lines: string[] = newLines(user);
    const rulings: string[] = offeredRulings(system);
    const text: string = lines.join("\n");
    const offered = (name: string): string => (rulings.includes(name) === true ? `[[${name}]] ` : "");
    const clueJudged: RegExpExecArray | null = /Judge the clue "([^"]+)", (\d+)/.exec(text);
    if (clueJudged !== null) {
        return (clueJudged[1] ?? "") === "Lookalike" ? `${offered("foul")}That sounds like a board word. Foul.` : `${offered("fair")}`;
    }
    const clue: RegExpExecArray | null = /The clue is "([^"]+)", (\d+)/.exec(text);
    if (clue !== null) {
        return `${clue[1] ?? ""}, ${clue[2] ?? ""}. Go on.`;
    }
    const place: string | undefined = /The (?:place|word) is: ([^.]+)\./.exec(system)?.[1];
    if (place !== undefined && rulings.includes("right") === true) {
        const said: string = lines.at(-1) ?? "";
        return said.toLowerCase().includes(place.toLowerCase()) === true ? "[[right]]" : "[[wrong]]";
    }
    const said: string = (lines.at(-1) ?? "").replace(/^[^:]*:\s*/, "").trim();
    if (rulings.includes("topic") === true && said !== "" && text.includes("(Game:") === false) {
        return `[[topic: ${said.slice(0, 60)}]]`;
    }
    if (rulings.includes("no") === true && rulings.includes("yes") === true && said !== "" && text.includes("(Game:") === false) {
        if (rulings.includes("giveup") === true && /give up/i.test(said) === true) {
            return "[[giveup]]";
        }
        return said.length % 2 === 0 ? "[[yes]] Yes." : "[[no]] No.";
    }
    if (rulings.includes("locked") === true && text.includes("(Game:") === false && text.trim() !== "") {
        return "[[locked]]";
    }
    if (system.includes("Players are questioning each other in turn") === true) {
        return "(quiet)";
    }
    if (text.includes("(Game:") === true) {
        return "Fair enough. Carry on.";
    }
    return "(quiet)";
}

/**
 * Answers one request the room makes.
 * @param body the parsed request body.
 * @returns the text to send back.
 */
export function stubAnswer(body: { messages?: { role: string; content: string }[]; response_format?: unknown }): string {
    const messages: { role: string; content: string }[] = body.messages ?? [];
    const system: string = messages.find((message: { role: string; content: string }) => message.role === "system")?.content ?? "";
    const user: string = messages.find((message: { role: string; content: string }) => message.role === "user")?.content ?? "";
    if (body.response_format !== undefined) {
        return JSON.stringify({ verdict: "allow" });
    }
    if (system.startsWith("You write content for a family party game") === true) {
        return contentFor(user) ?? "";
    }
    return hostReply(system, user);
}
