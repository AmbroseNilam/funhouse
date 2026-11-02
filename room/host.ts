// The AI host: a persona that wakes on room events, decides what to say and show, and acts
// through tools. It has no rule authority; it only sees what the room hands it and only acts
// through the stage the room gives it. One turn runs at a time; events that arrive mid-turn
// wait for the next one. Holding to talk on any phone interrupts the current turn.

import { streamSparkToolCalls, type SparkMessage, type SparkTool, type SparkToolCall } from "../providers/meta/spark.ts";
import type { SpeechVoice } from "../providers/openai/speech.ts";
import type { Mood } from "../shared/scene.ts";

/** Who the host is. A placeholder until the persona is chosen. */
export interface HostPersona {
    name: string;
    voice: SpeechVoice;
    /** Default delivery when a line names no style. */
    style: string;
    /** One paragraph of character, written in the second person. */
    character: string;
}

/** The placeholder persona. */
export const PLACEHOLDER_PERSONA: HostPersona = {
    name: "Marlowe",
    voice: "ash",
    style: "Warm, quick and playful, like a late-night game show host. Never shouty.",
    character: "You are Marlowe, the host of Game Room, a party game night played on one big screen with everyone's phones as controllers. You are witty, warm and brisk. You remember names and use them. You tease gently and never mock. You keep every line short enough to say in one breath.",
};

/** A headline the host puts on the screen. */
export interface Spotlight {
    headline: string;
    detail?: string;
    mood?: Mood;
}

/** What the host can do in the room. The room implements it. */
export interface HostStage {
    /** Names of the players present right now. */
    playerNames(): string[];
    /** Puts a headline on the screen. */
    show(spotlight: Spotlight): void;
    /** Speaks a line aloud and resolves when it has finished playing or was cancelled. */
    speak(text: string, style: string, signal: AbortSignal): Promise<void>;
}

/** Most lines of conversation the host remembers. */
const HISTORY_LIMIT: number = 40;

/** Most lines that may wait for the next turn; the oldest drop first. */
const PENDING_LIMIT: number = 20;

const MOODS: Mood[] = ["neutral", "lobby", "night", "dawn", "tense", "victory", "defeat"];

const TOOLS: SparkTool[] = [
    {
        name: "say",
        description: "Speak one line aloud to the whole room. Keep it to one or two short sentences.",
        parameters: {
            type: "object",
            properties: {
                text: { type: "string", description: "Exactly what to say." },
                style: { type: "string", description: "Optional delivery direction, such as 'hushed' or 'delighted'." },
            },
            required: ["text"],
        },
    },
    {
        name: "show",
        description: "Put a short headline on the big screen, with an optional line under it and a mood for the whole screen.",
        parameters: {
            type: "object",
            properties: {
                headline: { type: "string", description: "Two to six words." },
                detail: { type: "string", description: "Optional single line under the headline." },
                mood: { type: "string", enum: MOODS },
            },
            required: ["headline"],
        },
    },
];

/** The host loop. One instance per room. */
export class Host {
    public readonly persona: HostPersona;
    private readonly stage: HostStage;
    private readonly lobbyBrief: string;
    private readonly history: string[] = [];
    private readonly pending: string[] = [];
    private wakeTimer: NodeJS.Timeout | null = null;
    private turn: AbortController | null = null;

    /**
     * Creates a host that acts through the given stage.
     * @param stage what the host can do in the room.
     * @param persona who the host is.
     * @param gameSummaries one line per installed game, for the lobby brief.
     */
    public constructor(stage: HostStage, persona: HostPersona, gameSummaries: string[]) {
        this.stage = stage;
        this.persona = persona;
        this.lobbyBrief = [
            "Right now everyone is in the lobby. Greet people by name as they join, briefly; if several join at once, greet them together.",
            "Chat lightly. When the group talks about what to play, these games are installed:",
            ...gameSummaries.map((summary: string) => `- ${summary}`),
            "Starting a game is not wired up yet. If they ask to start, say you are setting the table and it is nearly ready.",
        ].join("\n");
    }

    /**
     * Notes something that happened and wakes the host after a short pause, so bursts of
     * events land in one turn.
     * @param line a plain description, such as "Ambrose: what are we playing?".
     * @param delayMilliseconds how long to wait for more events before acting.
     */
    public notice(line: string, delayMilliseconds: number): void {
        this.pending.push(line);
        if (this.pending.length > PENDING_LIMIT) {
            this.pending.splice(0, this.pending.length - PENDING_LIMIT);
        }
        if (this.turn !== null || this.wakeTimer !== null) {
            return;
        }
        this.wakeTimer = setTimeout(() => {
            this.wakeTimer = null;
            this.runTurn().catch((error: unknown) => { console.error("host turn failed:", error instanceof Error ? error.message : String(error)); });
        }, delayMilliseconds);
    }

