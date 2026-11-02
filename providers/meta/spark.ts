// Muse Spark through the OpenAI-compatible Chat Completions surface of the Meta Model API.
// Streams tokens so the host can start speaking on the first sentence. Tool calling and
// structured output land here when the host loop needs them.

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
}

/**
 * Streams a completion, yielding text deltas as they arrive.
 * @param messages the conversation so far.
 * @param options model and effort settings.
 */
export async function* streamSpark(messages: SparkMessage[], options: SparkOptions = {}): AsyncGenerator<string> {
    const response: Response = await postJson("/chat/completions", {
        model: options.model ?? SPARK_MODEL,
        messages,
        stream: true,
        max_tokens: options.maxTokens ?? 400,
        reasoning_effort: options.reasoningEffort ?? "minimal",
    });
    for await (const event of readServerSentEvents(response)) {
        const delta: unknown = (event as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0]?.delta?.content;
        if (typeof delta !== "string" || delta === "") {
            continue;
        }
        yield delta;
    }
}
