// The AI host: a persona that wakes on room events, decides what to say, and acts on the
// room only through the stage the room gives it. Its reply is plain text and that text is
// speech; each sentence goes to the voice the moment it is complete. Plain text on purpose:
// offered tools, Muse Spark narrates its own actions in the text, and structured output can
// spend the whole budget on hidden reasoning. The screen is the cartridge's job. The host
// has no rule authority. One turn runs at a time; events that arrive mid-turn wait for the
// next one. Holding to talk on any phone interrupts.

import { streamSpark, type SparkMessage } from "../providers/meta/spark.ts";
import type { SpeechVoice } from "../providers/openai/speech.ts";
import { log } from "./log.ts";

/** Who the host is. A placeholder until the persona is chosen. */
export interface HostPersona {
    name: string;
    voice: SpeechVoice;
    /** Delivery direction for the voice. */
    style: string;
    /** Character and manner, written in the second person. */
    character: string;
}

/** The placeholder persona. */
export const PLACEHOLDER_PERSONA: HostPersona = {
    name: "Marlowe",
    voice: "ash",
    style: "Relaxed and natural, like a friend talking across the coffee table at game night. Conversational pace, light warmth, no announcer voice, no exaggerated enthusiasm.",
    character: [
        "You are Marlowe, the host of Game Room: a party game night played on one big screen, with everyone's phone as their controller and microphone.",
        "Talk like a relaxed, quick-witted friend who happens to be running game night. Casual words, contractions, plain sentences.",
        "Most replies are one short sentence. Two at most. Never a speech.",
        "Almost never say people's names. Use a name only when you need to point at one person in a group. Never open a reply with a name.",
        "Greet each person once. Don't re-welcome anyone, don't repeat back what someone said, don't narrate what you're doing.",
        "A little dry humour is good. Forced puns and catchphrases are not.",
    ].join(" "),
};

/** What the host can do in the room. The room implements it. */
export interface HostStage {
    /** Names of the players present right now. */
    playerNames(): string[];
    /** Shows or clears the cue that the host is working out a reply. */
    setThinking(thinking: boolean): void;
    /** Queues one sentence to speak; its audio starts fetching at once. */
    say(text: string, style: string): void;
    /** Resolves when everything queued has finished playing, or the signal aborts. */
    finishSpeaking(signal: AbortSignal): Promise<void>;
    /** Drops everything queued and stops the voice mid-word. */
    stopSpeaking(): void;
}

/** Most lines of conversation the host remembers. */
const HISTORY_LIMIT: number = 40;

/** Most lines that may wait for the next turn; the oldest drop first. */
const PENDING_LIMIT: number = 20;

/** Sentence end: terminal punctuation, optional closing quote, then whitespace. */
const SENTENCE_END: RegExp = /[.!?…]["'”’)]?\s/;

/** Room for Spark's hidden reasoning plus a short spoken reply. */
const REPLY_TOKEN_LIMIT: number = 600;

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
            "Right now everyone is in the lobby. When people join, give them a quick hello; if several join close together, one hello covers them all.",
            "When the group talks about what to play, these games are installed:",
            ...gameSummaries.map((summary: string) => `- ${summary}`),
            "Starting a game is not wired up yet. If they ask to start, say you're setting it up and it's nearly ready.",
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
            this.runTurns().catch((error: unknown) => { log("host", `turn loop failed: ${error instanceof Error ? error.message : String(error)}`); });
        }, delayMilliseconds);
    }

    /** Stops whatever the host is doing, mid-word if need be. */
    public interrupt(): void {
        if (this.turn === null) {
            return;
        }
        this.turn.abort();
        this.stage.stopSpeaking();
        this.remember("(someone cut in)");
    }

    /** Runs turns until nothing new is pending. */
    private async runTurns(): Promise<void> {
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
                    log("host", `turn failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            this.stage.setThinking(false);
            this.turn = null;
        }
    }

    /**
     * Streams one reply from Spark. Each finished sentence is queued to the voice at once. Waits for the voice to finish so the next
     * turn never talks over this one.
     * @param earlier the conversation before this turn.
     * @param lines what happened since the last turn.
     * @param signal cancels the turn on interruption.
     */
    private async act(earlier: string[], lines: string[], signal: AbortSignal): Promise<void> {
        const startedAt: number = Date.now();
        let firstTextAt: number = 0;
        let firstLineAt: number = 0;
        let pendingText: string = "";
        const spoken: string[] = [];
        const speak = (sentence: string): void => {
            const clean: string = cleanSpeech(sentence);
            if (clean === "" || signal.aborted === true) {
                return;
            }
            if (firstLineAt === 0) {
                firstLineAt = Date.now();
                this.stage.setThinking(false);
            }
            spoken.push(clean);
            this.stage.say(clean, this.persona.style);
        };

        this.stage.setThinking(true);
        const messages: SparkMessage[] = [
            { role: "system", content: this.systemPrompt() },
            { role: "user", content: this.turnPrompt(earlier, lines) },
        ];
        for await (const delta of streamSpark(messages, { signal, maxTokens: REPLY_TOKEN_LIMIT })) {
            if (firstTextAt === 0) {
                firstTextAt = Date.now();
            }
            pendingText += delta;
            let end: RegExpExecArray | null = SENTENCE_END.exec(pendingText);
            while (end !== null) {
                speak(pendingText.slice(0, end.index + end[0].length));
                pendingText = pendingText.slice(end.index + end[0].length);
                end = SENTENCE_END.exec(pendingText);
            }
        }
        speak(pendingText);

        const timing: string = `first text ${firstTextAt === 0 ? "-" : firstTextAt - startedAt} ms, first line queued ${firstLineAt === 0 ? "-" : firstLineAt - startedAt} ms`;
        log("host", spoken.length === 0 ? `stayed quiet (${timing})` : `said "${spoken.join(" ")}" (${timing})`);
        if (spoken.length > 0) {
            this.remember(`${this.persona.name}: ${spoken.join(" ")}`);
        }
        await this.stage.finishSpeaking(signal);
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
            "Whatever text you write is spoken aloud to the whole room, word for word, by a voice. So write only the words you'd say: no stage directions, no descriptions of what you're doing, no emoji, no markdown, no lists.",
            "If nothing needs saying, for example people are talking to each other rather than to you, reply with exactly: (quiet)",
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
 * Strips what a voice should not read: markdown marks, bracketed or starred asides, emoji.
 * @param text one sentence from the model.
 * @returns the speakable words, trimmed; empty when nothing speakable remains.
 */
function cleanSpeech(text: string): string {
    return text
        .replace(/\*[^*]*\*/g, " ")
        .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
        .replace(/[#_`~>]/g, " ")
        .replace(/\p{Extended_Pictographic}/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}
