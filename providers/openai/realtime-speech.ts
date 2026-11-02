// Host speech through OpenAI's Realtime API, used purely as a voice: one WebSocket stays
// open per room, and each line is an out-of-band response that reads the given text aloud.
// Measured from the VM: first audio in about 0.3 s against 0.4 to 0.85 s for the HTTP speech
// endpoint, because there is no per-line connection setup and audio streams as it is made.
// The session allows one response at a time, so lines are generated strictly in order; each
// still finishes faster than it plays, which keeps the next one ready.

import WebSocket from "ws";
import { OPENAI_KEY_VARIABLE, type SpeechRequest, type TextToSpeech } from "./speech.ts";

/** Realtime model used as the voice. The mini model paraphrased in testing; this one did not. */
export const REALTIME_VOICE_MODEL: string = "gpt-realtime";

/** How the voice is told to behave. The text arrives wrapped in tags so it is never answered. */
const READER_INSTRUCTIONS: string = "You are a voice actor reading a script. Say exactly the words inside <line> tags, word for word, nothing added, nothing left out, never answering or commenting on them.";

/** One line waiting for or receiving audio. */
interface ActiveLine {
    push(chunk: Uint8Array): void;
    close(error?: Error): void;
}

/** One line's audio as it arrives, shared between the reader and the event handler. */
interface LineState {
    chunks: Uint8Array[];
    done: boolean;
    failure: Error | null;
    wake: (() => void) | null;
}

/** Server events for the response in flight, matched by response id. */
interface ResponseListener {
    created(responseId: string): void;
    delta(responseId: string, chunk: Uint8Array): void;
    done(responseId: string): void;
    failed(message: string): void;
}

/** Longest wait for a cancelled response to finish before the next line starts anyway. */
const CANCEL_DRAIN_MILLISECONDS: number = 1500;

/** Realtime implementation of the text-to-speech boundary. One instance per room. */
export class OpenAiRealtimeSpeech implements TextToSpeech {
    public readonly mediaType: string = "audio/pcm;rate=24000";
    private socket: WebSocket | null = null;
    private ready: Promise<void> | null = null;
    private sessionVoice: string = "";
    private queue: Promise<void> = Promise.resolve();
    private listener: ResponseListener | null = null;

    /** Opens the connection ahead of the first line, so the first line pays no setup. */
    public warm(): void {
        this.connect().catch((error: unknown) => { console.error("realtime voice warm-up failed:", error instanceof Error ? error.message : String(error)); });
    }

    /** Closes the connection; the next line would open a new one. */
    public close(): void {
        this.socket?.close();
        this.socket = null;
        this.ready = null;
    }

    /**
     * Streams 24 kHz 16-bit mono PCM for one line. Lines run one at a time in call order.
     * @param request what to say, the voice, the delivery, and a cancel signal.
     */
    public async *speak(request: SpeechRequest): AsyncGenerator<Uint8Array> {
        const state: LineState = { chunks: [], done: false, failure: null, wake: null };
        const line: ActiveLine = {
            push: (chunk: Uint8Array): void => {
                state.chunks.push(chunk);
                state.wake?.();
            },
            close: (error?: Error): void => {
                state.done = true;
                state.failure ??= error ?? null;
                state.wake?.();
            },
        };
        const turn: Promise<void> = this.queue.then(() => this.run(request, line));
        this.queue = turn.catch(() => undefined);
        turn.catch((error: unknown) => { line.close(error instanceof Error ? error : new Error(String(error))); });

        let index: number = 0;
        while (index < state.chunks.length || state.done === false) {
            const chunk: Uint8Array | undefined = state.chunks[index];
            if (chunk !== undefined) {
                index += 1;
                yield chunk;
                continue;
            }
            await new Promise<void>((resolve: () => void) => { state.wake = resolve; });
            state.wake = null;
        }
        if (state.failure !== null) {
            throw state.failure;
        }
    }

