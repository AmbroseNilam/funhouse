// The phone: a name, then one full-screen surface that works as a controller without looking
// down. Slide moves the highlight on the TV, tap chooses, and press and hold talks. Anything
// private to this player appears above the surface. The phone never decides game logic. It
// remembers its seat, so a refresh, a locked screen or a network blip returns to the same seat.

import type { PhoneTurn } from "../../shared/turn.ts";
import { useEffect, useReducer, useRef, useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import type { Control, PhoneView } from "../../shared/controls.ts";
import { parseMessage, SERVER_SILENCE_LIMIT_MILLISECONDS, type PhoneMessage, type RoomToPhoneMessage } from "../../shared/protocol.ts";
import { HOST_NAME, PRODUCT_NAME } from "../../shared/brand.ts";
import type { PadView } from "../../shared/shell.ts";
import { blockBrowserGestures, listenForGestures } from "./gestures.ts";
import { micSteps } from "./micHelp.ts";
import { microphoneAllowed, startMicrophone, type MicrophoneCapture } from "./microphone.ts";
import { followVoice } from "./talkGlow.ts";
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

/** How the bands of lamplight respond to this phone's voice. */

/** Frames of audio kept from before a hold, so first words survive: 320 ms. */
const PRE_ROLL_FRAMES: number = 4;

/** How long a phone buzzes when its turn comes. */
const TURN_BUZZ_MILLISECONDS: number = 40;

/** Least time between telling the TV this phone was touched, so its seat can show it. */
const TOUCH_SIGNAL_GAP_MILLISECONDS: number = 400;

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

/** True when opened from the home screen rather than a browser tab. */
const INSTALLED: boolean = matchMedia("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Letters in a room code. */
const ROOM_CODE_LENGTH: number = 4;

/** True when this phone has a share sheet. */
const CAN_SHARE: boolean = "share" in navigator;

/** What the credits say. */
const CREDITS: string = `Paintings are AI-generated with Meta's Muse Image. The host's words and voice are AI too.`;

/** Local phone state. */
interface PhoneState {
    stage: "name" | "joining" | "joined";
    connected: boolean;
    playerId: string;
    roomCode: string;
    view: PhoneView | null;
    holding: boolean;
    mic: MicState;
}

/** Whether the microphone can be used: fine or not yet opened, refused, or broken some other way. */
type MicState = "ok" | "refused" | "failed";

type PhoneAction =
    | { type: "message"; message: RoomToPhoneMessage }
    | { type: "holding"; holding: boolean }
    | { type: "mic"; mic: MicState }
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

const INITIAL_STATE: PhoneState = { stage: seatInThisRoom() === null ? "name" : "joining", connected: false, playerId: "", roomCode: ROOM_CODE, view: null, holding: false, mic: "ok" };

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
    if (action.type === "mic") {
        return { ...state, mic: action.mic };
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
 * @param canTalk whether the microphone may open right now.
 * @param micOff whether this phone's microphone is refused or broken, so talking can't be taught.
 * @returns the headline and a smaller line under it.
 */
function surfaceLine(pad: PadView, learned: Set<string>, waiting: string, canTalk: boolean, micOff: boolean): { big: string; small: string } {
    if (pad.watching === true) {
        return { big: "You're watching this game", small: canTalk === true ? "You'll be in the next one. Press and hold to talk." : "You'll be in the next one" };
    }
    if (pad.canDrive === true && pad.axis !== null && learned.has("slide") === false) {
        return { big: "Slide your thumb", small: "Watch the TV" };
    }
    if (pad.canSelect === true && pad.axis !== null && learned.has("tap") === false) {
        return { big: "Tap to choose", small: "Anywhere on this screen" };
    }
    if (canTalk === true && micOff === false && learned.has("hold") === false) {
        return { big: "Press and hold to talk", small: `${HOST_NAME} hears you while you hold` };
    }
    if (waiting !== "") {
        return { big: waiting, small: canTalk === true && micOff === true ? "Turn on your mic from the menu" : "" };
    }
    if (canTalk === false && pad.axis === null) {
        return { big: "Phones are quiet for now", small: `${HOST_NAME} will say when it's your turn` };
    }
    const talkLine: string = canTalk === false ? "" : micOff === true ? "Turn on your mic from the menu" : "Press and hold to talk";
    if (pad.axis === null) {
        return { big: "", small: talkLine };
    }
    if (pad.driving === true) {
        return { big: "You have the controller", small: talkLine };
    }
    if (pad.driverName === "") {
        return { big: "", small: talkLine };
    }
    return pad.canDrive === true
        ? { big: `${pad.driverName} has the controller`, small: "Slide to take over" }
        : { big: `${pad.driverName} is choosing`, small: talkLine !== "" ? talkLine : "You can take over when they stop" };
}

/**
 * Says who holds the controller, from this phone's side.
 * @param pad how the surface behaves.
 * @returns the line.
 */
function controlLine(pad: PadView): string {
    if (pad.driving === true) {
        return "You have the controller";
    }
    if (pad.controllerFree === true) {
        return pad.axis === null ? "Nobody has the controller" : "Nobody has the controller. Slide to take it";
    }
    return `${pad.driverName} has the controller`;
}

/**
 * Where the installed app opens when it isn't already in a room: a place to type the code.
 * @returns the element.
 */
function CodeScreen(): ReactElement {
    const [code, setCode] = useState<string>("");
    const search: URLSearchParams = new URLSearchParams(location.search);
    const missing: string | null = search.get("missing");
    const full: string | null = search.get("full");
    const closed: string | null = search.get("closed");
    return (
        <main className="note-screen" data-scrolls>
            <small className="room-tag">{PRODUCT_NAME}</small>
            <form className="place-card" onSubmit={(event) => { event.preventDefault(); location.assign(`/phone/?room=${encodeURIComponent(code)}`); }}>
                <label htmlFor="code-field">What's the code on the TV?</label>
                {missing !== null ? <p className="place-warning" role="alert">Room {missing} isn't open.</p> : null}
                {full !== null ? <p className="place-warning" role="alert">Room {full} is full.</p> : null}
                {closed !== null ? <p className="place-warning" role="alert">Room {closed} has closed. Enter the new code to rejoin.</p> : null}
                <input
                    id="code-field"
                    className="code-field"
                    value={code}
                    onChange={(event) => { setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH)); }}
                    placeholder="KPTR"
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                />
                <button className="primary" type="submit" disabled={code.length !== ROOM_CODE_LENGTH}>Sit down</button>
            </form>
            <p className="fine">Hosting? Open this site on a TV or laptop.</p>
        </main>
    );
}

/**
 * A secret dealt face down. It shows only while pressed, so a phone left on the table gives
 * nothing away.
 * @param props the secret.
 * @returns the element.
 */
function SecretCard(props: { title: string; lines: string[] }): ReactElement {
    const [peeking, setPeeking] = useState<boolean>(false);
    return (
        <button
            className={`paper peek ${peeking === true ? "peeking" : ""}`}
            onPointerDown={() => { setPeeking(true); }}
            onPointerUp={() => { setPeeking(false); }}
            onPointerCancel={() => { setPeeking(false); }}
            onPointerLeave={() => { setPeeking(false); }}
        >
            {peeking === true
                ? <>{props.title !== "" ? <strong>{props.title}</strong> : null}{props.lines.map((line: string) => <span key={line}>{line}</span>)}</>
                : <em>Press and hold to peek</em>}
        </button>
    );
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
        return control.secret === true
            ? null
            : <section key={index} className="paper"><h2>{control.title}</h2><p>{control.body}</p></section>;
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
                <button type="submit">Send it</button>
            </form>
        );
    }
    if (control.tone === "secret") {
        return null;
    }
    return <p key={index} className={`paper note ${control.tone}`}>{control.text}</p>;
}

