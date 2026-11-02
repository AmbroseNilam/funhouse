// Muse Spark through the OpenAI-compatible Chat Completions surface of the Meta Model API.
// Streams reply text so the host can start speaking on the first sentence. max_tokens covers
// Spark's hidden reasoning as well as the reply, so callers leave room for both.

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
