// Keeps the phone's screen on while the player is in a room, since a dark screen means a
// stopped microphone. The browser drops the lock whenever the page is hidden, so it is taken
// again on return. Safari can insist on a user gesture, so any touch retries too. Browsers
// without the API just keep their normal sleep timer.

/**
 * Holds a screen wake lock until the returned function is called.
 * @returns a function that releases the lock and stops retrying.
 */
export function keepScreenOn(): () => void {
    let lock: WakeLockSentinel | null = null;
    let stopped: boolean = false;

    /** Takes the lock when the page is visible and doesn't hold one. */
    const acquire = (): void => {
        if (lock !== null || stopped === true || document.visibilityState !== "visible" || "wakeLock" in navigator === false) {
            return;
        }
        navigator.wakeLock.request("screen").then((sentinel: WakeLockSentinel) => {
            lock = sentinel;
            sentinel.addEventListener("release", () => { lock = null; });
            if (stopped === true) {
                sentinel.release().catch(() => { /* already released */ });
            }
        }).catch(() => { /* refused, for example on low battery; the next touch tries again */ });
    };

    acquire();
    document.addEventListener("visibilitychange", acquire);
    document.addEventListener("pointerdown", acquire);
    return (): void => {
        stopped = true;
        document.removeEventListener("visibilitychange", acquire);
        document.removeEventListener("pointerdown", acquire);
        lock?.release().catch(() => { /* already released */ });
    };
}
