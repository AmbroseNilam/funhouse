// Turns raw touches on the phone's surface into the console's three gestures: slide, tap and
// hold. Designed to be used without looking, so it decides quickly and never asks for precision.
// A slide moves in discrete steps and leans in between, so the TV feels attached to the thumb.

import type { NavAxis } from "../../shared/shell.ts";

/** Movement that decides a touch is a slide. */
const SLIDE_START_PIXELS: number = 10;

/** Press time that decides a still touch is a hold. */
const HOLD_MILLISECONDS: number = 300;

/** Travel before the first step. */
const FIRST_STEP_PIXELS: number = 30;

/** Travel for each step after that. */
const NEXT_STEP_PIXELS: number = 70;

/** What the surface reports. */
export interface GestureHandlers {
    /** The current axis swipes move along. */
    axis(): NavAxis;
    /** A finger came down or moved, in element coordinates. */
    touch(x: number, y: number): void;
    /** The finger lifted. */
    lifted(): void;
    /** The highlight should move this many items. */
    step(delta: number): void;
    /** How far toward the next step the thumb is, from -1 to 1 on each axis. */
    lean(x: number, y: number): void;
    tap(): void;
    holdStart(): void;
    holdEnd(): void;
}

/**
 * Number of steps a thumb's travel has earned; reversing takes them back.
 * @param travel signed distance along the axis.
 * @returns signed whole steps.
 */
function stepsFor(travel: number): number {
    const distance: number = Math.abs(travel);
    if (distance < FIRST_STEP_PIXELS) {
        return 0;
    }
    return Math.sign(travel) * (1 + Math.floor((distance - FIRST_STEP_PIXELS) / NEXT_STEP_PIXELS));
}

/**
 * Listens for gestures on an element.
 * @param surface the element.
 * @param handlers what to call.
 * @returns a function that stops listening.
 */
export function listenForGestures(surface: HTMLElement, handlers: GestureHandlers): () => void {
    let mode: "none" | "pending" | "slide" | "hold" = "none";
    let startX: number = 0;
    let startY: number = 0;
    let stepsTaken: number = 0;
    let lockedAxis: "x" | "y" = "x";
    let holdTimer: number = 0;

    const down = (event: PointerEvent): void => {
        // A right or middle mouse button isn't a thumb; a finger always reports as the main button.
        if (event.button !== 0) {
            return;
        }
        surface.setPointerCapture(event.pointerId);
        mode = "pending";
        startX = event.clientX;
        startY = event.clientY;
        stepsTaken = 0;
        handlers.touch(event.clientX, event.clientY);
        holdTimer = window.setTimeout(() => {
            if (mode === "pending") {
                mode = "hold";
                handlers.holdStart();
            }
        }, HOLD_MILLISECONDS);
    };

    const move = (event: PointerEvent): void => {
        if (mode === "none") {
            return;
        }
        handlers.touch(event.clientX, event.clientY);
        const dx: number = event.clientX - startX;
        const dy: number = event.clientY - startY;
        if (mode === "pending" && Math.hypot(dx, dy) >= SLIDE_START_PIXELS) {
            mode = "slide";
            window.clearTimeout(holdTimer);
            lockedAxis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        }
        if (mode !== "slide" || handlers.axis() !== lockedAxis) {
            return;
        }
        const travel: number = lockedAxis === "x" ? dx : dy;
        const steps: number = stepsFor(travel);
        if (steps !== stepsTaken) {
            handlers.step(steps - stepsTaken);
            stepsTaken = steps;
        }
        const span: number = stepsTaken === 0 ? FIRST_STEP_PIXELS : NEXT_STEP_PIXELS;
        const anchor: number = stepsTaken === 0 ? 0 : Math.sign(stepsTaken) * (FIRST_STEP_PIXELS + (Math.abs(stepsTaken) - 1) * NEXT_STEP_PIXELS);
        const lean: number = Math.max(-1, Math.min(1, (travel - anchor) / span));
        handlers.lean(lockedAxis === "x" ? lean : 0, lockedAxis === "y" ? lean : 0);
    };

    const up = (): void => {
        window.clearTimeout(holdTimer);
        const was: typeof mode = mode;
        mode = "none";
        handlers.lifted();
        if (was === "pending") {
            handlers.tap();
        }
        if (was === "hold") {
            handlers.holdEnd();
        }
        if (was === "slide") {
            handlers.lean(0, 0);
        }
    };

    const cancel = (): void => {
        window.clearTimeout(holdTimer);
        const was: typeof mode = mode;
        mode = "none";
        handlers.lifted();
        if (was === "hold") {
            handlers.holdEnd();
        }
    };

    surface.addEventListener("pointerdown", down);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", up);
    surface.addEventListener("pointercancel", cancel);
    return (): void => {
        window.clearTimeout(holdTimer);
        surface.removeEventListener("pointerdown", down);
        surface.removeEventListener("pointermove", move);
        surface.removeEventListener("pointerup", up);
        surface.removeEventListener("pointercancel", cancel);
    };
}

/**
 * Stops the browser's own gestures from leaking through: pull to refresh, swipe back, and the
 * long-press callout. Scrolling stays allowed inside anything marked data-scrolls.
 * @returns a function that lets them back.
 */
export function blockBrowserGestures(): () => void {
    const EDGE_PIXELS: number = 20;
    const start = (event: TouchEvent): void => {
        const touch: Touch | undefined = event.touches[0];
        const onControl: boolean = event.target instanceof Element && event.target.closest("button, input, a") !== null;
        if (touch !== undefined && onControl === false && (touch.clientX < EDGE_PIXELS || touch.clientX > window.innerWidth - EDGE_PIXELS)) {
            event.preventDefault();
        }
    };
    const move = (event: TouchEvent): void => {
        if (event.target instanceof Element && event.target.closest("[data-scrolls]") !== null) {
            return;
        }
        event.preventDefault();
    };
    const menu = (event: Event): void => { event.preventDefault(); };
    document.addEventListener("touchstart", start, { passive: false });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("contextmenu", menu);
    return (): void => {
        document.removeEventListener("touchstart", start);
        document.removeEventListener("touchmove", move);
        document.removeEventListener("contextmenu", menu);
    };
}
