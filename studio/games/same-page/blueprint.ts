// Same Page as a blueprint: the match kit for three to eight people. Eight prompts, thirty seconds
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
            "Read the prompt and type what you think the room will say.",
            "Cards turn over together, and matching answers stack up.",
            "Bigger stacks score more points. Match the room, not the dictionary.",
            "A lone answer wears the hat. Hold it at the end and lose points.",
        ],
        remarks: ["Think like the room.", "Eight prompts. One mind, if you are lucky.", "Match the table, not the dictionary."],
        art: "art/hero.webp",
        minPlayers: 3,
        maxPlayers: 8,
        keywords: ["prompt", "stack", "match", "hat", "another game"],
    },
    decisions: {
        promptsPerGame: 8,
        stems: [
            { kind: "general", stem: "something you always lose" },
            { kind: "general", stem: "the worst smell in a car" },
            { kind: "general", stem: "the best thing to find in a coat pocket" },
            { kind: "general", stem: "a food that is better cold" },
            { kind: "general", stem: "a reason to leave a party early" },
            { kind: "general", stem: "a sound that means trouble" },
            { kind: "general", stem: "something a dog would steal" },
            { kind: "general", stem: "the first thing you do on a day off" },
            { kind: "general", stem: "a bad excuse for being late" },
            { kind: "general", stem: "what you would grab in a fire drill" },
            { kind: "general", stem: "an animal that is secretly in charge" },
            { kind: "general", stem: "something you pretend to understand" },
            { kind: "general", stem: "a job a cat would be terrible at" },
            { kind: "general", stem: "a snack you cannot stop eating" },
            { kind: "room", stem: "a thing someone here would bring to a desert island" },
            { kind: "room", stem: "what this table would argue about for an hour" },
            { kind: "room", stem: "the snack this group would order first" },
            { kind: "room", stem: "a film this group has seen too many times" },
            { kind: "room", stem: "a word this group says too often" },
            { kind: "room", stem: "a chore everyone here avoids" },
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
        writeSeconds: 30,
        revealSeconds: 10,
        settleSeconds: 3,
        askSeconds: 5,
        answerLimit: 30,
        pairPoints: 2,
        hatPenalty: 2,
    },
};
