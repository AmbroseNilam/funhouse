// The private stage: a name screen, then whatever the room tells this phone to show, plus the
// talk button. Holding it streams microphone frames until release; a quick tap keeps the
// microphone open until a second tap or a pause in speech. The phone never decides game logic; it renders controls and reports input. It remembers its seat so a refresh, a
// locked screen or a network blip reconnects into the same seat without asking again.

import { useEffect, useReducer, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { Control, PhoneView } from "../../shared/controls.ts";
import { parseMessage, type PhoneMessage, type RoomToPhoneMessage } from "../../shared/protocol.ts";
import { startMicrophone, type MicrophoneCapture } from "./microphone.ts";
import { keepScreenOn } from "./wakeLock.ts";

/** What the phone remembers about its seat, across reloads. */
interface SavedSeat {
    playerId: string;
    resumeToken: string;
    name: string;
    roomCode: string;
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
        if (typeof parsed.playerId !== "string" || typeof parsed.resumeToken !== "string" || typeof parsed.name !== "string" || typeof parsed.roomCode !== "string") {
            return null;
        }
        return { playerId: parsed.playerId, resumeToken: parsed.resumeToken, name: parsed.name, roomCode: parsed.roomCode };
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

/** Forgets the seat, so this phone joins as someone new next time. */
function clearSeat(): void {
    try {
        localStorage.removeItem(SEAT_KEY);
    } catch {
        // Blocked storage never held a seat to begin with.
    }
}

/** How often the talk button follows the microphone's loudness. */
const LEVEL_INTERVAL_MILLISECONDS: number = 50;

/** A press shorter than this is a tap, which locks the microphone open. */
const TAP_MILLISECONDS: number = 250;

/** Loudness that counts as someone speaking while locked. */
const SPEECH_LEVEL: number = 0.1;

/** How long a pause in speech ends a locked turn. */
const LOCK_SILENCE_MILLISECONDS: number = 1500;

/** How long a locked microphone waits for the first word before giving up. */
const LOCK_NO_SPEECH_MILLISECONDS: number = 6000;

/** The longest a locked turn may run, in case the room is too loud to ever fall silent. */
const LOCK_LIMIT_MILLISECONDS: number = 30000;

/** How long the tick shows after letting go. */
const SENT_TICK_MILLISECONDS: number = 900;

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

/** The room this page is for: the one in the link, or else the one this phone last sat in. */
const ROOM_CODE: string = (new URLSearchParams(location.search).get("room") ?? readSeat()?.roomCode ?? "").toUpperCase();

/**
 * The saved seat, if it belongs to this page's room.
 * @returns the seat or null.
 */
function seatInThisRoom(): SavedSeat | null {
    const seat: SavedSeat | null = readSeat();
    return seat?.roomCode === ROOM_CODE ? seat : null;
}

const INITIAL_STATE: PhoneState = { stage: seatInThisRoom() === null ? "name" : "joining", connected: false, playerId: "", roomCode: ROOM_CODE, view: null, holding: false, micError: "" };

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
    const startingMicrophoneRef = useRef<Promise<void> | null>(null);
    const pendingNameRef = useRef<string | null>(null);
    const holdingRef = useRef<boolean>(false);
    const talkRef = useRef<HTMLButtonElement | null>(null);
    const pressedAtRef = useRef<number>(0);
    const swallowReleaseRef = useRef<boolean>(false);
    const [locked, setLocked] = useState<boolean>(false);
    const [sent, setSent] = useState<boolean>(false);
    const [menu, setMenu] = useState<"closed" | "open" | "rename" | "leave">("closed");

    useEffect(() => {
        if (ROOM_CODE === "") {
            location.replace("/");
            return;
        }
        let stopped: boolean = false;
        let retryTimer: number = 0;
        let retryDelay: number = 500;

        /** Opens the socket and, once open, reclaims the saved seat if there is one. */
        const connect = (): void => {
            const protocol: string = location.protocol === "https:" ? "wss" : "ws";
            const socket: WebSocket = new WebSocket(`${protocol}://${location.host}/ws/phone?room=${encodeURIComponent(ROOM_CODE)}`);
            socket.binaryType = "arraybuffer";
            socketRef.current = socket;
            socket.onopen = (): void => {
                retryDelay = 500;
                dispatch({ type: "connection", connected: true });
                const seat: SavedSeat | null = seatInThisRoom();
                if (seat !== null) {
                    socket.send(JSON.stringify({ type: "hello", name: seat.name, playerId: seat.playerId, resumeToken: seat.resumeToken } satisfies PhoneMessage));
                    return;
                }
                if (pendingNameRef.current !== null) {
                    socket.send(JSON.stringify({ type: "hello", name: pendingNameRef.current } satisfies PhoneMessage));
                }
            };
            socket.onmessage = (event: MessageEvent<string>): void => {
                const message: RoomToPhoneMessage | null = parseMessage<RoomToPhoneMessage>(event.data);
                if (message === null) {
                    return;
                }
                if (message.type === "rejected") {
                    stopped = true;
                    clearSeat();
                    location.assign(`/?${message.reason === "roomFull" ? "full" : "missing"}=${encodeURIComponent(ROOM_CODE)}`);
                    return;
                }
                if (message.type === "welcome") {
                    pendingNameRef.current = null;
                    writeSeat({ playerId: message.playerId, resumeToken: message.resumeToken, name: message.name, roomCode: message.roomCode });
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

    const joined: boolean = state.stage === "joined";
    useEffect(() => {
        if (joined === false) {
            return;
        }
        return keepScreenOn();
    }, [joined]);

    useEffect(() => {
        if (state.holding === false) {
            return;
        }
        const startedAt: number = Date.now();
        let lastSpeechAt: number = 0;
        const timer: number = window.setInterval(() => {
            const level: number = captureRef.current?.level() ?? 0;
            talkRef.current?.style.setProperty("--level", level.toFixed(3));
            if (locked === false) {
                return;
            }
            const now: number = Date.now();
            if (level >= SPEECH_LEVEL) {
                lastSpeechAt = now;
            }
            const paused: boolean = lastSpeechAt !== 0 && now - lastSpeechAt >= LOCK_SILENCE_MILLISECONDS;
            const neverSpoke: boolean = lastSpeechAt === 0 && now - startedAt >= LOCK_NO_SPEECH_MILLISECONDS;
            if (paused === true || neverSpoke === true || now - startedAt >= LOCK_LIMIT_MILLISECONDS) {
                stopTalking();
            }
        }, LEVEL_INTERVAL_MILLISECONDS);
        /** Stops a turn when the phone is put away, since hidden pages lose the microphone. */
        const onHidden = (): void => {
            if (document.visibilityState === "hidden") {
                stopTalking();
            }
        };
        document.addEventListener("visibilitychange", onHidden);
        return (): void => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onHidden);
            talkRef.current?.style.setProperty("--level", "0");
        };
    }, [state.holding, locked]);

    useEffect(() => {
        if (sent === false) {
            return;
        }
        const timer: number = window.setTimeout(() => { setSent(false); }, SENT_TICK_MILLISECONDS);
        return (): void => { window.clearTimeout(timer); };
    }, [sent]);

    const send = (message: PhoneMessage): void => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify(message));
        }
    };

    /** Makes sure a live capture exists. Only one start runs at a time; a second would double the audio. */
    const startMicrophoneOnce = async (): Promise<void> => {
        const existing: MicrophoneCapture | null = captureRef.current;
        if (existing !== null && existing.isLive() === false) {
            await existing.resume().catch(() => undefined);
        }
        if (existing !== null && existing.isLive() === true) {
            return;
        }
        existing?.stop();
        captureRef.current = null;
        try {
            captureRef.current = await startMicrophone((frame: ArrayBuffer) => {
                if (holdingRef.current === true && socketRef.current?.readyState === WebSocket.OPEN) {
                    socketRef.current.send(frame);
                }
            });
        } catch (error: unknown) {
            dispatch({ type: "micError", error: error instanceof DOMException && error.name === "NotAllowedError" ? "Allow the microphone in your browser to talk." : "Couldn't start the microphone." });
        }
    };

    const ensureMicrophone = async (): Promise<void> => {
        if (startingMicrophoneRef.current !== null) {
            await startingMicrophoneRef.current;
            return;
        }
        const starting: Promise<void> = startMicrophoneOnce();
        startingMicrophoneRef.current = starting;
        await starting;
        startingMicrophoneRef.current = null;
    };

    const setHolding = (holding: boolean): void => {
        if (holding === false && holdingRef.current === true) {
            setSent(true);
        }
        if (holding === true) {
            setSent(false);
        }
        holdingRef.current = holding;
        dispatch({ type: "holding", holding });
        send({ type: "holdToTalk", down: holding });
    };

    const stopTalking = (): void => {
        setLocked(false);
        setHolding(false);
    };

    const onTalkDown = (): void => {
        void ensureMicrophone();
        if (locked === true) {
            swallowReleaseRef.current = true;
            stopTalking();
            return;
        }
        pressedAtRef.current = Date.now();
        setHolding(true);
    };

    const onTalkUp = (): void => {
        if (swallowReleaseRef.current === true) {
            swallowReleaseRef.current = false;
            return;
        }
        if (holdingRef.current === false) {
            return;
        }
        if (Date.now() - pressedAtRef.current < TAP_MILLISECONDS) {
            setLocked(true);
            return;
        }
        stopTalking();
    };

    if (state.stage === "name") {
        return (
            <main className="phone name">
                <h1>Game Room</h1>
                <p>Room {state.roomCode || "?"}</p>
                <form onSubmit={(event) => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("name") as HTMLInputElement; pendingNameRef.current = field.value; void ensureMicrophone(); dispatch({ type: "joining" }); send({ type: "hello", name: field.value }); }}>
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

    const leave = (): void => {
        send({ type: "leave" });
        clearSeat();
        location.assign("/");
    };

    const rename = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem("name") as HTMLInputElement;
        send({ type: "rename", name: field.value });
        setMenu("closed");
    };

    const view: PhoneView | null = state.view;
    const canTalk: boolean = view?.listening === "holdToTalk" || view?.listening === "openFloor";
    if (canTalk === false && state.holding === true) {
        stopTalking();
    }
    return (
        <main className={`phone joined listening-${view?.listening ?? "muted"}`}>
            <header className="top-bar">
                <strong>{view?.playerName ?? ""}</strong>
                <span>Room {state.roomCode}</span>
                <button className="menu-button" aria-label="Menu" aria-expanded={menu !== "closed"} onClick={() => { setMenu("open"); }}>⋯</button>
            </header>
            <section className="controls">{view?.controls.map((control, index) => renderControl(control, index, send))}</section>
            <button
                ref={talkRef}
                className={`talk ${state.holding === true ? "holding" : ""} ${sent === true ? "sent" : ""}`}
                disabled={canTalk === false}
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onTalkDown(); }}
                onPointerUp={onTalkUp}
                onPointerCancel={() => { swallowReleaseRef.current = false; stopTalking(); }}
                onContextMenu={(event) => { event.preventDefault(); }}
            >
                {state.holding === true ? "Listening" : sent === true ? "✓" : "Hold to talk"}
            </button>
            <p className="status" role="status">{state.connected === false ? "Reconnecting…" : state.micError !== "" ? state.micError : locked === true ? "Tap to stop, or just stop talking." : state.holding === true ? "Let go when you're done." : view?.status ?? ""}</p>
            {menu === "closed" ? null : (
                <div className="sheet-backdrop" onClick={(event) => { if (event.target === event.currentTarget) { setMenu("closed"); } }}>
                    <div className="sheet" role="dialog" aria-modal="true" aria-label="Menu">
                        {menu === "open" ? (
                            <>
                                <button onClick={() => { setMenu("rename"); }}>Change name</button>
                                <button onClick={() => { setMenu("leave"); }}>Leave room</button>
                                <button className="quiet" onClick={() => { setMenu("closed"); }}>Close</button>
                            </>
                        ) : null}
                        {menu === "rename" ? (
                            <form onSubmit={rename}>
                                <label htmlFor="new-name">New name</label>
                                <input id="new-name" name="name" defaultValue={view?.playerName ?? ""} maxLength={24} autoComplete="nickname" autoFocus required />
                                <button type="submit" className="primary">Save</button>
                                <button type="button" className="quiet" onClick={() => { setMenu("closed"); }}>Cancel</button>
                            </form>
                        ) : null}
                        {menu === "leave" ? (
                            <>
                                <p>Leave room {state.roomCode}? You'll give up your seat.</p>
                                <button className="danger" onClick={leave}>Leave</button>
                                <button className="quiet" onClick={() => { setMenu("closed"); }}>Stay</button>
                            </>
                        ) : null}
                    </div>
                </div>
            )}
        </main>
    );
}
