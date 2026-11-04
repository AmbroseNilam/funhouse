// A seat for someone at the TV with a mouse and no phone. It is an ordinary phone connection on
// /ws/phone, so the room applies the same holder rules, rate limits and moderation as any phone,
// and the TV page gains no authority of its own. A click only ever says what a phone could say.

import { useCallback, useEffect, useRef, useState } from "react";
import { parseMessage, type PhoneMessage, type RoomToPhoneMessage } from "../../shared/protocol.ts";
import type { NavAction } from "../../shared/shell.ts";
import type { PhoneView } from "../../shared/controls.ts";

/** How long to wait before reconnecting a seat whose connection dropped. */
const RECONNECT_MILLISECONDS: number = 1500;

/** Close codes from this number up mean the room refused or replaced this seat, so retrying won't help. */
const FINAL_CLOSE_CODE: number = 4000;

/** What a remembered seat holds. */
interface RememberedSeat {
    playerId: string;
    resumeToken: string;
}

/** What the TV page can do with its seat. */
export interface TvSeat {
    /** The seat's view from the room, or null when nobody is seated at this TV. */
    view: PhoneView | null;
    /** The seat's name, or an empty string. */
    name: string;
    /** True when the room had no chair left. */
    full: boolean;
    /** Takes a seat if there isn't one. */
    sit: () => void;
    /** Sends a phone message, taking a seat first if needed. */
    send: (message: PhoneMessage) => void;
    /** Sends a navigation action, taking a seat first if needed. */
    nav: (action: NavAction) => void;
    /** Gives the seat up. */
    leave: () => void;
}

/**
 * The storage key for a room's seat. Per tab, so a second window is a second person.
 * @param roomCode the room.
 * @returns the key.
 */
function seatKey(roomCode: string): string {
    return `funhouse.tvSeat.${roomCode}`;
}

/**
 * Reads the seat this tab remembers for a room.
 * @param roomCode the room.
 * @returns the seat, or null.
 */
function rememberedSeat(roomCode: string): RememberedSeat | null {
    try {
        const raw: string | null = sessionStorage.getItem(seatKey(roomCode));
        return raw === null ? null : JSON.parse(raw) as RememberedSeat;
    } catch {
        return null;
    }
}

/**
 * Keeps a TV page's seat, if it has one, and comes back to it after a reload or a dropped connection.
 * @param roomCode the room, or an empty string until it's known.
 * @param enabled false on a console with no mouse, which never sits down.
 * @returns the seat's state and actions.
 */
export function useTvSeat(roomCode: string, enabled: boolean): TvSeat {
    const [view, setView] = useState<PhoneView | null>(null);
    const [name, setName] = useState<string>("");
    const [full, setFull] = useState<boolean>(false);
    const socketRef = useRef<WebSocket | null>(null);
    const wantedRef = useRef<boolean>(false);
    const waitingRef = useRef<PhoneMessage[]>([]);
    const seatedRef = useRef<boolean>(false);
    const retryRef = useRef<number>(0);
    const roomRef = useRef<string>(roomCode);
    roomRef.current = roomCode;

    const connect = useCallback((): void => {
        if (socketRef.current !== null || roomRef.current === "") {
            return;
        }
        const room: string = roomRef.current;
        const protocol: string = location.protocol === "https:" ? "wss" : "ws";
        const socket: WebSocket = new WebSocket(`${protocol}://${location.host}/ws/phone?room=${encodeURIComponent(room)}`);
        socketRef.current = socket;
        socket.onopen = (): void => {
            const seat: RememberedSeat | null = rememberedSeat(room);
            const hello: PhoneMessage = seat === null ? { type: "hello", name: "" } : { type: "hello", name: "", playerId: seat.playerId, resumeToken: seat.resumeToken };
            socket.send(JSON.stringify(hello));
        };
        socket.onmessage = (event: MessageEvent<string>): void => {
            const message: RoomToPhoneMessage | null = parseMessage<RoomToPhoneMessage>(event.data);
            if (message?.type === "welcome") {
                seatedRef.current = true;
                setName(message.name);
                setFull(false);
                try {
                    sessionStorage.setItem(seatKey(room), JSON.stringify({ playerId: message.playerId, resumeToken: message.resumeToken } satisfies RememberedSeat));
                } catch {
                    // A browser may refuse storage; the seat still works until a reload.
                }
                for (const waiting of waitingRef.current.splice(0)) {
                    socket.send(JSON.stringify(waiting));
                }
                return;
            }
            if (message?.type === "view") {
                setView(message.view);
                setName(message.view.playerName);
                return;
            }
            if (message?.type === "rejected") {
                wantedRef.current = false;
                waitingRef.current = [];
                setFull(message.reason === "roomFull");
            }
        };
        socket.onclose = (event: CloseEvent): void => {
            if (socketRef.current !== socket) {
                return;
            }
            socketRef.current = null;
            seatedRef.current = false;
            if (wantedRef.current === false || event.code >= FINAL_CLOSE_CODE) {
                wantedRef.current = false;
                setView(null);
                return;
            }
            retryRef.current = window.setTimeout(connect, RECONNECT_MILLISECONDS);
        };
    }, []);

    useEffect(() => {
        if (enabled === false || roomCode === "" || rememberedSeat(roomCode) === null) {
            return;
        }
        wantedRef.current = true;
        connect();
    }, [connect, enabled, roomCode]);

    useEffect(() => (): void => {
        wantedRef.current = false;
        window.clearTimeout(retryRef.current);
        socketRef.current?.close();
        socketRef.current = null;
    }, []);

    const sit = useCallback((): void => {
        if (enabled === false) {
            return;
        }
        wantedRef.current = true;
        connect();
    }, [connect, enabled]);

    const send = useCallback((message: PhoneMessage): void => {
        if (enabled === false) {
            return;
        }
        if (seatedRef.current === true && socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify(message));
            return;
        }
        waitingRef.current = [message];
        wantedRef.current = true;
        connect();
    }, [connect, enabled]);

    const nav = useCallback((action: NavAction): void => { send({ type: "nav", action }); }, [send]);

    const leave = useCallback((): void => {
        wantedRef.current = false;
        window.clearTimeout(retryRef.current);
        const socket: WebSocket | null = socketRef.current;
        socketRef.current = null;
        seatedRef.current = false;
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "leave" } satisfies PhoneMessage));
        }
        socket?.close();
        try {
            sessionStorage.removeItem(seatKey(roomRef.current));
        } catch {
            // Nothing was remembered, then.
        }
        setView(null);
        setName("");
    }, []);

    return { view, name, full, sit, send, nav, leave };
}
