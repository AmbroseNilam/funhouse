// Past the Gate as a blueprint: the gate kit for two to eight people. The host plays the keeper of
// a gate, in character, with a secret rule that code checks against what each player says. Each
// player is smuggling a word on their phone. The experience script is in script.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { GateBlueprint } from "../../kits/gate/index.ts";
import { CARGO, KEEPERS } from "./keepers.ts";

/** Past the Gate, written as decisions on the gate kit. */
export const PAST_THE_GATE_BLUEPRINT: GateBlueprint = {
    kit: "gate",
    box: {
        id: "pastTheGate",
        name: "Past the Gate",
        pitch: `${HOST_NAME} plays a keeper with a secret rule. Talk your way past it.`,
        howToPlay: [
            "A keeper guards the gate, and only a secret rule opens it.",
            "Plead out loud on your phone. The clue on screen hints at the rule.",
            "Your phone shows a secret cargo word. Sneak it into your winning plea.",
            "Get everyone through before the keeper's patience runs out.",
        ],
        remarks: ["The gate is shut. It has its reasons.", "Flattery rarely works here.", "Bring a good argument."],
        art: "art/hero.webp",
        minPlayers: 2,
        maxPlayers: 8,
        keywords: ["gate", "keeper", "let me through", "plead", "cargo"],
    },
    decisions: {
        scenarios: KEEPERS,
        props: CARGO,
        readSeconds: 12,
        gateSeconds: 300,
        patience: { base: 6, perPlayer: 3, warnAt: [3, 1] },
        giveUpButton: true,
        points: { through: 1, smuggled: 3 },
    },
};
