// The TV: the room's shelf and pages, the game on the table, the lantern, and what was just
// said. It draws what it is told and plays what it is sent. Phones play. A mouse on the TV that opened
// the room can steer the menus for whoever holds the controller, and never plays.

import { versionLine } from "../../shared/build-info.ts";
import { DRAIN_WARM_SECONDS, drainHidden, drainShown } from "../../shared/drain.ts";
import type { Turn } from "../../shared/turn.ts";
import { useCallback, useEffect, useReducer, useRef, useState, type AnimationEvent, type CSSProperties, type FormEvent, type ReactElement } from "react";
import { flushSync } from "react-dom";
import QRCode from "qrcode";
import type { Scene, SceneBlock } from "../../shared/scene.ts";
import { parseMessage, SERVER_SILENCE_LIMIT_MILLISECONDS, type RoomToScreenMessage, type ScreenMessage } from "../../shared/protocol.ts";
import { HOST_NAME } from "../../shared/brand.ts";
import type { NavAction, Seat, ShelfGame, ShellView } from "../../shared/shell.ts";
import { Caption } from "./Caption.tsx";
import { ConsolePage, GameOverMenu, PausePanel, SteppedOutPanel, type Pointing } from "./Console.tsx";
import type { HostMood } from "../../shared/hostMood.ts";
import { Lantern } from "./Lantern.tsx";
import { AgentCursors, nextSeatMove, type SeatMove } from "./AgentCursors.tsx";
import { PlaceCards } from "./PlaceCards.tsx";
import { startFrameMeter } from "./frameMeter.ts";
import { ConsoleSounds } from "./sounds.ts";
import { HostSpeaker } from "./speaker.ts";

/** How long a reveal waits before its scores start counting: the answer, then who got it, then the points. */
const COUNT_UP_DELAY_MILLISECONDS: number = 900;

/** How long a score takes to count up. */
const COUNT_UP_MILLISECONDS: number = 700;

/** What the drain bar sends when it starts to warm. */
const DRAIN_WARM_EVENT: string = "funhouse-drain-warm";

/** How long the TV's drumroll lasts: the same as the game's build. */
const DRUMROLL_SECONDS: number = 4;

/** Local state reduced from room messages. */
interface ScreenState {
    scene: Scene | null;
    joinUrl: string;
    roomCode: string;
    qrDataUrl: string;
    hostThinking: boolean;
    hostMood: HostMood | null;
    turn: Turn | null;
    hostSpeaking: boolean;
    hostName: string;
    connected: boolean;
    started: boolean;
    turnedAway: boolean;
    roomClosed: boolean;
    resting: boolean;
    shell: ShellView | null;
    /** True once the room has said this screen opened it, so its mouse counts. */
    steering: boolean;
}

/** Actions that change screen state. */
type ScreenAction =
    | { type: "message"; message: RoomToScreenMessage }
    | { type: "qr"; dataUrl: string }
    | { type: "connection"; connected: boolean }
    | { type: "started" }
    | { type: "turnedAway" }
    | { type: "roomClosed" }
    | { type: "resting" };

/** True on a plug-in console with no mouse: it lights itself, and the browser must allow autoplay. */
const ON_CONSOLE: boolean = new URLSearchParams(location.search).get("console") === "1";

if (new URLSearchParams(location.search).get("fps") === "1") {
    startFrameMeter();
}

/** True where a mouse can hover. A wall tablet has none, so a stray tap there never takes a seat. */
const HAS_MOUSE: boolean = matchMedia("(hover: hover)").matches === true;

/** How long the mouse cursor stays on show after it last moved. */
const POINTER_IDLE_MILLISECONDS: number = 3000;

/** How long a touched phone's seat stays lifted on the TV. */
const TOUCH_SHOWN_MILLISECONDS: number = 700;

/** How long a new arrival's seat stays lifted on the TV. */
const ARRIVAL_MILLISECONDS: number = 1500;

/** Longest wait between reconnect attempts. */
const MAX_RECONNECT_DELAY_MILLISECONDS: number = 5000;

/** Widest short side a device can have and still count as a phone; tablets make fine screens. */
const PHONE_SHORT_SIDE_PIXELS: number = 600;

