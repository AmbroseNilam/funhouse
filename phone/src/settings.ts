// Preferences for this browser, kept in localStorage and nowhere else. If storage is blocked the
// defaults apply and choices last until the page closes. No setting can change when the mic stops.

/** Where the settings are kept. */
const SETTINGS_KEY: string = "gameroom.settings";

/** What one browser can choose. */
export interface PhoneSettings {
    /** The host's short sound when this phone's reply is slow to start. */
    reactions: boolean;
    /** Buzzes on steps and turns, where the phone can. */
    vibration: boolean;
    /** The Talk button, in rooms trying tap-to-talk; holding always works. */
    talkButton: boolean;
}

/** Used for anything not chosen yet. */
const DEFAULT_SETTINGS: PhoneSettings = { reactions: true, vibration: true, talkButton: true };

/**
 * Reads the settings, ignoring anything stored that isn't a yes or no.
 * @returns the settings.
 */
export function readSettings(): PhoneSettings {
    try {
        const parsed: Partial<Record<keyof PhoneSettings, unknown>> = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Record<keyof PhoneSettings, unknown>>;
        return {
            reactions: typeof parsed.reactions === "boolean" ? parsed.reactions : DEFAULT_SETTINGS.reactions,
            vibration: typeof parsed.vibration === "boolean" ? parsed.vibration : DEFAULT_SETTINGS.vibration,
            talkButton: typeof parsed.talkButton === "boolean" ? parsed.talkButton : DEFAULT_SETTINGS.talkButton,
        };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

/**
 * Saves the settings, if this browser allows it.
 * @param settings the settings.
 */
export function writeSettings(settings: PhoneSettings): void {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // Blocked storage: the choice still holds until the page closes.
    }
}
