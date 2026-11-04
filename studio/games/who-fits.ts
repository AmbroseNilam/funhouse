// Who Fits as a blueprint: the tap kit's nomination style for three to eight people. Each round a
// prompt such as "Would give the best wedding speech" goes up, everyone secretly taps the person
// it fits best, and the TV shows only the counts. The fallback prompts are original to this game;
// at play time the host's model writes its own. Notes are in who-fits.md beside this file.

import { HOST_NAME } from "../../shared/brand.ts";
import type { TapBlueprint } from "../blueprint.ts";
import type { FitsDecisions } from "../kits/tap-fits.ts";

/** Who Fits, written as decisions on the tap kit. */
export const WHO_FITS_BLUEPRINT: TapBlueprint<FitsDecisions> = {
    kit: "tap",
    box: {
        id: "whoFits",
        name: "Who Fits",
        pitch: `A prompt goes up, you all secretly tap who it fits, and ${HOST_NAME} reads the counts.`,
        howToPlay: [
            "Read the prompt on the screen.",
            "Tap the person it fits best. Nobody will know who you picked.",
            "The screen shows the counts, and the host says a kind word.",
        ],
        remarks: ["Nobody sees who you tapped. Promise.", "Be generous. Mostly.", "I like this one. Everyone wins a bit."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["tap", "prompt", "fits", "next"],
    },
    decisions: {
        style: "fits",
        rounds: 5,
        tapSeconds: 40,
        revealSeconds: 12,
        prompts: [
            "Would win a staring contest with a cat",
            "Would make friends first on a long train ride",
            "Would bring the best snacks to a picnic",
            "Would talk their way into a sold-out show",
            "Would stay calmest in a power cut",
            "Would give the best wedding speech",
            "Would learn a new language fastest",
            "Would keep a houseplant alive the longest",
        ],
    },
};
