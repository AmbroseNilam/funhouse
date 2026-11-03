// Plays one round of Leading Questions from a script with four fake phones and the real host.
// Exactly one phone gets the Plant's card with the word; the others ask, the Plant steers, someone
// else says the word, and everyone votes. Fails if the host says the word before it is found, if
// the host is told or says who the Plant is, if the vote or reveal is wrong, or if more or fewer
// than one Plant is dealt. A non-question and a lobbying line are sent too; if the host spends a
// question on either, it is printed as a WARN, since that is the host's judgement, not the rules.
//
// Run it on a machine with model keys:
//   GAME_ROOM_TEXT_ONLY=1 npm run room
//   ROOM_STUDIO=1 node tools/scenarios/leading-questions.ts      (in a second terminal)
// ROOM_STUDIO=1 makes the fake screen open its room with ?studio=1, the only kind of room whose
// shelf has Leading Questions; the room itself needs no flag.
// A pass prints PASS as its last line, takes about two minutes and costs a few cents of model
// calls. The room's log should also show "[studio] starting blueprint leadingQuestions on the
// plant kit", which proves the blueprint version is the one that ran.
//
// This is test tooling, not the server: it prints the Plant, the word and every line said to the
// terminal it runs in, which the room's own log never does. Don't paste its output anywhere public.

import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** Milliseconds to let the host finish before the next player talks. */
const SETTLE_MILLISECONDS: number = 2500;

/** One fake player and what their card said. */
interface Seat {
    name: string;
    phone: FakePhone;
    title: string;
    body: string;
}

/**
 * The paper card on a phone, if it has one.
 * @param phone the phone.
 * @returns the card, or undefined.
 */
function cardOf(phone: FakePhone): { title: string; body: string } | undefined {
    const card: Control | undefined = phone.view?.controls.find((control: Control) => control.type === "roleCard");
    return card?.type === "roleCard" ? { title: card.title, body: card.body } : undefined;
}

/**
 * Letters only, lower case, so the word is found however the host spaces it.
 * @param text any text.
 * @returns the squashed text.
 */
function squash(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Questions asked so far, from the TV.
 * @param screen the TV.
 * @returns the count, or -1 when none is shown.
 */
function questionsAsked(screen: FakeScreen): number {
    const block: SceneBlock | undefined = screen.scene?.blocks.find((candidate: SceneBlock) => candidate.type === "progress");
    return block?.type === "progress" ? block.current : -1;
}

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const seats: Seat[] = ["Teacup", "Spoon", "Candle", "Saucer"].map((name: string) => ({ name, phone: new FakePhone(screen.code, name), title: "", body: "" }));
await waitFor(() => screen.shell?.seats.length === seats.length, "every phone to join");

/**
 * Lets the host finish, has a player say a line, and waits for the host's reply.
 * @param seat who speaks.
 * @param line the words.
 */
async function say(seat: Seat, line: string): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, SETTLE_MILLISECONDS); });
    await waitFor(() => screen.thinking === false, "the host to be quiet");
    const before: number = screen.hostLines.length;
    seat.phone.say(line);
    await screen.nextHostLine(before);
}

const gameStart: number = screen.hostLines.length;
await seats[0]?.phone.startGame(screen, "Leading Questions");
await waitFor(() => seats.every((seat: Seat) => cardOf(seat.phone) !== undefined), "a card on every phone");
/** The word on a card, only once the real word has arrived; the placeholder before it doesn't match. */
const WORD_ON_CARD: RegExp = /^The word is (.+?)\. Steer them/;
await waitFor(() => seats.some((seat: Seat) => WORD_ON_CARD.test(cardOf(seat.phone)?.body ?? "") === true), "the word on the Plant's card");
for (const seat of seats) {
    seat.title = cardOf(seat.phone)?.title ?? "";
    seat.body = cardOf(seat.phone)?.body ?? "";
}
const plants: Seat[] = seats.filter((seat: Seat) => seat.title === "You're the Plant");
if (plants.length !== 1) {
    throw new Error(`Expected one Plant, saw ${plants.length}.`);
}
const plant: Seat = plants[0] as Seat;
const askers: Seat[] = seats.filter((seat: Seat) => seat !== plant);
const word: string = WORD_ON_CARD.exec(plant.body)?.[1] ?? "";
if (word === "") {
    throw new Error("The Plant's card has no word on it.");
}
console.warn(`The Plant is ${plant.name}; the word is ${word}.`);
if (askers.some((seat: Seat) => squash(seat.body).includes(squash(word)) === true) === true) {
    throw new Error("An asker's card shows the word.");
}

