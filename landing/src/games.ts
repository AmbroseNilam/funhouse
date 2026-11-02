// The games the page shows, in the lobby's order. Facts match each cartridge's manifest; the
// art is drawn once with Muse Image and kept in landing/public/art.

/** One game card. */
export interface GameCard {
    name: string;
    /** The genre in plain words; never another product's name. */
    line: string;
    players: string;
    length: string;
    art: string;
    alt: string;
}

/** The three games, in the lobby's order. */
export const GAMES: GameCard[] = [
    {
        name: "Twenty Doors",
        line: "The host holds a secret. You get twenty yes-or-no questions to find it, and it never cracks.",
        players: "1 to 12 players",
        length: "About 5 minutes",
        art: "/landing/art/twenty-doors.webp",
        alt: "A painted wooden door standing open on a moonlit beach, warm light spilling out",
    },
    {
        name: "Werewolf",
        line: "A village, secret werewolves, and a vote each day. The host narrates and never knows who's who.",
        players: "4 to 10 players",
        length: "15 to 25 minutes",
        art: "/landing/art/werewolf.webp",
        alt: "A painted timber village at night under a full moon, something moving between the trees",
    },
    {
        name: "Quizmaster",
        line: "Spoken trivia on any topic you name. The host writes the questions and judges your answers.",
        players: "1 to 12 players",
        length: "About 5 minutes",
        art: "/landing/art/quizmaster.webp",
        alt: "A painted quiz stage with a lit podium and a wall of glowing question marks",
    },
];