/** True on a touch device with a phone-sized display, in either orientation. */
const ON_PHONE: boolean = matchMedia("(pointer: coarse)").matches === true && Math.min(screen.width, screen.height) <= PHONE_SHORT_SIDE_PIXELS;

const INITIAL_STATE: ScreenState = { scene: null, joinUrl: "", roomCode: "", qrDataUrl: "", hostThinking: false, hostMood: null, turn: null, hostSpeaking: false, hostName: "Host", connected: false, started: false, turnedAway: false, roomClosed: false, resting: false, shell: null, steering: false };

/**
 * Pure reducer from room messages to screen state.
 * @param state the current state.
 * @param action the change.
 * @returns the next state.
 */
function reduce(state: ScreenState, action: ScreenAction): ScreenState {
    if (action.type === "connection") {
        return { ...state, connected: action.connected, steering: action.connected === true && state.steering };
    }
    if (action.type === "turnedAway") {
        return { ...state, turnedAway: true };
    }
    if (action.type === "resting") {
        return { ...state, resting: true };
    }
    if (action.type === "roomClosed") {
        return { ...state, roomClosed: true };
    }
    if (action.type === "started") {
        return { ...state, started: true };
    }
    if (action.type === "qr") {
        return { ...state, qrDataUrl: action.dataUrl };
    }
    const message: RoomToScreenMessage = action.message;
    if (message.type === "screenKey") {
        return { ...state, steering: true };
    }
    if (message.type === "scene") {
        return { ...state, scene: message.scene, joinUrl: message.joinUrl, roomCode: message.roomCode, turn: message.turn };
    }
    if (message.type === "shell") {
        return { ...state, shell: message.view };
    }
    if (message.type === "hostState") {
        return { ...state, hostThinking: message.thinking, hostSpeaking: message.speaking, hostName: message.hostName, hostMood: message.mood };
    }
    return state;
}

/**
 * A timer that counts down on its own from when it first appears, so the room needn't send
 * a new scene every second.
 * @param props the starting seconds, whether it runs, and an optional label.
 * @returns the element.
 */
function Countdown(props: { seconds: number; running: boolean; label?: string }): ReactElement {
    const [left, setLeft] = useState<number>(props.seconds);
    const leftRef = useRef<number>(props.seconds);
    leftRef.current = left;
    const shownSecondsRef = useRef<number>(props.seconds);
    useEffect(() => {
        // New seconds from the room are the truth; the same seconds with the clock restarting means carry on from here.
        const from: number = shownSecondsRef.current === props.seconds ? leftRef.current : props.seconds;
        shownSecondsRef.current = props.seconds;
        setLeft(from);
        if (props.running === false) {
            return;
        }
        const startedAt: number = Date.now();
        const timer: number = window.setInterval(() => { setLeft(Math.max(0, from - Math.floor((Date.now() - startedAt) / 1000))); }, 250);
        return (): void => { window.clearInterval(timer); };
    }, [props.running, props.seconds]);
    return <div className="timer"><span>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>{props.label !== undefined ? <small>{props.label}</small> : null}</div>;
}

/**
 * The bar that drains over a question. CSS runs it and a pause holds it. As it warms, it tells the App,
 * which plays one soft sound.
 * @param props which clock, and how long it runs.
 * @returns the bar.
 */
function DrainBar({ clock, seconds }: { clock: string; seconds: number }): ReactElement {
    const [gone] = useState<number>(() => drainShown(clock));
    useEffect(() => () => { drainHidden(clock); }, [clock]);
    const onStart = (event: AnimationEvent): void => {
        if (event.animationName === "drain-warm") {
            window.dispatchEvent(new Event(DRAIN_WARM_EVENT));
        }
    };
    const style = { "--drain-seconds": `${seconds}s`, "--drain-gone": `${-gone}s`, "--drain-warm-at": `${seconds - DRAIN_WARM_SECONDS - gone}s` } as CSSProperties;
    return <div className="drain" role="timer" aria-label={`${seconds} seconds`} style={style}><i onAnimationStart={onStart} /></div>;
}

