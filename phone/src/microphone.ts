// Owns the phone's microphone: asks for permission, runs the PCM worklet, and hands 80 ms
// frames to a callback. The page decides when frames are sent; this file only captures.
// iOS ends the track or suspends the audio context after a lock or a phone call, so the page
// asks whether a capture is still live before relying on it.

/** A running capture that can be stopped. */
export interface MicrophoneCapture {
    /** True while the track is live and the audio context is running. */
    isLive(): boolean;
    /** Tries to wake a suspended audio context; call from a user gesture. */
    resume(): Promise<void>;
    stop(): void;
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
    await context.audioWorklet.addModule("/phone/pcm-worklet.js");
    const source: MediaStreamAudioSourceNode = context.createMediaStreamSource(stream);
    const worklet: AudioWorkletNode = new AudioWorkletNode(context, "pcm-downsampler");
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>): void => { onFrame(event.data); };
    source.connect(worklet);
    return {
        isLive(): boolean {
            return stream.getAudioTracks().some((track: MediaStreamTrack) => track.readyState === "live") === true && context.state === "running";
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
