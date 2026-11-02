// The private stage: a name screen, then whatever the room tells this phone to show, plus the
// hold-to-talk button that streams microphone frames while held. The phone never decides
// game logic; it renders controls and reports input. It remembers its seat so a refresh, a
// locked screen or a network blip reconnects into the same seat without asking again.

import { useEffect, useReducer, useRef, type ReactElement } from "react";
import type { Control, PhoneView } from "../../shared/controls.ts";
import { parseMessage, type PhoneMessage, type RoomToPhoneMessage } from "../../shared/protocol.ts";
import { startMicrophone, type MicrophoneCapture } from "./microphone.ts";

/** What the phone remembers about its seat, across reloads. */
interface SavedSeat {
    playerId: string;
    resumeToken: string;
    name: string;
}

/** Storage key for the saved seat. */
const SEAT_KEY: string = "gameroom.seat";

/** Longest wait between reconnect attempts. */
const MAX_RECONNECT_DELAY_MILLISECONDS: number = 5000;

/**
 * Reads the saved seat, if storage allows and holds one.
 * @returns the seat or null.
 */
function readSeat(): SavedSeat | null {
    try {
        const raw: string | null = localStorage.getItem(SEAT_KEY);
        if (raw === null) {
            return null;
        }
        const parsed: Partial<SavedSeat> = JSON.parse(raw) as Partial<SavedSeat>;
        if (typeof parsed.playerId !== "string" || typeof parsed.resumeToken !== "string" || typeof parsed.name !== "string") {
            return null;
        }
        return { playerId: parsed.playerId, resumeToken: parsed.resumeToken, name: parsed.name };
    } catch {
        return null;
    }
}

/**
 * Saves the seat; a phone without storage just asks for its name again after a reload.
 * @param seat the seat the room gave this phone.
 */
function writeSeat(seat: SavedSeat): void {
    try {
        localStorage.setItem(SEAT_KEY, JSON.stringify(seat));
    } catch {
        // Private browsing or blocked storage: reconnects within this page still work.
    }
}

/** Local phone state. */
interface PhoneState {
    stage: "name" | "joining" | "joined";
    connected: boolean;
    playerId: string;
    roomCode: string;
    view: PhoneView | null;
    holding: boolean;
    micError: string;
}

type PhoneAction =
    | { type: "message"; message: RoomToPhoneMessage }
    | { type: "holding"; holding: boolean }
    | { type: "micError"; error: string }
    | { type: "connection"; connected: boolean }
    | { type: "joining" };

const INITIAL_STATE: PhoneState = { stage: readSeat() === null ? "name" : "joining", connected: false, playerId: "", roomCode: new URLSearchParams(location.search).get("room") ?? "", view: null, holding: false, micError: "" };

/**
 * Pure reducer from room messages and local actions to phone state.
 * @param state current state.
 * @param action the change.
 * @returns next state.
 */
function reduce(state: PhoneState, action: PhoneAction): PhoneState {
    if (action.type === "holding") {
        return { ...state, holding: action.holding };
    }
    if (action.type === "micError") {
        return { ...state, micError: action.error };
    }
    if (action.type === "connection") {
        return { ...state, connected: action.connected };
    }
    if (action.type === "joining") {
        return { ...state, stage: "joining" };
    }
    const message: RoomToPhoneMessage = action.message;
    if (message.type === "welcome") {
        return { ...state, stage: "joined", playerId: message.playerId, roomCode: message.roomCode };
    }
    if (message.type === "view") {
        return { ...state, view: message.view };
    }
    return state;
}

/**
 * Renders one control.
 * @param control the control.
 * @param index its index, sent back with input.
 * @param send sends a message to the room.
 * @returns the element.
 */
function renderControl(control: Control, index: number, send: (message: PhoneMessage) => void): ReactElement {
    if (control.type === "roleCard") {
        return <section key={index} className={`card ${control.secret === true ? "secret" : ""}`}><h2>{control.title}</h2><p>{control.body}</p></section>;
    }
    if (control.type === "buttons" || control.type === "choice") {
        return (
            <section key={index} className="buttons">
                {control.prompt !== undefined ? <p>{control.prompt}</p> : null}
                {control.options.map((option) => <button key={option.id} disabled={option.disabled === true} onClick={() => { send({ type: "input", input: { value: option.id, controlIndex: index } }); }}>{option.label}</button>)}
            </section>
        );
    }
    if (control.type === "textInput") {
        return (
            <form key={index} className="text-input" onSubmit={(event) => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("value") as HTMLInputElement; send({ type: "input", input: { value: field.value.slice(0, control.maxLength), controlIndex: index } }); field.value = ""; }}>
                <label>{control.prompt}<input name="value" maxLength={control.maxLength} placeholder={control.placeholder ?? ""} autoComplete="off" /></label>
                <button type="submit">Send</button>
            </form>
        );
    }
    if (control.type === "notice") {
        return <p key={index} className={`notice ${control.tone}`}>{control.text}</p>;
    }
    return <p key={index} className="waiting">{control.text}</p>;
}

