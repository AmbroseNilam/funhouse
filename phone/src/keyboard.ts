// Keeps a text box and its Send button above the on-screen keyboard. A phone's keyboard covers the
// page without resizing it, and every screen here is fixed to the full page, so nothing moves out
// of the way unless the browser happens to pan. While a box has focus, the screens are fitted to
// the part of the page that's really visible instead, whatever the browser did or didn't do.

/** How long a lost focus waits before the layout changes back, so a tap on Send lands on Send. */
const SETTLE_MILLISECONDS: number = 200;

/** Input types that don't bring up a keyboard. */
const NO_KEYBOARD: ReadonlySet<string> = new Set(["range", "button", "submit", "checkbox", "radio"]);

/**
 * Finds the box being typed in.
 * @returns the box, or null if nothing is taking typing.
 */
function typingBox(): HTMLInputElement | null {
    const active: Element | null = document.activeElement;
    return active instanceof HTMLInputElement && NO_KEYBOARD.has(active.type) === false ? active : null;
}

/**
 * Starts fitting the page to the keyboard.
 * @returns a function that stops.
 */
export function fitAboveKeyboard(): () => void {
    const viewport: VisualViewport | null = window.visualViewport;
    const root: HTMLElement = document.documentElement;
    if (viewport === null) {
        return (): void => { /* an old browser: it keeps its own panning */ };
    }
    let settleTimer: number = 0;

    const fit = (): void => {
        const box: HTMLInputElement | null = typingBox();
        if (box === null) {
            if (root.hasAttribute("data-typing") === true) {
                root.removeAttribute("data-typing");
                // A panned page can stay panned after the keyboard goes.
                window.scrollTo(0, 0);
            }
            return;
        }
        root.style.setProperty("--visible-top", `${viewport.offsetTop}px`);
        root.style.setProperty("--visible-height", `${viewport.height}px`);
        root.setAttribute("data-typing", "");
        // The whole form, so Send comes into view along with the box.
        (box.closest("form") ?? box).scrollIntoView({ block: "nearest" });
    };

    const focusOut = (): void => {
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(fit, SETTLE_MILLISECONDS);
    };

    document.addEventListener("focusin", fit);
    document.addEventListener("focusout", focusOut);
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return (): void => {
        window.clearTimeout(settleTimer);
        document.removeEventListener("focusin", fit);
        document.removeEventListener("focusout", focusOut);
        viewport.removeEventListener("resize", fit);
        viewport.removeEventListener("scroll", fit);
    };
}
