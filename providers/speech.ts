// The boundary between the host and whatever speaks for it. Voice is optional: ElevenLabs where it has
// a key, and otherwise silence, with the host's words shown as captions and the game carrying on.

/** Which of the room's voices a line uses. */
export type SpeechVoice = "usual" | "warm";

/** One request to speak. */
export interface SpeechRequest {
    text: string;
    voice: SpeechVoice;
    /** Delivery instruction; a voice that can't use one ignores it. */
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
