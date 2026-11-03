// The host's voice in one room: an ordered queue of sentences. Each sentence starts fetching
// its audio the moment it is queued, so the next one is ready while the current one plays;
// audio goes out strictly in order. Pre-recorded lines (acknowledgements, scripted narration)
// join the same queue with no fetch at all. Stopping drops everything queued and in flight.
// Owned by the room; single-threaded like the rest of the room.

import type { SpeechVoice, TextToSpeech } from "../providers/openai/speech.ts";
import { log } from "./log.ts";

/** Where the voice sends audio. The room fans it out to its screens. */
export interface VoiceOutput {
    /** A sentence's audio is about to start. */
    lineStarted(): void;
    /** One chunk of PCM, always an even number of bytes. */
    chunk(bytes: Uint8Array): void;
    /** A sentence's audio has been fully sent. */
    lineEnded(): void;
    /** Everything queued was dropped; listeners should stop playback now. */
    cancelled(): void;
    /** The voice started or stopped being audible, by estimate. */
    speakingChanged(speaking: boolean): void;
}

/** Bytes per second of PCM: 24 kHz, 16-bit, mono. */
const BYTES_PER_SECOND: number = 48000;

/** Audio the screen holds before it starts playing; see screen/src/speaker.ts. */
const SCREEN_CUSHION_MILLISECONDS: number = 120;

/** One sentence's audio as it downloads, readable while still arriving. */
class FetchedLine {
    private readonly chunks: Uint8Array[] = [];
    private done: boolean = false;
    private wake: (() => void) | null = null;

    /**
     * Adds a downloaded chunk.
     * @param chunk encoded audio bytes.
     */
    public push(chunk: Uint8Array): void {
        this.chunks.push(chunk);
        this.wake?.();
    }

    /** Marks the download finished, successfully or not. */
    public close(): void {
        this.done = true;
        this.wake?.();
    }

    /** Yields chunks in order, waiting for more until the download closes. */
    public async *read(): AsyncGenerator<Uint8Array> {
        let index: number = 0;
        while (index < this.chunks.length || this.done === false) {
            const chunk: Uint8Array | undefined = this.chunks[index];
            if (chunk !== undefined) {
                index += 1;
                yield chunk;
                continue;
            }
            await new Promise<void>((resolve: () => void) => { this.wake = resolve; });
            this.wake = null;
        }
    }
}

/** The ordered, prefetching voice. One instance per room. */
export class HostVoice {
    private readonly speech: TextToSpeech;
    private readonly output: VoiceOutput;
    private downloads: AbortController = new AbortController();
    private queue: Promise<void> = Promise.resolve();
    private generation: number = 0;
    private playbackEndsAt: number = 0;
    private speaking: boolean = false;
    private pendingLines: number = 0;
    private idleTimer: NodeJS.Timeout | null = null;

    /**
     * Creates a voice that speaks through the given provider.
     * @param speech the text-to-speech provider.
     * @param output where audio goes.
     */
    public constructor(speech: TextToSpeech, output: VoiceOutput) {
        this.speech = speech;
        this.output = output;
    }

    /**
     * Queues one sentence. Its audio begins downloading now.
     * @param text the words.
     * @param voice which voice to use.
     * @param style delivery direction.
     */
    public say(text: string, voice: SpeechVoice, style: string): void {
        this.enqueue(this.download(text, voice, style));
    }

    /**
     * Queues audio that is already rendered, such as an acknowledgement.
     * @param pcm the whole line as 24 kHz 16-bit mono PCM.
     */
    public sayRecorded(pcm: Uint8Array): void {
        const line: FetchedLine = new FetchedLine();
        line.push(pcm);
        line.close();
        this.enqueue(line);
    }

    /**
     * Renders a line to memory without playing it, for the pre-recorded bank.
     * @param text the words.
     * @param voice which voice.
     * @param style delivery direction.
     * @returns the whole line as PCM.
     */
    public async render(text: string, voice: SpeechVoice, style: string): Promise<Uint8Array> {
        const parts: Uint8Array[] = [];
        for await (const chunk of this.speech.speak({ text, voice, style })) {
            parts.push(chunk);
        }
        const whole: Uint8Array = new Uint8Array(parts.reduce((total: number, part: Uint8Array) => total + part.length, 0));
        let offset: number = 0;
        for (const part of parts) {
            whole.set(part, offset);
            offset += part.length;
        }
        return whole.subarray(0, whole.length - (whole.length % 2));
    }

