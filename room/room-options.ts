// What a room's address asks for. The lively host and tap-to-talk are on unless the address turns
// them off, and the faster reply model is only on when it asks. Only opening a room reads these.

/** The choices a room is opened with. */
export interface RoomOptions {
    lively: boolean;
    tapToTalk: boolean;
    fastReplies: boolean;
}

/**
 * Reads a room's options from its address.
 * @param query the address's query: ?lively=0 for the plain host, ?tap=0 or ?hold=1 for hold-to-talk only, ?fast=1 for the faster model.
 * @returns the options.
 */
export function roomOptions(query: URLSearchParams): RoomOptions {
    return {
        lively: query.get("lively") !== "0",
        tapToTalk: query.get("tap") !== "0" && query.get("hold") !== "1",
        fastReplies: query.get("fast") === "1",
    };
}
