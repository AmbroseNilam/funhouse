// Painted Whispers as a blueprint: the chain kit for three to eight people. One player writes a
// line, the host paints it, the next player sees only the painting and describes it, the host
// paints that, and so on round the table. Then the whole chain is shown on the TV, a line and a
// painting at a time, and the host comments on how far it wandered. The stock lines are original
// to this game and only stand in when someone writes nothing. The experience script is in
// painted-whispers.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { ChainBlueprint } from "../../kits/chain/index.ts";

/** Painted Whispers, written as decisions on the chain kit. */
export const PAINTED_WHISPERS_BLUEPRINT: ChainBlueprint = {
    kit: "chain",
    box: {
        id: "paintedWhispers",
        name: "Painted Whispers",
        pitch: `You write a line. ${HOST_NAME} paints it. The next person only sees the painting.`,
        howToPlay: [
            "One person writes a line on their phone. The host paints it.",
            "The next person sees only the painting and describes it.",
            "The host paints that too, and on it goes round the table.",
            "At the end, see the whole chain and how far it wandered.",
        ],
        remarks: ["I paint what I'm told. Not what's meant.", "Say it plainly. I'll do the rest.", "Somewhere in here, a goat becomes a lighthouse."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["paint", "painting", "chain", "line", "describe"],
    },
    decisions: {
        starters: [
            "A goat teaching a class of ducks",
            "A lighthouse made of teacups",
            "A very small train crossing a very large bridge",
            "An umbrella shop on the moon",
            "A tortoise running late for a wedding",
            "A kitchen where the pots cook themselves",
        ],
        blanks: [
            "Something round, sitting on something square",
            "A scene that is hard to put into words",
            "Several things, none of them where they should be",
            "A quiet place with one odd thing in it",
            "An ordinary afternoon gone slightly wrong",
            "Something old being carried somewhere new",
        ],
        writeSeconds: 60,
        paintSeconds: 45,
        beatSeconds: 6,
        lineLimit: 80,
    },
};
