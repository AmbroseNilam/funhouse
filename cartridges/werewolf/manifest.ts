// Werewolf's declarative half: who the host is in this game, what it must never say, how
// each phase listens, and the variant options the lobby offers. The rules core is in rules.ts.

import type { CartridgeManifest } from "../../shared/cartridge.ts";

export const WEREWOLF_MANIFEST: CartridgeManifest = {
    id: "werewolf",
    name: "Werewolf",
    minPlayers: 4,
    maxPlayers: 10,
    hostBrief: [
        "You are the narrator and referee of a game of Werewolf at a table of friends.",
        "You are never told anyone's role, any night choice, or the seer's findings, so never guess or imply them. If asked who the werewolf is, you don't know either.",
        "You narrate what the engine says is true, keep the pace brisk, and invite quiet players into the discussion.",
        "At night you whisper. At dawn you announce. During discussion you listen and only interject on a lull, your name, or the timer.",
    ].join(" "),
    keywords: ["werewolf", "werewolves", "villager", "seer", "vote", "lynch", "accuse", "night", "dawn"],
    variants: [
        { id: "seer", label: "Seer", description: "One villager may investigate one player each night.", defaultOn: true },
        { id: "dayTimer", label: "Discussion timer", description: "Limit each day's discussion to three minutes.", defaultOn: true },
        { id: "revealOnDeath", label: "Reveal roles on death", description: "Announce a player's role when they are eliminated.", defaultOn: true },
    ],
    phases: [
        { id: "roles", hostBrief: "Tell everyone to look at their phone privately and keep it to themselves. One or two sentences.", listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
        { id: "night", hostBrief: "One or two hushed sentences: everyone closes their eyes, and those with something to do do it on their phones.", listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
        { id: "dawn", hostBrief: "Announce in one or two sentences what you're told happened overnight. Don't accuse anyone.", listening: { "*": "hostSpeaking" }, hostMayInterject: true, silenceSeconds: 0 },
        {
            id: "discussion",
            hostBrief: "They're arguing among themselves. Reply exactly (quiet) unless someone says your name or asks you something; then answer in a sentence. You don't know who is what, so never hint that you do.",
            listening: { "*": "holdToTalk", spectator: "muted" },
            hostMayInterject: true,
            silenceSeconds: 12,
            hostRulings: { vote: "the group says they're ready to vote. Write [[vote]] first, then one short line calling it." },
        },
        { id: "vote", hostBrief: "They're voting on their phones, and you'll be told the result. Reply exactly (quiet) unless spoken to.", listening: { "*": "holdToTalk", spectator: "muted" }, hostMayInterject: true, silenceSeconds: 0 },
        { id: "end", hostBrief: "Recap the game in character and offer another round.", listening: { "*": "holdToTalk" }, hostMayInterject: true, silenceSeconds: 0 },
    ],
};
