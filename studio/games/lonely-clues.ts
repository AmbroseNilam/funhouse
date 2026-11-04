// Lonely Clues as a blueprint: the clue kit for three to eight people. One player guesses a word
// they can't see; everyone else types a one-word clue. Clues that match cancel out and are hidden
// from the guesser, and the host reads out what survived. After the guess the host reveals the
// cancelled clues, which is the joke. The word list is original to this game and lives in the
// blueprint, so the host is never told the word. The experience script is in lonely-clues.md.

import { HOST_NAME } from "../../shared/brand.ts";
import type { ClueBlueprint } from "../blueprint.ts";

/** Words the game can pick: everyday things most adults know, easy to clue and hard to clue alike. */
export const LONELY_CLUES_WORDS: readonly string[] = [
    "anchor", "umbrella", "volcano", "bicycle", "pillow", "lighthouse", "cactus", "marathon", "teapot", "scarecrow",
    "trampoline", "pancake", "compass", "snowman", "ladder", "backpack", "carnival", "tractor", "postcard", "mushroom",
    "windmill", "sandwich", "elevator", "campfire", "fireworks", "hammock", "library", "microscope", "orchestra", "parachute",
    "pyramid", "raincoat", "sailboat", "scissors", "skeleton", "spaghetti", "submarine", "sunflower", "suitcase", "telescope",
    "thermometer", "toothbrush", "treasure", "tornado", "vampire", "waterfall", "whistle", "wizard", "zipper", "avalanche",
    "balloon", "bakery", "barbecue", "blanket", "bonfire", "bookshelf", "bridge", "bubble", "butterfly", "chandelier",
    "castle", "chimney", "circus", "clock", "cobweb", "cookie", "crayon", "crown", "detective", "dinosaur",
    "doorbell", "dragon", "drum", "envelope", "escalator", "feather", "ferry", "flashlight", "football", "fountain",
    "freckles", "garage", "giraffe", "glacier", "goldfish", "graveyard", "guitar", "hairbrush", "helicopter", "hiccups",
    "igloo", "jigsaw", "kangaroo", "kettle", "kitten", "lemonade", "lightning", "lobster", "magnet", "mailbox",
    "mermaid", "mirror", "mustache", "necklace", "notebook", "octopus", "paintbrush", "peanut", "penguin", "pirate",
    "popcorn", "porcupine", "puddle", "pumpkin", "quicksand", "rainbow", "refrigerator", "robot", "rollercoaster", "sandcastle",
    "scooter", "seahorse", "shadow", "shipwreck", "skateboard", "slipper", "snorkel", "sneeze", "snowflake", "spider",
    "sponge", "stapler", "sunglasses", "swing", "tadpole", "tambourine", "thunder", "toaster", "tunnel",
    "turtle", "unicorn", "vacuum", "velvet", "walrus", "wheelbarrow", "window", "yoga", "zebra", "lawnmower",
    "passport", "picnic", "puppet", "quilt", "ribbon", "saddle", "tooth", "trumpet", "wallet", "yacht",
];

/** Lonely Clues, written as decisions on the clue kit. */
export const LONELY_CLUES_BLUEPRINT: ClueBlueprint = {
    kit: "clue",
    box: {
        id: "lonelyClues",
        name: "Lonely Clues",
        pitch: `One of you guesses. The rest write one word each, and ${HOST_NAME} cancels the twins.`,
        howToPlay: [
            "One player guesses and can't see the word. Everyone else can, on their phone.",
            "Type one word as a clue. Clues that match, or give the word away, are cancelled.",
            "The guesser sees what survived and gets one guess. The table scores together.",
        ],
        remarks: ["Think of something nobody else will.", "Matching clues cancel. Try not to match.", "Be clever. Be different."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["clue", "guess", "word", "pass", "cancel"],
    },
    decisions: {
        words: [...LONELY_CLUES_WORDS],
        rounds: 5,
        writingSeconds: 45,
        beatSeconds: 3,
        guessSeconds: 40,
        resultSeconds: 18,
        clueRetries: 2,
        correctPoints: 2,
        cleanBonus: 1,
        giveUpButton: true,
    },
};
