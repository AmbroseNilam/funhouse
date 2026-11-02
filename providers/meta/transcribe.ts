// One realtime session with Muse Voice Transcribe: open the socket, send the handshake,
// stream paced 24 kHz PCM frames in, and surface the server's events as typed callbacks.
// The room opens one of these per phone, so speaker identity comes from the session,
// never from diarization. Protocol reference: dev.meta.ai/docs/speech-to-text.

import WebSocket from "ws"; // Node's built-in WebSocket drops this endpoint with code 1006; ws does not.
import { readMetaKey } from "./client.ts";

/**
 * Converts a ws RawData payload to text.
 * @param data a Buffer, ArrayBuffer, or list of Buffers.
 * @returns the UTF-8 text.
 */
export function rawDataToText(data: WebSocket.RawData): string {
    if (Buffer.isBuffer(data)) {
        return data.toString("utf8");
    }
    if (Array.isArray(data)) {
        return Buffer.concat(data).toString("utf8");
    }
    return Buffer.from(data).toString("utf8");
}

/**
 * Reads a string field from an untyped server event.
 * @param value the field value.
 * @param fallback what to return when the field is not a string.
 * @returns the string.
 */
function stringField(value: unknown, fallback: string): string {
    if (typeof value === "string") {
        return value;
    }
    return fallback;
}

/** Realtime transcription endpoint. */
export const TRANSCRIBE_URL: string = "wss://api.meta.ai/v1/asr/realtime";

/** Model identifier for Muse Voice Transcribe. */
export const TRANSCRIBE_MODEL: string = "muse-voice-transcribe-1.0";

/** Audio sample rate the room standardizes on, in hertz. */
export const SAMPLE_RATE_HERTZ: number = 24000;

/** Bytes per 80 ms frame of 16-bit mono PCM at 24 kHz. */
export const FRAME_BYTES: number = 3840;

/** Milliseconds of audio in one frame. */
export const FRAME_MILLISECONDS: number = 80;

/** How the server decides where a turn ends. */
export type TurnMode = "PUSH_TO_TALK" | "ENDPOINTING" | "DIARIZATION";

/** Events the session reports, mirroring the server's event types. */
/** Most frames held while the session opens: six seconds of audio. */
const EARLY_FRAME_LIMIT: number = 75;

export interface TranscribeListener {
    /** Speech began for a new turn. */
    onSpeechStart?(turnId: string): void;
    /** A partial (cumulative) or final transcript for the current turn. */
    onTranscript?(text: string, isFinal: boolean): void;
    /** Speech stopped; the post-processed text arrives in onSpeechComplete. */
    onSpeechEnd?(turnId: string): void;
    /** Final post-processed text for a turn. */
    onSpeechComplete?(turnId: string, text: string): void;
    /** The server reported an error; the socket usually closes afterwards. */
    onError?(message: string): void;
    /** The socket closed with the given code and reason. */
    onClose?(code: number, reason: string): void;
}

/** Options fixed for the life of one session. */
export interface TranscribeOptions {
    mode: TurnMode;
    /** Words to bias recognition toward, such as player names and game terms. */
    keywords?: string[];
    /** Correlation identifier the server echoes back; a fresh one is made when omitted. */
    sessionId?: string;
}

/**
 * A live transcription session for one audio source.
 * Lifecycle: construct, await open(), send frames at real-time pace, then end().
 * Not thread-safe by design; one owner per instance.
 */
export class TranscribeSession {
    private readonly socket: WebSocket;
    private readonly listener: TranscribeListener;
    private readonly options: TranscribeOptions;
    private acknowledged: boolean = false;
    /** Frames sent before the server acknowledged; flushed in order on acknowledgement. */
    private readonly earlyFrames: Uint8Array[] = [];
    /** True when end() was called before acknowledgement. */
    private endRequested: boolean = false;

