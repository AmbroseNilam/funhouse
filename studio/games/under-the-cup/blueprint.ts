// Under the Cup as a blueprint: the tap kit's dice style for three to eight people. Everyone rolls
// dice that only their own phone shows, then players take turns raising a bid about how many dice
// show one face across every cup, or challenge the last bid. A lost challenge costs a die, and the
// last player with dice wins. The rules, odds and counting are code; the host builds the tension
// and plays the reveal. Notes are in under-the-cup.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { TapBlueprint } from "../../blueprint.ts";
import type { DiceDecisions } from "../../kits/tap/tap-dice.ts";

/** Under the Cup, written as decisions on the tap kit. */
export const UNDER_THE_CUP_BLUEPRINT: TapBlueprint<DiceDecisions> = {
    kit: "tap",
    box: {
        id: "underTheCup",
        name: "Under the Cup",
        pitch: `You each roll secret dice on your phone, bid on the whole table's dice, and ${HOST_NAME} calls the bluffs.`,
        howToPlay: [
            "Hold your phone card to peek at your dice. Nobody else can see them.",
            "On your turn, raise the bid or challenge the last one. A bid is how many dice show one number, across every cup.",
            "The cups are lifted on a challenge. Whoever was wrong loses a die, and the last player with dice wins.",
        ],
        remarks: ["Keep your face still. I'm watching.", "Everyone lies a little. Politely.", "The cups don't lie."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["bid", "challenge", "dice", "cup", "raise"],
    },
    decisions: {
        style: "dice",
        startingDice: 3,
        wildOnes: true,
        bidSeconds: 30,
        lookSeconds: 8,
        liftSeconds: 5,
        revealSeconds: 14,
        maxRounds: 12,
        exactLoss: 2,
    },
};
