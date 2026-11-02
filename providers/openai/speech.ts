// Text-to-speech behind a provider boundary. Meta has no speech output, so the host's voice
// comes from OpenAI's gpt-4o-mini-tts, steered by a style instruction so the same host can
// whisper at night and boom at dawn. Swapping providers means replacing this file only.

/** Name of the environment variable that holds the OpenAI key. */
export const OPENAI_KEY_VARIABLE: string = "OPENAI_API_KEY";

/** Default speech model. */
export const SPEECH_MODEL: string = "gpt-4o-mini-tts";

/** Voices the host may use; the persona picks one. */
export type SpeechVoice = "alloy" | "ash" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer" | "verse";

/** One request to speak. */
export interface SpeechRequest {
    text: string;
    voice: SpeechVoice;
    /** Delivery instruction, such as "hushed night narrator" or "bright game-show host". */
    style: string;
    /** Stops the request when the host is interrupted. */
    signal?: AbortSignal;
}

/** Contract the room depends on, so another provider can stand in. */
export interface TextToSpeech {
    /** Streams encoded audio chunks for the request. */
    speak(request: SpeechRequest): AsyncGenerator<Uint8Array>;
    /** Media type of the chunks, such as "audio/pcm;rate=24000". */
    readonly mediaType: string;
}

/**
 * Returns the OpenAI key or throws a specific error when it is missing.
 * @returns the key value.
 */
function readOpenAiKey(): string {
    const key: string | undefined = process.env[OPENAI_KEY_VARIABLE];
    if (key === undefined || key.trim() === "") {
        throw new Error(`${OPENAI_KEY_VARIABLE} is not set. Copy .env.example to .env and fill it in.`);
    }
    return key.trim();
}

/**
 * OpenAI implementation of the text-to-speech boundary. Raw PCM rather than MP3 so the
 * screen can schedule samples the moment they arrive, with no decoder buffering.
 */
export class OpenAiSpeech implements TextToSpeech {
    public readonly mediaType: string = "audio/pcm;rate=24000";

    /**
     * Streams 24 kHz 16-bit little-endian mono PCM for the given text.
     * @param request what to say and how.
     */
    public async *speak(request: SpeechRequest): AsyncGenerator<Uint8Array> {
        const response: Response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            signal: request.signal ?? null,
            headers: { authorization: `Bearer ${readOpenAiKey()}`, "content-type": "application/json" },
            body: JSON.stringify({ model: SPEECH_MODEL, input: request.text, voice: request.voice, instructions: request.style, response_format: "pcm" }),
        });
        if (response.ok === false || response.body === null) {
            throw new Error(`OpenAI speech responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
        }
        for await (const chunk of response.body) {
            yield chunk;
        }
    }
}