/**
 * A score counting up to where it landed, after a beat, so it lands after the answer lights.
 * @param props where it counts from and to.
 * @returns the number.
 */
function CountUp({ from, to }: { from: number; to: number }): ReactElement {
    const [shown, setShown] = useState<number>(from);
    useEffect(() => {
        if (from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches === true) {
            setShown(to);
            return undefined;
        }
        let frame: number = 0;
        const delay: number = window.setTimeout(() => {
            const began: number = performance.now();
            const step = (now: number): void => {
                const progress: number = Math.min(1, (now - began) / COUNT_UP_MILLISECONDS);
                setShown(Math.round(from + (to - from) * progress));
                if (progress < 1) {
                    frame = requestAnimationFrame(step);
                }
            };
            frame = requestAnimationFrame(step);
        }, COUNT_UP_DELAY_MILLISECONDS);
        return () => {
            window.clearTimeout(delay);
            cancelAnimationFrame(frame);
        };
    }, [from, to]);
    return <>{shown}</>;
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
    if (block.type === "painting") {
        return <figure key={block.key} className="painting" role="status"><i /><figcaption>{block.label}</figcaption></figure>;
    }
    if (block.type === "image") {
        return <figure key={index} className="image"><img src={block.src} alt={block.caption ?? ""} />{block.caption !== undefined ? <figcaption>{block.caption}</figcaption> : null}</figure>;
    }
    if (block.type === "gallery") {
        return (
            <ul key={index} className={`gallery ${block.items.length > 4 ? "many" : ""}`}>
                {block.items.map((item, place: number) => <li key={place}>{item.src === null ? <div className="gallery-empty" /> : <img src={item.src} alt="" />}<strong>{item.heading}</strong><span>{item.text}</span></li>)}
            </ul>
        );
    }
    if (block.type === "roster") {
        return <ul key={index} className="roster">{block.players.map((player) => <li key={player.playerId} className={`${player.speaking === true ? "speaking" : ""} ${player.badge === "out" ? "out" : ""}`}>{player.name}{player.badge !== undefined ? <small>{player.badge}</small> : null}</li>)}</ul>;
    }
    if (block.type === "drain") {
        return <DrainBar key={block.key} clock={block.key} seconds={block.seconds} />;
    }
    if (block.type === "timer") {
        return <Countdown key={`${index}-${block.label ?? ""}`} seconds={block.seconds} running={block.running} {...(block.label !== undefined ? { label: block.label } : {})} />;
    }
    if (block.type === "tally") {
        return <table key={index} className={`tally ${block.rows.length > 6 ? "many" : ""}`}><caption>{block.title}</caption><tbody>{block.rows.map((row) => <tr key={row.label} className={row.highlight === true || (row.gained ?? 0) > 0 ? "highlight" : ""}><td>{row.label}</td><td>{row.gained === undefined ? row.count : <CountUp to={row.count} from={row.count - row.gained} />}</td></tr>)}</tbody></table>;
    }
    if (block.type === "progress") {
        const marks: number[] = Array.from({ length: block.max }, (_unused: unknown, position: number) => position);
        return (
            <div key={index} className="progress">
                <span>{block.label}</span>
                <strong>{block.current} of {block.max}</strong>
                <div className={`marks marks-${block.marks ?? "card"}`}>{marks.map((position: number) => <i key={position} className={position < block.current ? "done" : ""} />)}</div>
            </div>
        );
    }
    if (block.type === "choices") {
        return <ol key={index} className={`answer-choices ${block.locked === true ? "locked" : ""} ${block.right === undefined ? "" : "revealed"}`}>{block.options.map((option: string, place: number) => <li key={option} className={place === block.right ? "right" : ""}>{option}</li>)}</ol>;
    }
    if (block.type === "board") {
        return (
            <ul key={index} className="board" style={{ gridTemplateColumns: `repeat(${block.columns}, 1fr)` }}>
                {block.cells.map((cell) => (
                    <li key={cell.text} className={`card-${cell.owner} ${cell.turned === true ? "turned" : "unturned"}`}>
                        <span>{cell.text}</span>
                        {cell.owned !== undefined ? <small>{cell.owned}</small> : null}
                    </li>
                ))}
            </ul>
        );
    }
    if (block.type === "moment") {
        return (
            <div key={`moment-${block.kind}-${block.heading}`} className={`moment moment-${block.kind}`}>
                {block.kind === "night" ? <div className="night-sky" aria-hidden="true"><i className="moon" /><i className="eyes"><b /><b /></i></div> : null}
                <div className="moment-card">
                    <strong>{block.heading}</strong>
                    {block.detail !== undefined ? <span>{block.detail}</span> : null}
                </div>
            </div>
        );
    }
    return <span key={index} hidden />;
}

