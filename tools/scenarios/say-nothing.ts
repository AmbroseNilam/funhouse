// Plays Say Nothing from a script with four fake phones. One player is dealt a prompt and acts it
// out; the others shout guesses, including a wrong one, a near miss and the right one, and the
// performer "says" the answer too, which the room must ignore because that phone is muted. The
// scenario fails if the prompt ever reaches a phone other than the performer's, the TV or the host
// before the turn is over, if the performer's own words count, if the near miss is not marked on
// the TV, if the guesser and the performer do not score the same, or if the performer does not
// rotate. A second turn swaps the prompt and is guessed with a listed synonym; a third is cut short
// from the pause menu and the final scores are checked. All of this is ruled in code, so it needs
// no model key: the host's lines only appear if the room has one.
//
// Run it on any machine with Node 24:
//   GAME_ROOM_TEXT_ONLY=1 npm run room
//   ROOM_STUDIO=1 node tools/scenarios/say-nothing.ts      (in a second terminal)
// ROOM_STUDIO=1 makes the fake screen open its room with ?studio=1, the only kind of room whose
// shelf has Say Nothing. A pass prints PASS as its last line and takes about a minute. The room's
// log should also show "[studio] starting blueprint sayNothing on the charades kit".
//
// This is test tooling, not the server: it prints the prompts and every line said to the terminal it
// runs in, which the room's own log never does. Don't paste its output anywhere public.

import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { SAY_NOTHING_PROMPTS } from "../../studio/games/say-nothing-prompts.ts";
import { ruleGuess, wordsOf } from "../../studio/kit/matching.ts";
import type { Prompt } from "../../studio/kits/charades.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** One fake player. */
interface Seat {
    name: string;
    phone: FakePhone;
}

/** Milliseconds to give the room to ignore something. */
const IGNORE_MILLISECONDS: number = 600;

/**
 * Letters only, lower case, so a prompt is found however it is spaced.
 * @param text any text.
 * @returns the squashed text.
 */
function squash(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Waits a moment.
 * @param milliseconds how long.
 */
async function pause(milliseconds: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); });
}

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const seats: Seat[] = ["Teacup", "Spoon", "Candle", "Saucer"].map((name: string) => ({ name, phone: new FakePhone(screen.code, name) }));
await waitFor(() => screen.shell?.seats.length === seats.length, "every phone to join");

/** The prompt being hidden right now, or an empty list. Everything the performer may not show is checked against it. */
let hidden: string[] = [];
/** Whose phone may show it. */
let performer: Seat | undefined;
/** The first leak found; thrown at the next step. */
let leak: string | null = null;

/**
 * Looks at every phone, the TV and the host for the prompt they may not have.
 */
function watchForLeaks(): void {
    if (hidden.length === 0 || leak !== null) {
        return;
    }
    const views: [string, string][] = [
        ["the TV", JSON.stringify(screen.scene)],
        ["the host", screen.hostLines.join(" ")],
        ...seats.filter((seat: Seat) => seat !== performer).map((seat: Seat): [string, string] => [`${seat.name}'s phone`, JSON.stringify(seat.phone.view?.controls ?? [])]),
    ];
    for (const [viewer, text] of views) {
        const found: string | undefined = hidden.find((secret: string) => squash(text).includes(squash(secret)) === true);
        if (found !== undefined) {
            leak = `${found} reached ${viewer}.`;
        }
    }
}

setInterval(watchForLeaks, 20);

/**
 * Fails if a leak has been seen.
 */
function noLeak(): void {
    if (leak !== null) {
        throw new Error(`Leak: ${leak}`);
    }
}

/**
 * The seat whose phone is offering the pick, once a turn starts.
 * @returns the seat.
 */
async function nextPerformer(): Promise<Seat> {
    await waitFor(() => seats.some((seat: Seat) => seat.phone.options().some((option) => option.label.startsWith("Easy")) === true), "a performer to choose");
    const seat: Seat | undefined = seats.find((candidate: Seat) => candidate.phone.options().some((option) => option.label.startsWith("Easy")) === true);
    if (seat === undefined) {
        throw new Error("Nobody was offered a choice.");
    }
    return seat;
}

/**
 * The prompt card on a phone, if it has one.
 * @param seat the player.
 * @returns the card's title and body, or undefined.
 */
function cardOf(seat: Seat): { title: string; body: string; secret: boolean } | undefined {
    const card: Control | undefined = seat.phone.view?.controls.find((control: Control) => control.type === "roleCard");
    return card?.type === "roleCard" ? { title: card.title, body: card.body, secret: card.secret } : undefined;
}

