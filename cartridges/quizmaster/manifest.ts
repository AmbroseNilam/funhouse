// Quizmaster's declarative half: the host writes trivia on a topic the players choose, reads each
// question aloud, and judges their spoken answers. The rules score them and move the game on.

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
            hostBrief: "Ask what topic they would like to be quizzed on. When anyone names a subject, broad or narrow, rule it straight away; never ask them to narrow it down or refuse it for being odd, unless it isn't fit for the table. Chat that doesn't name a subject gets no ruling; gently ask again.",
            listening: { "*": "holdToTalk" },
            hostMayInterject: true,
            silenceSeconds: 0,
            hostRulings: {
                topic: "they named a topic. Write it as [[topic: the topic in a few words]] and nothing else; you'll be told what to say next.",
            },
        },
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
                "Read the question exactly as written when the game tells you to. Then judge each spoken answer with a ruling and a few words.",
                "Never reveal the answer, not even when an answer is wrong or close; say it only when the game tells you to.",
                "Chat that isn't an answer gets no ruling, and you never rule on your own announcements or on a question you have just read.",
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
            id: "end",
            hostBrief: "The game is over. Announce the final scores and the winner in two or three sentences, then ask if they want another game.",
            listening: { "*": "holdToTalk" },
            hostMayInterject: true,
            silenceSeconds: 0,
        },
    ],
};