/** Keys this page holds, kept here too in case the browser refuses storage. */
const screenKeys: Map<string, string> = new Map();

/**
 * Keeps the key that shows this screen opened a room, so a reload still counts. Per tab.
 * @param roomCode the room.
 * @param key the key.
 */
function rememberScreenKey(roomCode: string, key: string): void {
    screenKeys.set(roomCode, key);
    try {
        sessionStorage.setItem(`funhouse.screenKey.${roomCode}`, key);
    } catch {
        // The copy in memory still covers a dropped connection.
    }
}

/**
 * Finds this tab's key for a room.
 * @param roomCode the room.
 * @returns the key, or an empty string.
 */
function screenKey(roomCode: string): string {
    try {
        return screenKeys.get(roomCode) ?? sessionStorage.getItem(`funhouse.screenKey.${roomCode}`) ?? "";
    } catch {
        return screenKeys.get(roomCode) ?? "";
    }
}

/** The screen application. */
export function App(): ReactElement {
    const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
    const socketRef = useRef<WebSocket | null>(null);
    const speakerRef = useRef<HostSpeaker | null>(null);
    const micRef = useRef<{ level: number; at: number }>({ level: 0, at: 0 });
    const rootRef = useRef<HTMLElement | null>(null);
    const soundsRef = useRef<ConsoleSounds | null>(null);
    const leanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const previousShellRef = useRef<ShellView | null>(null);
    const screenRef = useRef<string>("");
    const [seatMoves, setSeatMoves] = useState<Record<string, SeatMove>>({});
    const newestShellRef = useRef<Extract<RoomToScreenMessage, { type: "shell" }> | null>(null);
    const wasOverRef = useRef<boolean>(false);
    const [touchedId, setTouchedId] = useState<string | null>(null);
    const touchTimerRef = useRef<number>(0);
    const [phoneGate, setPhoneGate] = useState<boolean>(ON_PHONE);

    /** Sends what the mouse chose; the room decides whether this screen may. */
    const navigate = useCallback((action: NavAction): void => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "nav", action } satisfies ScreenMessage));
        }
    }, []);

    // The cursor and the mouse's own buttons show only while a real mouse is moving. A touch never brings them up, so a wall tablet stays clean.
    useEffect(() => {
        let timer: number = 0;
        const moved = (event: PointerEvent): void => {
            if (ON_CONSOLE === true || event.pointerType !== "mouse" || rootRef.current === null) {
                return;
            }
            rootRef.current.dataset.pointer = "live";
            window.clearTimeout(timer);
            timer = window.setTimeout(() => { delete rootRef.current?.dataset.pointer; }, POINTER_IDLE_MILLISECONDS);
        };
        window.addEventListener("pointermove", moved);
        return (): void => {
            window.removeEventListener("pointermove", moved);
            window.clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        if (phoneGate === true) {
            return;
        }
        let stopped: boolean = false;
        let retryTimer: number = 0;
        let retryDelay: number = 500;
        let silenceTimer: number = 0;

        /** Restarts the wait for the server; a dead network sends no close, so this notices it. */
        const heardFromServer = (socket: WebSocket): void => {
            window.clearTimeout(silenceTimer);
            silenceTimer = window.setTimeout(() => { giveUpOn(socket); }, SERVER_SILENCE_LIMIT_MILLISECONDS);
        };

        /** Moves on from a socket that has gone silent at once, as a browser can take a long while to close a dead one. */
        const giveUpOn = (socket: WebSocket): void => {
            if (socketRef.current !== socket) {
                return;
            }
            socket.close();
            dispatch({ type: "connection", connected: false });
            window.clearTimeout(retryTimer);
            retryDelay = 500;
            connect();
        };

        /** Opens the socket; on close, retries with backoff so a network blip heals itself. */
        const connect = (): void => {
            const protocol: string = location.protocol === "https:" ? "wss" : "ws";
            const socket: WebSocket = new WebSocket(`${protocol}://${location.host}/ws/screen${location.search}`);
            socket.binaryType = "arraybuffer";
            socketRef.current = socket;
            socket.onopen = (): void => {
                retryDelay = 500;
                dispatch({ type: "connection", connected: true });
                const key: string = screenKey(new URLSearchParams(location.search).get("room") ?? "");
                if (key !== "") {
                    socket.send(JSON.stringify({ type: "claim", key } satisfies ScreenMessage));
                }
                // Already lit before the connection dropped, so the room needs to hear it again, without any fuss.
                if (speakerRef.current !== null) {
                    socket.send(JSON.stringify({ type: "ready", resumed: true } satisfies ScreenMessage));
                }
            };
            socket.onclose = (): void => {
                if (socketRef.current !== socket) {
                    return;
                }
                dispatch({ type: "connection", connected: false });
                if (stopped === true) {
                    return;
                }
                retryTimer = window.setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, MAX_RECONNECT_DELAY_MILLISECONDS);
            };
            heardFromServer(socket);
            socket.onmessage = (event: MessageEvent<string | ArrayBuffer>): void => {
                heardFromServer(socket);
                if (event.data instanceof ArrayBuffer) {
                    speakerRef.current?.play(event.data);
                    return;
                }
                const message: RoomToScreenMessage | null = parseMessage<RoomToScreenMessage>(event.data);
                if (message === null) {
                    return;
                }
                if (message.type === "screenKey") {
                    rememberScreenKey(message.roomCode, message.key);
                }
                if (message.type === "edge") {
                    soundsRef.current?.edge();
                    const focused: Element | null = document.querySelector(".focused");
                    focused?.animate([{ translate: "0 0" }, { translate: `${leanRef.current.x * 14}px ${leanRef.current.y * 14}px` }, { translate: "0 0" }], { duration: 220, easing: "ease-out" });
                    return;
                }
                if (message.type === "rejected" && message.reason === "roomClosed" && ON_CONSOLE === true) {
                    stopped = true;
                    location.replace("/screen/?console=1");
                    return;
                }
                if (message.type === "rejected") {
                    stopped = true;
                    speakerRef.current?.cancel();
                    dispatch({ type: message.reason === "resting" ? "resting" : message.reason === "roomClosed" ? "roomClosed" : "turnedAway" });
                    return;
                }
                if (message.type === "scene" && new URLSearchParams(location.search).get("room") !== message.roomCode) {
                    const search: URLSearchParams = new URLSearchParams(location.search);
                    search.set("room", message.roomCode);
                    history.replaceState(null, "", `?${search.toString()}`);
                }
                if (message.type === "audioCancel") {
                    speakerRef.current?.cancel();
                    return;
                }
                if (message.type === "lean") {
                    rootRef.current?.style.setProperty("--lean-x", String(message.x));
                    rootRef.current?.style.setProperty("--lean-y", String(message.y));
                    leanRef.current = message;
                    return;
                }
                if (message.type === "heardYou") {
                    setTouchedId(message.playerId);
                    window.clearTimeout(touchTimerRef.current);
                    touchTimerRef.current = window.setTimeout(() => { setTouchedId(null); }, TOUCH_SHOWN_MILLISECONDS);
                    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches === false) {
                        document.querySelector(".host-spot .lantern-body")?.animate([{ translate: "0 0" }, { translate: "0 10px" }, { translate: "0 0" }], { duration: 260, easing: "ease-out" });
                    }
                    return;
                }
                if (message.type === "seatActivity") {
                    setSeatMoves((moves: Record<string, SeatMove>) => ({ ...moves, [message.playerId]: nextSeatMove(moves[message.playerId], message.activity, message.line, Date.now()) }));
                    return;
                }
                if (message.type === "seatMovesCleared") {
                    setSeatMoves({});
                    return;
                }
                if (message.type === "seatTouched") {
                    setTouchedId(message.playerId);
                    window.clearTimeout(touchTimerRef.current);
                    touchTimerRef.current = window.setTimeout(() => { setTouchedId(null); }, TOUCH_SHOWN_MILLISECONDS);
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
                if (message.type === "shell") {
                    newestShellRef.current = message;
                }
                if (message.type === "shell" && message.view.screen !== screenRef.current && "startViewTransition" in document && soundsRef.current !== null) {
                    screenRef.current = message.view.screen;
                    // The transition applies its change a moment later, so it takes the newest console: an older one would overwrite anything that arrived since.
                    const transition: ViewTransition = document.startViewTransition(() => { flushSync(() => { dispatch({ type: "message", message: newestShellRef.current ?? message }); }); });
                    transition.ready.catch(() => { /* a hidden page can't animate, and the change still applies */ });
                    return;
                }
                if (message.type === "shell") {
                    screenRef.current = message.view.screen;
                }
                dispatch({ type: "message", message });
            };
        };

        connect();
        return (): void => {
            stopped = true;
            window.clearTimeout(retryTimer);
            window.clearTimeout(silenceTimer);
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [phoneGate]);

    /** Unlocks audio with the click browsers require, then tells the room the screen is live. */
    const start = (): void => {
        const speaker: HostSpeaker = new HostSpeaker();
        const sounds: ConsoleSounds = new ConsoleSounds();
        soundsRef.current = sounds;
        dispatch({ type: "started" });
        if (ON_CONSOLE === false) {
            document.documentElement.requestFullscreen().catch(() => { /* a browser may refuse, and the page works either way */ });
        }
        sounds.start().then(() => { sounds.light(); }).catch((error: unknown) => { console.error("sounds failed:", error); });
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
        QRCode.toDataURL(state.joinUrl, { margin: 1, width: 480, color: { dark: "#17110c", light: "#efe3c8" } }).then((dataUrl: string) => {
            if (cancelled === false) {
                dispatch({ type: "qr", dataUrl });
            }
        }).catch((error: unknown) => { console.error("QR render failed:", error); });
        return (): void => { cancelled = true; };
    }, [state.joinUrl]);

    const connected: boolean = state.connected;
    const started: boolean = state.started;
    useEffect(() => {
        if (ON_CONSOLE === true && connected === true && started === false) {
            start();
        }
        // Only the moment it connects matters; start reads everything else when it runs.
    }, [connected, started]);

    useEffect(() => {
        const hurry = (): void => { soundsRef.current?.hurry(); };
        window.addEventListener(DRAIN_WARM_EVENT, hurry);
        return () => { window.removeEventListener(DRAIN_WARM_EVENT, hurry); };
    }, []);

    // The reveal's sounds follow the scene, so a TV that comes back mid-reveal joins in without a false start.
    const choicesBlock = state.scene?.blocks.find((block: SceneBlock) => block.type === "choices");
    const revealStage: string = choicesBlock?.type !== "choices" ? "" : choicesBlock.locked === true ? "locked" : choicesBlock.right !== undefined ? "right" : "";
    useEffect(() => {
        if (revealStage === "locked") {
            soundsRef.current?.drumroll(DRUMROLL_SECONDS);
        }
        if (revealStage === "right") {
            soundsRef.current?.reveal();
        }
    }, [revealStage]);

    useEffect(() => {
        const previous: ShellView | null = previousShellRef.current;
        const shell: ShellView | null = state.shell;
        previousShellRef.current = shell;
        const sounds: ConsoleSounds | null = soundsRef.current;
        if (previous === null || shell === null || sounds === null) {
            return;
        }
        const newcomer: Seat | undefined = shell.seats.find((seat: Seat) => previous.seats.some((before: Seat) => before.playerId === seat.playerId) === false);
        if (newcomer !== undefined) {
            sounds.sitDown();
            setTouchedId(newcomer.playerId);
            window.clearTimeout(touchTimerRef.current);
            touchTimerRef.current = window.setTimeout(() => { setTouchedId(null); }, ARRIVAL_MILLISECONDS);
        }
        if (previous.screen !== shell.screen) {
            const backing: boolean = shell.screen === "home" || (previous.screen === "howTo" && shell.screen === "pause") || (previous.screen === "pause" && shell.screen === "play");
            if (backing === true) {
                sounds.back();
                return;
            }
            sounds.select();
            return;
        }
        if (previous.focus !== shell.focus) {
            sounds.tick(shell.focus);
        }
    }, [state.shell]);

    const mood: string = state.scene?.mood ?? "neutral";
    const isOver: boolean = state.shell?.gameOver === true;
    useEffect(() => {
        if (isOver === true && wasOverRef.current === false) {
            if (mood === "victory") {
                soundsRef.current?.win();
            }
            if (mood !== "victory") {
                soundsRef.current?.lose();
            }
        }
        wasOverRef.current = isOver;
    }, [isOver, mood]);

    useEffect(() => { soundsRef.current?.duck(state.hostSpeaking); }, [state.hostSpeaking]);

    if (phoneGate === true) {
        return (
            <main className="phone-gate">
                <h1>This one's for the big screen.</h1>
                <p>Open it on a TV or laptop. Your phone is the controller.</p>
                <a className="phone-gate-join" href="/">Join a room instead</a>
                <button className="phone-gate-continue" onClick={() => { setPhoneGate(false); }}>Use this screen anyway</button>
            </main>
        );
    }

    if (state.turnedAway === true) {
        return (
            <main className="phone-gate">
                <h1>Every table's taken.</h1>
                <p>Try again in a few minutes.</p>
            </main>
        );
    }

    if (state.resting === true) {
        return (
            <main className="phone-gate">
                <h1>Marlowe needs rest.</h1>
                <p>Come back tomorrow.</p>
                <form className="judge-form" onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const entered: FormDataEntryValue | null = new FormData(event.currentTarget).get("code");
                    const code: string = typeof entered === "string" ? entered : "";
                    void fetch("/pass", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) }).then((response: Response) => {
                        if (response.ok === true) {
                            location.assign("/screen/");
                        }
                    });
                }}>
                    <input name="code" aria-label="Have a code?" type="password" autoComplete="off" placeholder="Have a code?" />
                    <button type="submit">Use code</button>
                </form>
            </main>
        );
    }

    if (state.roomClosed === true) {
        return (
            <main className="tv on-home">
                <button className="sound-gate" onClick={() => {
                    // A new room keeps whatever this one was opened to try, but not its code.
                    const search: URLSearchParams = new URLSearchParams(location.search);
                    search.delete("room");
                    location.assign(`/screen/?${search.toString()}`);
                }} autoFocus>
                    <Lantern micRef={micRef} speakerRef={speakerRef} awake={false} thinking={false} speaking={false} look={0} />
                    <span className="gate-title">This room has closed</span>
                    <span className="gate-detail">A new room gets a new code, so everyone will need to join again.</span>
                    <span className="gate-action">Open a new room</span>
                </button>
            </main>
        );
    }

    const caption: { speaker: string; text: string; final: boolean } | null = (() => {
        const block = state.scene?.blocks.find((candidate: SceneBlock) => candidate.type === "caption");
        return block?.type === "caption" ? { speaker: block.speaker, text: block.text, final: block.final } : null;
    })();
    const shell: ShellView | null = state.shell;
    const seats: Seat[] = shell?.seats ?? [];
    const driver: Seat | undefined = seats.find((seat: Seat) => seat.driving === true);
    const game: ShelfGame | undefined = shell?.games.find((candidate: ShelfGame) => candidate.id === shell.gameId);
    const playing: boolean = shell?.screen === "play" || shell?.screen === "pause" || shell?.screen === "howTo" || shell?.screen === "confirmEnd";
    const stageMood: string = playing === true ? mood : "room";
    const look: number = shell?.screen === "home" ? (shell.focus - 1.5) / 2 : 0;
    const backdrop: string | undefined = state.scene?.backdrop ?? (game === undefined ? undefined : `art/posters/${game.id}.webp`);
    const joinHost: string = state.joinUrl === "" ? "" : new URL(state.joinUrl).host;
    // Only the TV that opened the room gets a mouse, only where a mouse exists, and it never takes a seat.
    const pointing: Pointing = ON_CONSOLE === false && HAS_MOUSE === true && state.started === true && state.steering === true ? navigate : null;
    const backLabel: string | null = shell?.screen === "pick" || shell?.screen === "startCard" ? "Back" : (shell?.screen === "play" && shell.gameOver === false) || shell?.screen === "setup" ? "Pause" : null;
    return (
        <main ref={rootRef} className={`tv mood-${stageMood} on-${shell?.screen ?? "home"} ${isOver === true ? "over" : ""} ${state.started === true ? "lit" : ""}`} data-connected={state.connected}>
            <small className="build-tag">{versionLine(__BUILD_INFO__)}</small>
            {playing === true ? (
                <section className="screen play-screen">
                    {backdrop !== undefined ? <img key={backdrop} className="backdrop" src={backdrop} alt="" onError={(event) => { if (game !== undefined && event.currentTarget.getAttribute("src") !== game.art) { event.currentTarget.src = game.art; } }} style={{ viewTransitionName: `box-${game?.id ?? "game"}` }} /> : null}
                    <div className="play-column">
                        {state.turn !== null && state.turn.label !== "" ? <p className="turn-label">{state.turn.label}</p> : null}
                        <div className="blocks">{state.scene?.blocks.map(renderBlock)}</div>
                    </div>
                    {shell?.gameOver === true ? <GameOverMenu shell={shell} driver={driver} pointing={pointing} /> : null}
                    <aside className="corner-tag"><strong>{state.roomCode}</strong><small>{joinHost}</small></aside>
                </section>
            ) : null}
            {shell !== null && playing === false ? <ConsolePage shell={shell} qr={state.qrDataUrl} code={state.roomCode} joinHost={joinHost} pointing={pointing} /> : null}
            <div className="table-edge" />
            {state.started === true ? <PlaceCards seats={seats} turn={playing === true ? state.turn : null} touchedId={touchedId} /> : null}
            {state.started === true ? <AgentCursors seats={seats} moves={seatMoves} /> : null}
            <div className="host-spot">
                <Lantern
                    micRef={micRef}
                    speakerRef={speakerRef}
                    awake={state.started}
                    thinking={state.hostThinking}
                    speaking={state.hostSpeaking}
                    look={look}
                    mood={state.hostMood}
                />
                {caption !== null ? <Caption speaker={caption.speaker} text={caption.text} final={caption.final} host={caption.speaker === state.hostName} /> : null}
            </div>
            {shell?.steppedOut === true ? <SteppedOutPanel qr={state.qrDataUrl} code={state.roomCode} joinHost={joinHost} /> : null}
            {shell?.steppedOut !== true && (shell?.screen === "pause" || shell?.screen === "howTo" || shell?.screen === "confirmEnd") ? <PausePanel shell={shell} driver={driver} game={game} qr={state.qrDataUrl} code={state.roomCode} joinHost={joinHost} pointing={pointing} /> : null}
            {pointing !== null && backLabel !== null ? <div className="tv-strip"><button className="tv-button" onClick={() => { pointing({ kind: "back" }); }}>{backLabel}</button></div> : null}
            {state.connected === false && state.started === true ? <p className="reconnecting">Reconnecting…</p> : null}
            {state.started === false ? (
                <button key={state.connected === true ? "ready" : "connecting"} className="sound-gate" disabled={state.connected === false} onClick={start} autoFocus>
                    <Lantern micRef={micRef} speakerRef={speakerRef} awake={false} thinking={false} speaking={false} look={0} />
                    <span className="gate-title">{state.connected === true ? "Turn your sound on" : "Connecting…"}</span>
                    {state.connected === true ? <span className="gate-detail">{HOST_NAME} hosts the game out loud. The game opens full screen.</span> : null}
                    {state.connected === true ? <span className="gate-action">Start</span> : null}
                </button>
            ) : null}
        </main>
    );
}
