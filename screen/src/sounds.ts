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

/** A pentatonic scale, so any run of ticks sounds fine. */
const TICK_NOTES: number[] = [440, 494, 587, 659, 740, 880, 988, 1175];

/** Plays the console's sounds on one screen. */
export class ConsoleSounds {
    private readonly context: AudioContext = new AudioContext({ sampleRate: 48000 });
    private readonly master: GainNode = this.context.createGain();
    private lastTickAt: number = 0;

    /** Connects everything; call from the click that turned sound on. */
    public constructor() {
        this.master.gain.value = MASTER_GAIN;
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
     * A small wooden tick as the highlight moves, higher further along.
     * @param position which item it landed on.
     */
    public tick(position: number): void {
        const now: number = performance.now();
        if (now - this.lastTickAt < TICK_GAP_MILLISECONDS) {
            return;
        }
        this.lastTickAt = now;
        const note: number = TICK_NOTES[Math.min(position, TICK_NOTES.length - 1)] ?? 440;
        this.tone(note * (1 + (Math.random() - 0.5) * 0.04), note * 0.7, 0.03, 0.9, "triangle");
    }

    /** A rising two-note choice. */
    public select(): void {
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