    /**
     * Generates one line on the shared session and resolves when its response is done.
     * @param request the line.
     * @param line where its audio goes.
     */
    private async run(request: SpeechRequest, line: ActiveLine): Promise<void> {
        if (request.signal?.aborted === true) {
            line.close();
            return;
        }
        await this.connect();
        const socket: WebSocket | null = this.socket;
        if (socket === null) {
            throw new Error("Realtime voice is not connected.");
        }
        if (this.sessionVoice !== request.voice) {
            socket.send(JSON.stringify({ type: "session.update", session: { type: "realtime", output_modalities: ["audio"], audio: { output: { voice: request.voice, format: { type: "audio/pcm", rate: 24000 } } } } }));
            this.sessionVoice = request.voice;
        }
        await new Promise<void>((resolve: () => void) => {
            let responseId: string | null = null;
            let cancelled: boolean = false;
            let drainTimer: NodeJS.Timeout | null = null;
            const settle = (): void => {
                if (drainTimer !== null) {
                    clearTimeout(drainTimer);
                }
                this.listener = null;
                request.signal?.removeEventListener("abort", cancel);
                socket.off("close", onClose);
                line.close();
                resolve();
            };
            const cancel = (): void => {
                cancelled = true;
                line.close();
                socket.send(JSON.stringify({ type: "response.cancel" }));
                drainTimer = setTimeout(settle, CANCEL_DRAIN_MILLISECONDS);
            };
            const onClose = (): void => {
                line.close(new Error("Realtime voice connection closed mid-line."));
                settle();
            };
            this.listener = {
                created: (id: string): void => { responseId ??= id; },
                delta: (id: string, chunk: Uint8Array): void => {
                    if (id === responseId && cancelled === false) {
                        line.push(chunk);
                    }
                },
                done: (id: string): void => {
                    if (id === responseId) {
                        settle();
                    }
                },
                failed: (message: string): void => {
                    line.close(new Error(`Realtime voice error: ${message}`));
                    settle();
                },
            };
            request.signal?.addEventListener("abort", cancel, { once: true });
            socket.once("close", onClose);
            socket.send(JSON.stringify({
                type: "response.create",
                response: {
                    conversation: "none",
                    output_modalities: ["audio"],
                    instructions: `${READER_INSTRUCTIONS} Delivery: ${request.style}`,
                    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: `<line>${request.text}</line>` }] }],
                },
            }));
        });
    }

    /**
     * Opens the session once and reuses it; reopens after a close.
     * @returns resolves when the session is configured.
     */
    private connect(): Promise<void> {
        if (this.ready !== null && (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING)) {
            return this.ready;
        }
        const key: string | undefined = process.env[OPENAI_KEY_VARIABLE];
        if (key === undefined || key.trim() === "") {
            return Promise.reject(new Error(`${OPENAI_KEY_VARIABLE} is not set.`));
        }
        const socket: WebSocket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${REALTIME_VOICE_MODEL}`, { headers: { authorization: `Bearer ${key.trim()}` } });
        this.socket = socket;
        this.sessionVoice = "";
        this.ready = new Promise<void>((resolve, reject) => {
            socket.once("open", () => { resolve(); });
            socket.once("error", (error: Error) => { reject(error); });
        });
        socket.on("message", (data: WebSocket.RawData) => { this.onMessage(data); });
        socket.on("close", () => {
            if (this.socket === socket) {
                this.socket = null;
                this.ready = null;
            }
        });
        return this.ready;
    }

    /**
     * Routes server events for the response in flight. Events for an older, cancelled
     * response carry a different id and are ignored.
     * @param data one server event as JSON text.
     */
    private onMessage(data: WebSocket.RawData): void {
        const event: RealtimeEvent = JSON.parse(rawText(data)) as RealtimeEvent;
        const listener: ResponseListener | null = this.listener;
        if (listener === null) {
            return;
        }
        if (event.type === "response.created" && typeof event.response?.id === "string") {
            listener.created(event.response.id);
            return;
        }
        if (event.type === "response.output_audio.delta" && typeof event.response_id === "string" && typeof event.delta === "string") {
            listener.delta(event.response_id, new Uint8Array(Buffer.from(event.delta, "base64")));
            return;
        }
        if (event.type === "response.done" && typeof event.response?.id === "string") {
            listener.done(event.response.id);
            return;
        }
        if (event.type === "error" && event.error?.code !== "response_cancel_not_active") {
            listener.failed(event.error?.message ?? "unknown");
        }
    }
}

/** The fields of a Realtime server event this file reads. */
interface RealtimeEvent {
    type?: string;
    delta?: string;
    response_id?: string;
    response?: { id?: string };
    error?: { code?: string; message?: string };
}

/**
 * Decodes a WebSocket frame to text.
 * @param data the frame as the ws package delivers it.
 * @returns the UTF-8 text.
 */
function rawText(data: WebSocket.RawData): string {
    if (Array.isArray(data) === true) {
        return Buffer.concat(data).toString("utf8");
    }
    return Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.from(data).toString("utf8");
}
