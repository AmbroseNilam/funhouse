// Clue Gallery as a blueprint: the gallery kit for three to six people. Everyone holds a private
// hand of cards the host paints. One player a round is the storyteller: they pick a card and give
// a clue, the others put in the card from their own hand that fits it best, the cards are shown on
// the TV one at a time, and everyone votes for the one they think was the storyteller's. A clue
// that everyone finds, or that nobody finds, scores the storyteller nothing. Cards are made fresh
// each game by putting a subject, a setting and a light together; the lists are original to this
// game. The experience script is in clue-gallery.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { GalleryBlueprint } from "../../blueprint.ts";

/** Clue Gallery, written as decisions on the gallery kit. */
export const CLUE_GALLERY_BLUEPRINT: GalleryBlueprint = {
    kit: "gallery",
    box: {
        id: "clueGallery",
        name: "Clue Gallery",
        pitch: `${HOST_NAME} paints your hand. Give a clue that fits one card, but not too well.`,
        howToPlay: [
            "Each round one of you picks a card from your phone and gives a clue.",
            "The rest put in the card from their own hand that fits the clue, and the painted cards appear on the screen.",
            "Vote for the storyteller's card. Too obvious or too strange, and the storyteller scores nothing.",
        ],
        remarks: ["Not too clear. Not too strange.", "I painted every one of these.", "Somewhere in your hand is a bad idea."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 6,
        keywords: ["card", "clue", "vote", "gallery", "painting"],
    },
    decisions: {
        subjects: [
            "a red kite",
            "a copper kettle",
            "a paper boat",
            "a brass lantern",
            "a spiral staircase",
            "a sleepy fox",
            "a tall ship",
            "an open book",
            "a clock tower",
            "a grey heron",
            "a market stall",
            "an old bicycle",
            "a brass telescope",
            "a patient snail",
            "a wooden door",
            "a crooked bridge",
        ],
        settings: [
            "above a sleeping town",
            "at the bottom of a lake",
            "in a field of tall grass",
            "on the edge of a cliff",
            "inside a glass jar",
            "beside a frozen river",
            "on a rooftop in the rain",
            "in the middle of a desert",
            "under a very large moon",
            "at the end of a long pier",
            "among the clouds",
            "in a quiet forest",
            "on a crowded shelf",
            "at the top of a hill",
        ],
        lights: ["morning", "golden evening", "moonlit", "stormy", "candle"],
        handSize: 3,
        rounds: 3,
        clueSeconds: 75,
        playSeconds: 45,
        voteSeconds: 60,
        spotlightSeconds: 6,
        scoreSeconds: 9,
        clueLimit: 40,
        points: { storyteller: 3, found: 3, decoy: 1, extremes: 2 },
        waveSeconds: 4,
    },
};
