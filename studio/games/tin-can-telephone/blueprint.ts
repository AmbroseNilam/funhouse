// Tin Can Telephone as a blueprint: the clue-board kit for three to ten people in two teams. Each
// team has a giver who knows which words on the shared board are theirs and says one word and a
// number; the team turns over words on their phones. One word is a trapdoor. The host writes a fresh
// board every game and can give a side's clues itself. The team names and the fallback words are
// original to this game and ordinary words; at play time the host's model writes the board. The
// experience script is in tin-can-telephone.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { ClueBoardBlueprint } from "../../kits/clueboard/index.ts";

/** Tin Can Telephone, written as decisions on the clue-board kit. */
export const TIN_CAN_TELEPHONE_BLUEPRINT: ClueBoardBlueprint = {
    kit: "clueboard",
    box: {
        id: "tinCanTelephone",
        name: "Tin Can Telephone",
        pitch: `Two teams, one board of words. One clue per turn. ${HOST_NAME} watches for cheating.`,
        howToPlay: [
            "Two teams share a board. One giver per team knows which words are theirs.",
            "Givers hold their phone and say one word and a number. The team taps the words.",
            "Find all yours first. Never tap the trapdoor.",
        ],
        remarks: ["One word. One number. Good luck.", "Somebody here is hiding a trapdoor.", "Choose your clue carefully."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 10,
        keywords: ["clue", "plum", "teal", "trapdoor", "one", "two", "three", "four", "five"],
    },
    decisions: {
        teams: ["Plum", "Teal"],
        words: [
            "anchor", "biscuit", "blanket", "bridge", "bucket", "button", "cactus", "candle", "canoe", "carpet", "castle", "chimney", "cinnamon", "clover", "compass", "cushion",
            "diamond", "dolphin", "dragonfly", "drawer", "engine", "feather", "ferry", "fountain", "garden", "ginger", "glacier", "hammock", "harvest", "helmet", "island", "jacket",
            "kettle", "ladder", "lantern", "lemon", "magnet", "marble", "meadow", "mirror", "mitten", "noodle", "orchard", "paddle", "parade", "pepper", "pillow", "pirate",
            "pocket", "pumpkin", "quilt", "rabbit", "raisin", "rocket", "saddle", "scarf", "shovel", "tunnel", "umbrella", "violin", "walnut", "whistle", "windmill", "zipper",
        ],
        clueSeconds: 90,
        guessSeconds: 120,
        judgeSeconds: 8,
        maxFouls: 2,
        turnLimit: 24,
    },
};
