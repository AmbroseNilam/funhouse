// AudioWorklet that plays the host's voice from one ring buffer on the audio thread, so
// chunks join sample-exactly with no clicks between them. From silence it waits for a small
// cushion (or the end of a line) before starting, and fades in over a few milliseconds; a
// cancel fades out instead of cutting mid-wave. Each underrun grows the cushion a little.

const CAPACITY = 24000 * 180;
const FADE_IN_SAMPLES = 120;
const FADE_OUT_SAMPLES = 600;
const START_CUSHION = 2880;
const CUSHION_STEP = 1440;
const MAX_CUSHION = 9600;

class HostSpeakerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.ring = new Float32Array(CAPACITY);
        this.readIndex = 0;
        this.writeIndex = 0;
        this.buffered = 0;
        this.playing = false;
        this.flushRequested = false;
        this.cushion = START_CUSHION;
        this.fadeIn = 0;
        this.fadeOut = -1;
        this.port.onmessage = (event) => { this.onMessage(event.data); };
    }

    onMessage(message) {
        if (message.type === "push") {
            this.write(message.samples);
            return;
        }
        if (message.type === "flush") {
            this.flushRequested = true;
            return;
        }
        if (message.type === "cancel" && this.playing === true) {
            this.fadeOut = FADE_OUT_SAMPLES;
            return;
        }
        if (message.type === "cancel") {
            this.clear();
        }
    }

    write(samples) {
        for (let index = 0; index < samples.length; index += 1) {
            if (this.buffered === CAPACITY) {
                return;
            }
            this.ring[this.writeIndex] = samples[index];
            this.writeIndex = (this.writeIndex + 1) % CAPACITY;
            this.buffered += 1;
        }
    }

    clear() {
        this.readIndex = this.writeIndex;
        this.buffered = 0;
        this.playing = false;
        this.flushRequested = false;
        this.fadeOut = -1;
    }

    process(_inputs, outputs) {
        const output = outputs[0][0];
        if (this.playing === false && (this.buffered >= this.cushion || (this.flushRequested === true && this.buffered > 0))) {
            this.playing = true;
            this.fadeIn = 0;
        }
        for (let index = 0; index < output.length; index += 1) {
            if (this.playing === false || this.buffered === 0) {
                output[index] = 0;
                continue;
            }
            let gain = this.fadeIn < FADE_IN_SAMPLES ? this.fadeIn / FADE_IN_SAMPLES : 1;
            this.fadeIn += 1;
            if (this.fadeOut >= 0) {
                gain *= this.fadeOut / FADE_OUT_SAMPLES;
                this.fadeOut -= 1;
            }
            output[index] = this.ring[this.readIndex] * gain;
            this.readIndex = (this.readIndex + 1) % CAPACITY;
            this.buffered -= 1;
            if (this.fadeOut === 0) {
                this.clear();
            }
        }
        if (this.playing === true && this.buffered === 0) {
            this.playing = false;
            if (this.flushRequested === false) {
                this.cushion = Math.min(MAX_CUSHION, this.cushion + CUSHION_STEP);
            }
            this.flushRequested = false;
        }
        return true;
    }
}

registerProcessor("host-speaker", HostSpeakerProcessor);
