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
        { id: "choosing", hostBrief: "You are choosing the secret. Say nothing about it yet; one short teasing line at most.", listening: { "*": "holdToTalk" }, hostMayInterject: false, silenceSeconds: 0 },
        {
            id: "asking",
            hostBrief: "Answer each question with a ruling, then a few words. Chat that isn't a question or a guess gets no ruling and uses no door. Don't count doors out loud unless few are left.",
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
