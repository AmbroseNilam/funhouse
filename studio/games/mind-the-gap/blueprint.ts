// Mind the Gap as a blueprint: the line kit for two to eight people. A row of dated cards, events and
// inventions, lies on the table; each round a new card comes out without its date and everyone picks
// the gap it belongs in. The cards and where each year comes from are in cards.ts. The experience
// script is in script.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { LineBlueprint } from "../../kits/line/index.ts";
import { CARDS } from "./cards.ts";

/** Mind the Gap, written as decisions on the line kit. */
export const MIND_THE_GAP_BLUEPRINT: LineBlueprint = {
    kit: "line",
    box: {
        id: "mindTheGap",
        name: "Mind the Gap",
        pitch: `${HOST_NAME} lays out a row of dated cards. Where does the next one go?`,
        howToPlay: [
            "A row of events and inventions lies on the screen, oldest first, with the years showing.",
            "A new card comes out with no year. Pick the gap on your phone where it belongs.",
            "The right gap wins two. A gap next to it wins one.",
        ],
        remarks: ["Oldest on the left. Nobody cheats.", "Some of these will surprise you.", "Trust your gut. Or don't."],
        art: "art/hero.webp",
        minPlayers: 2,
        maxPlayers: 8,
        keywords: ["gap", "card", "before", "after", "between"],
    },
    decisions: {
        cards: CARDS,
        startCards: 2,
        rounds: 6,
        placeSeconds: 40,
        revealSeconds: 12,
        giveUpButton: true,
        points: { exact: 2, adjacent: 1 },
    },
};