    /**
     * Creates a session that connects immediately but sends nothing until open() resolves.
     * @param options turn mode and biasing fixed for the session.
     * @param listener callbacks for server events.
     */
    public constructor(options: TranscribeOptions, listener: TranscribeListener) {
        this.options = options;
        this.listener = listener;
        const url: string = options.sessionId === undefined ? TRANSCRIBE_URL : `${TRANSCRIBE_URL}?sessionId=${encodeURIComponent(options.sessionId)}`;
        this.socket = new WebSocket(url);
        this.socket.on("message", (data: WebSocket.RawData) => { this.handleMessage(rawDataToText(data)); });
        this.socket.on("close", (code: number, reason: Buffer) => { this.listener.onClose?.(code, reason.toString()); });
        // The server answers our close with status 1005, which ws reports as an error; harmless.
        this.socket.on("error", () => { /* surfaced through onClose */ });
    }

    /**
     * Sends the handshake and resolves once the server acknowledges with a session id.
     * @returns the server's session identifier.
     */
    public open(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const timer: NodeJS.Timeout = setTimeout(() => { reject(new Error("Transcribe handshake timed out after 10 s.")); }, 10000);
            this.socket.once("open", () => {
                this.socket.send(JSON.stringify({
                    authorization: { accessToken: `Bearer ${readMetaKey()}` },
                    audioEncoding: "PCM_24KHZ",
                    model: TRANSCRIBE_MODEL,
                    mode: this.options.mode,
                    partialMode: "CUMULATIVE",
                    emitAudioProgress: false,
                    keywords: this.options.keywords ?? [],
                }));
            });
            const onFirstMessage = (data: WebSocket.RawData): void => {
                const parsed: { sessionId?: string; type?: string; message?: string } = JSON.parse(rawDataToText(data)) as { sessionId?: string; type?: string; message?: string };
                if (parsed.type === "error") {
                    clearTimeout(timer);
                    reject(new Error(`Transcribe handshake rejected: ${parsed.message ?? "unknown error"}`));
                    return;
                }
                if (parsed.sessionId === undefined) {
                    return;
                }
                clearTimeout(timer);
                this.acknowledged = true;
                this.socket.off("message", onFirstMessage);
                for (const frame of this.earlyFrames.splice(0, this.earlyFrames.length)) {
                    this.socket.send(frame);
                }
                if (this.endRequested === true) {
                    this.socket.send(JSON.stringify({ type: "endStream" }));
                }
                resolve(parsed.sessionId);
            };
            this.socket.on("message", onFirstMessage);
        });
    }

    /**
     * Sends one frame of raw 16-bit little-endian mono PCM at 24 kHz. Frames sent before the
     * handshake completes are held and flushed on acknowledgement, so a player's first words
     * are not lost while the session opens. The hold is bounded; the oldest frames drop first.
     * Callers pace frames at real time; the server rejects streams that run far ahead.
     * @param frame audio bytes, normally FRAME_BYTES long.
     */
    public sendFrame(frame: Uint8Array): void {
        if (this.acknowledged === true) {
            this.socket.send(frame);
            return;
        }
        this.earlyFrames.push(frame);
        if (this.earlyFrames.length > EARLY_FRAME_LIMIT) {
            this.earlyFrames.shift();
        }
    }

    /**
     * Half-closes input so pending results can still arrive; the server then closes with 1000.
     * Before acknowledgement, the end is deferred until the held frames are flushed.
     */
    public end(): void {
        if (this.acknowledged === false) {
            this.endRequested = true;
            return;
        }
        if (this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        this.socket.send(JSON.stringify({ type: "endStream" }));
    }

    /** Closes the socket immediately, discarding any pending results. */
    public abort(): void {
        this.socket.close();
    }

    /**
     * Routes one server event to the listener. Unknown event types are ignored on purpose.
     * @param raw the JSON text frame from the server.
     */
    private handleMessage(raw: string): void {
        const event: Record<string, unknown> = JSON.parse(raw) as Record<string, unknown>;
        const type: unknown = event.type;
        if (type === "speechStart") {
            this.listener.onSpeechStart?.(stringField(event.turnId, ""));
            return;
        }
        if (type === "transcript") {
            this.listener.onTranscript?.(stringField(event.transcript, ""), event.final === true);
            return;
        }
        if (type === "speechEnd") {
            this.listener.onSpeechEnd?.(stringField(event.turnId, ""));
            return;
        }
        if (type === "speechComplete") {
            this.listener.onSpeechComplete?.(stringField(event.turnId, ""), stringField(event.transcript, ""));
            return;
        }
        if (type === "error") {
            this.listener.onError?.(stringField(event.message, "unknown error"));
        }
    }
}
