// Wrong Room as a blueprint: the stranger kit for four to eight people. Everyone knows where they
// are, with a role there, except one player, the Stranger, who is told nothing. They question each
// other in turn, and the room must find the Stranger before the Stranger works out the place. The
// host writes a fresh place and roles every round; the places below are original fallbacks for when
// it can't. The experience script is in wrong-room.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { StrangerBlueprint } from "../../kits/stranger/index.ts";

/** Wrong Room, written as decisions on the stranger kit. */
export const WRONG_ROOM_BLUEPRINT: StrangerBlueprint = {
    kit: "stranger",
    box: {
        id: "wrongRoom",
        name: "Wrong Room",
        pitch: `${HOST_NAME} picks a place. All of you know where you are, except one.`,
        howToPlay: [
            "Check your phone. You know where you are, unless you are the stranger.",
            "Take turns asking each other questions out loud. Give nothing away.",
            "Find the stranger. The stranger wants to work out the place.",
        ],
        remarks: ["Everyone knows where they are. Except one.", "Ask carefully. Someone is bluffing.", "Somebody here is in the wrong room."],
        art: "art/hero.webp",
        minPlayers: 4,
        maxPlayers: 8,
        keywords: ["stranger", "vote", "place", "where", "question", "answer", "guess"],
    },
    decisions: {
        places: [
            { name: "Lighthouse", roles: ["keeper", "sailor", "painter", "tourist", "engineer", "cook", "inspector", "fisher"] },
            { name: "Night ferry", roles: ["captain", "deckhand", "musician", "commuter", "baker", "ticket seller", "tourist", "engineer"] },
            { name: "Bakery", roles: ["baker", "apprentice", "regular", "delivery driver", "inspector", "cashier", "critic", "student"] },
            { name: "Observatory", roles: ["astronomer", "student", "guide", "janitor", "journalist", "technician", "donor", "child"] },
            { name: "Library", roles: ["librarian", "student", "retiree", "author", "janitor", "tourist", "volunteer", "poet"] },
            { name: "Greenhouse", roles: ["gardener", "botanist", "florist", "tourist", "beekeeper", "student", "buyer", "painter"] },
            { name: "Train station", roles: ["driver", "conductor", "commuter", "busker", "cleaner", "tourist", "guard", "florist"] },
            { name: "Lake cabin", roles: ["host", "angler", "guest", "neighbour", "cook", "poet", "ranger", "child"] },
            { name: "Circus tent", roles: ["clown", "juggler", "acrobat", "ringmaster", "vendor", "spectator", "tamer", "mechanic"] },
            { name: "Wedding hall", roles: ["bride", "groom", "caterer", "musician", "cousin", "photographer", "florist", "officiant"] },
        ],
        questions: { budget: 12, warnAt: [3, 1] },
        readSeconds: 10,
        stepSeconds: 30,
        talkSeconds: 420,
        voteSeconds: 45,
        guessSeconds: 30,
    },
};
