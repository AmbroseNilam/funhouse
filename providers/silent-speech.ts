// A voice that makes no sound and no provider calls, for the text-only test mode. It streams a
// short burst of silence for each line, so everything downstream runs as it would for speech.

import type { SpeechRequest, TextToSpeech } from "./openai/speech.ts";

/** One 100 ms chunk of 24 kHz 16-bit mono silence. */
const SILENCE: Uint8Array = new Uint8Array(4800);

/** Silent implementation of the text-to-speech boundary. */
export class SilentSpeech implements TextToSpeech {
    public readonly mediaType: string = "audio/pcm;rate=24000";

    /** Nothing to open ahead of time. */
    public warm(): void {
        // A silent voice has no connection.
    }

    /** Nothing to close. */
    public close(): void {
        // A silent voice has no connection.
    }

    /**
     * Streams silence for one line.
     * @param _request ignored; every line sounds the same.
     */
    public async *speak(_request: SpeechRequest): AsyncGenerator<Uint8Array> {
        await Promise.resolve();
        yield SILENCE;
    }
}
