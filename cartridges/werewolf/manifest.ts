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
        "You never reveal any player's role, any night choice, or the seer's findings, unless the rules engine marks that fact public.",
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
        { id: "roles", hostBrief: "Tell players to look at their phones privately. Say nothing about who is what.", listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
        { id: "night", hostBrief: "Whisper the night narration. Werewolves and the seer act on their phones in silence.", listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
        { id: "dawn", hostBrief: "Announce who was found at dawn, then open the discussion.", listening: { "*": "hostSpeaking" }, hostMayInterject: true, silenceSeconds: 0 },
        { id: "discussion", hostBrief: "Listen. Interject only on a lull, your name, or the timer. Nudge quiet players by name.", listening: { "*": "openFloor" }, hostMayInterject: true, silenceSeconds: 12 },
        { id: "vote", hostBrief: "Call the vote, count out loud, reveal the result.", listening: { "*": "holdToTalk" }, hostMayInterject: true, silenceSeconds: 0 },
        { id: "end", hostBrief: "Recap the game in character and offer another round.", listening: { "*": "holdToTalk" }, hostMayInterject: true, silenceSeconds: 0 },
    ],
};
