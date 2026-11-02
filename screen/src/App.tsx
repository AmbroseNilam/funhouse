// The public stage: connects to the room, keeps the latest scene, and renders it block by
// block. The screen is deliberately dumb; it draws what it is told and plays what it is sent.

import { useEffect, useReducer, useRef, type ReactElement } from "react";
import QRCode from "qrcode";
import type { Scene, SceneBlock } from "../../shared/scene.ts";
import { parseMessage, type RoomToScreenMessage, type ScreenMessage } from "../../shared/protocol.ts";
import { HostSpeaker } from "./speaker.ts";

/** Local state reduced from room messages. */
interface ScreenState {
    scene: Scene | null;
    joinUrl: string;
    roomCode: string;
    qrDataUrl: string;
    hostThinking: boolean;
    hostSpeaking: boolean;
    hostName: string;
    connected: boolean;
    started: boolean;
}

/** Actions that change screen state. */
type ScreenAction =
    | { type: "message"; message: RoomToScreenMessage }
    | { type: "qr"; dataUrl: string }
    | { type: "connection"; connected: boolean }
    | { type: "started" };

const INITIAL_STATE: ScreenState = { scene: null, joinUrl: "", roomCode: "", qrDataUrl: "", hostThinking: false, hostSpeaking: false, hostName: "Host", connected: false, started: false };

/**
 * Pure reducer from room messages to screen state.
 * @param state the current state.
 * @param action the change.
 * @returns the next state.
 */
function reduce(state: ScreenState, action: ScreenAction): ScreenState {
    if (action.type === "connection") {
        return { ...state, connected: action.connected };
    }
    if (action.type === "started") {
        return { ...state, started: true };
    }
    if (action.type === "qr") {
        return { ...state, qrDataUrl: action.dataUrl };
    }
    const message: RoomToScreenMessage = action.message;
    if (message.type === "scene") {
        return { ...state, scene: message.scene, joinUrl: message.joinUrl, roomCode: message.roomCode };
    }
    if (message.type === "hostState") {
        return { ...state, hostThinking: message.thinking, hostSpeaking: message.speaking, hostName: message.hostName };
    }
    return state;
}

/**
 * Renders one scene block.
 * @param block the block.
 * @param index its position, used as the key.
 * @returns the element.
 */
function renderBlock(block: SceneBlock, index: number): ReactElement {
    if (block.type === "title") {
        return <header key={index} className="title">{block.kicker !== undefined ? <p className="kicker">{block.kicker}</p> : null}<h1>{block.text}</h1></header>;
    }
    if (block.type === "text") {
        return <p key={index} className={`text ${block.emphasis ?? "normal"}`}>{block.text}</p>;
    }
    if (block.type === "image") {
        return <figure key={index} className="image"><img src={block.src} alt={block.caption ?? ""} />{block.caption !== undefined ? <figcaption>{block.caption}</figcaption> : null}</figure>;
    }
    if (block.type === "roster") {
        return <ul key={index} className="roster">{block.players.map((player) => <li key={player.playerId} className={player.speaking === true ? "speaking" : ""}>{player.name}{player.badge !== undefined ? <span className="badge">{player.badge}</span> : null}</li>)}</ul>;
    }
    if (block.type === "timer") {
        return <div key={index} className="timer"><span>{block.seconds}</span>{block.label !== undefined ? <small>{block.label}</small> : null}</div>;
    }
    if (block.type === "tally") {
        return <table key={index} className="tally"><caption>{block.title}</caption><tbody>{block.rows.map((row) => <tr key={row.label} className={row.highlight === true ? "highlight" : ""}><td>{row.label}</td><td>{row.count}</td></tr>)}</tbody></table>;
    }
    return <p key={index} className={`caption ${block.final === true ? "final" : ""}`}><strong>{block.speaker}</strong> {block.text}</p>;
}

/** The screen application. */
export function App(): ReactElement {
    const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
    const socketRef = useRef<WebSocket | null>(null);
    const speakerRef = useRef<HostSpeaker | null>(null);

    useEffect(() => {
        const protocol: string = location.protocol === "https:" ? "wss" : "ws";
        const socket: WebSocket = new WebSocket(`${protocol}://${location.host}/ws/screen`);
        socket.binaryType = "arraybuffer";
        socketRef.current = socket;
        socket.onopen = (): void => { dispatch({ type: "connection", connected: true }); };
        socket.onclose = (): void => { dispatch({ type: "connection", connected: false }); };
        socket.onmessage = (event: MessageEvent<string | ArrayBuffer>): void => {
            if (event.data instanceof ArrayBuffer) {
                speakerRef.current?.play(event.data);
                return;
            }
            const message: RoomToScreenMessage | null = parseMessage<RoomToScreenMessage>(event.data);
            if (message === null) {
                return;
            }
            if (message.type === "audioCancel") {
                speakerRef.current?.cancel();
                return;
            }
            if (message.type === "audioEnd") {
                speakerRef.current?.lineEnded();
                return;
            }
            dispatch({ type: "message", message });
        };
        return (): void => {
            socket.close();
            socketRef.current = null;
        };
    }, []);

    /** Unlocks audio with the click browsers require, then tells the room the screen is live. */
    const start = (): void => {
        const speaker: HostSpeaker = new HostSpeaker();
        speakerRef.current = speaker;
        speaker.unlock().catch((error: unknown) => { console.error("audio unlock failed:", error); });
        const ready: ScreenMessage = { type: "ready" };
        socketRef.current?.send(JSON.stringify(ready));
        dispatch({ type: "started" });
    };

    useEffect(() => {
        if (state.joinUrl === "") {
            return;
        }
        let cancelled: boolean = false;
        QRCode.toDataURL(state.joinUrl, { margin: 1, width: 320 }).then((dataUrl: string) => {
            if (cancelled === false) {
                dispatch({ type: "qr", dataUrl });
            }
        }).catch((error: unknown) => { console.error("QR render failed:", error); });
        return (): void => { cancelled = true; };
    }, [state.joinUrl]);

    const mood: string = state.scene?.mood ?? "neutral";
    return (
        <main className={`stage mood-${mood}`} data-connected={state.connected}>
            <section className="blocks">{state.scene?.blocks.map(renderBlock)}</section>
            <aside className="join">
                {state.qrDataUrl !== "" ? <img src={state.qrDataUrl} alt={`QR code to join room ${state.roomCode}`} /> : null}
                <p className="code">{state.roomCode}</p>
                <p className={`host ${state.hostThinking === true ? "thinking" : ""} ${state.hostSpeaking === true ? "speaking" : ""}`}>{state.hostName}{state.hostThinking === true ? <span className="dots" aria-label="thinking" /> : null}</p>
            </aside>
            {state.started === false ? <button className="start" disabled={state.connected === false} onClick={start}>Open the room</button> : null}
        </main>
    );
}
