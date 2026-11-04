// The closed list of things players can tell the room to do by voice. These are real room actions,
// run by code, with the host narrating the result, so the host can't promise what didn't happen.
// This file spots the sure phrasings without a model; room/decide.ts asks Jev about looser ones.

/** Something only the room can do. */
export type VoiceCommand = "restart" | "giveUp" | "changeTopic" | "repeat" | "skip" | "end" | "pause" | "whoseTurn";

/** Each command with what it means, for the model. */
export const VOICE_COMMANDS: Record<VoiceCommand, string> = {
    restart: "Start this game over from the beginning, or play it again.",
    giveUp: "Give up on the current game and reveal the answer.",
    changeTopic: "Pick a different topic for the quiz.",
    repeat: "Say the host's last line again.",
    skip: "Skip the current question and move on.",
    end: "Stop playing this game and go back to the shelf of games.",
    pause: "Pause the game for now.",
    whoseTurn: "Asks whose turn it is.",
};

/** Commands that lose a game in progress, so the same player has to say them twice. */
export const DESTRUCTIVE_COMMANDS: readonly VoiceCommand[] = ["restart", "end"];

/** Whole phrases, after tidying, that can only mean a command. A short answer like "stop" or "skip" is left alone. */
const SURE_PHRASES: Record<VoiceCommand, string[]> = {
    restart: ["restart", "restart the game", "restart game", "start over", "start again", "new game", "start a new game", "play again", "play it again", "let's play again"],
    giveUp: ["i give up", "we give up", "give up"],
    changeTopic: ["change the topic", "change topic", "new topic", "different topic", "pick a new topic", "pick a different topic"],
    repeat: ["say that again", "repeat that", "repeat", "what did you say", "can you repeat that"],
    skip: ["skip this question", "skip this one", "skip the question", "next question"],
    end: ["end the game", "end game", "stop the game", "quit the game", "quit game", "back to the shelf", "go back to the shelf"],
    pause: ["pause", "pause the game", "pause game"],
    whoseTurn: ["whose turn is it", "whose turn", "who's turn is it", "whos turn is it", "who is next", "who's next"],
};

/** Polite words around a command that don't change it. */
const LEADING_WORDS: RegExp = /^(?:(?:ok|okay|um|uh|so|hey|please|marlowe|can we|could we|let's|lets|i want to|we want to)[\s,]+)+/;
const TRAILING_WORDS: RegExp = /(?:[\s,]+(?:please|marlowe|now|then))+$/;

/**
 * Finds a command in a sure phrasing.
 * @param said the transcript.
 * @returns the command, or null when it may be ordinary talk.
 */
export function commandByKeywords(said: string): VoiceCommand | null {
    const tidy: string = said.toLowerCase().replace(/[.!?]+/g, "").replace(/\s+/g, " ").trim();
    const core: string = tidy.replace(LEADING_WORDS, "").replace(TRAILING_WORDS, "");
    for (const [command, phrases] of Object.entries(SURE_PHRASES) as [VoiceCommand, string[]][]) {
        if (phrases.includes(tidy) === true || phrases.includes(core) === true) {
            return command;
        }
    }
    return null;
}
