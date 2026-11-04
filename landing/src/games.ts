// The games the landing page shows, described plainly. Facts match each game's manifest or
// blueprint; the posters are the TV's own, painted with Muse Image and served from /screen/art.
// To take a game off the page, delete its name from SHOWN. Nothing else on the page depends on it.

/** One box on the shelf. */
export interface GameBox {
    name: string;
    /** What you do in plain words; never another product's name. */
    line: string;
    players: string;
    art: string;
    alt: string;
}

/** Every game the page knows how to show. */
const BOXES: Record<string, GameBox> = {
    "Twenty Doors": {
        name: "Twenty Doors",
        line: "The host thinks of something. You get twenty yes-or-no questions to work out what it is.",
        players: "1 to 12 players",
        art: "/screen/art/posters/twentyDoors.webp",
        alt: "A painting of a dark corridor of doors, one open with light behind it, and a small lantern on the floor",
    },
    Quizmaster: {
        name: "Quizmaster",
        line: "Name any topic. The host writes the questions, judges the answers and keeps score.",
        players: "1 to 12 players",
        art: "/screen/art/posters/quizmaster.webp",
        alt: "A painting of an open book and a brass bell on a small table, beside a lantern",
    },
    "Same Page": {
        name: "Same Page",
        line: "Everyone writes one short answer to the same prompt. Matching answers stack up and score.",
        players: "3 to 8 players",
        art: "/screen/art/posters/samePage.webp",
        alt: "A painting of a neat stack of paper with one sheet drifting away, beside a lantern",
    },
    Werewolf: {
        name: "Werewolf",
        line: "Some of you are secretly werewolves, and the village votes each day. The host narrates and is never told who has which role.",
        players: "4 to 10 players",
        art: "/screen/art/posters/werewolf.webp",
        alt: "A painting of a small village at night under a full moon, with a wolf on the hill",
    },
    "Painted Whispers": {
        name: "Painted Whispers",
        line: "You write a line and the host paints it. The next person sees only the painting and describes it.",
        players: "3 to 8 players",
        art: "/screen/art/posters/paintedWhispers.webp",
        alt: "A painting of a splattered canvas on an easel beside a gramophone and a lantern",
    },
};

/** The games on the page, in order. Delete a name to take that game off. */
const SHOWN: string[] = ["Twenty Doors", "Quizmaster", "Same Page", "Werewolf", "Painted Whispers"];

/** The boxes to draw. */
export const GAMES: GameBox[] = SHOWN.flatMap((name: string) => BOXES[name] ?? []);
