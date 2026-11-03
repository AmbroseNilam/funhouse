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
