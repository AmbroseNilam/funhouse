// Cold Read as a blueprint: the host-guess kit, reverse twenty questions. The table picks a category
// and secretly agrees on one thing in it, then the host asks fifteen yes-or-no questions, the
// players answer on their phones, and the host has to work out what it was. The box and category
// names are original to this game. Notes are in cold-read.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { HostGuessBlueprint } from "../../blueprint.ts";

/** Cold Read, written as decisions on the host-guess kit. */
export const COLD_READ_BLUEPRINT: HostGuessBlueprint = {
    kit: "hostGuess",
    box: {
        id: "coldRead",
        name: "Cold Read",
        pitch: `You pick the secret. ${HOST_NAME} asks fifteen questions and tries to find it.`,
        howToPlay: [
            "Pick a category on your phones, then agree on one thing in it. Keep it from the host.",
            "The host asks yes-or-no questions. Tap Yes, No or Sometimes. The most taps wins, and a tie is Sometimes.",
            "When the host makes its last guess, hold your phone and say what it was, then tap whether it was right.",
        ],
        remarks: ["You think of it. I ask the questions.", "Go on. Try to stump me.", "I have fifteen questions and no shame."],
        art: "art/hero.webp",
        minPlayers: 2,
        maxPlayers: 8,
        keywords: ["yes", "no", "sometimes", "right", "wrong", "ready"],
    },
    decisions: {
        categories: ["a person", "a place", "an animal", "an everyday object", "a food or drink", "a story character"],
        questions: 15,
        guesses: 3,
        warnAt: [5, 2, 1],
        categorySeconds: 25,
        secretSeconds: 75,
        answerSeconds: 25,
        verdictSeconds: 40,
        hostSeconds: 25,
    },
};
