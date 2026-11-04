// Werewolf's declarative half: who the host is in this game, what it must never say, how
// each phase listens, and the variant options the game starts with. The rules core is in rules.ts.

import { HOST_NAME } from "../../shared/brand.ts";
import type { CartridgeManifest } from "../../shared/cartridge.ts";

export const WEREWOLF_MANIFEST: CartridgeManifest = {
    id: "werewolf",
    name: "Werewolf",
    minPlayers: 4,
    maxPlayers: 10,
    hostBrief: [
        "You are the narrator and referee of a game of Werewolf at a table of friends.",
        "You are never told anyone's role, any night choice, or the seer's findings, so never guess or imply them. If asked who the werewolf is, say with a dry smile that nobody tells the lantern either.",
        "Every line you say here is 25 words at most, and any number comes only from what you're told. Narrate what the engine says is true and keep the pace brisk.",
        "At night you whisper. At dawn you announce. During discussion you listen and only interject on a lull, your name, or the timer.",
    ].join(" "),
    keywords: ["werewolf", "werewolves", "villager", "seer", "doctor", "hunter", "vote", "lynch", "accuse", "night", "dawn"],
    variants: [
        { id: "dayTimer", label: "Discussion timer", description: "Limit each day's discussion to three minutes.", defaultOn: true },
        { id: "revealOnDeath", label: "Reveal roles on death", description: "Announce a player's role when they are eliminated.", defaultOn: true },
    ],
    phases: [
        { id: "pick", hostBrief: `One short line: they can choose the village on their phones, or you, ${HOST_NAME}, will decide in a moment.`, listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
        { id: "intro", hostBrief: "Say what the game is in one line of 25 words at most, using the numbers you're told. The rules are on the TV and every phone, so don't read them out. Answer rules questions in a sentence, without hinting at anyone's role.", listening: { "*": "holdToTalk" }, hostMayInterject: false, silenceSeconds: 0 },
        { id: "roles", hostBrief: "One line: their role is on their phone now; read it, keep it to themselves, and tap to hide it.", listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
        { id: "night", hostBrief: "One hushed line: eyes closed, phones down, and those with something to do do it quietly.", listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
        { id: "dawn", hostBrief: "Announce in one line what you're told happened overnight. If everyone survived, don't guess why. Don't accuse anyone.", listening: { "*": "hostSpeaking" }, hostMayInterject: true, silenceSeconds: 0 },
        {
            id: "discussion",
            hostBrief: "When told the village may discuss, say so in one short line. After that they're arguing among themselves: reply exactly (quiet) unless someone says your name or asks you something; then answer in a sentence. You don't know who is what, so never hint that you do.",
            listening: { "*": "holdToTalk", spectator: "muted" },
            hostMayInterject: true,
            hostMostlyQuiet: true,
            silenceSeconds: 12,
            hostRulings: { vote: "the group says they're ready to vote. Write [[vote]] first, then one short line calling it." },
        },
        { id: "vote", hostBrief: "When told it's time to vote or that the vote is tied, say so in one short line. After that they're voting on their phones: reply exactly (quiet) unless spoken to.", listening: { "*": "holdToTalk", spectator: "muted" }, hostMayInterject: true, hostMostlyQuiet: true, silenceSeconds: 0 },
        { id: "verdict", hostBrief: "Say the result you're told in one line. Say nothing about who is left to catch, and don't accuse anyone.", listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
        { id: "hunter", hostBrief: "One line: the hunter you're told about is taking a last shot.", listening: { "*": "muted" }, hostMayInterject: false, silenceSeconds: 0 },
        { id: "end", hostBrief: "Recap the game in one or two short sentences, then offer another round.", listening: { "*": "holdToTalk" }, hostMayInterject: true, silenceSeconds: 0 },
    ],
};
