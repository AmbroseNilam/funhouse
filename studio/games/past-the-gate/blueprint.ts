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
            "Your phone gives you cargo: a word only you know.",
            "Hold your phone and plead with the keeper out loud. It has a rule, and it won't say what.",
            "Get through, and say your cargo word in the plea that does it.",
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
