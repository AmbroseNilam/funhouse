// AudioWorklet that turns the browser's float audio into 16-bit mono PCM at 24 kHz, the exact
// shape Muse Voice Transcribe wants, and posts 80 ms frames to the page. Runs on the audio
// thread, so it only resamples and packs; the page owns the socket. Each output sample is the
// average of the input samples it spans, a cheap low-pass that keeps high frequencies from
// folding into the speech band when 44.1 or 48 kHz is reduced to 24 kHz.

const TARGET_RATE = 24000;
const FRAME_SAMPLES = 1920; // 80 ms at 24 kHz

class PcmDownsampler extends AudioWorkletProcessor {
    constructor() {
        super();
        this.ratio = sampleRate / TARGET_RATE;
        this.position = 0;
        this.sum = 0;
        this.count = 0;
        this.pending = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
    }

    process(inputs) {
        const channel = inputs[0] && inputs[0][0];
        if (channel === undefined) {
            return true;
        }
        for (let index = 0; index < channel.length; index += 1) {
            this.sum += channel[index];
            this.count += 1;
            this.position += 1;
            if (this.position < this.ratio) {
                continue;
            }
            this.position -= this.ratio;
            const average = this.sum / this.count;
            this.sum = 0;
            this.count = 0;
            const clamped = Math.max(-1, Math.min(1, average));
            this.pending[this.filled] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
            this.filled += 1;
            if (this.filled === FRAME_SAMPLES) {
                this.port.postMessage(this.pending.buffer.slice(0));
                this.filled = 0;
            }
        }
        return true;
    }
}

registerProcessor("pcm-downsampler", PcmDownsampler);
