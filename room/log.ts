// Operational log lines for the room: one line per notable event, timestamped, to stderr so
// `podman logs` shows them. Player speech is logged as heard; this is a private server.

/**
 * Writes one log line.
 * @param scope where it came from, such as "room KPTR" or "host".
 * @param message what happened, plain words.
 */
export function log(scope: string, message: string): void {
    console.warn(`${new Date().toISOString()} [${scope}] ${message}`);
}