/** The phone application. */
export function App(): ReactElement {
    const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
    const socketRef = useRef<WebSocket | null>(null);
    const captureRef = useRef<MicrophoneCapture | null>(null);
    const startingMicrophoneRef = useRef<Promise<void> | null>(null);
    const micRef = useRef<MicState>(state.mic);
    micRef.current = state.mic;
    const pendingNameRef = useRef<string | null>(null);
    const holdingRef = useRef<boolean>(false);
    const preRollRef = useRef<ArrayBuffer[]>([]);
    const tailTimerRef = useRef<number>(0);
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const padRef = useRef<PadView | null>(null);
    const lastLeanAtRef = useRef<number>(0);
    const lastTouchSentRef = useRef<number>(0);
    const [learned, setLearned] = useState<Set<string>>(readLearned);
    const [movedAway, setMovedAway] = useState<boolean>(false);
    const [sameName, setSameName] = useState<string | null>(null);
    const [sent, setSent] = useState<boolean>(false);
    const [menu, setMenu] = useState<"closed" | "open" | "rename" | "leave" | "credits" | "mic">("closed");
    const [micRetried, setMicRetried] = useState<boolean>(false);
    const [invited, setInvited] = useState<string>("");

    useEffect(() => {
        if (ROOM_CODE === "") {
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
                    const wasSeated: boolean = seatInThisRoom() !== null;
                    clearSeat();
                    if (message.reason === "unknownRoom" && wasSeated === true) {
                        location.assign(`/phone/?closed=${encodeURIComponent(ROOM_CODE)}`);
                        return;
                    }
                    location.assign(`${INSTALLED === true ? "/phone/" : "/"}?${message.reason === "roomFull" ? "full" : "missing"}=${encodeURIComponent(ROOM_CODE)}`);
                    return;
                }
                if (message.type === "nameTaken") {
                    setSameName(message.name);
                    return;
                }
                if (message.type === "welcome") {
                    pendingNameRef.current = null;
                    setSameName(null);
                    writeSeat({ playerId: message.playerId, resumeToken: message.resumeToken, name: message.name, roomCode: message.roomCode });
                    if (document.visibilityState !== "visible") {
                        socket.send(JSON.stringify({ type: "presence", away: true } satisfies PhoneMessage));
                    }
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

        /** Tells the room this phone has left the app or come back. Best effort: an iPhone may not get to send it. */
        const reportPresence = (): void => {
            if (socketRef.current?.readyState === WebSocket.OPEN) {
                socketRef.current.send(JSON.stringify({ type: "presence", away: document.visibilityState !== "visible" } satisfies PhoneMessage));
            }
        };
        connect();
        document.addEventListener("visibilitychange", onVisible);
        document.addEventListener("visibilitychange", reportPresence);
        return (): void => {
            stopped = true;
            window.clearTimeout(retryTimer);
            window.clearTimeout(silenceTimer);
            document.removeEventListener("visibilitychange", onVisible);
            document.removeEventListener("visibilitychange", reportPresence);
            socketRef.current?.close();
            captureRef.current?.stop();
        };
    }, []);

    // A nudge in the hand when it becomes this phone's turn; phones that can't simply don't.
    const myTurn: boolean = state.view?.turn?.yours === true;
    useEffect(() => {
        if (myTurn === true && "vibrate" in navigator) {
            navigator.vibrate(TURN_BUZZ_MILLISECONDS);
        }
    }, [myTurn]);

    const joined: boolean = state.stage === "joined";
    useEffect(() => {
        if (joined === false) {
            return;
        }
        return keepScreenOn();
    }, [joined]);

    useEffect(() => {
        const surface: HTMLDivElement | null = surfaceRef.current;
        if (state.holding === false || surface === null) {
            return;
        }
        return followVoice(surface, () => captureRef.current?.level() ?? 0);
    }, [state.holding]);

    useEffect(() => {
        if (sent === false) {
            return;
        }
        const timer: number = window.setTimeout(() => { setSent(false); }, SENT_TICK_MILLISECONDS);
        return (): void => { window.clearTimeout(timer); };
    }, [sent]);

    useEffect(() => blockBrowserGestures(), []);

    // Colours the page behind the surface too, so no band of another colour shows past its edge.
    const seatColour: string | undefined = state.view?.pad.colour;
    useEffect(() => {
        document.documentElement.style.background = seatColour ?? "";
        return (): void => { document.documentElement.style.background = ""; };
    }, [seatColour]);

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
            dispatch({ type: "mic", mic: "ok" });
        } catch (error: unknown) {
            dispatch({ type: "mic", mic: error instanceof DOMException && error.name === "NotAllowedError" ? "refused" : "failed" });
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

    /**
     * Readies the microphone on any touch, but only when that can't put up a prompt mid-swipe. Otherwise it
     * waits for a hold, and after a refusal it waits for the person to ask again.
     */
    const wakeMicrophone = (): void => {
        if (captureRef.current !== null) {
            void ensureMicrophone();
            return;
        }
        if (micRef.current === "ok") {
            void microphoneAllowed().then((allowed: boolean) => {
                if (allowed === true) {
                    void ensureMicrophone();
                }
            });
        }
    };

    /** Answers a touch that can't do anything right now by drawing the eye to the line that says why. */
    const nudgeLine = (): void => {
        surfaceRef.current?.querySelector(".line")?.animate([{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
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
        send({ type: "released" });
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

    // Explains a microphone problem as soon as someone is seated, and clears the card once it's fixed.
    useEffect(() => {
        if (state.mic === "ok") {
            setMenu((current) => (current === "mic" ? "closed" : current));
            setMicRetried(false);
            return;
        }
        if (holdingRef.current === true) {
            stopTalking();
        }
        if (joined === true) {
            setMenu((current) => (current === "closed" ? "mic" : current));
        }
        // Only a change in the microphone or being seated should open the card.
    }, [state.mic, joined]);

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
                const touchedAt: number = Date.now();
                if (touchedAt - lastTouchSentRef.current >= TOUCH_SIGNAL_GAP_MILLISECONDS) {
                    lastTouchSentRef.current = touchedAt;
                    send({ type: "touched" });
                }
                wakeMicrophone();
            },
            lifted: (): void => { surface.classList.remove("touched"); },
            step: (delta: number): void => {
                if (padRef.current?.canDrive === false) {
                    nudgeLine();
                    return;
                }
                send({ type: "nav", action: { kind: "step", delta } });
                learn("slide");
                if ("vibrate" in navigator) {
                    navigator.vibrate(STEP_BUZZ_MILLISECONDS);
                }
            },
            lean: (x: number, y: number): void => {
                const now: number = Date.now();
                if (padRef.current?.canDrive === true && (now - lastLeanAtRef.current >= LEAN_INTERVAL_MILLISECONDS || (x === 0 && y === 0))) {
                    lastLeanAtRef.current = now;
                    send({ type: "lean", x, y });
                }
            },
            tap: (): void => {
                if (padRef.current?.canSelect === true) {
                    send({ type: "nav", action: { kind: "select" } });
                    learn("tap");
                    return;
                }
                nudgeLine();
            },
            holdStart: (): void => {
                if (canTalkRef.current === false) {
                    nudgeLine();
                }
                if (canTalkRef.current === false) {
                    return;
                }
                if (micRef.current !== "ok") {
                    setMenu("mic");
                    return;
                }
                void ensureMicrophone();
                startTalking();
            },
            holdEnd: (): void => {
                if (holdingRef.current === true) {
                    stopTalking();
                }
            },
        });
        // The surface reads everything it needs through refs, and only remounts with the screen.
    }, [showingSurface]);

    if (ROOM_CODE === "") {
        return <CodeScreen />;
    }

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
                <form className="place-card" onSubmit={(event) => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("name") as HTMLInputElement; pendingNameRef.current = field.value; void ensureMicrophone(); dispatch({ type: "joining" }); send({ type: "hello", name: field.value }); }}>
                    <label htmlFor="name-field">Who's sitting down?</label>
                    <input id="name-field" name="name" placeholder="Your name" maxLength={24} autoComplete="nickname" required />
                    <button className="primary" type="submit">Sit down</button>
                </form>
                <p className="fine">Your browser will ask for the mic. Your phone will show it as on while you play. {HOST_NAME} only hears you when you hold to talk.</p>
            </main>
        );
    }

    if (sameName !== null) {
        return (
            <main className="note-screen">
                <div className="place-card">
                    <label>You're already sitting here as {sameName}.</label>
                    <button className="primary" onClick={() => { send({ type: "hello", name: sameName, sameName: "takeSeat" }); }}>Take that seat</button>
                    <button className="plain" onClick={() => { send({ type: "hello", name: sameName, sameName: "newSeat" }); }}>I'm someone else</button>
                </div>
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

    /** Shares a link to this room, or copies it where a phone can't share. */
    const invite = async (): Promise<void> => {
        const url: string = `${location.origin}/phone/?room=${encodeURIComponent(state.roomCode)}`;
        try {
            if (CAN_SHARE === true) {
                await navigator.share({ title: PRODUCT_NAME, text: "Pull up a chair.", url });
                setMenu("closed");
                return;
            }
            await navigator.clipboard.writeText(url);
            setInvited("Link copied. Send it to whoever's coming.");
        } catch (error: unknown) {
            if (error instanceof DOMException && error.name === "AbortError") {
                return;
            }
            setInvited(url);
        }
    };

    const leave = (): void => {
        send({ type: "leave" });
        clearSeat();
        location.assign(INSTALLED === true ? "/phone/" : "/");
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
    const line: { big: string; small: string } = pad === null ? { big: "", small: "" } : surfaceLine(pad, learned, waiting, canTalk, state.mic !== "ok");
    const secretTitle: string = controls.flatMap((control: Control) => (control.type === "roleCard" && control.secret === true ? [control.title] : []))[0] ?? "";
    const secretLines: string[] = controls.flatMap((control: Control) => {
        if (control.type === "roleCard" && control.secret === true) {
            return [control.body];
        }
        return control.type === "notice" && control.tone === "secret" ? [control.text] : [];
    });
    const secretCard: ReactElement | null = secretLines.length > 0 ? <SecretCard key="secret" title={secretTitle} lines={secretLines} /> : null;
    const privateControls: (ReactElement | null)[] = [secretCard, ...controls.map((control, index) => renderControl(control, index, send))];
    const hasPrivate: boolean = privateControls.some((control) => control !== null);
    const problem: string = state.connected === false ? "Connecting…" : state.mic !== "ok" && canTalk === true ? "Your mic is off" : "";
    const status: string = problem !== "" ? problem : view?.status === line.big ? "" : view?.status ?? "";
    const turn: PhoneTurn | null = view?.turn ?? null;
    const seatStyle = { "--seat": pad?.colour ?? "#5a4a3a" } as CSSProperties;
    const atRest: boolean = pad !== null && canTalk === false && (pad.axis === null || pad.canDrive === false) && pad.canSelect === false;
    return (
        <main className={`pad-screen ${state.holding === true ? "talking" : ""} ${state.connected === false ? "offline" : ""} ${atRest === true ? "at-rest" : ""} ${turn?.yours === true ? "my-turn" : ""} ${turn?.yours === false ? "not-my-turn" : ""}`} style={seatStyle}>
            <header className="corners">
                {pad?.backLabel !== null && pad?.backLabel !== undefined
                    ? <button className="corner" onClick={() => { send({ type: "nav", action: { kind: "back" } }); }}>{pad.backLabel}</button>
                    : <span className="corner-gap" />}
                <span className="who">{view?.playerName ?? ""}</span>
                <button className="corner" aria-label="Your menu" aria-expanded={menu !== "closed"} onClick={() => { setMenu("open"); }}>···</button>
            </header>
            {turn !== null ? <p className="turn-line">{turn.line}</p> : null}
            {turn === null && pad !== null && pad.axis !== null ? <p className="control-line">{controlLine(pad)}</p> : null}
            {hasPrivate === true ? <section className="private" data-scrolls>{privateControls}</section> : null}
            <div className="surface" ref={surfaceRef}>
                <div className="bands" aria-hidden="true"><i /><i /><i /></div>
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
                                {invited !== "" ? <p className="invited">{invited}</p> : null}
                                {state.mic !== "ok" ? <button onClick={() => { setMenu("mic"); }}>Turn on your mic</button> : null}
                                <button onClick={() => { void invite(); }}>Invite someone</button>
                                <button onClick={() => { setMenu("rename"); }}>Change your name</button>
                                <button onClick={() => { setMenu("leave"); }}>Leave the table</button>
                                <button className="text-link" onClick={() => { setMenu("credits"); }}>Credits</button>
                                <button className="quiet" onClick={() => { setMenu("closed"); setInvited(""); }}>Close</button>
                            </>
                        ) : null}
                        {menu === "mic" ? (
                            <>
                                <p>{micRetried === true ? "Still off." : "Your mic is off."} You can still swipe and tap. To talk:</p>
                                {state.mic === "refused"
                                    ? <ol className="mic-steps">{micSteps().map((step: string) => <li key={step}>{step}</li>)}</ol>
                                    : <p className="mic-note">Another app may be using it. Close that app, then try again.</p>}
                                <button className="primary" onClick={() => { void ensureMicrophone().then(() => { setMicRetried(true); }); }}>Try again</button>
                                <button className="quiet" onClick={() => { setMenu("closed"); setMicRetried(false); }}>Keep playing without talking</button>
                            </>
                        ) : null}
                        {menu === "credits" ? (
                            <>
                                <p>{CREDITS}</p>
                                <button className="quiet" onClick={() => { setMenu("open"); }}>Back</button>
                            </>
                        ) : null}
                        {menu === "rename" ? (
                            <form onSubmit={rename}>
                                <label htmlFor="new-name">What should we call you?</label>
                                <input id="new-name" name="name" defaultValue={view?.playerName ?? ""} maxLength={24} autoComplete="nickname" autoFocus required />
                                <button type="submit" className="primary">That's me</button>
                                <button type="button" className="quiet" onClick={() => { setMenu("closed"); }}>Never mind</button>
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
