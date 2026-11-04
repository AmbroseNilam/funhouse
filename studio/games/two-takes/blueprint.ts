// Two Takes as a blueprint: the wit kit for three to eight people. The host sets one prompt per
// round, two of you answer it in secret on your phones, and the rest of the table votes for the
// funnier answer. The fallback prompts are original to this game; at play time the host's model
// writes fresh ones. The experience script and the host's lines are in script.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { WitBlueprint } from "../../blueprint.ts";

/** Two Takes, written as decisions on the wit kit. */
export const TWO_TAKES_BLUEPRINT: WitBlueprint = {
    kit: "wit",
    box: {
        id: "twoTakes",
        name: "Two Takes",
        pitch: `${HOST_NAME} sets a prompt. Two of you answer it. The rest decide who was funnier.`,
        howToPlay: [
            "Two players get the same prompt and type an answer on their phones.",
            "Everyone else hears both answers read out, and votes for the better one.",
            "Every vote scores. Most points after the last round wins.",
        ],
        remarks: ["Two answers enter. One leaves with the points.", "Somebody here is funnier than they let on.", "I'll read both answers the same way."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["prompt", "answer", "vote", "round", "another round"],
    },
    decisions: {
        prompts: [
            "The worst name for a pet goldfish",
            "A rejected slogan for a dentist",
            "Something you should never say to a pilot",
            "What the squirrels are really planning",
            "A terrible first line for a wedding speech",
            "The real reason that meeting could have been an email",
            "A review of the moon in one sentence",
            "What your houseplant would say about you",
            "The rule at the strictest lighthouse in the world",
            "A bad name for a boat",
            "The least helpful thing a satnav could say",
            "What the pigeon on the bench is thinking",
            "An awful thing to find in a birthday cake",
            "A motivational poster for a sloth",
        ],
        writeSeconds: 60,
        voteSeconds: 30,
        revealSeconds: 9,
        answerLimit: 70,
        points: { perVote: 100, sweepBonus: 100, walkover: 150 },
    },
};
