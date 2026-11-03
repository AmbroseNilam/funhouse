// The phone: a name, then one full-screen surface that works as a controller without looking
// down. Slide moves the highlight on the TV, tap chooses, and press and hold talks. Anything
// private to this player appears above the surface. The phone never decides game logic. It
// remembers its seat, so a refresh, a locked screen or a network blip returns to the same seat.

import { useEffect, useReducer, useRef, useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import type { Control, PhoneView } from "../../shared/controls.ts";
import { parseMessage, SERVER_SILENCE_LIMIT_MILLISECONDS, type PhoneMessage, type RoomToPhoneMessage } from "../../shared/protocol.ts";
import { HOST_NAME, PRODUCT_NAME } from "../../shared/brand.ts";
import type { PadView } from "../../shared/shell.ts";
import { blockBrowserGestures, listenForGestures } from "./gestures.ts";
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

/** The seat as this page knows it, so a reconnect works even when storage is blocked. */
let seatInMemory: SavedSeat | null = null;

/**
 * Reads the saved seat, if this page or storage holds one.
 * @returns the seat or null.
 */
function readSeat(): SavedSeat | null {
    if (seatInMemory !== null) {
        return seatInMemory;
    }
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
    seatInMemory = seat;
    try {
        localStorage.setItem(SEAT_KEY, JSON.stringify(seat));
    } catch {
        // Private browsing or blocked storage: reconnects within this page still work.
    }
}

/** Forgets the seat, so this phone joins as someone new next time. */
function clearSeat(): void {
    seatInMemory = null;
    try {
        localStorage.removeItem(SEAT_KEY);
    } catch {
        // Blocked storage never held a seat to begin with.
    }
}

/** How often the talk button follows the microphone's loudness. */
const LEVEL_INTERVAL_MILLISECONDS: number = 50;

/** Frames of audio kept from before a hold, so first words survive: 320 ms. */
const PRE_ROLL_FRAMES: number = 4;

/** How long the microphone keeps sending after release, so last words survive. */
const TAIL_MILLISECONDS: number = 300;

/** A tiny buzz on each step, where the phone can; iPhones can't, and the TV carries the feedback. */
const STEP_BUZZ_MILLISECONDS: number = 6;

/** Fewest milliseconds between lean messages. */
const LEAN_INTERVAL_MILLISECONDS: number = 33;

/** Storage key for the gestures this phone has already learned. */
const LEARNED_KEY: string = "gameroom.learned";

/** How long the tick shows after letting go. */
const SENT_TICK_MILLISECONDS: number = 900;

/** Close code the room uses when this seat has been opened somewhere else. */
const RESUMED_ELSEWHERE_CODE: number = 4000;

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
 * Reads which gestures this phone has already learned.
 * @returns the gestures.
 */
function readLearned(): Set<string> {
    try {
        return new Set((localStorage.getItem(LEARNED_KEY) ?? "").split(",").filter((item: string) => item !== ""));
    } catch {
        return new Set();
    }
}

/**
 * Saves which gestures this phone has learned; without storage it teaches them again next time.
 * @param learned the gestures.
 */
function writeLearned(learned: Set<string>): void {
    try {
        localStorage.setItem(LEARNED_KEY, [...learned].join(","));
    } catch {
        // Blocked storage only means a repeated hint.
    }
}

/**
 * The one line the surface shows, teaching one gesture at a time until each has been done.
 * @param pad how the surface behaves.
 * @param learned the gestures already done.
 * @param waiting what the game says to wait for, if anything.
 * @returns the headline and a smaller line under it.
 */
function surfaceLine(pad: PadView, learned: Set<string>, waiting: string): { big: string; small: string } {
    if (pad.driving === true && pad.axis !== null && learned.has("slide") === false) {
        return { big: "Slide your thumb", small: "Watch the TV" };
    }
    if (pad.driving === true && pad.canSelect === true && learned.has("tap") === false) {
        return { big: "Tap to choose", small: "Anywhere on this screen" };
    }
    if (learned.has("hold") === false) {
        return { big: "Press and hold to talk", small: `${HOST_NAME} is listening` };
    }
    if (waiting !== "") {
        return { big: waiting, small: "" };
    }
    if (pad.driving === false && pad.axis !== null && pad.driverName !== "") {
        return { big: `${pad.driverName} has the controller`, small: "Slide to take over" };
    }
    return { big: "", small: "Press and hold to talk" };
}

/**
 * Renders one private control as a paper card. Waiting lines go on the surface instead.
 * @param control the control.
 * @param index its index, sent back with input.
 * @param send sends a message to the room.
 * @returns the element, or null.
 */
function renderControl(control: Control, index: number, send: (message: PhoneMessage) => void): ReactElement | null {
    if (control.type === "waiting") {
        return null;
    }
    if (control.type === "roleCard") {
        return <section key={index} className={`paper ${control.secret === true ? "secret" : ""}`}>{control.secret === true ? <small>Only you can see this</small> : null}<h2>{control.title}</h2><p>{control.body}</p></section>;
    }
    if (control.type === "buttons" || control.type === "choice") {
        return (
            <section key={index} className="paper choices">
                {control.prompt !== undefined ? <p className="prompt">{control.prompt}</p> : null}
                {control.options.map((option) => <button key={option.id} disabled={option.disabled === true} onClick={() => { send({ type: "input", input: { value: option.id, controlIndex: index } }); }}>{option.label}</button>)}
            </section>
        );
    }
    if (control.type === "textInput") {
        return (
            <form key={index} className="paper choices" onSubmit={(event) => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("value") as HTMLInputElement; send({ type: "input", input: { value: field.value.slice(0, control.maxLength), controlIndex: index } }); field.value = ""; }}>
                <label className="prompt">{control.prompt}<input name="value" maxLength={control.maxLength} placeholder={control.placeholder ?? ""} autoComplete="off" /></label>
                <button type="submit">Send</button>
            </form>
        );
    }
    return <p key={index} className={`paper note ${control.tone}`}>{control.text}</p>;
}

