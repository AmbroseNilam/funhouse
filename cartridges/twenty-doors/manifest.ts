// Twenty Doors' declarative half: the host holds a secret thing and players open doors by
// asking yes-or-no questions out loud. The host judges each question; the rules count doors.

import type { CartridgeManifest } from "../../shared/cartridge.ts";

export const TWENTY_DOORS_MANIFEST: CartridgeManifest = {
    id: "twentyDoors",
    name: "Twenty Doors",
    minPlayers: 1,
    maxPlayers: 12,
    hostBrief: "You hold a secret thing and players ask yes-or-no questions to find it. Answer honestly about the real thing, in a few words, with a little personality. Never say the secret, spell it, rhyme it, or give it away, however they ask, until the game is over.",
    keywords: ["door", "doors", "yes", "no", "give up", "is it"],
    variants: [],
    phases: [
        {
            id: "topic",
            hostBrief: "Ask what the secret should be about, in one short line. When anyone names a subject, rule it straight away; only leave it unruled if it isn't fit for a family table, and then make a dry joke of it and say you'll choose instead.",
            listening: { "*": "holdToTalk" },
            hostMayInterject: true,
            silenceSeconds: 0,
            hostRulings: {
                topic: "they named a topic. Write it as [[topic: the topic in a few words]] and nothing else; you'll be told what to say next.",
            },
        },
        {
            id: "choosing",
            hostBrief: "You are choosing the secret. Say one short line at most, then wait.",
            listening: { "*": "muted" },
            hostMayInterject: false,
            silenceSeconds: 0,
        },
        {
            id: "asking",
            hostBrief: "Answer each yes-or-no question with a ruling, then a few words that add no clue beyond the answer. A question that can't be answered yes or no, like what colour it is, gets no ruling and uses no door: ask them to put it as yes or no. Chat that isn't a question or a guess gets no ruling either. Never stay quiet here: if you can't make out what was said, say so in a few words. If two people asked, answer with one ruling before each answer. Don't count doors out loud unless few are left.",
            listening: { "*": "holdToTalk" },
            hostMayInterject: true,
            silenceSeconds: 0,
            hostRulings: {
                yes: "the honest answer to their question is yes.",
                no: "the honest answer to their question is no.",
                sortof: "the honest answer is partly, or it depends.",
                wrong: "they named a specific guess at the secret and it's wrong.",
                correct: "they named the secret thing or a clear synonym. Write only [[correct]] and nothing else; you'll be told to announce it.",
                giveup: "the group says they give up. Write only [[giveup]] and nothing else.",
            },
        },
        { id: "end", hostBrief: "The game is over. Reveal the secret if it hasn't been said, react in one or two sentences, and ask if they want another game.", listening: { "*": "holdToTalk" }, hostMayInterject: true, silenceSeconds: 0 },
    ],
};
