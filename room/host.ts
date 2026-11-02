// The AI host: a persona that wakes on room events, decides what to say, and acts on the
// room only through the stage the room gives it. Its reply is plain text and that text is
// speech, sent to the voice as one line once complete: Spark delivers a short reply within
// tens of milliseconds, and splitting it would queue a second voice request behind the
// first, costing about a second. Plain text on purpose:
// offered tools, Muse Spark narrates its own actions in the text, and structured output can
// spend the whole budget on hidden reasoning. The screen is the cartridge's job. The host
// has no rule authority. One turn composes at a time; events that arrive mid-turn wait for
// the next one, which may compose while the previous reply is still playing (the voice keeps
// lines in order). Holding to talk on any phone interrupts.

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
    style: "Relaxed friend at a kitchen table: unhurried, a slight smile in the voice, no announcer energy.",
    character: [
        "You are Marlowe, hosting game night in someone's living room. One big screen, and everyone's phone is their mic.",
        "",
        "How you talk: like a quick, warm friend who has run a hundred game nights, not a presenter. Plain words, contractions, short sentences. One sentence is the norm, two is the max, and a single word is often best. Dry, light humour; never puns, never catchphrases, never \"welcome to the show\".",
        "",
        "Table rules:",
        "- Don't use names unless you're picking one person out of the group. Never start with a name.",
        "- Don't repeat what someone said back to them. Don't narrate what you're doing or about to do.",
        "- Vary your openers; never use the same phrase twice in a row.",
        "- What you get is speech-to-text. If it's garbled, half a sentence, or clearly not aimed at you, reply exactly (quiet) rather than guessing.",
        "- Several people join close together: one hello covers them all.",
        "- If a question wants a yes or no, give it first, then one beat of colour.",
        "",
        "Examples:",
        "Sam: can we start?",
        "You: Nearly. Two more people and we're on.",
        "Priya: what's werewolf",
        "You: A village, a couple of secret werewolves, and a lot of pointing fingers. You argue, you vote, someone gets it wrong.",
        "Jo: hey marlowe",
        "You: Yeah?",
        "Jo: Dana, did you park out front?",
        "You: (quiet)",
    ].join("\n"),
};

/** What the host can do in the room. The room implements it. */
export interface HostStage {
    /** Names of the players present right now. */
    playerNames(): string[];
    /** Shows or clears the cue that the host is working out a reply. */
    setThinking(thinking: boolean): void;
    /** Queues one sentence to speak; its audio starts fetching at once. */
    say(text: string, style: string): void;
    /** Drops everything queued and stops the voice mid-word. */
    stopSpeaking(): void;
}

/** Most lines of conversation the host remembers. */
const HISTORY_LIMIT: number = 40;

/** Most lines that may wait for the next turn; the oldest drop first. */
const PENDING_LIMIT: number = 20;

/** What the host replies to say nothing. Checked before speaking, not left to cleanup. */
const QUIET_MARKER: string = "(quiet)";

/** Room for Spark's hidden reasoning plus a short spoken reply. Measured: 96 to 192 reasoning tokens at minimal effort. */
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
            "Right now: the lobby. Installed games:",
            ...gameSummaries.map((summary: string) => `- ${summary}`),
            "Starting a game isn't wired up yet; if asked, say it's nearly ready.",
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

    /**
     * Stops whatever the host is doing, mid-word if need be.
     * @param wasSpeaking true when the host was audible, so the cut-in is worth remembering.
     */
    public interrupt(wasSpeaking: boolean): void {
        this.turn?.abort();
        this.stage.stopSpeaking();
        if (wasSpeaking === true) {
            this.remember("(someone cut in)");
        }
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
     * Streams one reply from Spark and queues it to the voice as one line. A reply that opens
     * with the quiet marker says nothing at all.
     * @param earlier the conversation before this turn.
     * @param lines what happened since the last turn.
     * @param signal cancels the turn on interruption.
     */
    private async act(earlier: string[], lines: string[], signal: AbortSignal): Promise<void> {
        const startedAt: number = Date.now();
        let firstTextAt: number = 0;
        let reply: string = "";

        this.stage.setThinking(true);
        const messages: SparkMessage[] = [
            { role: "system", content: this.systemPrompt() },
            { role: "user", content: this.turnPrompt(earlier, lines) },
        ];
        for await (const delta of streamSpark(messages, { signal, maxTokens: REPLY_TOKEN_LIMIT })) {
            if (firstTextAt === 0) {
                firstTextAt = Date.now();
            }
            reply += delta;
        }

        const timing: string = `first text ${firstTextAt === 0 ? "-" : firstTextAt - startedAt} ms, complete ${Date.now() - startedAt} ms`;
        const spoken: string = reply.trimStart().startsWith(QUIET_MARKER) === true ? "" : cleanSpeech(reply);
        if (spoken === "" || signal.aborted === true) {
            log("host", `stayed quiet (${timing})`);
            return;
        }
        log("host", `said "${spoken}" (${timing})`);
        this.stage.setThinking(false);
        this.stage.say(spoken, this.persona.style);
        this.remember(`${this.persona.name}: ${spoken}`);
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
            "Everything you write is read aloud word for word, so no lists, markdown, emoji, stage directions or brackets, except the exact reply (quiet).",
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
