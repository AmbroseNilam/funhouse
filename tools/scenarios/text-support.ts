// Helpers the typing-game scenarios share: finding a phone's text box, typing into it past the
// room's pace limit, trying a hostile line and checking it was refused, and searching everything a
// phone or the TV has ever shown for text that must never have reached it. Test tooling, not the
// server: it prints what players say to the terminal it runs in, which the room's own log never does.

import type { Control, PhoneView } from "../../shared/controls.ts";
import type { Scene } from "../../shared/scene.ts";
import { FakePhone, waitFor, type FakeScreen } from "../simulate.ts";

/** Milliseconds between one phone's typed answers; the room drops a second answer sooner than this. */
const ANSWER_GAP_MILLISECONDS: number = 1300;

/** One fake player. */
export interface Seat {
    name: string;
    phone: FakePhone;
}

/** The text box on a phone, if it has one. */
export interface TextBox {
    id: string;
    note: string | undefined;
}

/**
 * Waits.
 * @param milliseconds how long.
 */
export async function pause(milliseconds: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); });
}

/**
 * Seats fake players and waits for the room to see them all.
 * @param screen the TV.
 * @param names who joins.
 * @returns the seats.
 */
export async function seatPlayers(screen: FakeScreen, names: string[]): Promise<Seat[]> {
    await waitFor(() => screen.code !== "", "a room");
    const seats: Seat[] = names.map((name: string) => ({ name, phone: new FakePhone(screen.code, name) }));
    await waitFor(() => screen.shell?.seats.length === seats.length, "every phone to join");
    return seats;
}

/**
 * The text box a view shows.
 * @param view a phone's view.
 * @returns the box, or null.
 */
export function boxIn(view: PhoneView | null): TextBox | null {
    const control: Control | undefined = view?.controls.find((candidate: Control) => candidate.type === "textInput");
    return control?.type === "textInput" ? { id: control.id, note: control.note } : null;
}

/**
 * Every string in a phone's controls.
 * @param view a phone's view.
 * @returns the strings.
 */
export function phoneStrings(view: PhoneView): string[] {
    return view.controls.flatMap((control: Control) => {
        if (control.type === "waiting" || control.type === "notice") {
            return [control.text];
        }
        if (control.type === "roleCard") {
            return [control.title, control.body];
        }
        if (control.type === "buttons" || control.type === "choice") {
            return [control.prompt ?? "", ...control.options.map((option) => option.label)];
        }
        return control.type === "drain" ? [] : [control.prompt, control.note ?? ""];
    });
}

/**
 * Every string a scene shows.
 * @param scene a scene.
 * @returns the strings.
 */
export function sceneStrings(scene: Scene): string[] {
    return scene.blocks.flatMap((block) => {
        if (block.type === "title") {
            return [block.text, block.kicker ?? ""];
        }
        if (block.type === "text") {
            return [block.text];
        }
        if (block.type === "gallery") {
            return block.items.flatMap((item) => [item.heading, item.text]);
        }
        if (block.type === "tally") {
            return [block.title, ...block.rows.map((row) => row.label)];
        }
        if (block.type === "roster") {
            return block.players.map((player) => `${player.name} ${player.badge ?? ""}`);
        }
        if (block.type === "progress" || block.type === "timer") {
            return [block.label ?? ""];
        }
        return [];
    });
}

/**
 * Letters only, lower case, so text is found however it is spaced.
 * @param text any text.
 * @returns the squashed text.
 */
export function squash(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Everything the TV has shown or the host said, as one string.
 * @param screen the TV.
 * @returns the text.
 */
export function everythingOnScreen(screen: FakeScreen): string {
    return [...screen.scenes.flatMap(sceneStrings), ...screen.hostLines].join(" ");
}

/**
 * Everything a phone has ever shown, as one string.
 * @param seat the player.
 * @returns the text.
 */
export function everythingOnPhone(seat: Seat): string {
    return seat.phone.views.flatMap(phoneStrings).join(" ");
}

/**
 * Fails when text appears anywhere it must not have: the TV, the host, or any phone but the ones allowed.
 * @param what names the text for the failure.
 * @param text the text that must not have been seen.
 * @param screen the TV, or null to skip it and the host.
 * @param seats every player.
 * @param allowed names of the players who may have seen it.
 */
export function assertNeverSeen(what: string, text: string, screen: FakeScreen | null, seats: Seat[], allowed: string[] = []): void {
    const needle: string = squash(text);
    if (screen !== null && squash(everythingOnScreen(screen)).includes(needle) === true) {
        throw new Error(`${what} reached the TV or the host.`);
    }
    for (const seat of seats) {
        if (allowed.includes(seat.name) === false && squash(everythingOnPhone(seat)).includes(needle) === true) {
            throw new Error(`${what} reached ${seat.name}'s phone.`);
        }
    }
    console.warn(`  ok: ${what} stayed where it should`);
}

/**
 * The seats whose phones have a text box open.
 * @param seats every player.
 * @returns those seats.
 */
export function writersOf(seats: Seat[]): Seat[] {
    return seats.filter((seat: Seat) => boxIn(seat.phone.view) !== null);
}

/**
 * Types into a seat's box once it is open, waiting out the room's pace limit first.
 * @param seat who types.
 * @param text what they type.
 */
export async function typeInto(seat: Seat, text: string): Promise<void> {
    await waitFor(() => boxIn(seat.phone.view) !== null, `${seat.name}'s box`);
    await pause(ANSWER_GAP_MILLISECONDS);
    seat.phone.answer(boxIn(seat.phone.view)?.id ?? "", text);
}

/**
 * Types a line the room must refuse, and checks the box stays open with a note and the line goes
 * nowhere: not to the TV, not to the host, not to another phone.
 * @param seat who types.
 * @param text the hostile line.
 * @param label names the attempt for the output.
 * @param screen the TV.
 * @param seats every player.
 */
export async function typeRefused(seat: Seat, text: string, label: string, screen: FakeScreen, seats: Seat[]): Promise<void> {
    await typeInto(seat, text);
    await pause(400);
    await waitFor(() => boxIn(seat.phone.view)?.note !== undefined || seat.phone.view?.controls.some((control) => control.type === "notice" && control.text === "Sent.") === true, `the result for ${label}`);
    await pause(400);
    if (boxIn(seat.phone.view) === null) {
        throw new Error(`${label} was accepted.`);
    }
    console.warn(`  ok: ${label} was refused and the box stayed open`);
    const marker: string = squash(text).slice(0, 18);
    const onScreen: boolean = squash(everythingOnScreen(screen)).includes(marker);
    const onAnotherPhone: boolean = seats.some((other: Seat) => other !== seat && squash(everythingOnPhone(other)).includes(marker) === true);
    if (onScreen === true || onAnotherPhone === true) {
        throw new Error(`${label} was shown to someone after it was refused.`);
    }
}
