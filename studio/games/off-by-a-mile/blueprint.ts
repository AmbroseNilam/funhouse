// Off by a Mile as a blueprint: the estimate kit for three to eight people. The host asks a numeric
// question, everyone types a guess, the guesses go up without the answer, and everyone bets on whose
// is closest. The questions and where each answer comes from are in questions.ts. The experience
// script is in script.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { EstimateBlueprint } from "../../blueprint.ts";
import { QUESTIONS } from "./questions.ts";

/** Off by a Mile, written as decisions on the estimate kit. */
export const OFF_BY_A_MILE_BLUEPRINT: EstimateBlueprint = {
    kit: "estimate",
    box: {
        id: "offByAMile",
        name: "Off by a Mile",
        pitch: `${HOST_NAME} asks for a number. Guess it, then bet on whose guess is closest.`,
        howToPlay: [
            "Type your guess for each question on your phone. Nobody sees it yet.",
            "Then every guess goes up on the screen. Back the one you think is closest.",
            "The closest guess wins three. Backing it wins two, or three if hardly anyone else did.",
        ],
        remarks: ["Guess boldly. Bet carefully.", "Somebody here will be way off.", "I know the answer. You don't."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["guess", "closest", "number", "bet"],
    },
    decisions: {
        questions: QUESTIONS,
        rounds: 5,
        guessSeconds: 45,
        betSeconds: 30,
        revealSeconds: 14,
        giveUpButton: true,
        points: { closest: 3, backer: 2, bold: 1 },
    },
};
