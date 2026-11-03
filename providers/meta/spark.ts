// Muse Spark through the OpenAI-compatible Chat Completions surface of the Meta Model API.
// Streams reply text. max_tokens covers Spark's hidden reasoning as well as the reply, so callers
// leave room for both. Time to first text varies widely, so a slow start can be raced by a backup.

import { postJson, readServerSentEvents } from "./client.ts";

/** Default host model. */
export const SPARK_MODEL: string = "muse-spark-1.3";

/** One chat message. */
export interface SparkMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/** Options for one streamed completion. */
export interface SparkOptions {
    model?: string;
    /** Spark reasoning effort; "minimal" keeps quick reactions quick. */
    reasoningEffort?: "minimal" | "low" | "medium" | "high";
    maxTokens?: number;
    signal?: AbortSignal;
}

/** One request in a race, with its first result already asked for. */
interface RacingStream {
    canceller: AbortController;
    stream: AsyncGenerator<string>;
    first: Promise<IteratorResult<string>>;
}

/** Shape of one streamed chunk, as far as this file reads it. */
interface StreamChunk {
    choices?: { delta?: { content?: unknown } }[];
}

/**
 * Streams a completion, yielding text deltas as they arrive.
 * @param messages the conversation so far.
 * @param options model and effort settings.
 */
export async function* streamSpark(messages: SparkMessage[], options: SparkOptions = {}): AsyncGenerator<string> {
    for await (const chunk of streamChunks(messages, options)) {
        const delta: unknown = chunk.choices?.[0]?.delta?.content;
        if (typeof delta !== "string" || delta === "") {
            continue;
        }
        yield delta;
    }
}

/**
 * Streams a completion, racing a second request if the first has sent no text in time. Whichever
 * sends text first is used and the other is cancelled.
 * @param messages the conversation so far.
 * @param options model and effort settings.
 * @param backupAfterMilliseconds how long the first request gets alone.
 * @param mayBackUp asked once, when a backup is due; false keeps the first request alone.
 */
export async function* streamSparkWithBackup(messages: SparkMessage[], options: SparkOptions, backupAfterMilliseconds: number, mayBackUp: () => boolean): AsyncGenerator<string> {
    const open = (): RacingStream => {
        const canceller: AbortController = new AbortController();
        const signal: AbortSignal = options.signal === undefined ? canceller.signal : AbortSignal.any([options.signal, canceller.signal]);
        const stream: AsyncGenerator<string> = streamSpark(messages, { ...options, signal });
        return { canceller, stream, first: stream.next() };
    };
    const main: RacingStream = open();
    let backup: RacingStream | null = null;
    try {
        const startedInTime: boolean = await Promise.race([
            main.first.then(() => true, () => true),
            new Promise<boolean>((resolve: (value: boolean) => void) => { setTimeout(() => { resolve(false); }, backupAfterMilliseconds).unref(); }),
        ]);
        if (startedInTime === false && options.signal?.aborted !== true && mayBackUp() === true) {
            backup = open();
        }
        const winner: RacingStream = backup === null ? main : await firstToSpeak(main, backup);
        const loser: RacingStream | null = backup === null ? null : winner === main ? backup : main;
        loser?.canceller.abort();
        loser?.first.catch(() => { /* cancelled on purpose */ });
        const opening: IteratorResult<string> = await winner.first;
        if (opening.done === true) {
            return;
        }
        yield opening.value;
        yield* winner.stream;
    } finally {
        main.canceller.abort();
        backup?.canceller.abort();
    }
}

/**
 * Picks the stream that sends text first. One that fails or ends with no text only counts if the
 * other does too, so the caller sees the failure of the last one left.
 * @param first one stream.
 * @param second the other.
 * @returns the winner.
 */
async function firstToSpeak(first: RacingStream, second: RacingStream): Promise<RacingStream> {
    const spoke = async (racer: RacingStream): Promise<RacingStream> => {
        const result: IteratorResult<string> = await racer.first;
        if (result.done === true) {
            throw new Error("no text");
        }
        return racer;
    };
    try {
        return await Promise.any([spoke(first), spoke(second)]);
    } catch {
        return second;
    }
}

/**
 * Posts one streaming request and yields its parsed chunks.
 * @param messages the conversation so far.
 * @param options model, effort, length and cancellation.
 */
async function* streamChunks(messages: SparkMessage[], options: SparkOptions): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
        model: options.model ?? SPARK_MODEL,
        messages,
        stream: true,
        max_tokens: options.maxTokens ?? 400,
        reasoning_effort: options.reasoningEffort ?? "minimal",
    };
    const response: Response = await postJson("/chat/completions", body, options.signal);
    for await (const event of readServerSentEvents(response)) {
        yield event as StreamChunk;
    }
}
