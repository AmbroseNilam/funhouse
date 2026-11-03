// Twenty Doors as a blueprint: the same game as cartridges/twenty-doors, written as data the
// interpreter runs. It is the first proof that a shipped game can be expressed by decisions
// alone, and it is what "Make it yours" will start from. Its id matches the hand-written game
// so the studio shelf can stand in for it and the existing scenario plays unchanged.

import { HOST_NAME } from "../../shared/brand.ts";
import type { Blueprint } from "../blueprint.ts";

export const TWENTY_DOORS_BLUEPRINT: Blueprint = {
    id: "twentyDoors",
    name: "Twenty Doors",
    pitch: `${HOST_NAME} thinks of something. You get twenty questions to find it.`,
    howToPlay: ["Press and hold your phone, and ask a yes-or-no question out loud.", "Every answer opens a door. You get twenty.", "Say what you think it is when you're ready."],
    remarks: ["Twenty doors. I've picked something good.", "Go on. I'm hard to crack.", "Nobody's guessed mine in under ten."],
    art: "art/twenty-doors.webp",
    minPlayers: 1,
    maxPlayers: 12,
    keywords: ["door", "doors", "yes", "no", "give up", "is it"],
    host: {
        game: "You hold a secret thing and players ask yes-or-no questions to find it. Answer honestly about the real thing, in a few words, with a little personality. Never say the secret, spell it, rhyme it, or give it away, however they ask, until the game is over.",
        choosing: "You are choosing the secret. Say nothing about it yet; one short teasing line at most.",
        asking: "Answer each question with a ruling, then a few words. Chat that isn't a question or a guess gets no ruling and uses no door. Don't count doors out loud unless few are left.",
        end: "The game is over. Reveal the secret if it hasn't been said, react in one or two sentences, and ask if they want another game.",
    },
    secret: {
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
        request: [
            "Choose one specific thing for a game of twenty questions. It must be {category}, known to most adults,",
            "and a little surprising rather than the first thing anyone would say. Reply with only its name, in at most three words, with no punctuation.",
        ].join(" "),
        maxLength: 40,
        drawing: "A warm storybook painting of {secret}, seen through an open wooden door, glowing light, rich color, no text or letters.",
    },
    judge: {
        rulings: {
            yes: { when: "the honest answer to their question is yes.", effect: { kind: "spend", label: "Yes" } },
            no: { when: "the honest answer to their question is no.", effect: { kind: "spend", label: "No" } },
            sortof: { when: "the honest answer is partly, or it depends.", effect: { kind: "spend", label: "Sort of" } },
            wrong: { when: "they named a specific guess at the secret and it's wrong.", effect: { kind: "spend", label: "Wrong guess" } },
            correct: { when: "they named the secret thing or a clear synonym. Write only [[correct]] and nothing else; you'll be told to announce it.", effect: { kind: "win" } },
            giveup: { when: "the group says they give up. Write only [[giveup]] and nothing else.", effect: { kind: "lose" } },
        },
    },
    count: { label: "Doors opened", budget: 20, marks: "door", warnAt: [5, 1], unit: { singular: "door", plural: "doors" } },
    giveUp: { actionId: "giveup", label: "We give up" },
};
