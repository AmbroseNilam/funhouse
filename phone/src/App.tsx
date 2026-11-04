// The phone: a name, then one full-screen surface that works as a controller without looking
// down. Slide moves the highlight on the TV, tap chooses, and press and hold talks. Anything
// private to this player appears above the surface. The phone never decides game logic. It
// remembers its seat, so a refresh, a locked screen or a network blip returns to the same seat.

import type { PhoneTurn } from "../../shared/turn.ts";
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import { listeningAllowsTalk, type Control, type PhoneView } from "../../shared/controls.ts";
import { FOREGROUND_ANSWER_LIMIT_MILLISECONDS, parseMessage, SERVER_SILENCE_LIMIT_MILLISECONDS, type PhoneMessage, type RoomToPhoneMessage, type TapEnd } from "../../shared/protocol.ts";
import { HOST_NAME, PRODUCT_NAME } from "../../shared/brand.ts";
import type { PadView } from "../../shared/shell.ts";
import { blockBrowserGestures, listenForGestures } from "./gestures.ts";
import { startScanning, type ScanEnd } from "./scanner.ts";
import { isOutOfDate, versionLine } from "../../shared/build-info.ts";
import { InstallCard, mayOfferInstall, useInstallWay, type InstallWay } from "../../landing/src/InstallCard.tsx";
import { readServerBuild } from "./freshness.ts";
import { readSettings, writeSettings, type PhoneSettings } from "./settings.ts";
import { drawWave } from "./talkWave.ts";
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

/** How loud counts as speech for ending a tap-to-talk recording; a starting value to tune on real phones. */
const TAP_SPEECH_LEVEL: number = 0.08;

/** A tap-to-talk recording ends after this much quiet once someone has spoken. */
const TAP_SILENCE_MILLISECONDS: number = 2000;

/** A tap-to-talk recording ends if nobody has spoken after this long. */
const TAP_FIRST_WORDS_MILLISECONDS: number = 8000;

/** The most a tap-to-talk recording runs, just under the room's own limit on a press. */
const TAP_LIMIT_MILLISECONDS: number = 28000;

/** How often a tap-to-talk recording checks whether to stop. */
const TAP_CHECK_MILLISECONDS: number = 100;

/** How long a phone buzzes when its turn comes. */
const TURN_BUZZ_MILLISECONDS: number = 40;

/** How long a hold can go with no audio arriving at all before the phone says the mic has stopped. */
const MIC_STALL_LIMIT_MILLISECONDS: number = 1000;

/** How long a hold can stay purely silent before the phone asks them to speak up. */
const MIC_QUIET_LIMIT_MILLISECONDS: number = 3000;

/** How often a hold checks on the microphone. */
const MIC_WATCH_MILLISECONDS: number = 400;

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
/** How long after a game ends the home screen offer waits. */
const INSTALL_OFFER_DELAY_MILLISECONDS: number = 4000;

const CAN_SHARE: boolean = "share" in navigator && "canShare" in navigator;

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
const ROOM_CODE: string = new URLSearchParams(location.search).has("scan") === true ? "" : (new URLSearchParams(location.search).get("room") ?? readSeat()?.roomCode ?? "").toUpperCase();

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
 * @param talkButton whether this phone talks with the Talk button rather than by holding.
 * @returns the headline and a smaller line under it.
 */
