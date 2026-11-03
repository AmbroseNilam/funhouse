// Reads the join QR code off the TV with the phone's camera. Frames are looked at on the phone
// and go nowhere. Only a link to a room on this site counts; anything else in a code is ignored.

/** How wide a frame is scaled to before it is searched; the TV's code is large, and this stays quick on an old phone. */
const FRAME_WIDTH: number = 640;

/** How often a frame is searched. */
const SCAN_GAP_MILLISECONDS: number = 150;

/** What a room code looks like. */
const ROOM_CODE_PATTERN: RegExp = /^[A-Z]{4}$/;

/** The one call used from jsQR, whose published types don't match how it loads. */
type QrReader = (data: Uint8ClampedArray, width: number, height: number, options: { inversionAttempts: "dontInvert" }) => { data: string } | null;

/** What a scan can end in. */
export type ScanEnd = "refused" | "unavailable";

/**
 * Takes the room code out of a scanned link.
 * @param text what the QR code held.
 * @param origin the site's own origin.
 * @returns the room code, or null when it isn't a link to one of our rooms.
 */
export function roomFromScan(text: string, origin: string): string | null {
    if (URL.canParse(text) === false) {
        return null;
    }
    const url: URL = new URL(text);
    const room: string = url.searchParams.get("room") ?? "";
    if (url.origin !== origin || url.pathname !== "/phone/" || ROOM_CODE_PATTERN.test(room) === false) {
        return null;
    }
    return room;
}

/**
 * Looks for a room's QR code in the camera until one is found or the scan is stopped.
 * @param video shows the camera.
 * @param onRoom called once with the room code.
 * @param onNotOurs called when a code in view isn't one of ours.
 * @param onEnd called when the camera can't be used.
 * @returns stops the scan and turns the camera off.
 */
export function startScanning(video: HTMLVideoElement, onRoom: (room: string) => void, onNotOurs: () => void, onEnd: (end: ScanEnd) => void): () => void {
    let stopped: boolean = false;
    let timer: number = 0;
    let stream: MediaStream | null = null;
    const stop = (): void => {
        stopped = true;
        window.clearTimeout(timer);
        stream?.getTracks().forEach((track: MediaStreamTrack) => { track.stop(); });
        video.srcObject = null;
    };
    const run = async (): Promise<void> => {
        const jsQR = (await import("jsqr")).default as unknown as QrReader;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped === true) {
            stop();
            return;
        }
        video.srcObject = stream;
        await video.play();
        const canvas: HTMLCanvasElement = document.createElement("canvas");
        const context: CanvasRenderingContext2D | null = canvas.getContext("2d", { willReadFrequently: true });
        const look = (): void => {
            if (stopped === true || context === null) {
                return;
            }
            timer = window.setTimeout(look, SCAN_GAP_MILLISECONDS);
            if (video.videoWidth === 0) {
                return;
            }
            canvas.width = FRAME_WIDTH;
            canvas.height = Math.round((video.videoHeight / video.videoWidth) * FRAME_WIDTH);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame: ImageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
            if (found === null) {
                return;
            }
            const room: string | null = roomFromScan(found.data, location.origin);
            if (room === null) {
                onNotOurs();
                return;
            }
            stop();
            onRoom(room);
        };
        look();
    };
    run().catch((error: unknown) => {
        if (stopped === true) {
            return;
        }
        stop();
        onEnd(error instanceof DOMException && error.name === "NotAllowedError" ? "refused" : "unavailable");
    });
    return stop;
}
