// Three Claims as a blueprint: the claims kit for three to eight people. Everyone writes three claims
// about themselves and secretly marks the false one. One claimant at a time, the host interviews them
// by voice, a player it names asks a third question, and the table taps the claim it thinks is the
// lie. Code keeps the mark and the score. The experience script is in script.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { ClaimsBlueprint } from "../../kits/claims/index.ts";

/** Three Claims, written as decisions on the claims kit. */
export const THREE_CLAIMS_BLUEPRINT: ClaimsBlueprint = {
    kit: "claims",
    box: {
        id: "threeClaims",
        name: "Three Claims",
        pitch: `Three claims about you, and one is a lie. ${HOST_NAME} asks the questions, and the table decides.`,
        howToPlay: [
            "On your phone, write two true things about you and one lie.",
            "Tap the lie. Only you can see which one you marked.",
            "One at a time, the host questions you, and you answer out loud.",
            "Everyone else votes for the lie. Fool them or catch them to score.",
        ],
        remarks: ["Three claims. One of them is not true.", "I only ask about details.", "Somebody here lies well."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["claim", "lie", "detail", "round", "another round"],
    },
    decisions: {
        claimLimit: 60,
        gatherSeconds: 150,
        interviewSeconds: 18,
        challengeSeconds: 14,
        answerSeconds: 18,
        voteSeconds: 16,
        countSeconds: 4,
        revealSeconds: 8,
        points: { perFooled: 3, perCatch: 2, sweepFactor: 2 },
    },
};
