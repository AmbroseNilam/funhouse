// The keepers of Past the Gate: who they are, where the gate is, and the secret rules they might have.
// Everything here is original to this game. A rule is a list of tests on the words of a plea, run in
// code; its clue is the only hint the table gets, and it never contains a word that opens or shuts
// the gate (the kit's check enforces that). The cargo words are everyday things; none is a rule word.

import type { GateScenario } from "../../kits/gate/gate.ts";

/** The words that count as a bird, for Pell's first rule. */
const BIRD_WORDS: string[] = [
    "bird", "goose", "geese", "gander", "duck", "swan", "heron", "hen", "rooster", "chicken", "owl", "crow", "robin", "wren", "sparrow", "feather", "wing", "nest", "pigeon", "gull", "stork",
];

/** The words that count as weather, for Pell's second rule. */
const WEATHER_WORDS: string[] = ["rain", "storm", "snow", "wind", "windy", "fog", "frost", "cloud", "sunshine", "thunder", "drizzle", "hail", "weather", "gale", "mist", "rainy", "stormy", "foggy"];

/** The words that count as money, for the ferrywoman's first rule. */
const MONEY_WORDS: string[] = ["coin", "penny", "pennies", "fare", "pay", "paid", "money", "silver", "gold", "copper", "cash", "shilling", "purse", "wallet"];

/** The words that count as night, for the ferrywoman's second rule. */
const NIGHT_WORDS: string[] = ["night", "dark", "darkness", "moon", "star", "midnight", "dusk", "evening", "late", "moonlight"];

/** The words that count as a source of light, for the rock keeper's rule. */
const LAMP_WORDS: string[] = ["lamp", "lantern", "candle", "torch", "bulb", "flame", "glow", "glowing", "bright", "shine", "shining", "beam", "spark", "fire"];

/** The words that count as a number, for the collector's rule. */
const NUMBER_WORDS: string[] = [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "dozen", "twenty", "hundred", "thousand", "pair", "couple", "double", "triple", "half", "numeral",
];

/** The keepers, each with the rules they might hold this round. */
export const KEEPERS: GateScenario[] = [
    {
        keeper: "Pell",
        title: "the gatekeeper of the marsh orchard",
        place: "the marsh orchard gate",
        manner: "Slow and dry, in short sentences, and treats every visitor as a mild inconvenience.",
        rules: [
            {
                tests: [{ kind: "mentions", words: BIRD_WORDS }, { kind: "avoids", words: ["please", "sorry", "beg", "begging", "begged", "mercy"] }],
                clue: "Pell keeps strange company, things that honk and roost, and can't stand grovelling.",
                reveal: "Pell lets in anyone who mentions a bird, and shuts on anyone who begs.",
            },
            {
                tests: [{ kind: "mentions", words: WEATHER_WORDS }, { kind: "long", minWords: 9 }],
                clue: "Pell has opinions about the sky, and no patience for mumblers.",
                reveal: "Pell lets in anyone who talks about the weather at some length, in nine words or more.",
            },
        ],
    },
    {
        keeper: "Odd",
        title: "the ferrywoman of the grey river",
        place: "the ferry steps",
        manner: "Quiet and blunt, finds speeches tiring, and has rowed the same stretch for forty years.",
        rules: [
            {
                tests: [{ kind: "mentions", words: MONEY_WORDS }, { kind: "short", maxWords: 8 }],
                clue: "Odd works for a living and hates a speech.",
                reveal: "Odd takes anyone who mentions payment in eight words or fewer.",
            },
            {
                tests: [{ kind: "mentions", words: NIGHT_WORDS }, { kind: "avoids", words: ["hurry", "quick", "quickly", "fast", "now", "urgent", "urgently", "immediately"] }],
                clue: "Odd keeps to the old hours and can't be rushed.",
                reveal: "Odd takes anyone who talks about the dark hours, and shuts on anyone in a hurry.",
            },
        ],
    },
    {
        keeper: "Maud",
        title: "the keeper of the Skerry rock",
        place: "the rock tower door",
        manner: "Brisk and fussy, and talks as if every sentence were going into a ship's log.",
        rules: [
            {
                tests: [{ kind: "mentions", words: LAMP_WORDS }, { kind: "long", minWords: 10 }],
                clue: "Maud likes whatever keeps off the dark, and a proper account of yourself.",
                reveal: "Maud lets in anyone who mentions a lamp or a flame, in ten words or more.",
            },
        ],
    },
    {
        keeper: "Brannock",
        title: "the collector of the stone toll bridge",
        place: "the toll bridge",
        manner: "Pompous and exact, and corrects other people's arithmetic without ever saying the answer.",
        rules: [
            {
                tests: [{ kind: "mentions", words: NUMBER_WORDS }, { kind: "avoids", words: ["free", "freebie", "cheap", "cheaper", "discount", "bargain", "haggle", "owe", "owing"] }],
                clue: "Brannock likes his figures in order and takes offence at anyone angling for a better price.",
                reveal: "Brannock lets in anyone who says a number, and shuts on anyone angling for a discount.",
            },
        ],
    },
];

/** The cargo words: everyday things, one for each seat. */
export const CARGO: string[] = [
    "teapot", "umbrella", "pudding", "kettle", "scarecrow", "wheelbarrow", "hammock", "marmalade", "anchor", "pineapple", "lobster", "cushion",
    "ladder", "compass", "sundial", "barrel", "wardrobe", "spanner", "thimble", "trampoline", "saddle", "cabbage", "mirror", "pocketwatch",
];
