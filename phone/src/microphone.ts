// Owns the phone's microphone: asks for permission, runs the PCM worklet, and hands 80 ms
// frames to a callback. The page decides when frames are sent; this file only captures.
// iOS ends the track or suspends the audio context after a lock or a phone call, so the page
// asks whether a capture is still live before relying on it.

/** Samples the loudness reading looks at; about 40 ms at 48 kHz. */
const LEVEL_WINDOW_SAMPLES: number = 2048;

/** Scales raw loudness so ordinary speech fills most of the 0 to 1 range. */
const LEVEL_GAIN: number = 5;

/** A running capture that can be stopped. */
export interface MicrophoneCapture {
    /** True while the track is live and the audio context is running. */
    isLive(): boolean;
    /** How long since the microphone sent any real sound, in milliseconds. Noise suppression sends pure silence in a quiet room, so this alone doesn't mean it's broken. */
    silentFor(): number;
    /** Which of the browser's voice clean-ups are really on, as it reports them. */
    applied(): { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };
    /** How long this capture has been open, in milliseconds. */
    openFor(): number;
    /** How long since the microphone delivered any audio at all, in milliseconds. A long gap means it has stopped. */
    stalledFor(): number;
    /** How loud the microphone is right now, from 0 to about 1. */
    level(): number;
    /** Tries to wake a suspended audio context; call from a user gesture. */
    resume(): Promise<void>;
    stop(): void;
}

/**
 * Whether the browser says the microphone is already allowed, so opening it won't put up a prompt.
 * @returns true only when it's sure; browsers that can't say give false.
 */
export async function microphoneAllowed(): Promise<boolean> {
    try {
        const status: PermissionStatus = await navigator.permissions.query({ name: "microphone" });
        return status.state === "granted";
    } catch {
        return false;
    }
}

/**
 * Starts capturing and calls onFrame with each 24 kHz 16-bit mono PCM frame.
 * @param onFrame receives raw frame bytes.
 * @returns a handle to stop capture and release the microphone.
 */
export async function startMicrophone(onFrame: (frame: ArrayBuffer) => void): Promise<MicrophoneCapture> {
    const stream: MediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const context: AudioContext = new AudioContext();
    // A hold starts on a timer rather than a tap, which some browsers won't count as permission to run audio.
    context.resume().catch(() => { /* the next touch tries again */ });
    await context.audioWorklet.addModule("/phone/pcm-worklet.js");
    const source: MediaStreamAudioSourceNode = context.createMediaStreamSource(stream);
    const worklet: AudioWorkletNode = new AudioWorkletNode(context, "pcm-downsampler");
    let lastSoundAt: number = Date.now();
    let lastFrameAt: number = Date.now();
    const openedAt: number = Date.now();
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>): void => {
        lastFrameAt = Date.now();
        if (new Int16Array(event.data).some((sample: number) => sample !== 0) === true) {
            lastSoundAt = Date.now();
        }
        onFrame(event.data);
    };
    source.connect(worklet);
    const analyser: AnalyserNode = context.createAnalyser();
    analyser.fftSize = LEVEL_WINDOW_SAMPLES;
    source.connect(analyser);
    const window: Float32Array<ArrayBuffer> = new Float32Array(LEVEL_WINDOW_SAMPLES);
    return {
        isLive(): boolean {
            return stream.getAudioTracks().some((track: MediaStreamTrack) => track.readyState === "live" && track.muted === false) === true && context.state === "running";
        },
        silentFor(): number {
            return Date.now() - lastSoundAt;
        },
        applied(): { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean } {
            const settings: MediaTrackSettings = stream.getAudioTracks()[0]?.getSettings() ?? {};
            return { echoCancellation: settings.echoCancellation === true, noiseSuppression: settings.noiseSuppression === true, autoGainControl: settings.autoGainControl === true };
        },
        openFor(): number {
            return Date.now() - openedAt;
        },
        stalledFor(): number {
            return Date.now() - lastFrameAt;
        },
        level(): number {
            analyser.getFloatTimeDomainData(window);
            let sum: number = 0;
            for (const sample of window) {
                sum += sample * sample;
            }
            return Math.min(1, Math.sqrt(sum / window.length) * LEVEL_GAIN);
        },
        async resume(): Promise<void> {
            await context.resume();
        },
        stop(): void {
            worklet.disconnect();
            source.disconnect();
            for (const track of stream.getTracks()) {
                track.stop();
            }
            context.close().catch(() => { /* already closed */ });
        },
    };
}
