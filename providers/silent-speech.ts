// A voice that makes no sound and no provider calls: what a room has with no ElevenLabs key or when a
// line can't start, and the text-only test mode. It streams a short burst of silence for each line,
// so everything downstream runs as it would for speech, and the captions carry the words.

import { charge, PRICES } from "./meter.ts";
import type { SpeechRequest, TextToSpeech } from "./speech.ts";

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
     * @param request the line; every line sounds the same.
     */
    public async *speak(request: SpeechRequest): AsyncGenerator<Uint8Array> {
        // For measuring: counts what this line would have cost in a real voice.
        if (process.env.COST_COUNT_SILENT === "1") {
            charge("voice", request.text.length * PRICES.voicePerCharacter);
        }
        await Promise.resolve();
        yield SILENCE;
    }
}
