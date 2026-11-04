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
            "The first person writes a line on their phone, and the host paints it on the screen.",
            "The next person sees only the painting and describes it. The host paints that.",
            "Round the table it goes. At the end the whole chain is shown, and you see where it wandered.",
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
