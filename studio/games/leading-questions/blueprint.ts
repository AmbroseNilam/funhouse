// Leading Questions as a blueprint: the plant kit for four to eight people. The host thinks of a
// word, one player is dealt the Plant and shown it, and the table finds it with yes-or-no
// questions before voting on who knew all along. The categories and fallback words are original
// to this game; at play time the host's model writes the word. The experience script is in
// leading-questions.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { PlantBlueprint } from "../../blueprint.ts";

/** Leading Questions, written as decisions on the plant kit. */
export const LEADING_QUESTIONS_BLUEPRINT: PlantBlueprint = {
    kit: "plant",
    box: {
        id: "leadingQuestions",
        name: "Leading Questions",
        pitch: `${HOST_NAME} thinks of a word. One of you already knows it.`,
        howToPlay: [
            "Check your phone. One of you is the Plant and knows the word.",
            "Hold your phone and ask yes-or-no questions out loud to find it.",
            "Found it? Vote for who knew all along.",
        ],
        remarks: ["One of you knows. Interesting.", "Ask good questions. Or leading ones.", "Someone here is being very helpful."],
        art: "art/hero.webp",
        minPlayers: 4,
        maxPlayers: 8,
        keywords: ["plant", "yes", "no", "is it", "give up", "vote", "word"],
    },
    decisions: {
        categories: [
            { name: "something in a kitchen", fallback: "colander" },
            { name: "an animal", fallback: "hedgehog" },
            { name: "something at a party", fallback: "balloon" },
            { name: "a job", fallback: "beekeeper" },
            { name: "something in a garden", fallback: "wheelbarrow" },
            { name: "something you'd pack for a trip", fallback: "passport" },
            { name: "a sport", fallback: "bowling" },
            { name: "a shop on a high street", fallback: "laundromat" },
        ],
        questions: { budget: 20, warnAt: [5, 1] },
        readSeconds: 10,
        askingSeconds: 240,
        voteSeconds: 45,
    },
};