/** The phone application. */
export function App(): ReactElement {
    const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
    const socketRef = useRef<WebSocket | null>(null);
    const captureRef = useRef<MicrophoneCapture | null>(null);
    const startingMicrophoneRef = useRef<Promise<void> | null>(null);
    const pendingNameRef = useRef<string | null>(null);
    const holdingRef = useRef<boolean>(false);
    const preRollRef = useRef<ArrayBuffer[]>([]);
    const tailTimerRef = useRef<number>(0);
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const padRef = useRef<PadView | null>(null);
    const lastLeanAtRef = useRef<number>(0);
    const [learned, setLearned] = useState<Set<string>>(readLearned);
    const [movedAway, setMovedAway] = useState<boolean>(false);
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
        let silenceTimer: number = 0;

        /** Restarts the wait for the server; a dead network sends no close, so this notices it. */
        const heardFromServer = (socket: WebSocket): void => {
            window.clearTimeout(silenceTimer);
            silenceTimer = window.setTimeout(() => { socket.close(); }, SERVER_SILENCE_LIMIT_MILLISECONDS);
        };

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
            heardFromServer(socket);
            socket.onmessage = (event: MessageEvent<string>): void => {
                heardFromServer(socket);
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
            socket.onclose = (event: CloseEvent): void => {
                dispatch({ type: "connection", connected: false });
                window.clearTimeout(silenceTimer);
                if (stopped === true || socketRef.current !== socket) {
                    return;
                }
                holdingRef.current = false;
                dispatch({ type: "holding", holding: false });
                if (event.code === RESUMED_ELSEWHERE_CODE) {
                    stopped = true;
                    setMovedAway(true);
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
            window.clearTimeout(silenceTimer);
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
        const timer: number = window.setInterval(() => {
            surfaceRef.current?.style.setProperty("--level", (captureRef.current?.level() ?? 0).toFixed(3));
        }, LEVEL_INTERVAL_MILLISECONDS);
        return (): void => {
            window.clearInterval(timer);
            surfaceRef.current?.style.setProperty("--level", "0");
        };
    }, [state.holding]);

    useEffect(() => {
        if (sent === false) {
            return;
        }
        const timer: number = window.setTimeout(() => { setSent(false); }, SENT_TICK_MILLISECONDS);
        return (): void => { window.clearTimeout(timer); };
    }, [sent]);

    useEffect(() => blockBrowserGestures(), []);

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
                    return;
                }
                preRollRef.current.push(frame);
                if (preRollRef.current.length > PRE_ROLL_FRAMES) {
                    preRollRef.current.shift();
                }
            });
            dispatch({ type: "micError", error: "" });
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

    /** Records that a gesture has been done, which retires its hint. */
    const learn = (gesture: string): void => {
        setLearned((current: Set<string>) => {
            if (current.has(gesture) === true) {
                return current;
            }
            const next: Set<string> = new Set(current);
            next.add(gesture);
            writeLearned(next);
            return next;
        });
    };

    /** Starts talking: the room first, then the audio kept from just before the hold. */
    const startTalking = (): void => {
        window.clearTimeout(tailTimerRef.current);
        if (holdingRef.current === false) {
            send({ type: "holdToTalk", down: true });
            holdingRef.current = true;
            for (const frame of preRollRef.current.splice(0, preRollRef.current.length)) {
                if (socketRef.current?.readyState === WebSocket.OPEN) {
                    socketRef.current.send(frame);
                }
            }
        }
        dispatch({ type: "holding", holding: true });
        setSent(false);
        learn("hold");
    };

    /** Stops talking, keeping the microphone on a moment so the last word isn't cut. */
    const stopTalking = (): void => {
        dispatch({ type: "holding", holding: false });
        setSent(true);
        tailTimerRef.current = window.setTimeout(() => {
            holdingRef.current = false;
            send({ type: "holdToTalk", down: false });
        }, TAIL_MILLISECONDS);
    };

    const view: PhoneView | null = state.view;
    padRef.current = view?.pad ?? null;
    const canTalk: boolean = view?.listening === "holdToTalk" || view?.listening === "openFloor";
    const canTalkRef = useRef<boolean>(canTalk);
    canTalkRef.current = canTalk;
    useEffect(() => {
        if (canTalk === false && holdingRef.current === true) {
            stopTalking();
        }
        // Only a change in whether talking is allowed should end a turn.
    }, [canTalk]);

    const showingSurface: boolean = state.stage === "joined" && movedAway === false;
    useEffect(() => {
        const surface: HTMLDivElement | null = surfaceRef.current;
        if (showingSurface === false || surface === null) {
            return;
        }
        return listenForGestures(surface, {
            axis: () => padRef.current?.axis ?? null,
            touch: (x: number, y: number): void => {
                const box: DOMRect = surface.getBoundingClientRect();
                surface.style.setProperty("--thumb-x", `${x - box.left}px`);
                surface.style.setProperty("--thumb-y", `${y - box.top}px`);
                surface.classList.add("touched");
                void ensureMicrophone();
            },
            lifted: (): void => { surface.classList.remove("touched"); },
            step: (delta: number): void => {
                send({ type: "nav", action: { kind: "step", delta } });
                learn("slide");
                if ("vibrate" in navigator) {
                    navigator.vibrate(STEP_BUZZ_MILLISECONDS);
                }
            },
            lean: (x: number, y: number): void => {
                const now: number = Date.now();
                if (padRef.current?.driving === true && (now - lastLeanAtRef.current >= LEAN_INTERVAL_MILLISECONDS || (x === 0 && y === 0))) {
                    lastLeanAtRef.current = now;
                    send({ type: "lean", x, y });
                }
            },
            tap: (): void => {
                if (padRef.current?.canSelect === true) {
                    send({ type: "nav", action: { kind: "select" } });
                    learn("tap");
                }
            },
            holdStart: (): void => {
                if (canTalkRef.current === true) {
                    startTalking();
                }
            },
            holdEnd: (): void => {
                if (holdingRef.current === true) {
                    stopTalking();
                }
            },
        });
        // The surface reads everything it needs through refs, and only remounts with the screen.
    }, [showingSurface]);

    if (movedAway === true) {
        return (
            <main className="note-screen">
                <h1>You're playing somewhere else</h1>
                <p>This seat is open in another tab or window.</p>
                <button className="primary" onClick={() => { location.reload(); }}>Use this tab instead</button>
            </main>
        );
    }

    if (state.stage === "name") {
        return (
            <main className="note-screen" data-scrolls>
                <small className="room-tag">{PRODUCT_NAME} · Room {state.roomCode}</small>
                <h1>Who's sitting down?</h1>
                <form onSubmit={(event) => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("name") as HTMLInputElement; pendingNameRef.current = field.value; void ensureMicrophone(); dispatch({ type: "joining" }); send({ type: "hello", name: field.value }); }}>
                    <input name="name" placeholder="Your name" maxLength={24} autoComplete="nickname" autoFocus required aria-label="Your name" />
                    <button className="primary" type="submit">Sit down</button>
                </form>
                <p className="fine">Your browser will ask for the microphone. That's how {HOST_NAME} hears you.</p>
            </main>
        );
    }

    if (state.stage === "joining") {
        return (
            <main className="note-screen">
                <h1>{state.connected === true ? "Pulling up a chair…" : "Finding the room…"}</h1>
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

    const pad: PadView | null = view?.pad ?? null;
    const controls: Control[] = view?.controls ?? [];
    const waiting: string = controls.flatMap((control: Control) => (control.type === "waiting" ? [control.text] : [])).join(" ");
    const line: { big: string; small: string } = pad === null ? { big: "", small: "" } : surfaceLine(pad, learned, waiting);
    const privateControls: (ReactElement | null)[] = controls.map((control, index) => renderControl(control, index, send));
    const hasPrivate: boolean = privateControls.some((control) => control !== null);
    const problem: string = state.connected === false ? "Reconnecting…" : state.micError !== "" ? state.micError : "";
    const status: string = problem !== "" ? problem : view?.status ?? "";
    const seatStyle = { "--seat": pad?.colour ?? "#5a4a3a" } as CSSProperties;
    return (
        <main className={`pad-screen ${state.holding === true ? "talking" : ""}`} style={seatStyle}>
            <header className="corners">
                {pad?.backLabel !== null && pad?.backLabel !== undefined
                    ? <button className="corner" onClick={() => { send({ type: "nav", action: { kind: "back" } }); }}>{pad.backLabel}</button>
                    : <span className="corner-gap" />}
                <span className="who">{view?.playerName ?? ""}</span>
                <button className="corner" aria-label="Your menu" aria-expanded={menu !== "closed"} onClick={() => { setMenu("open"); }}>···</button>
            </header>
            {hasPrivate === true ? <section className="private" data-scrolls>{privateControls}</section> : null}
            <div className="surface" ref={surfaceRef}>
                <div className="level-fill" aria-hidden="true" />
                <div className="thumb" aria-hidden="true" />
                <div className="line" aria-live="polite">
                    {state.holding === true
                        ? <strong>Listening</strong>
                        : sent === true
                            ? <strong>Got it</strong>
                            : <><strong>{line.big}</strong>{line.small !== "" ? <small>{line.small}</small> : null}</>}
                </div>
                {status !== "" && state.holding === false ? <p className="status" role="status">{status}</p> : null}
            </div>
            {menu === "closed" ? null : (
                <div className="sheet-backdrop" onClick={(event) => { if (event.target === event.currentTarget) { setMenu("closed"); } }}>
                    <div className="sheet" role="dialog" aria-modal="true" aria-label="Your menu">
                        {menu === "open" ? (
                            <>
                                <button onClick={() => { setMenu("rename"); }}>Change your name</button>
                                <button onClick={() => { setMenu("leave"); }}>Leave the table</button>
                                <button className="quiet" onClick={() => { setMenu("closed"); }}>Close</button>
                            </>
                        ) : null}
                        {menu === "rename" ? (
                            <form onSubmit={rename}>
                                <label htmlFor="new-name">What should we call you?</label>
                                <input id="new-name" name="name" defaultValue={view?.playerName ?? ""} maxLength={24} autoComplete="nickname" autoFocus required />
                                <button type="submit" className="primary">Save</button>
                                <button type="button" className="quiet" onClick={() => { setMenu("closed"); }}>Cancel</button>
                            </form>
                        ) : null}
                        {menu === "leave" ? (
                            <>
                                <p>Leave the table? You'll give up your seat in room {state.roomCode}.</p>
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