/**
 * The prompts accepted for an answer, from the game's own list.
 * @param answer the answer on a card.
 * @returns the prompt.
 */
function promptFor(answer: string): Prompt {
    const found: Prompt | undefined = SAY_NOTHING_PROMPTS.find((prompt: Prompt) => prompt.answer === answer);
    if (found === undefined) {
        throw new Error(`"${answer}" is not in the list.`);
    }
    return found;
}

/**
 * The title block of the TV.
 * @returns its text and kicker.
 */
function heading(): { text: string; kicker: string } {
    const block: SceneBlock | undefined = screen.scene?.blocks.find((candidate: SceneBlock) => candidate.type === "title");
    return block?.type === "title" ? { text: block.text, kicker: block.kicker ?? "" } : { text: "", kicker: "" };
}

/**
 * Every line of text on the TV.
 * @returns the lines.
 */
function texts(): string[] {
    return (screen.scene?.blocks ?? []).flatMap((block: SceneBlock) => (block.type === "text" ? [block.text] : []));
}

/**
 * The scores on the TV, by name.
 * @returns the scores.
 */
function scores(): Record<string, number> {
    const block: SceneBlock | undefined = screen.scene?.blocks.find((candidate: SceneBlock) => candidate.type === "tally");
    return block?.type === "tally" ? Object.fromEntries(block.rows.map((row) => [row.label, row.count])) : {};
}

/**
 * A guess that is part of the way to an answer: rules "close" by the game's own matcher.
 * @param prompt the prompt.
 * @returns the guess.
 */
function nearMiss(prompt: Prompt): string {
    const words: string[] = wordsOf(prompt.answer).filter((word: string) => word.length > 3);
    const tries: string[] = [...words, ...words.flatMap((first: string, index: number) => words.slice(index + 1).map((second: string) => `${first} ${second}`)), `${words[0]?.slice(0, 4) ?? "zzzz"}ish`];
    const guess: string | undefined = tries.find((candidate: string) => ruleGuess(candidate, prompt.answer, prompt.also) === "close");
    if (guess === undefined) {
        throw new Error(`No near miss exists for "${prompt.answer}".`);
    }
    return guess;
}

/**
 * Has the performer choose a level and read the card.
 * @param seat the performer.
 * @param label the level's button label.
 * @returns the answer on the card.
 */
async function chooseAndRead(seat: Seat, label: string): Promise<string> {
    seat.phone.press(label);
    await waitFor(() => cardOf(seat) !== undefined, "the prompt card");
    const card: { title: string; body: string; secret: boolean } | undefined = cardOf(seat);
    if (card === undefined || card.secret === true) {
        throw new Error("The performer's card must be plain, not a card to peek at.");
    }
    return card.title;
}

const gameStart: number = screen.hostLines.length;
await seats[0]?.phone.startGame(screen, "Say Nothing");

// Turn one: a wrong guess, a near miss, the performer's own words, then the right guess.
const first: Seat = await nextPerformer();
performer = first;
const firstAnswer: string = await chooseAndRead(first, "Medium · 2 points");
const firstPrompt: Prompt = promptFor(firstAnswer);
hidden = [firstPrompt.answer, ...firstPrompt.also];
console.warn(`${first.name} is acting "${firstAnswer}" (${firstPrompt.kind}, ${firstPrompt.level}).`);
await waitFor(() => heading().kicker.includes("word"), "the kind and word count on the TV");
console.warn(`The TV says: ${heading().text} / ${heading().kicker}`);
const others: Seat[] = seats.filter((seat: Seat) => seat !== first);
if (others.some((seat: Seat) => cardOf(seat) !== undefined) === true) {
    throw new Error("A guesser has a prompt card.");
}
first.phone.press("Start acting");
await waitFor(() => heading().text === `${first.name} is acting`, "the clock to start");
first.phone.say(firstAnswer);
await pause(IGNORE_MILLISECONDS);
noLeak();
if (heading().text !== `${first.name} is acting`) {
    throw new Error("The performer's own words counted.");
}
const [one, two, three] = others;
if (one === undefined || two === undefined || three === undefined) {
    throw new Error("Expected three guessers.");
}
one.phone.say("Is it a wardrobe?");
await waitFor(() => texts().some((line: string) => line.includes("wardrobe") === true), "the wrong guess on the TV");
const close: string = nearMiss(firstPrompt);
two.phone.say(close);
await waitFor(() => texts().some((line: string) => line.endsWith("(close)") === true), "the near miss to be marked close");
console.warn(`The near miss "${close}" was marked close on the TV.`);
noLeak();
// The right guess is the one moment the prompt may be said aloud, and the room captions it on the TV.
hidden = [];
three.phone.say(`Is it ${firstAnswer}?`);
await waitFor(() => heading().text === firstAnswer, "the answer to be revealed");
const revealed = scores();
console.warn(`Reveal: ${heading().kicker}. Scores: ${JSON.stringify(revealed)}`);
if (heading().kicker !== `${three.name} got it` || (revealed[three.name] ?? 0) < 2 || revealed[three.name] !== revealed[first.name]) {
    throw new Error("The guesser and the performer must score the same, and be named.");
}
await waitFor(() => (three.phone.view?.controls ?? []).some((control: Control) => control.type === "waiting" && control.text.startsWith("+") === true), "the guesser's points on their phone");

