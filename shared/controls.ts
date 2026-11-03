// The control vocabulary: what a phone can show and how it listens. The cartridge declares
// which controls each role gets per phase; the host may compose within that set. Small on
// purpose: the host's creativity is in labels, composition and timing, not new widgets.

import type { PadView } from "./shell.ts";

/** How a phone's microphone behaves right now. See docs/VOICE.md in the planning repo. */
export type ListeningMode = "muted" | "holdToTalk" | "openFloor" | "hostSpeaking";

/** One interactive element on a phone. */
export type Control =
    | { type: "roleCard"; title: string; body: string; secret: boolean }
    | { type: "buttons"; prompt?: string; options: ControlOption[] }
    | { type: "choice"; prompt: string; options: ControlOption[]; multiple: boolean }
    | { type: "textInput"; prompt: string; placeholder?: string; maxLength: number }
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
}

/** What a phone sends when a player uses a control. */
export interface ControlInput {
    /** Id of the control's option, or the text for a textInput. */
    value: string;
    /** Which control, by its index in the current view. */
    controlIndex: number;
}
