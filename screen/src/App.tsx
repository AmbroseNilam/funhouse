// The public stage: connects to the room, keeps the latest scene, and renders it block by
// block. The screen is deliberately dumb; it draws what it is told and plays what it is sent.

import { useEffect, useReducer, type ReactElement } from "react";
import QRCode from "qrcode";
import type { Scene, SceneBlock } from "../../shared/scene.ts";
import { parseMessage, type RoomToScreenMessage } from "../../shared/protocol.ts";

/** Local state reduced from room messages. */
interface ScreenState {
    scene: Scene | null;
    joinUrl: string;
    roomCode: string;
    qrDataUrl: string;
    hostListening: boolean;
    hostSpeaking: boolean;
    connected: boolean;
}

/** Actions that change screen state. */
type ScreenAction =
    | { type: "message"; message: RoomToScreenMessage }
    | { type: "qr"; dataUrl: string }
    | { type: "connection"; connected: boolean };

const INITIAL_STATE: ScreenState = { scene: null, joinUrl: "", roomCode: "", qrDataUrl: "", hostListening: false, hostSpeaking: false, connected: false };

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
    if (action.type === "qr") {
        return { ...state, qrDataUrl: action.dataUrl };
    }
    const message: RoomToScreenMessage = action.message;
    if (message.type === "scene") {
        return { ...state, scene: message.scene, joinUrl: message.joinUrl, roomCode: message.roomCode };
    }
    if (message.type === "hostState") {
        return { ...state, hostListening: message.listening, hostSpeaking: message.speaking };
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

    useEffect(() => {
        const protocol: string = location.protocol === "https:" ? "wss" : "ws";
        const socket: WebSocket = new WebSocket(`${protocol}://${location.host}/ws/screen`);
        socket.onopen = (): void => { dispatch({ type: "connection", connected: true }); };
        socket.onclose = (): void => { dispatch({ type: "connection", connected: false }); };
        socket.onmessage = (event: MessageEvent<string>): void => {
            const message: RoomToScreenMessage | null = parseMessage<RoomToScreenMessage>(event.data);
            if (message === null) {
                return;
            }
            dispatch({ type: "message", message });
        };
        return (): void => { socket.close(); };
    }, []);

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
                <p className={`host ${state.hostListening === true ? "listening" : ""} ${state.hostSpeaking === true ? "speaking" : ""}`}>Host</p>
            </aside>
        </main>
    );
}
