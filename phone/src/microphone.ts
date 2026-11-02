// Owns the phone's microphone: asks for permission, runs the PCM worklet, and hands 80 ms
// frames to a callback. The page decides when frames are sent; this file only captures.

/** A running capture that can be stopped. */
export interface MicrophoneCapture {
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