/** The phone application. */
export function App(): ReactElement {
    const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
    const socketRef = useRef<WebSocket | null>(null);
    const captureRef = useRef<MicrophoneCapture | null>(null);
    const holdingRef = useRef<boolean>(false);

    useEffect(() => {
        let stopped: boolean = false;
        let retryTimer: number = 0;
        let retryDelay: number = 500;

        /** Opens the socket and, once open, reclaims the saved seat if there is one. */
        const connect = (): void => {
            const protocol: string = location.protocol === "https:" ? "wss" : "ws";
            const socket: WebSocket = new WebSocket(`${protocol}://${location.host}/ws/phone`);
            socket.binaryType = "arraybuffer";
            socketRef.current = socket;
            socket.onopen = (): void => {
                retryDelay = 500;
                dispatch({ type: "connection", connected: true });
                const seat: SavedSeat | null = readSeat();
                if (seat !== null) {
                    socket.send(JSON.stringify({ type: "hello", name: seat.name, playerId: seat.playerId, resumeToken: seat.resumeToken } satisfies PhoneMessage));
                }
            };
            socket.onmessage = (event: MessageEvent<string>): void => {
                const message: RoomToPhoneMessage | null = parseMessage<RoomToPhoneMessage>(event.data);
                if (message === null) {
                    return;
                }
                if (message.type === "welcome") {
                    writeSeat({ playerId: message.playerId, resumeToken: message.resumeToken, name: message.name });
                }
                dispatch({ type: "message", message });
            };
            socket.onclose = (): void => {
                dispatch({ type: "connection", connected: false });
                if (stopped === true || socketRef.current !== socket) {
                    return;
                }
                retryTimer = window.setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, MAX_RECONNECT_DELAY_MILLISECONDS);
            };
        };

        /** Reconnects at once when the phone comes back to the foreground. */
        const onVisible = (): void => {
            if (document.visibilityState !== "visible" || socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) {
                return;
            }
            window.clearTimeout(retryTimer);
            retryDelay = 500;
            connect();
        };

        connect();
        document.addEventListener("visibilitychange", onVisible);
        return (): void => {
            stopped = true;
            window.clearTimeout(retryTimer);
            document.removeEventListener("visibilitychange", onVisible);
            socketRef.current?.close();
            captureRef.current?.stop();
        };
    }, []);

    const send = (message: PhoneMessage): void => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify(message));
        }
    };

    const ensureMicrophone = async (): Promise<void> => {
        if (captureRef.current !== null) {
            return;
        }
        try {
            captureRef.current = await startMicrophone((frame: ArrayBuffer) => {
                if (holdingRef.current === true && socketRef.current?.readyState === WebSocket.OPEN) {
                    socketRef.current.send(frame);
                }
            });
        } catch (error: unknown) {
            dispatch({ type: "micError", error: error instanceof Error ? error.message : "Microphone unavailable." });
        }
    };

    const setHolding = (holding: boolean): void => {
        holdingRef.current = holding;
        dispatch({ type: "holding", holding });
        send({ type: "holdToTalk", down: holding });
    };

    if (state.stage === "name") {
        return (
            <main className="phone name">
                <h1>Game Room</h1>
                <p>Room {state.roomCode || "?"}</p>
                <form onSubmit={(event) => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("name") as HTMLInputElement; void ensureMicrophone(); dispatch({ type: "joining" }); send({ type: "hello", name: field.value }); }}>
                    <input name="name" placeholder="Your name" maxLength={24} autoComplete="nickname" autoFocus required />
                    <button type="submit">Join</button>
                </form>
            </main>
        );
    }

    if (state.stage === "joining") {
        return (
            <main className="phone name">
                <h1>Game Room</h1>
                <p>{state.connected === true ? "Joining…" : "Connecting…"}</p>
            </main>
        );
    }

    const view: PhoneView | null = state.view;
    const canTalk: boolean = view?.listening === "holdToTalk" || view?.listening === "openFloor";
    return (
        <main className={`phone joined listening-${view?.listening ?? "muted"}`}>
            <header><strong>{view?.playerName ?? ""}</strong><span>Room {state.roomCode}</span></header>
            <section className="controls">{view?.controls.map((control, index) => renderControl(control, index, send))}</section>
            <p className="status">{state.connected === false ? "Reconnecting…" : state.micError !== "" ? state.micError : view?.status ?? ""}</p>
            <button
                className={`talk ${state.holding === true ? "holding" : ""}`}
                disabled={canTalk === false}
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); void ensureMicrophone(); setHolding(true); }}
                onPointerUp={() => { setHolding(false); }}
                onPointerCancel={() => { setHolding(false); }}
            >
                {state.holding === true ? "Listening…" : "Hold to talk"}
            </button>
        </main>
    );
}
