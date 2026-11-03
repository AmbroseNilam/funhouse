// Twenty Doors as a blueprint: the guessing kit with twenty doors. It plays the same as
// cartridges/twenty-doors, and its id matches that game so the studio shelf can stand in for it
// and the existing scenario plays unchanged. It is what "Make it yours" will start from.

import { HOST_NAME } from "../../shared/brand.ts";
import type { GuessingBlueprint } from "../blueprint.ts";

/** Twenty Doors, written as decisions on the guessing kit. */
export const TWENTY_DOORS_BLUEPRINT: GuessingBlueprint = {
    kit: "guessing",
    box: {
        id: "twentyDoors",
        name: "Twenty Doors",
        pitch: `${HOST_NAME} thinks of something. You get twenty questions to find it.`,
        howToPlay: [
            "Press and hold your phone, and ask a yes-or-no question out loud.",
            "Every answer opens a door. You get twenty.",
            "Say what you think it is when you're ready.",
        ],
        remarks: ["Twenty doors. I've picked something good.", "Go on. I'm hard to crack.", "Nobody's guessed mine in under ten."],
        art: "art/twenty-doors.webp",
        minPlayers: 1,
        maxPlayers: 12,
        keywords: ["door", "doors", "yes", "no", "give up", "is it"],
    },
    decisions: {
        categories: [
            { name: "an animal", fallback: "platypus" },
            { name: "something in a kitchen", fallback: "whisk" },
            { name: "a famous landmark", fallback: "Eiffel Tower" },
            { name: "a food", fallback: "pineapple" },
            { name: "a job", fallback: "lighthouse keeper" },
            { name: "something you'd find at the beach", fallback: "sandcastle" },
            { name: "a musical instrument", fallback: "accordion" },
            { name: "a vehicle", fallback: "hot air balloon" },
        ],
        paintReveal: true,
        count: { label: "Doors opened", budget: 20, marks: "door", warnAt: [5, 1], unit: { singular: "door", plural: "doors" } },
        answers: {
            yes: { label: "Yes", spends: true },
            no: { label: "No", spends: true },
            sortof: { label: "Sort of", spends: true },
            wrong: { label: "Wrong guess", spends: true },
        },
        giveUpButton: true,
    },
};
