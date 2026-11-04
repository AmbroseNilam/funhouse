// Blank Verdict as a blueprint: the hand kit for three to eight people. Each round the host reads a
// prompt card with a gap in it, everyone but the judge plays a card from their phone to fill it, the
// judge secretly picks the best, and the host reads the plays and reveals the pick. Every card is
// original to this game and lives in blank-verdict-cards.ts. A family room plays the clean cards and
// a party room plays them all; the first player chooses on their phone before the first round.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { HandBlueprint } from "../../kits/hand/index.ts";
import { BLANK_VERDICT_ANSWERS, BLANK_VERDICT_PROMPTS } from "./blank-verdict-cards.ts";

/** Blank Verdict, written as decisions on the hand kit. */
export const BLANK_VERDICT_BLUEPRINT: HandBlueprint = {
    kit: "hand",
    box: {
        id: "blankVerdict",
        name: "Blank Verdict",
        pitch: `${HOST_NAME} reads a card with a gap in it. You fill it from your hand, and one of you judges.`,
        howToPlay: [
            "Each round one player judges. Everyone else holds a hand of cards on their phone.",
            "Play the card that fills the gap best, or worst, if you know your judge.",
            `${HOST_NAME} reads every play. The judge picks one in secret, and its player scores.`,
        ],
        remarks: ["Mind the gap.", "Somebody here is holding a great card.", "Judges, be honest. Or don't."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["blank", "number", "verdict", "round", "judge"],
    },
    decisions: {
        prompts: [...BLANK_VERDICT_PROMPTS],
        answers: [...BLANK_VERDICT_ANSWERS],
        handSize: 6,
        toneSeconds: 20,
        playSeconds: 50,
        judgeSeconds: 45,
        revealSeconds: 14,
        readBaseSeconds: 4,
        readSecondsPerPlay: 4,
        doubleBelow: 5,
    },
};
