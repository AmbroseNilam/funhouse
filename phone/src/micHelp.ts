// What to tell someone whose microphone is off. A web page can't open a phone's settings or turn
// the mic on by itself, so the card gives the steps for the phone in the person's hand.

/**
 * The steps that turn the microphone back on for this device.
 * @returns the steps, in order.
 */
export function micSteps(): string[] {
    const agent: string = navigator.userAgent;
    const onApple: boolean = /iPhone|iPad|iPod/.test(agent) === true || (agent.includes("Macintosh") === true && navigator.maxTouchPoints > 1);
    if (onApple === true) {
        return [
            "Open Settings, then Apps, then Safari, then Microphone.",
            "Choose Ask or Allow.",
            "If that doesn't do it, check Privacy & Security, then Microphone, and turn on Safari.",
        ];
    }
    if (agent.includes("Android") === true) {
        return [
            "In Chrome, open the menu, then Settings, then Site settings, then Microphone.",
            "Find this site under Blocked, tap it, and choose Allow.",
            "If that doesn't do it, check that your phone's settings let Chrome use the microphone.",
        ];
    }
    return ["Open this site's settings in your browser and allow the microphone."];
}

/** Where it's remembered that this installed app has opened the microphone before. */
const MIC_OPENED_KEY: string = "funhouse-mic-opened";

/** Where it's remembered that the note about repeat prompts has been shown. */
const MIC_NOTE_KEY: string = "funhouse-mic-note-shown";

/**
 * Whether to say, once, that an installed iPhone app gets asked again. iOS forgets the answer each
 * launch and a page can't change that, so this waits for someone who has just seen it happen again.
 * @param installed whether this page runs from the home screen.
 * @returns true the first time the microphone opens in a later launch.
 */
export function shouldExplainMicPrompt(installed: boolean): boolean {
    if (installed === false || /iPhone|iPod/.test(navigator.userAgent) === false) {
        return false;
    }
    try {
        if (localStorage.getItem(MIC_OPENED_KEY) === null) {
            localStorage.setItem(MIC_OPENED_KEY, String(performance.timeOrigin));
            return false;
        }
        const sameLaunch: boolean = localStorage.getItem(MIC_OPENED_KEY) === String(performance.timeOrigin);
        if (sameLaunch === true || localStorage.getItem(MIC_NOTE_KEY) !== null) {
            return false;
        }
        localStorage.setItem(MIC_NOTE_KEY, "1");
        return true;
    } catch {
        return false;
    }
}
