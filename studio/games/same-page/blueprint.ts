// Same Page as a blueprint: the match kit for three to eight people. Eight prompts, twenty seconds
// to type a short card in secret, ten seconds to look at the stacks. Matching cards stack and score;
// the card that sits alone wears the hat, and whoever holds the hat at the end loses points. The
// host writes each prompt from a fixed stem; the 24 fallback prompts and the stems are original to
// this game. The experience script and the host's lines are in script.md beside this file.

import { HOST_NAME } from "../../../shared/brand.ts";
import type { MatchBlueprint } from "../../kits/match/index.ts";

/** Same Page, written as decisions on the match kit. */
export const SAME_PAGE_BLUEPRINT: MatchBlueprint = {
    kit: "match",
    box: {
        id: "samePage",
        name: "Same Page",
        pitch: `${HOST_NAME} asks. You all write one short answer, and the matching ones stack up.`,
        howToPlay: [
            "Each prompt, type a short answer on your phone before the clock runs out. Nobody sees it yet.",
            "Then the cards turn over and the matching ones stack up. Every other card in your stack is a point, and a pair is worth two each.",
            "A card that matches nobody wears the hat. Whoever holds it when the last prompt ends loses two points.",
        ],
        remarks: ["Think like the room.", "Eight prompts. One mind, if you are lucky.", "Match the table, not the dictionary."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["prompt", "stack", "match", "hat", "another game"],
    },
    decisions: {
        stems: [
            { kind: "general", stem: "a thing you would never share" },
            { kind: "general", stem: "something you always lose" },
            { kind: "room", stem: "a thing someone here would bring to a desert island" },
            { kind: "general", stem: "the best thing to find in a coat pocket" },
            { kind: "general", stem: "a food that is better cold" },
            { kind: "room", stem: "what this table would argue about for an hour" },
            { kind: "general", stem: "a reason to leave a party early" },
            { kind: "general", stem: "a sound that means trouble" },
        ],
        bank: [
            { kind: "general", text: "A thing you would never share" },
            { kind: "general", text: "Something you always lose" },
            { kind: "general", text: "The best thing to find in a coat pocket" },
            { kind: "general", text: "A food that is better cold" },
            { kind: "general", text: "A reason to leave a party early" },
            { kind: "general", text: "A sound that means trouble" },
            { kind: "general", text: "Something that belongs on every desk" },
            { kind: "general", text: "A smell that means home" },
            { kind: "general", text: "What you reach for when you are cold" },
            { kind: "general", text: "Something that is always in the fridge" },
            { kind: "general", text: "A good excuse for being late" },
            { kind: "general", text: "What you would grab in a fire drill" },
            { kind: "general", text: "The first thing you do on a day off" },
            { kind: "general", text: "Something in every kitchen drawer" },
            { kind: "general", text: "A place everyone should visit once" },
            { kind: "general", text: "A colour that feels calm" },
            { kind: "general", text: "Something to bring to a picnic" },
            { kind: "general", text: "An animal that is secretly in charge" },
            { kind: "room", text: "A thing someone here would bring to a desert island" },
            { kind: "room", text: "What this table would argue about for an hour" },
            { kind: "room", text: "Something someone here is always late for" },
            { kind: "room", text: "The snack this group would order first" },
            { kind: "room", text: "A job someone here would be good at" },
            { kind: "room", text: "A word this group says too often" },
        ],
        writeSeconds: 20,
        revealSeconds: 10,
        settleSeconds: 3,
        askSeconds: 5,
        answerLimit: 30,
        pairPoints: 2,
        hatPenalty: 2,
    },
};
