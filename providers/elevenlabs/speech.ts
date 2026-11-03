// The host's voice from ElevenLabs, as raw 24 kHz PCM so the screen can play it as it arrives. If a
// line can't start, for example when the account is busy or out of credit, that line falls back to
// another voice so the game never goes quiet. This model takes no delivery direction, so a line's
// style isn't used here; moods still show on the lantern.

import type { SpeechRequest, TextToSpeech } from "../openai/speech.ts";

/** Environment variable holding the ElevenLabs key. */
export const ELEVENLABS_KEY_VARIABLE: string = "ELEVENLABS_API_KEY";

/** The fast model, chosen in a blind comparison. */
const VOICE_MODEL: string = "eleven_flash_v2_5";

/** The stock voice used in that comparison. */
const VOICE_ID: string = "JBFqnCBsd6RMkjVDRZzb";

/** Longest wait for a line to finish. */
const LINE_TIME_LIMIT_MILLISECONDS: number = 30000;

/** ElevenLabs implementation of the text-to-speech boundary. */
export class ElevenLabsSpeech implements TextToSpeech {
    public readonly mediaType: string = "audio/pcm;rate=24000";
    private readonly fallback: TextToSpeech;

    /**
     * Creates the voice.
     * @param fallback speaks any line this one can't start.
     */
    public constructor(fallback: TextToSpeech) {
        this.fallback = fallback;
    }

    /** Nothing to open ahead of time; each line is its own request. */
    public warm(): void {
        // No connection stays open.
    }

    /** Nothing to close; each line is its own request. */
    public close(): void {
        // No connection stays open.
    }

    /**
     * Streams one line, or hands it to the fallback when it can't start.
     * @param request the line.
     */
    public async *speak(request: SpeechRequest): AsyncGenerator<Uint8Array> {
        const body: ReadableStream<Uint8Array> | null = await this.open(request);
        let started: boolean = false;
        try {
            for await (const chunk of (body ?? []) as unknown as AsyncIterable<Uint8Array>) {
                started = true;
                yield chunk;
            }
        } catch (error: unknown) {
            if (started === true || request.signal?.aborted === true) {
                throw error;
            }
            console.warn("elevenlabs voice failed before any audio");
        }
        if (started === false && request.signal?.aborted !== true) {
            yield* this.fallback.speak(request);
        }
    }

    /**
     * Asks for one line.
     * @param request the line.
     * @returns the audio stream, or null when it couldn't start.
     */
    private async open(request: SpeechRequest): Promise<ReadableStream<Uint8Array> | null> {
        const limit: AbortSignal = AbortSignal.timeout(LINE_TIME_LIMIT_MILLISECONDS);
        try {
            const response: Response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream?output_format=pcm_24000`, {
                method: "POST",
                headers: { "xi-api-key": (process.env[ELEVENLABS_KEY_VARIABLE] ?? "").trim(), "content-type": "application/json" },
                body: JSON.stringify({ text: request.text, model_id: VOICE_MODEL }),
                signal: request.signal === undefined ? limit : AbortSignal.any([request.signal, limit]),
            });
            if (response.ok === false || response.body === null) {
                console.warn(`elevenlabs voice refused a line: ${response.status}`);
                return null;
            }
            return response.body;
        } catch {
            return null;
        }
    }
}
