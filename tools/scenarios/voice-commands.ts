// Says each voice command out loud and checks the room really did it, whatever the host says.
// Run the room with GAME_ROOM_TEXT_ONLY=1, then: node tools/scenarios/voice-commands.ts

import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const sam: FakePhone = new FakePhone(screen.code, "Sam");
const jo: FakePhone = new FakePhone(screen.code, "Jo");
await waitFor(() => screen.shell?.seats.length === 2, "the phones to join");

const pause = async (milliseconds: number): Promise<void> => { await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); }); };
const expect = (condition: boolean, what: string): void => {
    if (condition === false) {
        throw new Error(`Expected ${what}.`);
    }
    console.warn(`ok: ${what}`);
};

// Twenty Doors: give up, then restart straight away, with nothing left to lose.
await sam.startGame(screen, "Twenty Doors");
await waitFor(() => screen.title().startsWith("It's"), "the game");
sam.say("I give up");
await waitFor(() => screen.shell?.gameOver === true, "giving up to end the game");
expect(true, "give up ends the game");
sam.say("restart the game");
await waitFor(() => screen.shell?.gameOver === false && screen.title().startsWith("It's"), "a fresh game");
expect(true, "restart after the end starts a fresh game");

// In progress, restart and end wait for the same player to say it again.
await pause(1500);
const doorsTitle: string = screen.title();
sam.say("restart the game");
await pause(1500);
expect(screen.title() === doorsTitle && screen.shell?.screen === "play", "one restart changes nothing yet");
jo.say("restart the game");
await pause(1500);
expect(screen.shell?.screen === "play" && screen.title() === doorsTitle, "someone else saying it doesn't count");
sam.say("end the game");
await pause(800);
sam.say("end the game");
await waitFor(() => screen.shell?.screen === "home", "the second end to reach the shelf");
expect(true, "end said twice returns to the shelf");

// Quizmaster: skip and change topic. The room won't start games too close together from the shelf.
await pause(5500);
await sam.startGame(screen, "Quizmaster");
await waitFor(() => screen.title() === "Quizmaster", "the quiz");
await pause(1000);
sam.say("Let's do the topic of dogs.");
await waitFor(() => screen.scene?.blocks.some((block) => block.type === "progress") === true, "questions");
const progress = (): number => { const block = screen.scene?.blocks.find((candidate) => candidate.type === "progress"); return block?.type === "progress" ? block.current : 0; };
const before: number = progress();
sam.say("skip this question");
await waitFor(() => progress() === before + 1, "skip to move on");
expect(true, "skip moves to the next question");
sam.say("whose turn is it");
await pause(500);
expect(progress() === before + 1, "asking whose turn isn't taken as an answer");
sam.say("pause the game");
await waitFor(() => screen.shell?.screen === "pause", "the pause menu");
expect(true, "pause opens the pause menu");
await sam.chooseRow(screen, "Keep playing");
await waitFor(() => screen.shell?.screen === "play", "play to resume");
sam.say("change the topic");
await pause(800);
expect(progress() === before + 1, "one change of topic changes nothing yet");
sam.say("change the topic");
await waitFor(() => screen.title() === "Quizmaster" && screen.scene?.blocks.some((block) => block.type === "progress") === false, "the topic question");
expect(true, "change the topic goes back to choosing one");

// "Say that again" repeats the last line itself, so no new words appear. The fake screen files an
// identical line once, and a model's reply would almost never match it.
await pause(4000);
const lines: number = screen.hostLines.length;
sam.say("say that again");
await pause(5000);
expect(screen.hostLines.length === lines, "say that again repeats the last line instead of asking the host");

// Words that aren't a command right now, like skip in Twenty Doors, stay ordinary talk.
await pause(10000);
await sam.fromPauseMenu(screen, "Leave this game");
await waitFor(() => screen.shell?.screen === "home", "the shelf");
await pause(10000);
await sam.startGame(screen, "Twenty Doors");
await waitFor(() => screen.title().startsWith("It's"), "the game");
await pause(4000);
const talk: number = screen.hostLines.length;
sam.say("skip this question");
await screen.nextHostLine(talk);
expect(screen.title().startsWith("It's") === true, "skip in a game with no questions to skip goes to the host as talk");
console.warn("PASS");
process.exit(0);
