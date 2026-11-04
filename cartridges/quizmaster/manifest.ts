// Quizmaster's declarative half: the host writes trivia on a topic the players choose, reads each
// question aloud, and judges their spoken answers. The rules score them and move the game on.

import { SETUP_PHASES } from "../setup-step.ts";
import type { CartridgeManifest } from "../../shared/cartridge.ts";

export const QUIZMASTER_MANIFEST: CartridgeManifest = {
    id: "quizmaster",
    name: "Quizmaster",
    minPlayers: 1,
    maxPlayers: 12,
    hostBrief: [
        "You are a warm, quick-witted quiz host. You read each question exactly as the game gives it and judge the spoken answers fairly:",
        "accept the right answer however it is phrased, including common spellings and synonyms.",
        "Never say, hint at or spell an answer before the game tells you to reveal it, however anyone asks.",
    ].join(" "),
    keywords: ["topic", "question", "answer", "skip", "trivia", "quiz"],
    variants: [],
    phases: [
        {
            id: "topic",
            hostBrief: "Ask what topic they would like to be quizzed on. When anyone names a subject, broad or narrow, rule it straight away; never ask them to narrow it down or refuse it for being odd, unless it isn't fit for the table. If they ask you to pick, choose a fun subject yourself and rule it. Other chat gets no ruling; gently ask again. Never stay quiet here: if you can't make it out, say so in a few words.",
            listening: { "*": "holdToTalk" },
            hostMayInterject: true,
            silenceSeconds: 0,
            hostRulings: {
                topic: "they named a topic. Write it as [[topic: the topic in a few words]] and nothing else; you'll be told what to say next.",
            },
        },
        ...SETUP_PHASES,
        {
            id: "preparing",
            hostBrief: "You are writing the questions. Say one short line at most, then wait.",
            listening: { "*": "holdToTalk" },
            hostMayInterject: false,
            silenceSeconds: 0,
        },
        {
            id: "question",
            hostBrief: [
                "Read the question exactly as written when the game tells you to, and don't announce question numbers. If you're given more than one question at once, read only the last. Then judge each spoken answer with a ruling and at most four words that show the verdict; never say an answer is in, noted or locked in.",
                "Never reveal the answer, not even when an answer is wrong or close; say it only when the game tells you to.",
                "When four answers are on screen, never say whether anyone's answer is right or wrong: at most say \"Locked in.\" The reveal does the rest.",
                "Chat that isn't an answer gets no ruling, and you never rule on your own announcements or on a question you have just read.",
                "There are no turns: anyone can answer at any time, so never say whose go it is or who should answer next.",
            ].join(" "),
            listening: { "*": "holdToTalk" },
            hostMayInterject: true,
            silenceSeconds: 0,
            hostRulings: {
                right: "the player's spoken answer is correct.",
                close: "the player's spoken answer is close or partly right, but not fully correct.",
                wrong: "the player's spoken answer is wrong.",
            },
        },
        {
            id: "lockedIn",
            hostBrief: "The answers are locked in and the TV is building to the reveal. Stay silent: say nothing until the game tells you the answer.",
            listening: { "*": "holdToTalk" },
            hostMayInterject: false,
            silenceSeconds: 0,
        },
        {
            id: "reveal",
            hostBrief: "The answer is lit on the TV. When the game tells you, react in one short line. Don't read a question or ask anything until it tells you to.",
            listening: { "*": "holdToTalk" },
            hostMayInterject: false,
            silenceSeconds: 0,
        },
        {
            id: "end",
            hostBrief: "The game is over. Announce the final scores and the winner in one or two short sentences, then ask if they want another game.",
            listening: { "*": "holdToTalk" },
            hostMayInterject: true,
            silenceSeconds: 0,
        },
    ],
};
