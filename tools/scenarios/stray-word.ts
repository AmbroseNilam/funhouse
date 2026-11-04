// Plays Stray Word from a script with five fake phones and the real room: the word is dealt to all but
// one player, ten words are said in the enforced order over two rounds (one refused for being too close
// to the secret, one refused for being several words, one typed, and an interloper who talks out of
// turn), everyone votes for the Stray, and the Stray guesses the word, wrongly by default or rightly
// with SCENARIO_GUESS=right. Fails if the Stray's phone ever shows the word, if the TV or the host says
// the word before the end, if anyone but the person who is up can move the words on, if a refused word
// appears on the TV, or if the reveal is wrong.
//
// Run it with model keys, or against the stub model when there are none (the stub only proves the
// room, the rules and the screens; it says nothing about how Muse Spark hosts):
//   node tools/stub-model.ts                         (stub only)
//   META_BASE_URL=http://localhost:8799 META_MODEL_API_KEY=<any text> GAME_ROOM_TEXT_ONLY=1 node room/server.ts
//   ROOM_STUDIO=1 node tools/scenarios/stray-word.ts      (in another terminal)
// ROOM_STUDIO=1 makes the fake screen open its room with ?studio=1, the only kind of room whose shelf
// has this game. A pass prints PASS as its last line. The room's log should show "[studio] starting
// blueprint strayWord on the oddword kit".
//
// This is test tooling, not the server: it prints the word, the Stray and every line said to the
// terminal it runs in, which the room's own log never does. Don't paste its output anywhere public.

import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { tooClose } from "../../studio/kit/words.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** One fake player. */
interface Seat {
    name: string;
    phone: FakePhone;
}

/** The names the fake players use. */
const NAMES: string[] = ["Teacup", "Spoon", "Candle", "Saucer", "Matchbox"];

/** Words the table says. The secret isn't known in advance, so any too close to it are dropped once it is. */
const WORDS: string[] = ["steam", "whistle", "handle", "boil", "spout", "copper", "tea", "hot", "lid", "stove", "meadow", "button", "ribbon", "lantern", "pepper", "violin", "marble", "anchor"];

/** Milliseconds to let things settle between steps. */
const SETTLE_MILLISECONDS: number = 900;

/**
 * Letters only, lower case.
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

/**
 * The card on a phone.
 * @param phone the phone.
 * @returns its title and body, or empty text.
 */
function cardOf(phone: FakePhone): { title: string; body: string } {
    const card: Control | undefined = phone.view?.controls.find((control: Control) => control.type === "roleCard");
    return card?.type === "roleCard" ? { title: card.title, body: card.body } : { title: "", body: "" };
}

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const seats: Seat[] = NAMES.map((name: string) => ({ name, phone: new FakePhone(screen.code, name) }));
await waitFor(() => screen.shell?.seats.length === seats.length, "every phone to join");

/**
 * The first title on the TV.
 * @returns its text and kicker.
 */
function headline(): { text: string; kicker: string } {
    const block: SceneBlock | undefined = screen.scene?.blocks.find((candidate: SceneBlock) => candidate.type === "title");
    return block?.type === "title" ? { text: block.text, kicker: block.kicker ?? "" } : { text: "", kicker: "" };
}

/**
 * Everything the game puts on the TV, as one string. The room's live captions are left out: they are
 * only a transcript of what was said aloud, so a secret blurted into the room is caption text, and
 * nothing in the game's own scene.
 * @returns the text.
 */
function tvText(): string {
    return (screen.scene?.blocks ?? []).filter((block: SceneBlock) => block.type !== "caption").map((block: SceneBlock) => JSON.stringify(block)).join(" ");
}

const gameStart: number = screen.hostLines.length;
await seats[0]?.phone.startGame(screen, "Stray Word");
await waitFor(() => seats.every((seat: Seat) => cardOf(seat.phone).title !== ""), "a card on every phone");
await waitFor(() => seats.some((seat: Seat) => cardOf(seat.phone).title.startsWith("Your word: ")), "the word on the cards");

const strays: Seat[] = seats.filter((seat: Seat) => cardOf(seat.phone).title === "You're the stray");
if (strays.length !== 1) {
    throw new Error(`Expected one stray, saw ${strays.length}.`);
}
const stray: Seat = strays[0] as Seat;
const others: Seat[] = seats.filter((seat: Seat) => seat !== stray);
const word: string = cardOf((others[0] as Seat).phone).title.replace("Your word: ", "");
console.warn(`The stray is ${stray.name}; the word is ${word}.`);
if (others.some((seat: Seat) => cardOf(seat.phone).title !== `Your word: ${word}`) === true) {
    throw new Error("The others were not all shown the same word.");
}
const category: string = /It's (.+?)\./.exec(cardOf((others[0] as Seat).phone).body)?.[1] ?? "";
if (category === "" || cardOf(stray.phone).body.includes(category) === false) {
    throw new Error("The stray was not told what kind of thing it is.");
}

