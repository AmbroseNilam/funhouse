// Stray Word as a blueprint: the odd-word kit for four to ten people. Everyone is shown the same secret
// word except one player, the Stray, who only knows what kind of thing it is. Each player says one word
// about it, in an order the game enforces, for two rounds; then everyone votes on who the Stray is, and
// a caught Stray gets one guess at the word. The host writes a fresh category and word every round; the
// entries below are original fallbacks for when it can't. The experience script is in stray-word.md
// beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { OddWordBlueprint } from "../../blueprint.ts";

/** Stray Word, written as decisions on the odd-word kit. */
export const STRAY_WORD_BLUEPRINT: OddWordBlueprint = {
    kit: "oddword",
    box: {
        id: "strayWord",
        name: "Stray Word",
        pitch: `Everyone gets the same secret word, except one. ${HOST_NAME} won't say who.`,
        howToPlay: [
            "Check your phone. Everyone has the secret word except one of you, the stray.",
            "Take turns saying one word about it, out loud. Don't make it too easy.",
            "Vote for the stray. A caught stray still gets one guess at the word.",
        ],
        remarks: ["Everyone has the word. Except one.", "One word each. Choose it carefully.", "Somebody here is making it up."],
        art: "art/hero.webp",
        minPlayers: 4,
        maxPlayers: 10,
        keywords: ["stray", "vote", "word", "guess"],
    },
    decisions: {
        entries: [
            { category: "a thing in a kitchen", word: "kettle" },
            { category: "an animal", word: "otter" },
            { category: "something you wear", word: "scarf" },
            { category: "a kind of weather", word: "drizzle" },
            { category: "a piece of furniture", word: "wardrobe" },
            { category: "a kind of food", word: "dumpling" },
            { category: "something at the seaside", word: "lighthouse" },
            { category: "a musical instrument", word: "cello" },
            { category: "something in a garden", word: "trowel" },
            { category: "a kind of vehicle", word: "tram" },
            { category: "something you read", word: "almanac" },
            { category: "a thing in a bathroom", word: "sponge" },
            { category: "a kind of building", word: "windmill" },
            { category: "a sport", word: "archery" },
            { category: "a thing on a desk", word: "stapler" },
            { category: "a kind of tree", word: "willow" },
            { category: "something at a market", word: "stall" },
            { category: "a thing in a toolbox", word: "spanner" },
            { category: "a kind of dessert", word: "custard" },
            { category: "something at a train station", word: "platform" },
            { category: "a thing in a bedroom", word: "pillow" },
            { category: "a kind of boat", word: "canoe" },
            { category: "a thing you'd take camping", word: "lantern" },
            { category: "a kind of bird", word: "heron" },
        ],
        rounds: 2,
        readSeconds: 10,
        clueSeconds: 30,
        voteSeconds: 45,
        guessSeconds: 30,
    },
};