// Turn two: a different performer swaps the prompt and the room answers with a listed synonym.
await waitFor(() => heading().text.endsWith(" is up"), "the next turn");
const second: Seat = await nextPerformer();
if (second === first) {
    throw new Error("The performer did not rotate.");
}
performer = second;
const swapFrom: string = await chooseAndRead(second, "Easy · 1 point");
hidden = [swapFrom];
second.phone.press("Swap it for another");
await waitFor(() => cardOf(second)?.title !== swapFrom, "a different prompt after swapping");
const secondAnswer: string = cardOf(second)?.title ?? "";
const secondPrompt: Prompt = promptFor(secondAnswer);
hidden = [secondPrompt.answer, ...secondPrompt.also];
console.warn(`${second.name} swapped and is acting "${secondAnswer}".`);
if (second.phone.options().some((option) => option.label.startsWith("Swap")) === true) {
    throw new Error("The swap was offered twice.");
}
second.phone.press("Start acting");
await waitFor(() => heading().text === `${second.name} is acting`, "the second clock to start");
const synonym: string | undefined = secondPrompt.also[secondPrompt.also.length - 1];
const guesser: Seat | undefined = seats.find((seat: Seat) => seat !== second);
if (synonym === undefined || guesser === undefined) {
    throw new Error("Expected a synonym and a guesser.");
}
noLeak();
hidden = [];
guesser.phone.say(`Maybe ${synonym}`);
await waitFor(() => heading().text === secondAnswer, "the synonym to be accepted");
console.warn(`The synonym "${synonym}" was accepted for "${secondAnswer}".`);

// Turn three: cut short from the pause menu; the scores stay.
await waitFor(() => heading().text.endsWith(" is up"), "the third turn");
const third: Seat = await nextPerformer();
performer = third;
const thirdAnswer: string = await chooseAndRead(third, "Hard · 3 points");
const thirdPrompt: Prompt = promptFor(thirdAnswer);
hidden = [thirdPrompt.answer, ...thirdPrompt.also];
third.phone.press("Start acting");
await waitFor(() => heading().text === `${third.name} is acting`, "the third clock to start");
seats.find((seat: Seat) => seat !== third)?.phone.say("Is it a bicycle?");
await pause(IGNORE_MILLISECONDS);
noLeak();
const beforeEnd: string[] = screen.hostLines.slice(gameStart);
await seats[3]?.phone.fromPauseMenu(screen, "We give up");
await waitFor(() => screen.shell?.gameOver === true, "the end of the game");
hidden = [];
const final = scores();
console.warn(`Final: ${heading().text}. Scores: ${JSON.stringify(final)}`);
if (seats.some((seat: Seat) => final[seat.name] === undefined) === true || (final[three.name] ?? 0) < 2) {
    throw new Error("The final scores are missing someone or lost points.");
}
const said: string[] = beforeEnd.filter((line: string) => squash(line).includes(squash(thirdAnswer)) === true);
console.warn(`Host lines heard: ${screen.hostLines.length - gameStart}${screen.hostLines.length === gameStart ? " (no model key here, so the host stayed silent; the rules did not need it)" : ""}.`);
if (said.length > 0) {
    throw new Error(`The host said the third prompt before it was over: ${said.join(" | ")}`);
}
await pause(6000);
await seats[3]?.phone.chooseRow(screen, "Back to the shelf");
await waitFor(() => screen.shell?.screen === "home", "the shelf");
console.warn("PASS");
process.exit(0);