function surfaceLine(pad: PadView, learned: Set<string>, waiting: string, canTalk: boolean, micOff: boolean, talkButton: boolean): { big: string; small: string } {
    // The Talk button says this itself, so the surface only teaches holding.
    const talkHint: string = talkButton === true ? "" : "Hold to talk";
    if (pad.startCard.length > 0) {
        return { big: "", small: pad.canSelect === true ? "Tap to start now" : "Starting soon" };
    }
    if (pad.pausedBy !== "") {
        return { big: `Paused by ${pad.pausedBy}`, small: pad.canDrive === true ? "Slide to see more, tap to choose" : `Only ${pad.driverName} can resume` };
    }
    if (pad.watching === true) {
        return { big: "You're watching this game", small: canTalk === true && talkHint !== "" ? `You'll be in the next one. ${talkHint}.` : "You'll be in the next one" };
    }
    if (pad.canDrive === true && pad.axis !== null && learned.has("slide") === false) {
        return { big: "Slide your thumb", small: "Watch the TV" };
    }
    if (pad.canSelect === true && pad.axis !== null && learned.has("tap") === false) {
        return { big: "Tap to choose", small: "Anywhere on this screen" };
    }
    if (canTalk === true && micOff === false && talkButton === false && learned.has("hold") === false) {
        return { big: talkHint, small: `${HOST_NAME} hears you while you hold` };
    }
    if (waiting !== "") {
        return { big: waiting, small: "" };
    }
    if (canTalk === false && pad.axis === null) {
        return { big: "Phones are quiet for now", small: `${HOST_NAME} will say when it's your turn` };
    }
    const talkLine: string = canTalk === false || micOff === true ? "" : talkHint;
    if (pad.axis === null) {
        return { big: "", small: talkLine };
    }
    if (pad.driving === true) {
        return { big: "You have the controller", small: talkLine };
    }
    if (pad.driverName === "" || pad.controllerFree === true) {
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
    const [scanning, setScanning] = useState<boolean>(new URLSearchParams(location.search).has("scan") === true);
    const [scanNote, setScanNote] = useState<string>("");
    const openRoom = useCallback((room: string): void => { location.assign(`/phone/?room=${encodeURIComponent(room)}`); }, []);
    const endScan = useCallback((message: string): void => {
        setScanNote(message);
        setScanning(false);
    }, []);
    const search: URLSearchParams = new URLSearchParams(location.search);
    const missing: string | null = search.get("missing");
    const full: string | null = search.get("full");
    const closed: string | null = search.get("closed");
    if (scanning === true) {
        return <CodeScanner onRoom={openRoom} onEnd={endScan} />;
    }
    return (
        <main className="note-screen" data-scrolls>
            <small className="room-tag">{PRODUCT_NAME}</small>
            <form className="place-card" onSubmit={(event) => { event.preventDefault(); openRoom(code); }}>
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
                {scanNote !== "" ? <p className="place-warning" role="alert">{scanNote}</p> : null}
                <button className="primary" type="submit" disabled={code.length !== ROOM_CODE_LENGTH}>Sit down</button>
                {"mediaDevices" in navigator === false ? null : <button className="plain" type="button" onClick={() => { setScanNote(""); setScanning(true); }}>Scan the code</button>}
            </form>
            <p className="fine">Hosting? Open this site on a TV or laptop.</p>
        </main>
    );
}

/**
 * One setting that is on or off.
 * @param props its name, its state and what to do when it changes.
 * @returns the element.
 */
function SettingRow(props: { label: string; on: boolean; onChange: (on: boolean) => void; onWord?: string; offWord?: string }): ReactElement {
    return (
        <button className="setting" role="switch" aria-checked={props.on} onClick={() => { props.onChange(props.on === false); }}>
            <span>{props.label}</span>
            <span className="setting-state">{props.on === true ? props.onWord ?? "On" : props.offWord ?? "Off"}</span>
        </button>
    );
}

/**
 * The camera, looking for the code on the TV.
 * @param props onRoom gets the code; onEnd closes the camera, saying why if it couldn't be used.
 * @returns the element.
 */
function CodeScanner(props: { onRoom: (room: string) => void; onEnd: (message: string) => void }): ReactElement {
    const video = useRef<HTMLVideoElement>(null);
    const [notOurs, setNotOurs] = useState<boolean>(false);
    const { onRoom, onEnd } = props;
    useEffect(() => {
        if (video.current === null) {
            return undefined;
        }
        return startScanning(video.current, onRoom, () => { setNotOurs(true); }, (end: ScanEnd) => {
            onEnd(end === "refused" ? "The camera's off, so type the code instead." : "That camera won't open. Type the code instead.");
        });
    }, [onRoom, onEnd]);
    return (
        <main className="note-screen scanner">
            <video ref={video} muted playsInline aria-label="Camera view" />
            <p role="status">{notOurs === true ? "That code isn't one of ours. Point at the one on the TV." : "Point at the code on the TV."}</p>
            <button className="primary" type="button" onClick={() => { onEnd(""); }}>Type it instead</button>
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
 * A role dealt to this player. A tap turns it over; it starts face up when first dealt and as a
 * small strip from then on, so it never crowds the game.
 * @param props the role, anything else secret, and how it starts.
 * @returns the element.
 */
function RoleCard(props: { title: string; lines: string[]; startHidden: boolean }): ReactElement {
    const [hidden, setHidden] = useState<boolean>(props.startHidden);
    useEffect(() => { setHidden(props.startHidden); }, [props.startHidden]);
    if (hidden === true) {
        return <button className="paper role-strip" onClick={() => { setHidden(false); }}>Your role. Tap to see</button>;
    }
    return (
        <button className="paper role-face" onClick={() => { setHidden(true); }}>
            <strong>{props.title}</strong>
            {props.lines.map((line: string) => <span key={line}>{line}</span>)}
            <small>Tap to hide</small>
        </button>
    );
}

/** The page colour on any screen but the controller, as in phone/index.html. */
const RESTING_PAGE_COLOUR: string = "#17110c";

/**
 * Turns any CSS colour into the #rrggbb that a theme-color tag is sure to read.
 * @param colour any CSS colour.
 * @returns the hex colour.
 */
function plainColour(colour: string): string {
    const context: CanvasRenderingContext2D | null = document.createElement("canvas").getContext("2d");
    if (context === null) {
        return RESTING_PAGE_COLOUR;
    }
    context.fillStyle = colour;
    context.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
    return `#${[red, green, blue].map((part: number) => part.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Gives the page and the browser's bars the colour of the screen.
 * @param colour any CSS colour.
 */
function matchPageColour(colour: string): void {
    if (document.documentElement.style.backgroundColor === colour) {
        return;
    }
    document.documentElement.style.backgroundColor = colour;
    document.body.style.backgroundColor = colour;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", plainColour(colour));
}

/**
 * A slider with its value in big type, answered once.
 * @param props the control, and how to send the answer.
 * @returns the element.
 */
function SliderCard(props: { control: Extract<Control, { type: "slider" }>; send: (message: PhoneMessage) => void }): ReactElement {
    const { control } = props;
    const step: number = control.step ?? 1;
    const [value, setValue] = useState<number>(control.min + Math.round((control.max - control.min) / 2 / step) * step);
    return (
        <section className="paper choices slider-card">
            <label className="prompt">{control.prompt}<input type="range" min={control.min} max={control.max} step={step} value={value} onChange={(event) => { setValue(Number(event.target.value)); }} /></label>
            <div className="slider-labels"><span>{control.lowLabel ?? control.min}</span><strong>{value}</strong><span>{control.highLabel ?? control.max}</span></div>
            <button onClick={() => { props.send({ type: "answer", controlId: control.id, value }); }}>Send it</button>
        </section>
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
    if (control.type === "textInput" || control.type === "numberInput") {
        const submit = (event: FormEvent<HTMLFormElement>): void => {
            event.preventDefault();
            const typed: string = (event.currentTarget.elements.namedItem("value") as HTMLInputElement).value;
            if (typed.trim() !== "") {
                send({ type: "answer", controlId: control.id, value: control.type === "numberInput" ? Number(typed) : typed });
            }
        };
        return (
            <form key={control.id} className="paper choices" onSubmit={submit}>
                {control.note !== undefined ? <p className="prompt" role="alert">{control.note}</p> : null}
                {control.type === "textInput"
                    ? <label className="prompt">{control.prompt}<input name="value" maxLength={control.maxLength} placeholder={control.placeholder ?? ""} autoComplete="off" enterKeyHint="send" /></label>
                    : <label className="prompt">{control.prompt}<input name="value" type="number" inputMode="numeric" min={control.min} max={control.max} step={control.step ?? 1} autoComplete="off" enterKeyHint="send" /></label>}
                <button type="submit">Send it</button>
            </form>
        );
    }
    if (control.type === "slider") {
        return <SliderCard key={control.id} control={control} send={send} />;
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
    const tappingRef = useRef<boolean>(false);
    const waveRef = useRef<HTMLCanvasElement>(null);
    const [tapping, setTapping] = useState<boolean>(false);
    const preRollRef = useRef<ArrayBuffer[]>([]);
    const tailTimerRef = useRef<number>(0);
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const padRef = useRef<PadView | null>(null);
    const lastLeanAtRef = useRef<number>(0);
    const [learned, setLearned] = useState<Set<string>>(readLearned);
    const [movedAway, setMovedAway] = useState<boolean>(false);
    const [sameName, setSameName] = useState<string | null>(null);
    const [sent, setSent] = useState<boolean>(false);
    // Someone at a computer, or an agent using its screen, can play without the mic ever being asked for.
    const [noMic, setNoMic] = useState<boolean>(new URLSearchParams(location.search).has("nomic"));
    const noMicRef = useRef<boolean>(noMic);
    noMicRef.current = noMic;
    const [menu, setMenu] = useState<"closed" | "open" | "rename" | "leave" | "credits" | "mic" | "settings" | "type" | "guests" | "install">("closed");
    const [settings, setSettings] = useState<PhoneSettings>(readSettings);
    const settingsRef = useRef<PhoneSettings>(settings);
    settingsRef.current = settings;
    const [micRetried, setMicRetried] = useState<boolean>(false);
    const [micSilent, setMicSilent] = useState<"" | "stopped" | "quiet">("");
    const micSilentRef = useRef<"" | "stopped" | "quiet">("");
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
        const heardFromServer = (socket: WebSocket, limit: number = SERVER_SILENCE_LIMIT_MILLISECONDS): void => {
            window.clearTimeout(silenceTimer);
            silenceTimer = window.setTimeout(() => { giveUpOn(socket); }, limit);
        };

        /** Moves on from a socket that has gone silent at once, as a browser can take a long while to close a dead one. */
        const giveUpOn = (socket: WebSocket): void => {
            if (socketRef.current !== socket) {
                return;
            }
            socket.close();
            dispatch({ type: "connection", connected: false });
            holdingRef.current = false;
            dispatch({ type: "holding", holding: false });
            window.clearTimeout(retryTimer);
            retryDelay = 500;
            connect();
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
                if (socketRef.current !== socket) {
                    return;
                }
                dispatch({ type: "connection", connected: false });
                window.clearTimeout(silenceTimer);
                if (stopped === true) {
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
            const current: WebSocket | null = socketRef.current;
            if (document.visibilityState !== "visible" || current?.readyState === WebSocket.CONNECTING) {
                return;
            }
            // A phone that slept can hold a socket that looks open and is dead, so the room's answer to reportPresence decides.
            if (current?.readyState === WebSocket.OPEN) {
                heardFromServer(current, FOREGROUND_ANSWER_LIMIT_MILLISECONDS);
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
        /** Reconnects at once when the network returns or the page is restored, if the socket is gone. */
        const onRestored = (): void => {
            if (socketRef.current?.readyState !== WebSocket.OPEN) {
                onVisible();
            }
        };
        connect();
        window.addEventListener("online", onRestored);
        window.addEventListener("pageshow", onRestored);
        document.addEventListener("visibilitychange", onVisible);
        document.addEventListener("visibilitychange", reportPresence);
        return (): void => {
            stopped = true;
            window.clearTimeout(retryTimer);
            window.clearTimeout(silenceTimer);
            window.removeEventListener("online", onRestored);
            window.removeEventListener("pageshow", onRestored);
            document.removeEventListener("visibilitychange", onVisible);
            document.removeEventListener("visibilitychange", reportPresence);
            socketRef.current?.close();
            captureRef.current?.stop();
        };
    }, []);

    // A nudge in the hand when it becomes this phone's turn; phones that can't simply don't.
    const myTurn: boolean = state.view?.turn?.yours === true;
    useEffect(() => {
        if (myTurn === true && settingsRef.current.vibration === true && "vibrate" in navigator) {
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

    // Says so when a hold isn't reaching anything. A stopped mic is reopened once. Pure silence may only mean a quiet
    // room, so it just asks them to speak, and any sound during the hold ends the worry for that hold.
    useEffect(() => {
        if (state.holding === false) {
            micSilentRef.current = "";
            setMicSilent("");
            return;
        }
        const startedAt: number = Date.now();
        let reopened: boolean = false;
        const watch: number = window.setInterval(() => {
            const heldFor: number = Date.now() - startedAt;
            if (startingMicrophoneRef.current !== null) {
                return;
            }
            const capture: MicrophoneCapture | null = captureRef.current;
            const stopped: boolean = capture === null || capture.isLive() === false || capture.stalledFor() >= MIC_STALL_LIMIT_MILLISECONDS;
            const nothingYet: boolean = capture !== null && capture.silentFor() >= Math.min(heldFor, capture.openFor()) && heldFor >= MIC_QUIET_LIMIT_MILLISECONDS;
            const worry: "" | "stopped" | "quiet" = stopped === true && heldFor >= MIC_STALL_LIMIT_MILLISECONDS ? "stopped" : nothingYet === true ? "quiet" : "";
            micSilentRef.current = worry;
            setMicSilent(worry);
            if (worry === "stopped" && reopened === false) {
                reopened = true;
                capture?.stop();
                captureRef.current = null;
                void ensureMicrophone();
            }
        }, MIC_WATCH_MILLISECONDS);
        return (): void => { window.clearInterval(watch); };
        // Only starting or ending a hold should restart this watch.
    }, [state.holding]);

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

    const waveShown: boolean = state.holding === true && state.view?.tapToTalk === true;
    const padScreenRef = useRef<HTMLElement>(null);
    // Browsers tint their own bars from the page, some only now and then; every colour they could read should agree.
    useEffect(() => {
        if (padScreenRef.current !== null) {
            matchPageColour(getComputedStyle(padScreenRef.current).backgroundColor);
        }
        return (): void => { matchPageColour(RESTING_PAGE_COLOUR); };
    });
    useEffect(() => {
        const canvas: HTMLCanvasElement | null = waveRef.current;
        if (waveShown === false || canvas === null) {
            return;
        }
        return drawWave(canvas, () => captureRef.current?.level() ?? 0);
    }, [waveShown]);

    useEffect(() => blockBrowserGestures(), []);

    // Offers the home screen once, a few seconds after a game ends, and only if nothing else is open.
    const installWay: InstallWay | null = useInstallWay();
    const betweenGames: boolean = state.view?.gameOn === false;
    const wasInGameRef = useRef<boolean>(false);
    useEffect(() => {
        if (state.view === null) {
            return;
        }
        if (betweenGames === false) {
            wasInGameRef.current = true;
            return;
        }
        if (wasInGameRef.current === false || installWay === null || mayOfferInstall() === false) {
            return;
        }
        wasInGameRef.current = false;
        const timer: number = window.setTimeout(() => {
            setMenu((current) => (current === "closed" ? "install" : current));
        }, INSTALL_OFFER_DELAY_MILLISECONDS);
        return (): void => { window.clearTimeout(timer); };
    }, [betweenGames, installWay, state.view === null]);

    // Colours the page behind the surface too, so no band of another colour shows past its edge.
    const seatColour: string | undefined = state.view?.pad.colour;
    useEffect(() => {
        document.documentElement.style.background = seatColour ?? "";
        return (): void => { document.documentElement.style.background = ""; };
    }, [seatColour]);

    const privateRef = useRef<HTMLElement>(null);
    const typedEntryId: string = state.view?.controls.find((control: Control) => control.type === "textInput" || control.type === "numberInput")?.id ?? "";
    // A typed answer may be all someone has, so its box and Send come into view rather than sitting below the fold.
    useEffect(() => {
        if (typedEntryId !== "" && privateRef.current !== null) {
            privateRef.current.scrollTop = privateRef.current.scrollHeight;
        }
    }, [typedEntryId]);
    const [outOfDate, setOutOfDate] = useState<boolean>(false);
    // A page cached from an older release says so; one open when the server restarts reloads by itself.
    useEffect(() => {
        void readServerBuild().then((server) => { setOutOfDate(server !== null && isOutOfDate(__BUILD_INFO__, server)); });
    }, [state.connected]);
    const reactionsWanted: boolean = settings.reactions;
    useEffect(() => {
        if (state.stage === "joined" && state.connected === true && socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "reactions", wanted: reactionsWanted }));
        }
    }, [state.stage, state.connected, reactionsWanted]);

    /**
     * Applies and saves a change of settings.
     * @param next the settings.
     */
    const changeSettings = (next: PhoneSettings): void => {
        writeSettings(next);
        setSettings(next);
    };

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
            send({ type: "micSettings", ...captureRef.current.applied() });
            dispatch({ type: "mic", mic: "ok" });
        } catch (error: unknown) {
            dispatch({ type: "mic", mic: error instanceof DOMException && error.name === "NotAllowedError" ? "refused" : "failed" });
        }
    };

    const ensureMicrophone = async (): Promise<void> => {
        if (noMicRef.current === true) {
            return;
        }
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

    /**
     * Stops talking, keeping the microphone on a moment so the last word isn't cut.
     * @param why why a tap-to-talk recording ended; absent for a hold.
     */
    const stopTalking = (why?: TapEnd): void => {
        dispatch({ type: "holding", holding: false });
        setSent(micSilentRef.current === "");
        tappingRef.current = false;
        setTapping(false);
        send(why === undefined ? { type: "released" } : { type: "released", why });
        tailTimerRef.current = window.setTimeout(() => {
            holdingRef.current = false;
            send({ type: "holdToTalk", down: false });
        }, TAIL_MILLISECONDS);
    };

    /** Starts a tap-to-talk recording. */
    const startTapping = (): void => {
        if (micRef.current !== "ok") {
            setMenu("mic");
            return;
        }
        tappingRef.current = true;
        setTapping(true);
        void ensureMicrophone();
        startTalking();
    };

    // A recording nobody is holding has to end itself, so a forgotten one can't keep listening to the room.
    useEffect(() => {
        if (tapping === false) {
            return;
        }
        const startedAt: number = Date.now();
        let lastSpeechAt: number = 0;
        const check: number = window.setInterval(() => {
            const now: number = Date.now();
            if ((captureRef.current?.level() ?? 0) >= TAP_SPEECH_LEVEL) {
                lastSpeechAt = now;
            }
            if (now - startedAt >= TAP_LIMIT_MILLISECONDS) {
                stopTalking("limit");
                return;
            }
            const silentSince: number = lastSpeechAt === 0 ? startedAt + TAP_FIRST_WORDS_MILLISECONDS - TAP_SILENCE_MILLISECONDS : lastSpeechAt;
            if (now - silentSince >= TAP_SILENCE_MILLISECONDS) {
                stopTalking("silence");
            }
        }, TAP_CHECK_MILLISECONDS);
        const hidden = (): void => {
            if (document.visibilityState === "hidden") {
                stopTalking("hidden");
            }
        };
        document.addEventListener("visibilitychange", hidden);
        return (): void => {
            window.clearInterval(check);
            document.removeEventListener("visibilitychange", hidden);
        };
        // Only starting or ending a recording should restart this watch.
    }, [tapping]);

    const view: PhoneView | null = state.view;
    padRef.current = view?.pad ?? null;
    const canTalk: boolean = view !== null && listeningAllowsTalk(view.listening);
    const canTalkRef = useRef<boolean>(canTalk);
    canTalkRef.current = canTalk;
    useEffect(() => {
        if (canTalk === false && holdingRef.current === true) {
            stopTalking();
        }
        // Only a change in whether talking is allowed should end a turn.
    }, [canTalk]);

    // Tells the room which voice clean-ups this phone really applied, once it's seated with a working mic.
    useEffect(() => {
        const capture: MicrophoneCapture | null = captureRef.current;
        if (state.mic !== "ok" || joined === false || capture === null) {
            return;
        }
        send({ type: "micSettings", ...capture.applied() });
        // Only a change in the microphone or being seated should report again.
    }, [state.mic, joined]);

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
        if (joined === true && canTalk === true) {
            setMenu((current) => (current === "closed" ? "mic" : current));
        }
        // Only a change in the microphone or being seated should open the card; a tap-only phase never does.
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
                if (surface.classList.contains("touched") === false) {
                    send({ type: "touched" });
                }
                surface.classList.add("touched");
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
                if (settingsRef.current.vibration === true && "vibrate" in navigator) {
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
                if (tappingRef.current === true) {
                    return;
                }
                if (padRef.current?.canSelect === true) {
                    send({ type: "nav", action: { kind: "select" } });
                    learn("tap");
                    return;
                }
                nudgeLine();
            },
            holdStart: (): void => {
                if (tappingRef.current === true) {
                    return;
                }
                if (canTalkRef.current === false) {
                    nudgeLine();
                }
                if (canTalkRef.current === false || noMicRef.current === true) {
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
                if (holdingRef.current === true && tappingRef.current === false) {
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
                    <input id="name-field" name="name" placeholder="Your name" maxLength={24} autoComplete="nickname" autoCapitalize="words" required />
                    <button className="primary" type="submit">Sit down</button>
                    <button type="submit" className="quiet" onClick={() => { noMicRef.current = true; setNoMic(true); }}>Sit down without a mic</button>
                </form>
                <p className="fine">Your browser will ask for the mic. Your phone will show it as on while you play. {HOST_NAME} only hears you after you tap to talk or hold to talk.</p>
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
    // Called straight from the tap with nothing awaited first, because iOS only allows sharing inside a tap.
    const invite = async (): Promise<void> => {
        const url: string = `${location.origin}/phone/?room=${encodeURIComponent(state.roomCode)}`;
        const shared: ShareData = { title: PRODUCT_NAME, text: `Pull up a chair. We're playing ${PRODUCT_NAME}.`, url };
        if (CAN_SHARE === true && navigator.canShare(shared) === true) {
            try {
                await navigator.share(shared);
                setMenu("closed");
                return;
            } catch (error: unknown) {
                if (error instanceof DOMException && error.name === "AbortError") {
                    return;
                }
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            setInvited("Copied. Send the link to whoever's coming.");
        } catch {
            setInvited(url);
        }
    };

    const leave = (): void => {
        send({ type: "leave" });
        clearSeat();
        location.assign(INSTALLED === true ? "/phone/" : "/");
    };

    const sendTyped = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem("typed") as HTMLInputElement;
        if (field.value.trim() !== "") {
            send({ type: "typed", text: field.value });
        }
        setMenu("closed");
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
    const secretTitle: string = controls.flatMap((control: Control) => (control.type === "roleCard" && control.secret === true ? [control.title] : []))[0] ?? "";
    const secretLines: string[] = controls.flatMap((control: Control) => {
        if (control.type === "roleCard" && control.secret === true) {
            return [control.body];
        }
        return control.type === "notice" && control.tone === "secret" ? [control.text] : [];
    });
    const roleControl: Control | undefined = controls.find((control: Control) => control.type === "roleCard" && control.secret === true);
    const roleStartsHidden: boolean = roleControl?.type === "roleCard" && roleControl.startHidden === true;
    const secretCard: ReactElement | null = secretLines.length === 0
        ? null
        : roleControl !== undefined
            ? <RoleCard key="role" title={secretTitle} lines={secretLines} startHidden={roleStartsHidden} />
            : <SecretCard key="secret" title={secretTitle} lines={secretLines} />;
    const privateControls: (ReactElement | null)[] = [secretCard, ...controls.map((control, index) => renderControl(control, index, send))];
    const hasPrivate: boolean = privateControls.some((control) => control !== null) && pad?.pausedBy === "";
    const quietUnderCards: boolean = hasPrivate === true && waiting === "" && canTalk === false;
    const line: { big: string; small: string } = pad === null || quietUnderCards === true ? { big: "", small: "" } : surfaceLine(pad, learned, waiting, canTalk, state.mic !== "ok", view?.tapToTalk === true && settings.talkButton === true);
    const problem: string = state.connected === false ? "Connecting…" : state.mic !== "ok" && canTalk === true && hasPrivate === false ? "Your mic is off" : "";
    const status: string = problem !== "" ? problem : view?.status === line.big || hasPrivate === true || (pad !== null && pad.pausedBy !== "") ? "" : view?.status ?? "";
    const turn: PhoneTurn | null = view?.turn ?? null;
    const seatStyle = { "--seat": pad?.colour ?? "#5a4a3a" } as CSSProperties;
    const atRest: boolean = pad !== null && canTalk === false && (pad.axis === null || pad.canDrive === false) && pad.canSelect === false;
    return (
        <main ref={padScreenRef} className={`pad-screen ${state.holding === true ? "talking" : ""} ${waveShown === true ? "dictating" : ""} ${state.connected === false ? "offline" : ""} ${atRest === true ? "at-rest" : ""} ${turn?.yours === true ? "my-turn" : ""} ${turn?.yours === false && turn.open === false ? "not-my-turn" : ""} ${hasPrivate === true ? "has-private" : ""}`} style={seatStyle}>
            <header className="corners">
                {pad?.backLabel !== null && pad?.backLabel !== undefined
                    ? <button className="corner" onClick={() => { send({ type: "nav", action: { kind: "back" } }); }}>{pad.backLabel}</button>
                    : <span className="corner-gap" />}
                <span className="who">{view?.playerName ?? ""}</span>
                <button className="corner" aria-label="Your menu" aria-expanded={menu !== "closed"} onClick={() => { setMenu("open"); }}>···</button>
            </header>
            {turn !== null && turn.line !== "" && pad?.pausedBy === "" ? <p className="turn-line">{turn.line}</p> : null}
            {turn === null && pad !== null && pad.axis !== null ? <p className="control-line">{controlLine(pad)}</p> : null}
            {pad !== null && pad.startCard.length > 0 ? (
                <section className="private" data-scrolls>
                    <section className="paper">
                        <ol className="start-lines">{pad.startCard.map((text: string) => <li key={text}>{text}</li>)}</ol>
                    </section>
                </section>
            ) : null}
            {pad?.confirmEnd === true ? (
                <section className="private" data-scrolls>
                    <section className="paper choices">
                        <p className="prompt">End the game for everyone?</p>
                        <button onClick={() => { send({ type: "nav", action: { kind: "choose", index: 1 } }); }}>End for everyone</button>
                        <button onClick={() => { send({ type: "nav", action: { kind: "choose", index: 0 } }); }}>Keep playing</button>
                    </section>
                </section>
            ) : null}
            {hasPrivate === true && pad?.pausedBy === "" ? <section ref={privateRef} className="private" data-scrolls>{privateControls}</section> : null}
            <div className="surface" ref={surfaceRef}>
                <div className="bands" aria-hidden="true"><i /><i /><i /></div>
                <div className="thumb" aria-hidden="true" />
                <div className="line" aria-live="polite">
                    {state.holding === true
                        ? micSilent === "stopped"
                            ? <><strong>Can't hear your mic</strong><small>{tapping === true ? "Stop and try again" : "Let go and try again"}</small></>
                            : micSilent === "quiet" && view?.hearing === ""
                                ? <><strong>Listening</strong><small>Nothing yet. Try a bit louder.</small></>
                            : view?.hearing !== undefined && view.hearing !== ""
                                ? <p className="hearing">{view.hearing.slice(-90)}</p>
                                : <><strong>Listening</strong>{tapping === true ? <small>Tap Stop when you're done</small> : null}</>
                        : sent === true
                            ? <strong>Got it</strong>
                            : <><strong>{line.big}</strong>{line.small !== "" ? <small>{line.small}</small> : null}</>}
                </div>
                {status !== "" && state.holding === false ? <p className="status" role="status">{status}</p> : null}
            </div>
            {waveShown === true ? (
                <div className="dictation">
                    <canvas ref={waveRef} aria-hidden="true" />
                    {tapping === true ? <button onClick={() => { stopTalking("stop"); }}>Stop</button> : null}
                </div>
            ) : null}
            {tapping === false && state.holding === false && canTalk === true && pad?.startCard.length === 0 ? (
                <div className="talk-row">
                    {view?.tapToTalk === true && settings.talkButton === true && noMic === false ? <button className="tap-talk" disabled={view.talkWaiting === true} onClick={startTapping}>{view.talkWaiting === true ? "Wait" : "Tap to talk"}</button> : null}
                    <button className="type-instead" onClick={() => { setMenu("type"); }}>Type instead</button>
                </div>
            ) : null}
            {outOfDate === true ? <button className="update-note" onClick={() => { location.reload(); }}>New version available, reload</button> : null}
            {menu === "closed" ? null : (
                <div className="sheet-backdrop" onClick={(event) => { if (event.target === event.currentTarget) { setMenu("closed"); } }}>
                    <div className="sheet" data-scrolls role="dialog" aria-modal="true" aria-label="Your menu">
                        {menu === "open" ? (
                            <>
                                {invited !== "" ? <p className="invited" role="status">{invited}</p> : null}
                                {noMic === true ? <button onClick={() => { noMicRef.current = false; setNoMic(false); setMenu("closed"); void ensureMicrophone(); }}>Turn on your mic</button> : null}
                                {state.mic !== "ok" && noMic === false ? <button onClick={() => { setMenu("mic"); }}>Turn on your mic</button> : null}
                                <button onClick={() => { void invite(); }}>Invite someone</button>
                                {view !== null && (view.guests.canAdd === true || view.guests.seated.length > 0) ? <button onClick={() => { setMenu("guests"); }}>AI guests</button> : null}
                                {installWay !== null ? <button onClick={() => { setMenu("install"); }}>Add to your home screen</button> : null}
                                <button onClick={() => { setMenu("rename"); }}>Change your name</button>
                                <button onClick={() => { setMenu("leave"); }}>Leave the table</button>
                                <button onClick={() => { setMenu("settings"); }}>Settings</button>
                                <button className="text-link" onClick={() => { setMenu("credits"); }}>Credits</button>
                                <button className="quiet" onClick={() => { setMenu("closed"); setInvited(""); }}>Close</button>
                                <small className="version-line">{versionLine(__BUILD_INFO__)}</small>
                            </>
                        ) : null}
                        {menu === "mic" ? (
                            <>
                                <p>{micRetried === true ? "Still off." : "Your mic is off."} You can still swipe and tap. To talk:</p>
                                {state.mic === "refused"
                                    ? <ol className="mic-steps">{micSteps().map((step: string) => <li key={step}>{step}</li>)}</ol>
                                    : <p className="mic-note">Another app may be using it. Close that app, then try again.</p>}
                                <button className="primary" onClick={() => { void ensureMicrophone().then(() => { setMicRetried(true); }); }}>Try again</button>
                                {canTalk === true ? <button onClick={() => { setMenu("type"); setMicRetried(false); }}>Type instead</button> : null}
                                <button className="quiet" onClick={() => { setMenu("closed"); setMicRetried(false); }}>Keep playing without talking</button>
                            </>
                        ) : null}
                        {menu === "type" ? (
                            <form onSubmit={sendTyped}>
                                <label htmlFor="typed-line">Type what you'd say</label>
                                <input id="typed-line" name="typed" maxLength={200} autoComplete="off" enterKeyHint="send" autoFocus />
                                <button type="submit" className="primary">Send</button>
                                <button type="button" className="quiet" onClick={() => { setMenu("closed"); }}>Never mind</button>
                            </form>
                        ) : null}
                        {menu === "install" && installWay !== null ? <InstallCard way={installWay} onDone={() => { setMenu("closed"); }} /> : null}
                        {menu === "guests" ? (
                            <>
                                <p>Short of people? An AI guest takes a seat. It plays from its own phone, and it can't talk.</p>
                                <ul className="guest-list">
                                    {(view?.guests.seated ?? []).map((guest) => (
                                        <li key={guest.playerId}>
                                            <div><strong>{guest.name}</strong> <small className="guest-mark">AI guest</small><br />{guest.style}</div>
                                            {view?.guests.canRemove === true ? <button className="quiet" onClick={() => { send({ type: "guest", action: "remove", playerId: guest.playerId }); }}>Remove</button> : null}
                                        </li>
                                    ))}
                                </ul>
                                {view?.guests.canAdd === true ? <button className="primary" onClick={() => { send({ type: "guest", action: "add" }); }}>Add a guest</button> : null}
                                {view?.guests.canRemove === false && (view.guests.seated.length > 0) ? <p className="mic-note">Guests come and go between games.</p> : null}
                                <button className="quiet" onClick={() => { setMenu("open"); }}>Back</button>
                            </>
                        ) : null}
                        {menu === "settings" ? (
                            <>
                                <p>These stay on this phone.</p>
                                <SettingRow label={`${HOST_NAME}'s quick reactions`} on={settings.reactions} onChange={(on: boolean) => { changeSettings({ ...settings, reactions: on }); }} />
                                {"vibrate" in navigator ? <SettingRow label="Vibration" on={settings.vibration} onChange={(on: boolean) => { changeSettings({ ...settings, vibration: on }); }} /> : null}
                                {view?.tapToTalk === true ? <SettingRow label="To talk" on={settings.talkButton} onWord="Tap" offWord="Hold" onChange={(on: boolean) => { changeSettings({ ...settings, talkButton: on }); }} /> : null}
                                <button className="quiet" onClick={() => { setMenu("open"); }}>Back</button>
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
                                <input id="new-name" name="name" defaultValue={view?.playerName ?? ""} maxLength={24} autoComplete="nickname" autoCapitalize="words" autoFocus required />
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
