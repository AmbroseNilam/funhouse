// The control vocabulary: what a phone can show and how it listens. The cartridge declares
// which controls each role gets per phase; the host may compose within that set. Small on
// purpose: the host's creativity is in labels, composition and timing, not new widgets.

import type { PadView } from "./shell.ts";
import type { PhoneTurn } from "./turn.ts";

/** How a phone's microphone behaves right now. See docs/VOICE.md in the planning repo. */
export type ListeningMode = "muted" | "holdToTalk" | "openFloor" | "hostSpeaking";

/**
 * Whether a phone in this listening mode asks for the microphone and shows hold-to-talk. A game that
 * declares "muted" for a phase (tap-only games do) never listens, so the phone offers neither.
 * @param mode the listening mode the room sent this phone.
 * @returns true when holding to talk can do anything.
 */
export function listeningAllowsTalk(mode: ListeningMode): boolean {
    return mode === "holdToTalk" || mode === "openFloor";
}

/**
 * One interactive element on a phone. A textInput, numberInput or slider is answered once: the room
 * checks the answer, then hands the game an "answered" event with the control's id, and a text
 * answer only gets that far once the content filter has passed it. Give each question its own id.
 */
export type Control =
    | { type: "roleCard"; title: string; body: string; secret: boolean }
    | { type: "buttons"; prompt?: string; options: ControlOption[] }
    | { type: "choice"; prompt: string; options: ControlOption[]; multiple: boolean }
    | { type: "textInput"; id: string; prompt: string; placeholder?: string; maxLength: number; note?: string }
    | { type: "numberInput"; id: string; prompt: string; min: number; max: number; step?: number; note?: string }
    | { type: "slider"; id: string; prompt: string; min: number; max: number; step?: number; lowLabel?: string; highLabel?: string; note?: string }
    | { type: "waiting"; text: string }
    | { type: "notice"; text: string; tone: "info" | "warning" | "secret" };

/** A selectable option; the id is what the phone sends back. */
export interface ControlOption {
    id: string;
    label: string;
    disabled?: boolean;
}

/** Everything one phone needs to render itself. */
export interface PhoneView {
    playerName: string;
    listening: ListeningMode;
    /** Short line under the mic indicator, such as "The host is speaking". */
    status: string;
    controls: Control[];
    /** How the phone's touch surface behaves right now. */
    pad: PadView;
    /** The words heard so far while this phone holds to talk, so the person knows it's working. */
    hearing: string;
    /** True when this room offers the Talk button. */
    tapToTalk: boolean;
    /** True while the Talk button waits for the host's voice to finish. */
    talkWaiting: boolean;
    /** What the game's turn means for this phone, if anything. */
    turn: PhoneTurn | null;
}

/** What a phone sends when a player uses a control. */
export interface ControlInput {
    /** Id of the control's option. */
    value: string;
    /** Which control, by its index in the current view. */
    controlIndex: number;
}
