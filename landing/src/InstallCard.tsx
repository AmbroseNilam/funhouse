// Offers to keep the site on the home screen, with the steps for the phone in the visitor's hand.
// Android hands over to the browser's real install prompt; iPhones can't be prompted, so a small
// drawing and three steps show the way. Nothing shows once installed, on a big screen, or in an
// app's built-in browser, which has no way to add to the home screen.

import "./install-card.css";
import { useEffect, useState, type ReactElement } from "react";
import { PRODUCT_NAME } from "../../shared/brand.ts";

/** The browser's install event, which TypeScript doesn't describe. */
interface InstallEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Where a visitor's "not now" is remembered. */
const DISMISSED_KEY: string = "funhouse-install-dismissed";

/** Widest screen that counts as a phone, in pixels. */
const PHONE_WIDTH: number = 820;

/** Browsers built into other apps, which can't add to a home screen. */
const IN_APP_BROWSER: RegExp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|Snapchat|GSA\//;

let waitingPrompt: InstallEvent | null = null;
const promptListeners: Set<() => void> = new Set();

// The event can fire before anything has mounted, so it's caught as soon as this file loads.
addEventListener("beforeinstallprompt", (event: Event) => {
    event.preventDefault();
    waitingPrompt = event as InstallEvent;
    promptListeners.forEach((listener: () => void) => { listener(); });
});

/** What this phone needs to be told. */
export type InstallWay = "prompt" | "safari" | "safariOlder" | "chromeOnIphone";

/**
 * Whether this page is already running from the home screen.
 * @returns true when installed.
 */
