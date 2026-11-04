// Magpie Pockets as a blueprint: the tap kit's push-your-luck style for three to eight people. Each
// beat everyone secretly chooses to draw or stay, one card is flipped for everyone who drew, and
// a trinket you already hold is a bust. The trinkets and tension lines are original to this game;
// at play time the host's model writes extra lines. Notes are in magpie-pockets.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { TapBlueprint } from "../../blueprint.ts";
import type { PushDecisions } from "../../kits/tap/tap-push.ts";

/** Magpie Pockets, written as decisions on the tap kit. */
export const MAGPIE_POCKETS_BLUEPRINT: TapBlueprint<PushDecisions> = {
    kit: "tap",
    box: {
        id: "magpiePockets",
        name: "Magpie Pockets",
        pitch: `Fill your pocket with trinkets, and stay before you draw a repeat. ${HOST_NAME} flips every card.`,
        howToPlay: [
            "Everyone secretly chooses to draw a card or stay.",
            "One card is flipped for everyone who drew. A trinket you already hold busts your pocket.",
            "Staying banks your pocket. First to the target at the end of a round wins.",
        ],
        remarks: ["Greedy hands, steady nerves.", "One more card. Famous last words.", "Bank early or tell stories later."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["draw", "stay", "bank", "pocket"],
    },
    decisions: {
        style: "push",
        target: 30,
        maxRounds: 8,
        chooseSeconds: 10,
        revealSeconds: 4,
        roundEndSeconds: 7,
        cards: [
            { name: "Button", value: 1, copies: 3 },
            { name: "Teaspoon", value: 1, copies: 3 },
            { name: "Brass key", value: 2, copies: 3 },
            { name: "Marble", value: 2, copies: 3 },
            { name: "Thimble", value: 3, copies: 3 },
            { name: "Feather quill", value: 3, copies: 3 },
            { name: "Pocket watch", value: 4, copies: 3 },
            { name: "Music box", value: 5, copies: 3 },
            { name: "Tin crown", value: 6, copies: 3 },
            { name: "Opal", value: 8, copies: 3 },
        ],
        lines: [
            "Everyone has a pocket and an opinion about it.",
            "Fingers ready. Nobody is watching your fingers.",
            "One more card is how most stories end.",
            "The deck has no feelings. It has a shuffle.",
            "Somebody is about to be brave, and somebody else is about to be right.",
            "Greed is a fine hobby until the repeat.",
            "A banked point is a point nobody can take back.",
            "The careful ones are counting. The bold ones are already wincing.",
            "Draw or stay. The pocket is listening.",
            "Every card is innocent until it matches.",
            "Think of the points. Then think of the repeat.",
            "The deck was shuffled by someone who loves drama.",
            "Pockets are heavy things. Choose.",
            "Somebody here has the look of a person about to push it.",
            "History remembers the ones who stayed, mostly because they are still here.",
            "The next card is already decided. It simply has not told you.",
        ],
    },
};
