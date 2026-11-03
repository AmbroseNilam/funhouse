// The games on the shelf, in the lobby's order. Facts match each cartridge's manifest; the
// paintings are the TV's own, drawn once with Muse Image and served from /screen/art.

/** One box on the shelf. */
export interface GameBox {
    name: string;
    /** The genre in plain words; never another product's name. */
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
        line: "I hold a secret. You get twenty yes-or-no questions to find it, and I don't crack.",
        players: "1 to 12 players",
        length: "About 5 minutes",
        art: "/screen/art/twenty-doors.webp",
        alt: "A painting of a wooden door standing open on a moonlit beach, light spilling out",
    },
    {
        name: "Werewolf",
        line: "A village, secret werewolves, and a vote each day. I narrate, and I never know who's who.",
        players: "4 to 10 players",
        length: "15 to 25 minutes",
        art: "/screen/art/werewolf.webp",
        alt: "A painting of a timber village at night under a full moon, something moving between the trees",
    },
    {
        name: "Quizmaster",
        line: "Trivia on any topic you name, out loud. I write the questions and judge the answers.",
        players: "1 to 12 players",
        length: "About 5 minutes",
        art: "/screen/art/quizmaster.webp",
        alt: "A painting of a quiz stage with a lit podium and a wall of question marks",
    },
];
