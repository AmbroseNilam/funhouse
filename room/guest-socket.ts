// The stand-in for an AI guest's phone connection. The room sends a seat's messages to a socket and
// doesn't care what's on the other end, so a guest's "phone" is this: it opens the same messages a
// real phone gets and hands each view to the guest. The only thing that crosses is that seat's own
// PhoneView, which is what keeps a guest from knowing more than the phone in its hand.

import type { PhoneView } from "../shared/controls.ts";
import { parseMessage, type RoomToPhoneMessage } from "../shared/protocol.ts";

/** A guest's connection: what the room calls on a seat's socket. */
export class GuestSocket {
    /** Nothing ever queues, because nothing crosses a network. */
    public readonly bufferedAmount: number = 0;
    private readonly onView: (view: PhoneView) => void;

    /**
     * Creates a connection.
     * @param onView called with each view the room sends this seat.
     */
    public constructor(onView: (view: PhoneView) => void) {
        this.onView = onView;
    }

    /**
     * Takes a message the room would send a phone.
     * @param data the JSON text.
     */
    public send(data: string): void {
        const message: RoomToPhoneMessage | null = parseMessage<RoomToPhoneMessage>(data);
        if (message?.type === "view") {
            this.onView(message.view);
        }
    }

    /** There's nothing to close; the room removes a guest through its seat. */
    public close(): void {
        return;
    }

    /** There's nothing to end; the room removes a guest through its seat. */
    public terminate(): void {
        return;
    }
}
