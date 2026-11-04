// The console's small sounds, made rather than sampled, on their own 48 kHz context so they keep
// their top end; host speech runs at 24 kHz. They duck when the host talks, and the voice stays
// on top. Quiet by design: you should miss them when they're gone, not notice them when they're there.

/** Loudness of everything here, well under the voice. */
const MASTER_GAIN: number = 0.18;

/** How far sounds duck while the host talks: about 9 dB. */
const DUCKED_GAIN: number = 0.36;

/** Time constants for ducking, in seconds: quick down, slow up. */
const DUCK_DOWN_SECONDS: number = 0.04;
const DUCK_UP_SECONDS: number = 0.27;

/** Fewest milliseconds between ticks. */
const TICK_GAP_MILLISECONDS: number = 70;

/** Where a tick's noise is centred. */
const TICK_CENTRE_HERTZ: number = 1800;

/** How long a tick lasts. */
const TICK_SECONDS: number = 0.025;

/** Where the drumroll's noise is centred. */
const DRUM_CENTRE_HERTZ: number = 260;

/** How long one drum tap rings. */
const DRUM_TAP_SECONDS: number = 0.05;

/** The gap between taps at the start of a drumroll. */
const DRUM_SLOWEST_GAP_SECONDS: number = 0.14;

/** The gap between taps at the end of a drumroll. */
const DRUM_FASTEST_GAP_SECONDS: number = 0.045;

/** Plays the console's sounds on one screen. */
export class ConsoleSounds {
    private readonly context: AudioContext = new AudioContext({ sampleRate: 48000 });
    private readonly master: GainNode = this.context.createGain();
    private lastTickAt: number = 0;
    private readonly noise: AudioBuffer = this.context.createBuffer(1, 2400, 48000);

    /** Connects everything; call from the click that turned sound on. */
    public constructor() {
        this.master.gain.value = MASTER_GAIN;
        const samples: Float32Array = this.noise.getChannelData(0);
        for (let index = 0; index < samples.length; index += 1) {
            samples[index] = Math.random() * 2 - 1;
        }
        this.master.connect(this.context.destination);
    }

    /** Wakes audio up; call from a click. */
    public async start(): Promise<void> {
        await this.context.resume();
    }

    /**
     * Ducks under the host's voice, or comes back up.
     * @param speaking true while the host talks.
     */
    public duck(speaking: boolean): void {
        const level: number = speaking === true ? MASTER_GAIN * DUCKED_GAIN : MASTER_GAIN;
        this.master.gain.setTargetAtTime(level, this.context.currentTime, speaking === true ? DUCK_DOWN_SECONDS : DUCK_UP_SECONDS);
    }

    /**
     * A small wooden tick as the highlight moves: a burst of filtered noise, brighter further along.
     * @param position which item it landed on.
     */
    public tick(position: number): void {
        const now: number = performance.now();
        if (now - this.lastTickAt < TICK_GAP_MILLISECONDS) {
            return;
        }
        this.lastTickAt = now;
        const start: number = this.context.currentTime;
        const noise: AudioBufferSourceNode = this.context.createBufferSource();
        noise.buffer = this.noise;
        const filter: BiquadFilterNode = this.context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = TICK_CENTRE_HERTZ * (1 + Math.min(position, 6) * 0.06) * (1 + (Math.random() - 0.5) * 0.06);
        filter.Q.value = 6;
        const gain: GainNode = this.context.createGain();
        gain.gain.setValueAtTime(1.6, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + TICK_SECONDS);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        noise.start(start);
        noise.stop(start + TICK_SECONDS);
    }

    /** A wooden thunk and a rising two-note choice. */
    public select(): void {
        this.tone(170, 90, 0.08, 1, "sine");
        this.tone(523, 540, 0.07, 0.8, "triangle");
        this.tone(784, 800, 0.11, 0.7, "triangle", 0.05);
    }

    /** The same notes falling, for going back. */
    public back(): void {
        this.tone(659, 640, 0.06, 0.6, "triangle");
        this.tone(494, 480, 0.09, 0.5, "triangle", 0.04);
    }

    /** A soft low thud at the end of a shelf. */
    public edge(): void {
        this.tone(130, 80, 0.09, 1, "sine");
    }

    /** Someone pulled up a chair. */
    public sitDown(): void {
        this.tone(220, 180, 0.09, 0.8, "sine");
        this.tone(440, 450, 0.1, 0.5, "triangle", 0.07);
    }

    /** A small rising fanfare. */
    public win(): void {
        [523, 659, 784, 1047].forEach((note: number, index: number) => { this.tone(note, note, 0.22, 0.8, "triangle", index * 0.11); });
    }

    /** A small falling shrug. */
    public lose(): void {
        [392, 330, 262].forEach((note: number, index: number) => { this.tone(note, note * 0.97, 0.26, 0.7, "triangle", index * 0.14); });
    }

    /**
     * A soft roll of low noise taps, closing up and swelling as it goes.
     * @param seconds how long it lasts.
     */
    public drumroll(seconds: number): void {
        const filter: BiquadFilterNode = this.context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = DRUM_CENTRE_HERTZ;
        filter.connect(this.master);
        const start: number = this.context.currentTime;
        let at: number = 0;
        while (at < seconds) {
            const progress: number = at / seconds;
            const source: AudioBufferSourceNode = this.context.createBufferSource();
            const gain: GainNode = this.context.createGain();
            source.buffer = this.noise;
            gain.gain.setValueAtTime(0.3 + progress * 0.7, start + at);
            gain.gain.exponentialRampToValueAtTime(0.001, start + at + DRUM_TAP_SECONDS);
            source.connect(gain).connect(filter);
            source.start(start + at, 0, DRUM_TAP_SECONDS);
            at += DRUM_SLOWEST_GAP_SECONDS - (DRUM_SLOWEST_GAP_SECONDS - DRUM_FASTEST_GAP_SECONDS) * progress;
        }
    }

    /** Time running short: one soft low note, easy to miss if you're already answering. */
    public hurry(): void {
        this.tone(330, 294, 0.3, 0.5, "sine");
    }

    /** The answer lighting up: two bright notes. */
    public reveal(): void {
        this.tone(784, 784, 0.16, 0.8, "triangle");
        this.tone(1175, 1175, 0.4, 0.8, "triangle", 0.12);
    }

        /** The match being struck when the lantern lights. */
    public light(): void {
        this.tone(330, 660, 0.25, 0.5, "sine");
        this.tone(990, 1320, 0.3, 0.25, "triangle", 0.08);
    }

    /**
     * Plays one short shaped tone.
     * @param from starting pitch in hertz.
     * @param to ending pitch in hertz.
     * @param seconds how long.
     * @param volume how loud, from 0 to 1.
     * @param wave the oscillator shape.
     * @param delay how long to wait first, in seconds.
     */
    private tone(from: number, to: number, seconds: number, volume: number, wave: OscillatorType, delay: number = 0): void {
        const start: number = this.context.currentTime + delay;
        const oscillator: OscillatorNode = this.context.createOscillator();
        const gain: GainNode = this.context.createGain();
        oscillator.type = wave;
        oscillator.frequency.setValueAtTime(from, start);
        oscillator.frequency.exponentialRampToValueAtTime(to, start + seconds);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(volume, start + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
        oscillator.connect(gain);
        gain.connect(this.master);
        oscillator.start(start);
        oscillator.stop(start + seconds + 0.02);
    }
}