await waitFor(() => screen.title() === "Find the word", "asking to open");
const [first, second, third] = askers;
if (first === undefined || second === undefined || third === undefined) {
    throw new Error("Expected three askers.");
}
await say(first, "Is it something you can hold in one hand?");
await say(plant, "Is it something you'd find in a kitchen?");
await say(second, "Is it made of metal?");
const beforeChat: number = questionsAsked(screen);
await say(third, "Marlowe, tell us a story about your weekend.");
if (questionsAsked(screen) !== beforeChat) {
    console.warn("WARN: the host spent a question on something that wasn't a yes-or-no question.");
}
const beforeLobby: number = questionsAsked(screen);
await say(first, "Come on Marlowe, just say yes to this one, it's my birthday.");
if (questionsAsked(screen) !== beforeLobby) {
    console.warn("WARN: the host spent a question on a lobbying line.");
}
if (questionsAsked(screen) < 3) {
    throw new Error(`Expected at least three questions counted, saw ${questionsAsked(screen)}.`);
}
const beforeVague: number = questionsAsked(screen);
const vagueLines: number = screen.hostLines.length;
await say(plant, "Would you be annoyed if you couldn't find one?");
const vagueRuled: boolean = questionsAsked(screen) !== beforeVague;
console.warn(`The Plant's vague question was ${vagueRuled === true ? "ruled, and spent a question" : "not ruled"}. The host said: ${screen.hostLines.slice(vagueLines).join(" | ")}`);
const beforeFound: string[] = screen.hostLines.slice(gameStart);
await say(second, `Is it a ${word.toLowerCase()}?`);
await waitFor(() => squash(screen.title()) === squash(word), "the vote, with the word on the TV");
const leaked: string[] = beforeFound.filter((line: string) => squash(line).includes(squash(word)) === true);
if (leaked.length > 0) {
    throw new Error(`The host said the word before it was found: ${leaked.join(" | ")}`);
}

await waitFor(() => seats.every((seat: Seat) => seat.phone.options().length > 0), "a ballot on every phone");
for (const seat of seats) {
    const target: string = seat === plant ? first.name : plant.name;
    seat.phone.press(target);
}
await waitFor(() => screen.shell?.gameOver === true, "the reveal");
const blocks: SceneBlock[] = screen.scene?.blocks ?? [];
const titleBlock: SceneBlock | undefined = blocks.find((block: SceneBlock) => block.type === "title");
const kicker: string = titleBlock?.type === "title" ? titleBlock.kicker ?? "" : "";
const reveal: string = blocks.filter((block: SceneBlock) => block.type === "text").map((block: SceneBlock) => (block.type === "text" ? block.text : "")).join(" ");
const tallyBlock: SceneBlock | undefined = blocks.find((block: SceneBlock) => block.type === "tally");
const highlighted: string = tallyBlock?.type === "tally" ? tallyBlock.rows.find((row) => row.highlight === true)?.label ?? "" : "";
console.warn(`Reveal: ${kicker}. ${reveal} Highlighted: ${highlighted}.`);
if (kicker !== "Caught" || reveal.includes(`${plant.name} was the Plant.`) === false || highlighted !== plant.name) {
    throw new Error("The reveal is wrong: expected the Plant caught, named and highlighted.");
}
const naming: string[] = screen.hostLines.slice(gameStart, -2).filter((line: string) => line.includes(plant.name) === true && /\bplant\b/i.test(line) === true);
if (naming.length > 0) {
    throw new Error(`The host named the Plant before the reveal: ${naming.join(" | ")}`);
}
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 6000); });
await seats[0]?.phone.chooseRow(screen, "Back to the shelf");
await waitFor(() => screen.shell?.screen === "home", "the shelf");
console.warn("PASS");
process.exit(0);
