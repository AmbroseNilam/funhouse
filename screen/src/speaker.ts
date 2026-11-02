// Plays the host's voice. The room streams raw 24 kHz 16-bit mono PCM; this converts each
// chunk to floats and hands it to an AudioWorklet that plays from one ring buffer, which
// joins chunks without clicks, fades in from silence and fades out on a cut-in (see
// screen/public/speaker-worklet.js). Browsers only allow audio after a user gesture, so the
// screen starts the speaker from a click.

/** Sample rate of host speech. */
const SAMPLE_RATE: number = 24000;

/** Streams PCM chunks to the speakers in order. One instance per screen. */
export class HostSpeaker {
    private readonly context: AudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    private node: AudioWorkletNode | null = null;

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
        node.connect(this.context.destination);
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

    /** A line has been fully sent; play what is held even if the cushion is not full. */
    public lineEnded(): void {
        this.node?.port.postMessage({ type: "flush" });
    }

    /** Fades out and drops everything queued, because someone cut in. */
    public cancel(): void {
        this.node?.port.postMessage({ type: "cancel" });
    }
}
