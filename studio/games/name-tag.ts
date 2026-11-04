// Name Tag as a blueprint: the identity kit's game for three to eight people. Everyone is dealt a
// secret name tag (a person, a creature or a thing) that everyone else can see on their phone and
// they cannot. One player at a time is on the spot and asks the room yes-or-no questions out loud
// to work out who they are. The fallback identities are original choices of well-known, gentle
// names; at play time the host's model writes a fresh list. Notes are in name-tag.md beside this file.

import { HOST_NAME } from "../../shared/brand.ts";
import type { IdentityBlueprint } from "../blueprint.ts";

/** Name Tag, written as decisions on the identity kit. */
export const NAME_TAG_BLUEPRINT: IdentityBlueprint = {
    kit: "identity",
    box: {
        id: "nameTag",
        name: "Name Tag",
        pitch: `Everyone wears a secret name tag that only the others can see. Ask the room questions out loud until you know who you are, and ${HOST_NAME} keeps time.`,
        howToPlay: [
            "Your phone shows everyone's name tag but your own. Keep quiet about them.",
            "When it's your turn, hold to talk and ask the room yes-or-no questions. They answer out loud.",
            "Say who you think you are. The game checks it, and the fewer questions it takes, the more points you get.",
        ],
        remarks: ["Everyone knows who you are but you.", "Keep your face still. Mostly.", "Ask good questions. Or silly ones."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["name tag", "pass", "who am I", "yes", "no", "sort of"],
    },
    decisions: {
        introSeconds: 12,
        turnSeconds: 75,
        questionsPerTurn: 12,
        betweenSeconds: 8,
        identities: [
            { name: "Cleopatra", kind: "person", also: [] },
            { name: "Albert Einstein", kind: "person", also: [] },
            { name: "Marie Curie", kind: "person", also: [] },
            { name: "Leonardo da Vinci", kind: "person", also: ["Leonardo"] },
            { name: "Amelia Earhart", kind: "person", also: [] },
            { name: "Isaac Newton", kind: "person", also: [] },
            { name: "William Shakespeare", kind: "person", also: [] },
            { name: "Sherlock Holmes", kind: "person", also: [] },
            { name: "Robin Hood", kind: "person", also: [] },
            { name: "Cinderella", kind: "person", also: [] },
            { name: "Giraffe", kind: "creature", also: [] },
            { name: "Octopus", kind: "creature", also: [] },
            { name: "Penguin", kind: "creature", also: [] },
            { name: "Kangaroo", kind: "creature", also: [] },
            { name: "Narwhal", kind: "creature", also: [] },
            { name: "Dragon", kind: "creature", also: [] },
            { name: "Unicorn", kind: "creature", also: [] },
            { name: "Elephant", kind: "creature", also: [] },
            { name: "Eiffel Tower", kind: "thing", also: [] },
            { name: "Statue of Liberty", kind: "thing", also: [] },
            { name: "Mount Everest", kind: "thing", also: ["Everest"] },
            { name: "Great Wall of China", kind: "thing", also: [] },
            { name: "Umbrella", kind: "thing", also: [] },
            { name: "Toaster", kind: "thing", also: [] },
            { name: "Lighthouse", kind: "thing", also: [] },
            { name: "Hot air balloon", kind: "thing", also: [] },
        ],
    },
};
