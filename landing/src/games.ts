// The games on the shelf, in the lobby's order, described plainly. Facts match each
// cartridge's manifest; the paintings are the TV's own, drawn once with Muse Image and served
// from /screen/art.

/** One box on the shelf. */
export interface GameBox {
    name: string;
    /** What you do in plain words; never another product's name. */
    line: string;
    players: string;
    length: string;
    art: string;
    alt: string;
}

/** The games, in the lobby's order. */
export const GAMES: GameBox[] = [
    {
        name: "Twenty Doors",
        line: "The host thinks of something. You get twenty yes-or-no questions to work out what it is.",
        players: "1 to 12 players",
        length: "About 5 minutes",
        art: "/screen/art/twenty-doors.webp",
        alt: "A painting of a corridor of coloured doors, one standing open with light behind it",
    },
    {
        name: "Werewolf",
        line: "Some of you are secretly werewolves, and the village votes each day. The host narrates and is never told who has which role.",
        players: "4 to 10 players",
        length: "15 to 25 minutes",
        art: "/screen/art/werewolf.webp",
        alt: "A painting of a timber village at night under a full moon",
    },
    {
        name: "Quizmaster",
        line: "Name any topic and answer out loud. The host writes the questions and judges the answers.",
        players: "1 to 12 players",
        length: "About 5 minutes",
        art: "/screen/art/quizmaster.webp",
        alt: "A painting of paper question marks and a brass bell on a wooden table",
    },
];