/** Fails if the word has reached the Stray, the TV or the host before the end. */
function checkNoLeaks(ended: boolean): void {
    if (squash(JSON.stringify(stray.phone.view?.controls ?? [])).includes(squash(word)) === true) {
        throw new Error("The word reached the stray's phone.");
    }
    if (ended === false && squash(tvText()).includes(squash(word)) === true) {
        throw new Error("The word reached the TV before the end.");
    }
    if (ended === false && screen.hostLines.slice(gameStart).some((line: string) => squash(line).includes(squash(word)) === true) === true) {
        throw new Error("The host said the word before the end.");
    }
}

await waitFor(() => headline().text.endsWith("says a word"), "words to open");
checkNoLeaks(false);
const seatNamed: Map<string, Seat> = new Map(seats.map((seat: Seat) => [seat.name, seat]));
const words: string[] = WORDS.filter((candidate: string) => tooClose(candidate, word) === false);
const nearWord: string = `${(word.toLowerCase().split(" ").at(-1) ?? word).trim()}s`;
let triedNearWord: boolean = false;
for (let said = 0; said < 10; said += 1) {
    await waitFor(() => headline().text.endsWith("says a word"), "a turn");
    const upName: string = headline().text.replace(" says a word", "");
    const up: Seat = seatNamed.get(upName) as Seat;
    await waitFor(() => up.phone.view?.turn?.yours === true, `${upName}'s phone to say it's their turn`);
    const interloper: Seat | undefined = seats.find((seat: Seat) => seat !== up);
    interloper?.phone.say("Mine is better.");
    await pause(SETTLE_MILLISECONDS);
    if (headline().text !== `${upName} says a word`) {
        throw new Error("Someone out of turn moved the words on.");
    }
    if (triedNearWord === false && up !== stray) {
        triedNearWord = true;
        up.phone.say(nearWord);
        await pause(SETTLE_MILLISECONDS);
        if (headline().text !== `${upName} says a word` || tvText().toLowerCase().includes(nearWord) === true) {
            throw new Error(`A word too close to the secret was taken, or shown. Headline: ${headline().text}; TV: ${tvText().slice(0, 400)}`);
        }
        if (JSON.stringify(up.phone.view?.controls ?? []).includes("Too close to the secret") === false) {
            throw new Error("The speaker was not told the word was too close.");
        }
    }
    if (said === 2) {
        up.phone.say("well it is sort of a thing");
        await pause(SETTLE_MILLISECONDS);
        if (headline().text !== `${upName} says a word`) {
            throw new Error("Several words were taken as one.");
        }
    }
    const next: string = words[said] ?? "";
    if (said === 3) {
        const box: Control | undefined = up.phone.view?.controls.find((control: Control) => control.type === "textInput");
        if (box?.type !== "textInput") {
            throw new Error(`${upName} has no box to type a word in.`);
        }
        up.phone.answer(box.id, next);
    }
    if (said !== 3) {
        up.phone.say(next);
    }
    await waitFor(() => tvText().toLowerCase().includes(`${upName.toLowerCase()}: ${next}`) || headline().text === "Who is the stray?", `${next} on the TV`);
    checkNoLeaks(false);
}
await waitFor(() => headline().text === "Who is the stray?", "the vote");
await waitFor(() => seats.every((seat: Seat) => seat.phone.options().length > 0), "a ballot on every phone");
for (const seat of seats) {
    seat.phone.press(seat === stray ? (others[0] as Seat).name : stray.name);
}
await waitFor(() => headline().text === `${stray.name} is the stray`, "the Stray's guess");
checkNoLeaks(false);
await pause(SETTLE_MILLISECONDS);
const right: boolean = process.env.SCENARIO_GUESS === "right";
stray.phone.say(right === true ? `Is it a ${word.toLowerCase()}?` : "I would say it is a teapot.");
await waitFor(() => screen.shell?.gameOver === true, "the reveal");
checkNoLeaks(true);
const end = headline();
console.warn(`End: ${end.text}. ${end.kicker}.`);
const expected: string = right === true ? "Caught, and named the word" : "Caught";
if (squash(end.text) !== squash(word) || end.kicker !== expected || tvText().includes(`${stray.name} was the stray.`) === false) {
    throw new Error(`The reveal is wrong: expected ${word} and "${expected}", with ${stray.name} named.`);
}
console.warn("PASS");
process.exit(0);