    /** Stops whatever the host is doing, mid-sentence if need be. */
    public interrupt(): void {
        this.turn?.abort();
    }

    /** Runs turns until nothing new is pending. */
    private async runTurn(): Promise<void> {
        while (this.pending.length > 0) {
            const lines: string[] = this.pending.splice(0, this.pending.length);
            const earlier: string[] = [...this.history];
            this.remember(...lines);
            const turn: AbortController = new AbortController();
            this.turn = turn;
            try {
                await this.act(earlier, lines, turn.signal);
            } catch (error: unknown) {
                if (turn.signal.aborted === false) {
                    console.error("host turn failed:", error instanceof Error ? error.message : String(error));
                }
            }
            this.turn = null;
        }
    }

    /**
     * Asks Spark what to do about the new lines and carries out each tool call in order.
     * Speech plays one line after another while later calls are still streaming in.
     * @param earlier the conversation before this turn.
     * @param lines what happened since the last turn.
     * @param signal cancels the turn on interruption.
     */
    private async act(earlier: string[], lines: string[], signal: AbortSignal): Promise<void> {
        const messages: SparkMessage[] = [
            { role: "system", content: this.systemPrompt() },
            { role: "user", content: this.turnPrompt(earlier, lines) },
        ];
        let speech: Promise<void> = Promise.resolve();
        for await (const call of streamSparkToolCalls(messages, TOOLS, { signal })) {
            speech = this.carryOut(call, speech, signal);
        }
        await speech;
    }

    /**
     * Carries out one tool call.
     * @param call the call.
     * @param speech the speech queued so far; a new line plays after it.
     * @param signal cancels speech on interruption.
     * @returns the speech queue including this call.
     */
    private carryOut(call: SparkToolCall, speech: Promise<void>, signal: AbortSignal): Promise<void> {
        if (call.name === "show") {
            this.stage.show(readSpotlight(call.arguments));
            return speech;
        }
        if (call.name !== "say") {
            console.warn(`host called an unknown tool: ${call.name}`);
            return speech;
        }
        const text: string = typeof call.arguments.text === "string" ? call.arguments.text.trim() : "";
        if (text === "") {
            return speech;
        }
        const style: string = typeof call.arguments.style === "string" ? `${this.persona.style} Right now: ${call.arguments.style}.` : this.persona.style;
        return speech.then(async () => {
            if (signal.aborted === true) {
                return;
            }
            this.remember(`${this.persona.name}: ${text}`);
            await this.stage.speak(text, style, signal);
        });
    }

    /**
     * Appends lines to the conversation history, keeping it bounded.
     * @param lines what was said or happened, in order.
     */
    private remember(...lines: string[]): void {
        this.history.push(...lines);
        if (this.history.length > HISTORY_LIMIT) {
            this.history.splice(0, this.history.length - HISTORY_LIMIT);
        }
    }

    /**
     * The standing instructions for every turn.
     * @returns the system prompt.
     */
    private systemPrompt(): string {
        return [
            this.persona.character,
            "You act only by calling tools: say to speak aloud, show to change the big screen. Calling no tool means you stay quiet, which is right when people are talking to each other and not to you.",
            "Everything you say is heard by every player. Never use emoji, stage directions or markdown in what you say.",
            this.lobbyBrief,
        ].join("\n\n");
    }

    /**
     * The message for one turn: recent conversation, then what is new.
     * @param earlier the conversation before this turn.
     * @param lines what happened since the last turn.
     * @returns the user prompt.
     */
    private turnPrompt(earlier: string[], lines: string[]): string {
        const names: string[] = this.stage.playerNames();
        return [
            `Players here: ${names.length === 0 ? "nobody yet" : names.join(", ")}.`,
            earlier.length === 0 ? "Nothing has happened before this." : `Earlier:\n${earlier.join("\n")}`,
            `New, respond to this:\n${lines.join("\n")}`,
        ].join("\n\n");
    }
}

/**
 * Reads a show call's arguments into a spotlight, dropping anything malformed.
 * @param args the parsed tool arguments.
 * @returns the spotlight.
 */
function readSpotlight(args: Record<string, unknown>): Spotlight {
    const spotlight: Spotlight = { headline: typeof args.headline === "string" ? args.headline.slice(0, 80) : "" };
    if (typeof args.detail === "string") {
        spotlight.detail = args.detail.slice(0, 160);
    }
    if (typeof args.mood === "string" && MOODS.includes(args.mood as Mood) === true) {
        spotlight.mood = args.mood as Mood;
    }
    return spotlight;
}
