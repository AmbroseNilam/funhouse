// The Blank Truth as a blueprint: the bluff kit for three to eight people. The host states a real
// fact with one word missing, everyone writes a believable fake in secret, and the table picks the
// one they think is true. The fallback facts are checked and original in wording; at play time the
// host's model writes fresh ones, and its facts are used only if a second look confirms them. The
// experience script and the host's lines are in script.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { BluffBlueprint } from "../../kits/bluff/index.ts";

/** The Blank Truth, written as decisions on the bluff kit. */
export const BLANK_TRUTH_BLUEPRINT: BluffBlueprint = {
    kit: "bluff",
    box: {
        id: "blankTruth",
        name: "The Blank Truth",
        pitch: `${HOST_NAME} states a real fact with a word missing. You write fakes. Somebody has to find the true one.`,
        howToPlay: [
            "A real fact appears with one word missing. Write a believable fake on your phone.",
            "Every answer is read out, mixed together. Pick the one you think is true.",
            "Points for the true answer, and for every friend your fake fools.",
        ],
        remarks: ["One of these is true. I'll never tell.", "Write something believable. Or something brave.", "I read them all the same way."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["fact", "blank", "fake", "true", "pick", "round", "another round"],
    },
    decisions: {
        facts: [
            { statement: "A group of flamingos is called a ____.", answer: "flamboyance" },
            { statement: "Botanically speaking, bananas count as ____.", answer: "berries" },
            { statement: "Wombats produce droppings shaped like ____.", answer: "cubes" },
            { statement: "An octopus has ____ hearts.", answer: "three" },
            { statement: "The national animal of Scotland is the ____.", answer: "unicorn" },
            { statement: "Cleopatra lived closer in time to the first ____ landing than to the building of the Great Pyramid.", answer: "Moon" },
            { statement: "Crows can recognise, and remember, human ____.", answer: "faces" },
            { statement: "The Eiffel Tower grows by up to fifteen centimetres in summer because its iron expands in the ____.", answer: "heat" },
            { statement: "Butterflies taste with their ____.", answer: "feet" },
            { statement: "A polar bear's fur isn't really white; each hair is ____.", answer: "transparent" },
            { statement: "A day on Venus lasts longer than a ____ on Venus.", answer: "year" },
        ],
        rounds: 3,
        writeSeconds: 60,
        mergeSeconds: 8,
        pickSeconds: 40,
        revealSeconds: 10,
        answerLimit: 40,
        points: { truth: 200, fooled: 100 },
    },
};
