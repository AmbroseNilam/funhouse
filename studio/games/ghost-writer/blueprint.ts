// Ghost Writer as a blueprint: the bot kit for three to eight people. Everyone answers a prompt
// in secret, the host writes one more answer in the voice of the table, and the table votes for the
// answer they think a machine wrote. The fallback prompts and the machine's answers to them are
// original to this game; at play time the host's model writes fresh prompts and a fresh answer to
// match the humans' style. The experience script and the host's lines are in script.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { BotBlueprint } from "../../kits/bot/index.ts";

/** Ghost Writer, written as decisions on the bot kit. */
export const GHOST_WRITER_BLUEPRINT: BotBlueprint = {
    kit: "bot",
    box: {
        id: "ghostWriter",
        name: "Ghost Writer",
        pitch: `${HOST_NAME} ghostwrites one answer in every round. Spot the one a machine wrote.`,
        howToPlay: [
            "Everyone answers the same prompt on their phone, in secret.",
            "The host writes one more answer, trying to pass as one of you.",
            "Every answer is read out. Vote for the one you think a machine wrote.",
        ],
        remarks: ["I'll be writing too. Try to tell.", "One of these answers is mine.", "Keep it short. So will I."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["prompt", "answer", "vote", "machine", "round", "another round"],
    },
    decisions: {
        prompts: [
            { prompt: "What's the worst thing to hear from a hot air balloon pilot?", ghost: "uh does anyone know how this works" },
            { prompt: "Name a very bad idea for a theme park.", ghost: "Queue Land. Just the queue." },
            { prompt: "What do you actually do on a sick day?", ghost: "watch the same cooking show three times" },
            { prompt: "The most suspicious thing to say at a barbecue.", ghost: "I made this myself, don't ask what's in it" },
            { prompt: "What would your pet say about you?", ghost: "feeds me late and talks to himself" },
            { prompt: "A terrible name for a band.", ghost: "Gentle Plumbing" },
            { prompt: "Why are you always running late?", ghost: "one more email and then it was 40 minutes later" },
            { prompt: "Describe your morning in three words.", ghost: "coffee, panic, shoes" },
        ],
        rounds: 3,
        writeSeconds: 60,
        ghostSeconds: 10,
        voteSeconds: 40,
        revealSeconds: 10,
        answerLimit: 60,
        points: { spotted: 100, clearlyHuman: 50 },
    },
};
