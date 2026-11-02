// Plays the host's voice. The room streams raw 24 kHz 16-bit mono PCM; this converts each
// chunk to floats and hands it to an AudioWorklet that plays from one ring buffer, which
// joins chunks without clicks, fades in from silence and fades out on a cut-in (see
// screen/public/speaker-worklet.js). Browsers only allow audio after a user gesture, so the
// screen starts the speaker from a click.

/** Sample rate of host speech. */
const SAMPLE_RATE: number = 24000;

/** Samples the loudness reading looks at; about 40 ms at this rate. */
const LEVEL_WINDOW_SAMPLES: number = 1024;

/** Scales raw loudness so ordinary speech fills most of the 0 to 1 range. */
const LEVEL_GAIN: number = 4;

/** Streams PCM chunks to the speakers in order. One instance per screen. */
export class HostSpeaker {
    private readonly context: AudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    private node: AudioWorkletNode | null = null;
    private readonly analyser: AnalyserNode = this.context.createAnalyser();
    private readonly levelWindow: Float32Array<ArrayBuffer> = new Float32Array(LEVEL_WINDOW_SAMPLES);

    /**
     * Resumes audio and loads the player; call from a click handler.
     * @throws Error when the browser cannot load the worklet.
     */
    public async start(): Promise<void> {
        await this.context.resume();
        if (this.context.sampleRate !== SAMPLE_RATE) {
            console.warn(`audio runs at ${this.context.sampleRate} Hz, not ${SAMPLE_RATE}; the host voice will play at the wrong pitch`);
        }
        await this.context.audioWorklet.addModule(new URL("speaker-worklet.js", document.baseURI).href);
        const node: AudioWorkletNode = new AudioWorkletNode(this.context, "host-speaker", { numberOfInputs: 0, outputChannelCount: [1] });
        this.analyser.fftSize = LEVEL_WINDOW_SAMPLES;
        node.connect(this.analyser);
        this.analyser.connect(this.context.destination);
        this.node = node;
    }

    /**
     * Queues one chunk of PCM.
     * @param chunk 16-bit little-endian samples; an even byte count.
     */
    public play(chunk: ArrayBuffer): void {
        const samples: Int16Array = new Int16Array(chunk);
        const floats: Float32Array = new Float32Array(samples.length);
        for (let index = 0; index < samples.length; index += 1) {
            floats[index] = (samples[index] ?? 0) / 32768;
        }
        this.node?.port.postMessage({ type: "push", samples: floats }, [floats.buffer]);
    }

    /**
     * How loud the host is right now, for the orb.
     * @returns loudness from 0 to about 1.
     */
    public level(): number {
        this.analyser.getFloatTimeDomainData(this.levelWindow);
        let sum: number = 0;
        for (const sample of this.levelWindow) {
            sum += sample * sample;
        }
        return Math.min(1, Math.sqrt(sum / this.levelWindow.length) * LEVEL_GAIN);
    }

    /** A line has been fully sent; play what is held even if the cushion is not full. */
    public lineEnded(): void {
        this.node?.port.postMessage({ type: "flush" });
    }

    /** Fades out and drops everything queued, because someone cut in. */
    public cancel(): void {
        this.node?.port.postMessage({ type: "cancel" });
    }
}
