// Measures how quickly Muse Voice Transcribe hears the end of a sentence through the real
// provider client. Speaks a test line with macOS `say`, streams it at real-time pace the way
// a phone would, follows it with two seconds of silence, and times the server's events.
// Usage: npm run probe:asr -- "text to say"

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { FRAME_BYTES, FRAME_MILLISECONDS, TranscribeSession } from "../providers/meta/transcribe.ts";

/** Default sentence, chosen to include a player name and a game term. */
const DEFAULT_TEXT: string = "Okay host, I think Nick is the werewolf. He has been way too quiet.";

/** Frames of silence sent after speech so endpointing has something to detect. */
const TRAILING_SILENCE_FRAMES: number = 25;

/** Where the synthesized WAV is written; ignored by Git. */
const WAV_PATH: string = "tools/out/asr-probe.wav";

/**
 * Formats milliseconds as seconds with two decimals.
 * @param milliseconds a duration.
 * @returns a short human-readable string.
 */
function formatSeconds(milliseconds: number): string {
    return `${(milliseconds / 1000).toFixed(2)} s`;
}

/**
 * Extracts the raw PCM data chunk from a RIFF WAV file.
 * @param file the whole WAV file.
 * @returns the PCM bytes.
 * @throws Error when the file has no data chunk.
 */
function extractPcm(file: Buffer): Buffer {
    let offset: number = 12;
    while (offset < file.length) {
        const chunkId: string = file.toString("ascii", offset, offset + 4);
        const chunkSize: number = file.readUInt32LE(offset + 4);
        if (chunkId === "data") {
            return file.subarray(offset + 8, offset + 8 + chunkSize);
        }
        offset += 8 + chunkSize + (chunkSize % 2);
    }
    throw new Error("No audio data chunk in the WAV file.");
}

/**
 * Runs the probe end to end and prints timings.
 */
async function main(): Promise<void> {
    const text: string = process.argv[2] ?? DEFAULT_TEXT;
    mkdirSync("tools/out", { recursive: true });
    execFileSync("say", ["-o", WAV_PATH, "--file-format=WAVE", "--data-format=LEI16@24000", text]);
    const pcm: Buffer = extractPcm(readFileSync(WAV_PATH));
    const speechFrames: number = Math.ceil(pcm.length / FRAME_BYTES);
    const silence: Uint8Array = new Uint8Array(FRAME_BYTES);

    const startedAt: number = performance.now();
    let speechEndedAt: number = 0;
    let firstPartialAt: number = 0;
    const log: string[] = [];
    const note = (label: string, detail: string): void => {
        log.push(`${formatSeconds(performance.now() - startedAt).padStart(8)}  ${label}  ${detail}`);
    };

    await new Promise<void>((resolve, reject) => {
        const session: TranscribeSession = new TranscribeSession({ mode: "ENDPOINTING", keywords: ["Nick", "werewolf", "host"] }, {
            onSpeechStart: (turnId: string): void => { note("speechStart", turnId); },
            onTranscript: (partial: string, isFinal: boolean): void => {
                if (firstPartialAt === 0) {
                    firstPartialAt = performance.now();
                }
                note(isFinal === true ? "final" : "partial", partial.slice(0, 100));
            },
            onSpeechEnd: (turnId: string): void => { note("speechEnd", turnId); },
            onSpeechComplete: (_turnId: string, transcript: string): void => {
                const completedAt: number = performance.now();
                note("speechComplete", transcript);
                console.log(log.join("\n"));
                console.log(`\naudio length            ${formatSeconds(speechFrames * FRAME_MILLISECONDS)}`);
                console.log(`first partial           ${formatSeconds(firstPartialAt - startedAt)} after the first frame`);
                console.log(`turn complete           ${formatSeconds(completedAt - speechEndedAt)} after the last spoken frame`);
                console.log(`transcript              ${transcript}`);
                session.abort();
                resolve();
            },
            onError: (message: string): void => { reject(new Error(message)); },
            onClose: (code: number, reason: string): void => {
                if (log.some((line) => line.includes("speechComplete")) === false) {
                    reject(new Error(`closed ${code} ${reason} before speechComplete\n${log.join("\n")}`));
                }
            },
        });

        session.open().then((sessionId: string) => {
            note("ack", sessionId);
            let index: number = 0;
            const pacingStart: number = performance.now();
            const tick = (): void => {
                if (index < speechFrames) {
                    session.sendFrame(new Uint8Array(pcm.subarray(index * FRAME_BYTES, (index + 1) * FRAME_BYTES)));
                    if (index === speechFrames - 1) {
                        speechEndedAt = performance.now();
                    }
                }
                if (index >= speechFrames && index < speechFrames + TRAILING_SILENCE_FRAMES) {
                    session.sendFrame(silence);
                }
                if (index >= speechFrames + TRAILING_SILENCE_FRAMES) {
                    session.end();
                    return;
                }
                index += 1;
                // Pace against the wall clock so the stream never runs ahead of real time.
                setTimeout(tick, Math.max(0, pacingStart + index * FRAME_MILLISECONDS - performance.now()));
            };
            tick();
        }).catch(reject);
    });
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
