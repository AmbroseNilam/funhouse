// Shared plumbing for every Meta Model API call: the base URL, the bearer key read from
// the environment, a JSON POST helper that fails loudly, and a server-sent-events reader.
// Nothing in this file knows about a specific model; those live in sibling files.

/** Base URL for the hosted Meta Model API. Overridable for tests and proxies. */
export const META_BASE_URL: string = process.env.META_BASE_URL ?? "https://api.meta.ai/v1";

/** Name of the environment variable that holds the Meta Model API key. */
export const META_KEY_VARIABLE: string = "META_MODEL_API_KEY";

/**
 * Returns the Meta Model API key or throws a specific error when it is missing.
 * The key is never logged or echoed.
 * @returns the bearer key value.
 * @throws Error when the environment variable is empty.
 */
export function readMetaKey(): string {
    const key: string | undefined = process.env[META_KEY_VARIABLE];
    if (key === undefined || key.trim() === "") {
        throw new Error(`${META_KEY_VARIABLE} is not set. Copy .env.example to .env and fill it in.`);
    }
    return key.trim();
}

/**
 * Sends a JSON body to a Meta Model API path and returns the raw response.
 * @param path path under the base URL, starting with a slash.
 * @param body JSON-serializable request body.
 * @param signal aborts the request when the caller no longer wants the answer.
 * @returns the successful response, left unread so callers can stream it.
 * @throws Error with the status when the API rejects the call. The body stays out of it, since
 * an error can quote what was sent, and errors reach the logs.
 */
export async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const response: Response = await fetch(`${META_BASE_URL}${path}`, {
        method: "POST",
        signal: signal ?? null,
        headers: { authorization: `Bearer ${readMetaKey()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    if (response.ok === false) {
        await response.body?.cancel();
        throw new Error(`Meta API ${path} responded ${response.status}.`);
    }
    return response;
}

/**
 * Yields each JSON payload from a server-sent-events response, stopping at the [DONE] marker.
 * @param response a streaming response whose body is text/event-stream.
 */
export async function* readServerSentEvents(response: Response): AsyncGenerator<unknown> {
    if (response.body === null) {
        throw new Error("Meta API returned a response without a body.");
    }
    const decoder: TextDecoder = new TextDecoder();
    let buffered: string = "";
    for await (const chunk of response.body) {
        buffered += decoder.decode(chunk, { stream: true });
        let newline: number = buffered.indexOf("\n");
        while (newline >= 0) {
            const line: string = buffered.slice(0, newline).trim();
            buffered = buffered.slice(newline + 1);
            newline = buffered.indexOf("\n");
            if (line.startsWith("data:") === false) {
                continue;
            }
            const data: string = line.slice("data:".length).trim();
            if (data === "[DONE]") {
                return;
            }
            yield JSON.parse(data);
        }
    }
}
