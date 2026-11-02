// Plays the host's voice. The room streams raw 24 kHz 16-bit mono PCM; chunks are scheduled
// back to back so playback is gap-free. When the speaker is idle it first holds a short
// cushion of audio, so network jitter is absorbed instead of heard as stutter; once playing,
// chunks are scheduled the moment they arrive. Browsers only allow audio after a user
// gesture, so the screen unlocks it once.

/** Sample rate of host speech. */
const SAMPLE_RATE: number = 24000;

/** Audio held before playback starts from idle. Matches the room's estimate in room/voice.ts. */
const CUSHION_SECONDS: number = 0.25;

/** Lead when scheduling into silence, so the first sample is never in the past. */
const START_LEAD_SECONDS: number = 0.02;

/** Streams PCM chunks to the speakers in order. One instance per screen. */
export class HostSpeaker {
    private readonly context: AudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    private readonly playing: Set<AudioBufferSourceNode> = new Set();
    private readonly held: AudioBuffer[] = [];
    private heldSeconds: number = 0;
    private nextStartTime: number = 0;

    /** Resumes audio; call from a click handler. */
    public async unlock(): Promise<void> {
        await this.context.resume();
    }

    /**
     * Takes one chunk of PCM. Plays it right after what is queued, or holds it while idle
     * until the cushion is full.
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
        if (this.isIdle() === false) {
            this.schedule(buffer);
            return;
        }
        this.held.push(buffer);
        this.heldSeconds += buffer.duration;
        if (this.heldSeconds >= CUSHION_SECONDS) {
            this.release();
        }
    }

    /** A line has been fully sent; play whatever is held even if the cushion is not full. */
    public lineEnded(): void {
        this.release();
    }

    /** Stops everything queued and held, because someone cut in. */
    public cancel(): void {
        for (const source of this.playing) {
            source.stop();
        }
        this.playing.clear();
        this.held.length = 0;
        this.heldSeconds = 0;
        this.nextStartTime = 0;
    }

    /**
     * Whether nothing is scheduled ahead of the playhead.
     * @returns true when the next chunk would start into silence.
     */
    private isIdle(): boolean {
        return this.nextStartTime <= this.context.currentTime;
    }

    /** Schedules everything held. */
    private release(): void {
        for (const buffer of this.held) {
            this.schedule(buffer);
        }
        this.held.length = 0;
        this.heldSeconds = 0;
    }

    /**
     * Schedules one buffer right after the last one, or just ahead of now when idle.
     * @param buffer decoded samples.
     */
    private schedule(buffer: AudioBuffer): void {
        const source: AudioBufferSourceNode = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.context.destination);
        const startAt: number = Math.max(this.nextStartTime, this.context.currentTime + START_LEAD_SECONDS);
        source.start(startAt);
        this.nextStartTime = startAt + buffer.duration;
        this.playing.add(source);
        source.onended = (): void => { this.playing.delete(source); };
    }
}
