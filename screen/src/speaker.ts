// Plays the host's voice. The room streams raw 24 kHz 16-bit mono PCM; each chunk is
// scheduled right after the previous one so playback starts on the first chunk and runs
// gap-free. Browsers only allow audio after a user gesture, so the screen unlocks it once.

/** Sample rate of host speech. */
const SAMPLE_RATE: number = 24000;

/** Small lead so the first chunk is not scheduled in the past. */
const START_LEAD_SECONDS: number = 0.05;

/** Streams PCM chunks to the speakers in order. One instance per screen. */
export class HostSpeaker {
    private readonly context: AudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    private readonly playing: Set<AudioBufferSourceNode> = new Set();
    private nextStartTime: number = 0;

    /** Resumes audio; call from a click handler. */
    public async unlock(): Promise<void> {
        await this.context.resume();
    }

    /**
     * Queues one chunk of PCM right after whatever is already queued.
     * @param chunk 16-bit little-endian samples; an even byte count.
     */
    public play(chunk: ArrayBuffer): void {
        const samples: Int16Array = new Int16Array(chunk);
        if (samples.length === 0) {
            return;
        }
        const buffer: AudioBuffer = this.context.createBuffer(1, samples.length, SAMPLE_RATE);
        const channel: Float32Array = buffer.getChannelData(0);
        for (let index = 0; index < samples.length; index += 1) {
            channel[index] = (samples[index] ?? 0) / 32768;
        }
        const source: AudioBufferSourceNode = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.context.destination);
        const startAt: number = Math.max(this.nextStartTime, this.context.currentTime + START_LEAD_SECONDS);
        source.start(startAt);
        this.nextStartTime = startAt + buffer.duration;
        this.playing.add(source);
        source.onended = (): void => { this.playing.delete(source); };
    }

    /** Stops everything queued, because someone cut in. */
    public cancel(): void {
        for (const source of this.playing) {
            source.stop();
        }
        this.playing.clear();
        this.nextStartTime = 0;
    }
}
