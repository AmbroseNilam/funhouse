// Pantomime Panic as a blueprint: the charades kit for three to ten people. One player at a time gets
// a private prompt on their phone, a movie-style title, an action or a character, and acts it out
// in silence while the others shout guesses at their phones. Code hears each guess and rules it
// against the answer and its listed synonyms, scores the guesser and the performer, and rotates.
// The prompts are original to this game and live beside this file.

import { HOST_NAME } from "../../shared/brand.ts";
import type { CharadesBlueprint } from "../blueprint.ts";
import { PANTOMIME_PANIC_PROMPTS } from "./pantomime-panic-prompts.ts";

/** Pantomime Panic, written as decisions on the charades kit. */
export const PANTOMIME_PANIC_BLUEPRINT: CharadesBlueprint = {
    kit: "charades",
    box: {
        id: "pantomimePanic",
        name: "Pantomime Panic",
        pitch: `One of you acts it out without a word. The rest shout. ${HOST_NAME} keeps time.`,
        howToPlay: [
            "When it's your turn, pick how hard, then read your phone and act it out. No talking.",
            "Everyone else holds their phone and shouts guesses. The game hears every one.",
            "A right guess scores for the guesser and the performer. Quicker is worth more.",
        ],
        remarks: ["Somebody's about to look ridiculous.", "No talking. That's the rule.", "I'll keep the time. You keep the dignity."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 10,
        keywords: ["is it", "I think it's", "close", "swap", "start", "easy", "medium", "hard"],
    },
    decisions: {
        prompts: PANTOMIME_PANIC_PROMPTS,
        levels: {
            easy: { label: "Easy", points: 1, seconds: 60 },
            medium: { label: "Medium", points: 2, seconds: 75 },
            hard: { label: "Hard", points: 3, seconds: 90 },
        },
        turnsEach: 1,
        pickSeconds: 12,
        readySeconds: 10,
        revealSeconds: 7,
        fastBonus: 1,
        tryPoints: 1,
        giveUpButton: true,
    },
};
