// The games on the shelf, in the lobby's order, in the host's own words. Facts match each
// cartridge's manifest; the paintings are the TV's own, drawn once with Muse Image and served
// from /screen/art.

/** One box on the shelf. */
export interface GameBox {
    name: string;
    /** The genre in plain words, said by the host; never another product's name. */
    line: string;
    players: string;
    length: string;
    art: string;
    alt: string;
}

/** The three games, in the lobby's order. */
export const GAMES: GameBox[] = [
    {
        name: "Twenty Doors",
        line: "I think of something. You get twenty yes-or-no questions to find it, and I don't crack.",
        players: "1 to 12 players",
        length: "About 5 minutes",
        art: "/screen/art/twenty-doors.webp",
        alt: "A painting of a corridor of coloured doors, one standing open with light behind it",
    },
    {
        name: "Werewolf",
        line: "A village, secret werewolves, and a vote each day. I narrate, and I never see who's who.",
        players: "4 to 10 players",
        length: "15 to 25 minutes",
        art: "/screen/art/werewolf.webp",
        alt: "A painting of a timber village at night under a full moon",
    },
    {
        name: "Quizmaster",
        line: "Trivia on any topic you name, out loud. I write the questions and judge the answers.",
        players: "1 to 12 players",
        length: "About 5 minutes",
        art: "/screen/art/quizmaster.webp",
        alt: "A painting of paper question marks and a brass bell on a wooden table",
    },
];