function isInstalled(): boolean {
    return matchMedia("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Works out how this device adds to a home screen.
 * @returns the way, or null when there's nothing useful to offer.
 */
function installWay(): InstallWay | null {
    if (isInstalled() === true || innerWidth > PHONE_WIDTH || navigator.maxTouchPoints === 0) {
        return null;
    }
    if (waitingPrompt !== null) {
        return "prompt";
    }
    const agent: string = navigator.userAgent;
    if (/iPhone|iPod/.test(agent) === false || IN_APP_BROWSER.test(agent) === true) {
        return null;
    }
    if (agent.includes("CriOS") === true) {
        return "chromeOnIphone";
    }
    if (/FxiOS|EdgiOS|OPiOS/.test(agent) === true) {
        return null;
    }
    const version: RegExpMatchArray | null = /Version\/(\d+)/.exec(agent);
    return version !== null && Number(version[1]) >= 26 ? "safari" : "safariOlder";
}

/**
 * Whether the visitor has already said not now.
 * @returns true when dismissed. Blocked storage counts as not dismissed.
 */
function wasDismissed(): boolean {
    try {
        return localStorage.getItem(DISMISSED_KEY) !== null;
    } catch {
        return false;
    }
}

/** Remembers that the visitor said not now. */
function rememberDismissed(): void {
    try {
        localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
        // Private browsing or blocked storage: it just comes back next visit.
    }
}

/**
 * Watches for how this device can install, as the browser's event may come late.
 * @returns the way, or null when there's nothing to offer.
 */
export function useInstallWay(): InstallWay | null {
    const [way, setWay] = useState<InstallWay | null>(installWay);
    useEffect(() => {
        const update = (): void => { setWay(installWay()); };
        promptListeners.add(update);
        addEventListener("appinstalled", update);
        return (): void => {
            promptListeners.delete(update);
            removeEventListener("appinstalled", update);
        };
    }, []);
    return way;
}

/**
 * Whether to bring the offer up unasked.
 * @returns true when the visitor hasn't turned it down.
 */
export function mayOfferInstall(): boolean {
    return wasDismissed() === false;
}

/** The steps for each kind of phone that has to do it by hand. */
const STEPS: Record<Exclude<InstallWay, "prompt">, string[]> = {
    safari: ["Tap the three dots beside the address.", "Tap Share, then View More.", "Tap Add to Home Screen, then Add."],
    safariOlder: ["Tap the Share button.", "Scroll down and tap Add to Home Screen.", "Tap Add."],
    chromeOnIphone: ["Tap the Share button by the address.", "Tap Add to Home Screen. It may be under More.", "Tap Add."],
};

/**
 * A little phone: the browser's button lights up, a menu rises, and the lantern lands on the home
 * screen. Drawn here, in the same shapes as the app icon.
 * @param props the way, which decides the button drawn.
 * @returns the drawing.
 */
function InstallDrawing(props: { way: InstallWay }): ReactElement {
    return (
        <svg className="install-drawing" viewBox="0 0 120 200" aria-hidden="true">
            <rect x="6" y="4" width="108" height="192" rx="14" className="install-body" />
            <rect x="12" y="10" width="96" height="180" rx="9" className="install-screen" />
            {[0, 1, 2].flatMap((row: number) => [0, 1, 2].map((column: number) => (
                row === 1 && column === 1 ? null : <rect key={`${row}-${column}`} x={22 + column * 28} y={22 + row * 30} width="20" height="20" rx="5" className="install-tile" />
            )))}
            <g className="install-lantern">
                <rect x="46" y="48" width="28" height="28" rx="7" className="install-icon" />
                <path d="M55 56c0-4 10-4 10 0" className="install-handle" />
                <path d="M54 56h12l2 3H52z" className="install-brass" />
                <path d="M53 59h14l2 3v7l-2 2H53l-2-2v-7z" className="install-glass" />
                <path d="M51 71h18l1 3H50z" className="install-brass" />
                <circle cx="57" cy="64" r="1.2" className="install-face" />
                <circle cx="63" cy="64" r="1.2" className="install-face" />
            </g>
            {props.way === "prompt" ? null : (
                <g className="install-browser">
                    <g className="install-menu">
                        <rect x="22" y="104" width="76" height="52" className="install-slip" />
                        <rect x="30" y="112" width="60" height="6" className="install-line" />
                        <rect x="30" y="124" width="60" height="6" className="install-line" />
                        <rect x="27" y="134" width="66" height="14" className="install-chosen" />
                        <path d="M60 137v8M56 141h8" className="install-plus" />
                    </g>
                    <rect x="20" y="166" width="80" height="16" rx="3" className="install-bar" />
                    {props.way === "safari"
                        ? <g className="install-button"><circle cx="82" cy="174" r="1.6" /><circle cx="88" cy="174" r="1.6" /><circle cx="94" cy="174" r="1.6" /></g>
                        : <g className="install-button install-share"><path d="M84 173v6h8v-6M88 176v-8M85 170l3-3 3 3" /></g>}
                </g>
            )}
        </svg>
    );
}

/**
 * The offer itself.
 * @param props the way, and what to do when it's done with.
 * @returns the card.
 */
export function InstallCard(props: { way: InstallWay; onDone(): void }): ReactElement {
    const dismiss = (): void => {
        rememberDismissed();
        props.onDone();
    };
    const install = (): void => {
        if (waitingPrompt === null) {
            props.onDone();
            return;
        }
        const event: InstallEvent = waitingPrompt;
        waitingPrompt = null;
        // Called inside the tap, because the browser only allows the prompt there.
        void event.prompt().then(async () => event.userChoice).then((choice) => {
            if (choice.outcome === "accepted") {
                rememberDismissed();
            }
            props.onDone();
        });
    };
    return (
        <div className="install-card">
            <InstallDrawing way={props.way} />
            <div className="install-words">
                <strong>Keep {PRODUCT_NAME} on your home screen</strong>
                <p>It opens full screen, without the browser around it.</p>
                {props.way === "prompt" ? null : (
                    <ol>{STEPS[props.way].map((step: string) => <li key={step}>{step}</li>)}</ol>
                )}
                <div className="install-actions">
                    {props.way === "prompt" ? <button type="button" className="install-add" onClick={install}>Add it</button> : null}
                    <button type="button" className="install-later" onClick={dismiss}>Not now</button>
                </div>
            </div>
        </div>
    );
}
