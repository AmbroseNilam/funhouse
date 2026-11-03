// Operational log lines for the room: one line per notable event, timestamped, to stderr so
// `podman logs` shows them. Logs say what happened and how long it took. They never hold what
// anyone said, what the host replied, or a player's name; use the player's id instead.

/**
 * Writes one log line.
 * @param scope where it came from, such as "room KPTR" or "host".
 * @param message what happened, plain words.
 */
export function log(scope: string, message: string): void {
    console.warn(`${new Date().toISOString()} [${scope}] ${message}`);
}
