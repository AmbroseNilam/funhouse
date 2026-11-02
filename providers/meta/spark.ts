// Muse Spark through the OpenAI-compatible Chat Completions surface of the Meta Model API.
// Streams tokens so the host can start speaking on the first sentence, and streams tool
// calls so the room can act on each one as soon as its arguments are complete.

import { postJson, readServerSentEvents } from "./client.ts";

/** Default host model. */
export const SPARK_MODEL: string = "muse-spark-1.3";

/** One chat message. */
export interface SparkMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/** A tool the model may call, described with a JSON schema for its arguments. */
export interface SparkTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/** One finished tool call: the name and its parsed arguments. */
export interface SparkToolCall {
    name: string;
    arguments: Record<string, unknown>;
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
    choices?: { delta?: { content?: unknown; tool_calls?: { index?: number; function?: { name?: unknown; arguments?: unknown } }[] } }[];
}

/**
 * Streams a completion, yielding text deltas as they arrive.
 * @param messages the conversation so far.
 * @param options model and effort settings.
 */
export async function* streamSpark(messages: SparkMessage[], options: SparkOptions = {}): AsyncGenerator<string> {
    for await (const chunk of streamChunks(messages, [], options)) {
        const delta: unknown = chunk.choices?.[0]?.delta?.content;
        if (typeof delta !== "string" || delta === "") {
            continue;
        }
        yield delta;
    }
}

/**
 * Streams a completion with tools, yielding each tool call once its arguments are complete.
 * Calls arrive in order; a call is complete when the next one starts or the stream ends.
 * Plain text the model writes alongside is its private narration and is dropped.
 * @param messages the conversation so far.
 * @param tools the tools the model may call.
 * @param options model, effort and cancellation.
 */
export async function* streamSparkToolCalls(messages: SparkMessage[], tools: SparkTool[], options: SparkOptions = {}): AsyncGenerator<SparkToolCall> {
    let currentIndex: number = -1;
    let currentName: string = "";
    let currentArguments: string = "";
    for await (const chunk of streamChunks(messages, tools, options)) {
        for (const call of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
            const index: number = call.index ?? currentIndex;
            if (index !== currentIndex) {
                if (currentIndex >= 0) {
                    yield finishCall(currentName, currentArguments);
                }
                currentIndex = index;
                currentName = "";
                currentArguments = "";
            }
            if (typeof call.function?.name === "string") {
                currentName += call.function.name;
            }
            if (typeof call.function?.arguments === "string") {
                currentArguments += call.function.arguments;
            }
        }
    }
    if (currentIndex >= 0) {
        yield finishCall(currentName, currentArguments);
    }
}

/**
 * Posts one streaming request and yields its parsed chunks.
 * @param messages the conversation so far.
 * @param tools tools to offer, possibly none.
 * @param options model, effort, length and cancellation.
 */
async function* streamChunks(messages: SparkMessage[], tools: SparkTool[], options: SparkOptions): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
        model: options.model ?? SPARK_MODEL,
        messages,
        stream: true,
        max_tokens: options.maxTokens ?? 400,
        reasoning_effort: options.reasoningEffort ?? "minimal",
    };
    if (tools.length > 0) {
        body.tools = tools.map((tool: SparkTool) => ({ type: "function", function: tool }));
    }
    const response: Response = await postJson("/chat/completions", body, options.signal);
    for await (const event of readServerSentEvents(response)) {
        yield event as StreamChunk;
    }
}

/**
 * Parses a finished tool call's argument text.
 * @param name the tool name.
 * @param argumentText the concatenated JSON argument text.
 * @returns the call with parsed arguments.
 * @throws Error naming the tool when the arguments are not a JSON object.
 */
function finishCall(name: string, argumentText: string): SparkToolCall {
    const parsed: unknown = JSON.parse(argumentText === "" ? "{}" : argumentText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Spark tool call ${name} had non-object arguments: ${argumentText.slice(0, 200)}`);
    }
    return { name, arguments: parsed as Record<string, unknown> };
}
