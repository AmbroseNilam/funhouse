// The private stage: a name screen, then whatever the room tells this phone to show, plus the
// hold-to-talk button that streams microphone frames while held. The phone never decides
// game logic; it renders controls and reports input.

import { useEffect, useReducer, useRef, type ReactElement } from "react";
import type { Control, PhoneView } from "../../shared/controls.ts";
import { parseMessage, type PhoneMessage, type RoomToPhoneMessage } from "../../shared/protocol.ts";
import { startMicrophone, type MicrophoneCapture } from "./microphone.ts";

/** Local phone state. */
interface PhoneState {
    stage: "name" | "joined";
    playerId: string;
    roomCode: string;
    view: PhoneView | null;
    holding: boolean;
    micError: string;
}

type PhoneAction =
    | { type: "message"; message: RoomToPhoneMessage }
    | { type: "holding"; holding: boolean }
    | { type: "micError"; error: string };

const INITIAL_STATE: PhoneState = { stage: "name", playerId: "", roomCode: new URLSearchParams(location.search).get("room") ?? "", view: null, holding: false, micError: "" };

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
        const protocol: string = location.protocol === "https:" ? "wss" : "ws";
        const socket: WebSocket = new WebSocket(`${protocol}://${location.host}/ws/phone`);
        socket.binaryType = "arraybuffer";
        socket.onmessage = (event: MessageEvent<string>): void => {
            const message: RoomToPhoneMessage | null = parseMessage<RoomToPhoneMessage>(event.data);
            if (message === null) {
                return;
            }
            dispatch({ type: "message", message });
        };
        socketRef.current = socket;
        return (): void => { socket.close(); captureRef.current?.stop(); };
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
                <form onSubmit={(event) => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("name") as HTMLInputElement; void ensureMicrophone(); send({ type: "hello", name: field.value }); }}>
                    <input name="name" placeholder="Your name" maxLength={24} autoComplete="nickname" autoFocus required />
                    <button type="submit">Join</button>
                </form>
            </main>
        );
    }

    const view: PhoneView | null = state.view;
    const canTalk: boolean = view?.listening === "holdToTalk" || view?.listening === "openFloor";
    return (
        <main className={`phone joined listening-${view?.listening ?? "muted"}`}>
            <header><strong>{view?.playerName ?? ""}</strong><span>Room {state.roomCode}</span></header>
            <section className="controls">{view?.controls.map((control, index) => renderControl(control, index, send))}</section>
            <p className="status">{state.micError !== "" ? state.micError : view?.status ?? ""}</p>
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
