// The public stage: connects to the room, keeps the latest scene, and renders it block by
// block. The screen is deliberately dumb; it draws what it is told and plays what it is sent.

import { useEffect, useReducer, useRef, useState, type ReactElement } from "react";
import QRCode from "qrcode";
import type { Scene, SceneBlock } from "../../shared/scene.ts";
import { parseMessage, type RoomToScreenMessage, type ScreenMessage } from "../../shared/protocol.ts";
import { Orb } from "./Orb.tsx";
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
    turnedAway: boolean;
}

/** Actions that change screen state. */
type ScreenAction =
    | { type: "message"; message: RoomToScreenMessage }
    | { type: "qr"; dataUrl: string }
    | { type: "connection"; connected: boolean }
    | { type: "started" }
    | { type: "turnedAway" };

/** Longest wait between reconnect attempts. */
const MAX_RECONNECT_DELAY_MILLISECONDS: number = 5000;

/** Widest short side a device can have and still count as a phone; tablets make fine screens. */
const PHONE_SHORT_SIDE_PIXELS: number = 600;

/** True on a touch device with a phone-sized display, in either orientation. */
const ON_PHONE: boolean = matchMedia("(pointer: coarse)").matches === true && Math.min(screen.width, screen.height) <= PHONE_SHORT_SIDE_PIXELS;

const INITIAL_STATE: ScreenState = { scene: null, joinUrl: "", roomCode: "", qrDataUrl: "", hostThinking: false, hostSpeaking: false, hostName: "Host", connected: false, started: false, turnedAway: false };

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
    if (action.type === "turnedAway") {
        return { ...state, turnedAway: true };
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
    const micRef = useRef<{ level: number; at: number }>({ level: 0, at: 0 });
    const [phoneGate, setPhoneGate] = useState<boolean>(ON_PHONE);

    useEffect(() => {
        if (phoneGate === true) {
            return;
        }
        let stopped: boolean = false;
        let retryTimer: number = 0;
        let retryDelay: number = 500;

        /** Opens the socket; on close, retries with backoff so a network blip heals itself. */
        const connect = (): void => {
            const protocol: string = location.protocol === "https:" ? "wss" : "ws";
            const socket: WebSocket = new WebSocket(`${protocol}://${location.host}/ws/screen${location.search}`);
            socket.binaryType = "arraybuffer";
            socketRef.current = socket;
            socket.onopen = (): void => {
                retryDelay = 500;
                dispatch({ type: "connection", connected: true });
            };
            socket.onclose = (): void => {
                dispatch({ type: "connection", connected: false });
                if (stopped === true || socketRef.current !== socket) {
                    return;
                }
                retryTimer = window.setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, MAX_RECONNECT_DELAY_MILLISECONDS);
            };
            socket.onmessage = (event: MessageEvent<string | ArrayBuffer>): void => {
                if (event.data instanceof ArrayBuffer) {
                    speakerRef.current?.play(event.data);
                    return;
                }
                const message: RoomToScreenMessage | null = parseMessage<RoomToScreenMessage>(event.data);
                if (message === null) {
                    return;
                }
                if (message.type === "rejected") {
                    stopped = true;
                    dispatch({ type: "turnedAway" });
                    return;
                }
                if (message.type === "scene" && new URLSearchParams(location.search).get("room") !== message.roomCode) {
                    history.replaceState(null, "", `?room=${message.roomCode}`);
                }
                if (message.type === "audioCancel") {
                    speakerRef.current?.cancel();
                    return;
                }
                if (message.type === "micLevel") {
                    micRef.current = { level: message.level, at: performance.now() };
                    return;
                }
                if (message.type === "audioEnd") {
                    speakerRef.current?.lineEnded();
                    return;
                }
                dispatch({ type: "message", message });
            };
        };

        connect();
        return (): void => {
            stopped = true;
            window.clearTimeout(retryTimer);
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [phoneGate]);

    /** Unlocks audio with the click browsers require, then tells the room the screen is live. */
    const start = (): void => {
        const speaker: HostSpeaker = new HostSpeaker();
        dispatch({ type: "started" });
        speaker.start().then(() => {
            speakerRef.current = speaker;
            const ready: ScreenMessage = { type: "ready" };
            socketRef.current?.send(JSON.stringify(ready));
        }).catch((error: unknown) => { console.error("audio start failed:", error); });
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

    if (phoneGate === true) {
        return (
            <main className="phone-gate">
                <h1>This is the big-screen view.</h1>
                <p>Join as a player instead?</p>
                <a className="phone-gate-join" href="/">Join as a player</a>
                <button className="phone-gate-continue" onClick={() => { setPhoneGate(false); }}>Continue anyway</button>
            </main>
        );
    }

    if (state.turnedAway === true) {
        return (
            <main className="phone-gate">
                <h1>Every room is in use.</h1>
                <p>Try again in a few minutes.</p>
            </main>
        );
    }

    const mood: string = state.scene?.mood ?? "neutral";
    return (
        <main className={`stage mood-${mood}`} data-connected={state.connected}>
            <section className="blocks">{state.scene?.blocks.map(renderBlock)}</section>
            <aside className="join">
                {state.qrDataUrl !== "" ? <img src={state.qrDataUrl} alt={`QR code to join room ${state.roomCode}`} /> : null}
                <p className="code">{state.roomCode}</p>
                <Orb micRef={micRef} speakerRef={speakerRef} thinking={state.hostThinking} speaking={state.hostSpeaking} />
                <p className="host">{state.hostName}</p>
            </aside>
            {state.started === false ? (
                <button className="sound-gate" disabled={state.connected === false} onClick={start}>
                    <span className="sound-gate-title">Tap anywhere to turn on sound</span>
                    <span className="sound-gate-detail">{state.connected === true ? `${state.hostName} hosts out loud, so the room needs sound.` : "Connecting…"}</span>
                </button>
            ) : null}
        </main>
    );
}