    /**
     * True while anything is queued or audible.
     * @returns whether the voice is busy.
     */
    public isBusy(): boolean {
        return this.pendingLines > 0 || this.speaking === true;
    }

    /** Drops everything queued and in flight, and tells listeners to go quiet now. */
    public stop(): void {
        this.generation += 1;
        this.downloads.abort();
        this.downloads = new AbortController();
        this.queue = Promise.resolve();
        this.pendingLines = 0;
        this.playbackEndsAt = 0;
        this.clearIdleTimer();
        this.output.cancelled();
        this.setSpeaking(false);
    }

    /**
     * Adds a line to the ordered queue.
     * @param line the line, downloading or complete.
     */
    private enqueue(line: FetchedLine): void {
        const generation: number = this.generation;
        this.pendingLines += 1;
        this.clearIdleTimer();
        this.queue = this.queue.then(async () => {
            if (generation !== this.generation) {
                return;
            }
            await this.send(line, generation);
            if (generation !== this.generation) {
                return;
            }
            this.pendingLines -= 1;
            this.scheduleIdle(generation);
        });
    }

    /**
     * Marks the voice silent once the last sent audio should have finished playing, unless
     * more lines were queued in the meantime.
     * @param generation the queue generation that sent the audio.
     */
    private scheduleIdle(generation: number): void {
        if (this.pendingLines > 0) {
            return;
        }
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (generation !== this.generation || this.pendingLines > 0) {
                return;
            }
            this.setSpeaking(false);
        }, Math.max(0, this.playbackEndsAt - Date.now()));
    }

    /** Cancels a pending idle check. */
    private clearIdleTimer(): void {
        if (this.idleTimer === null) {
            return;
        }
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }

    /**
     * Starts downloading one sentence's audio in the background.
     * @param text the words.
     * @param voice which voice.
     * @param style delivery direction.
     * @returns the line, readable while it downloads.
     */
    private download(text: string, voice: SpeechVoice, style: string): FetchedLine {
        const line: FetchedLine = new FetchedLine();
        const signal: AbortSignal = this.downloads.signal;
        const startedAt: number = Date.now();
        const run = async (): Promise<void> => {
            let first: boolean = true;
            for await (const chunk of this.speech.speak({ text, voice, style, signal })) {
                if (first === true) {
                    first = false;
                    log("voice", `first audio byte after ${Date.now() - startedAt} ms`);
                }
                line.push(chunk);
            }
        };
        run().catch((error: unknown) => {
            if (signal.aborted === false) {
                log("voice", `speech failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }).finally(() => { line.close(); });
        return line;
    }

    /**
     * Sends one sentence's audio as it arrives, keeping chunks on sample boundaries.
     * @param line the downloading sentence.
     * @param generation the queue generation it belongs to; a stop makes it stale.
     */
    private async send(line: FetchedLine, generation: number): Promise<void> {
        let carry: Uint8Array = new Uint8Array(0);
        this.output.lineStarted();
        for await (const chunk of line.read()) {
            if (generation !== this.generation) {
                return;
            }
            const joined: Uint8Array = new Uint8Array(carry.length + chunk.length);
            joined.set(carry);
            joined.set(chunk, carry.length);
            const even: number = joined.length - (joined.length % 2);
            carry = joined.slice(even);
            if (even === 0) {
                continue;
            }
            const now: number = Date.now();
            const startsAt: number = this.playbackEndsAt > now ? this.playbackEndsAt : now + SCREEN_CUSHION_MILLISECONDS;
            this.playbackEndsAt = startsAt + (even / BYTES_PER_SECOND) * 1000;
            this.setSpeaking(true);
            this.output.chunk(joined.subarray(0, even));
        }
        this.output.lineEnded();
    }

    /**
     * Records and announces whether the voice is audible.
     * @param speaking the new state.
     */
    private setSpeaking(speaking: boolean): void {
        if (this.speaking === speaking) {
            return;
        }
        this.speaking = speaking;
        this.output.speakingChanged(speaking);
    }
}
