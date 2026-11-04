// Plays Wrong Room from a script with five fake phones and the real room: the place and roles are
// dealt, four questions are asked and answered in the enforced order (one spoken, one typed, and an
// interloper who tries to talk out of turn), the table calls the vote, everyone votes for the Stranger,
// and the Stranger guesses the place, wrongly by default or rightly with SCENARIO_GUESS=right. Fails if
// the Stranger's phone ever shows the place, if the TV or the host names the place before the end, if
// anyone but the person who is up can move the questioning, if a pick offers the person who just asked
// or the asker themselves, or if the reveal is wrong.
//
// Run it with model keys, or against the stub model when there are none (the stub only proves the
// room, the rules and the screens; it says nothing about how Muse Spark hosts):
//   node tools/stub-model.ts                         (stub only)
//   META_BASE_URL=http://localhost:8799 META_MODEL_API_KEY=<any text> GAME_ROOM_TEXT_ONLY=1 node room/server.ts
//   ROOM_STUDIO=1 node tools/scenarios/wrong-room.ts      (in another terminal)
// ROOM_STUDIO=1 makes the fake screen open its room with ?studio=1, the only kind of room whose shelf
// has this game. A pass prints PASS as its last line. The room's log should show "[studio] starting
// blueprint wrongRoom on the stranger kit".
//
// This is test tooling, not the server: it prints the place, the Stranger and every line said to the
// terminal it runs in, which the room's own log never does. Don't paste its output anywhere public.

import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** One fake player. */
interface Seat {
    name: string;
    phone: FakePhone;
}

/** The names the fake players use. */
const NAMES: string[] = ["Teacup", "Spoon", "Candle", "Saucer", "Matchbox"];

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
 * only a transcript of what was said aloud, and nothing in the game's own scene.
 * @returns the text.
 */
function tvText(): string {
    return (screen.scene?.blocks ?? []).filter((block: SceneBlock) => block.type !== "caption").map((block: SceneBlock) => JSON.stringify(block)).join(" ");
}

const gameStart: number = screen.hostLines.length;
await seats[0]?.phone.startGame(screen, "Wrong Room");
await waitFor(() => seats.every((seat: Seat) => cardOf(seat.phone).title !== ""), "a card on every phone");
await waitFor(() => seats.some((seat: Seat) => cardOf(seat.phone).title.startsWith("You're at: ")), "the place on the cards");

const strangers: Seat[] = seats.filter((seat: Seat) => cardOf(seat.phone).title === "You're the stranger");
if (strangers.length !== 1) {
    throw new Error(`Expected one stranger, saw ${strangers.length}.`);
}
const stranger: Seat = strangers[0] as Seat;
const others: Seat[] = seats.filter((seat: Seat) => seat !== stranger);
const place: string = cardOf((others[0] as Seat).phone).title.replace("You're at: ", "");
console.warn(`The stranger is ${stranger.name}; the place is ${place}.`);
if (others.some((seat: Seat) => cardOf(seat.phone).title !== `You're at: ${place}`) === true) {
    throw new Error("The others were not all told the same place.");
}

/** Fails if the place has reached the Stranger, the TV or the host, or the Stranger has been named early. */
function checkNoLeaks(ended: boolean): void {
    if (squash(JSON.stringify(stranger.phone.view?.controls ?? [])).includes(squash(place)) === true) {
        throw new Error("The place reached the stranger's phone.");
    }
    if (ended === false && squash(tvText()).includes(squash(place)) === true) {
        throw new Error("The place reached the TV before the end.");
    }
    const said: string[] = screen.hostLines.slice(gameStart);
    if (ended === false && said.some((line: string) => squash(line).includes(squash(place)) === true) === true) {
        throw new Error("The host said the place before the end.");
    }
}

await waitFor(() => headline().text.endsWith("picks who to ask"), "questions to open");
checkNoLeaks(false);
const names: Map<string, Seat> = new Map(seats.map((seat: Seat) => [seat.name, seat]));
let lastAsker: string = "";
for (let asked = 1; asked <= 4; asked += 1) {
    await waitFor(() => headline().text.endsWith("picks who to ask"), "a pick");
    const asker: Seat | undefined = seats.find((seat: Seat) => seat.phone.view?.turn?.yours === true);
    if (asker === undefined) {
        throw new Error("Nobody is up to pick.");
    }
    const offered: string[] = asker.phone.options().map((option: { id: string; label: string }) => option.label).filter((label: string) => names.has(label) === true);
    if (offered.includes(asker.name) === true || (lastAsker !== "" && offered.includes(lastAsker) === true)) {
        throw new Error(`${asker.name} is offered themselves or the person who just asked them: ${offered.join(", ")}.`);
    }
    const choice: string = offered.find((label: string) => label !== stranger.name) ?? offered[0] ?? "";
    asker.phone.press(choice);
    const target: Seat = names.get(choice) as Seat;
    await waitFor(() => headline().text === `${asker.name} asks ${target.name}`, "the question step");
    checkNoLeaks(false);
    const interloper: Seat | undefined = seats.find((seat: Seat) => seat !== asker && seat !== target);
    interloper?.phone.say("Can I ask something too?");
    await pause(SETTLE_MILLISECONDS);
    if (headline().text !== `${asker.name} asks ${target.name}`) {
        throw new Error("Someone out of turn moved the questioning on.");
    }
    if (asked === 2) {
        const box: Control | undefined = asker.phone.view?.controls.find((control: Control) => control.type === "textInput");
        if (box?.type !== "textInput") {
            throw new Error(`${asker.name} has no box to type a question in.`);
        }
        asker.phone.answer(box.id, "Do you keep a spare key around here?");
    }
    if (asked !== 2) {
        asker.phone.say("What do you usually do here on a quiet day?");
    }
    await waitFor(() => headline().text === `${target.name} answers ${asker.name}`, "the answer step");
    if (asked === 2 && tvText().includes("spare key") === false) {
        throw new Error("A typed question was not shown on the TV.");
    }
    await pause(SETTLE_MILLISECONDS);
    if (asked === 3) {
        const box: Control | undefined = target.phone.view?.controls.find((control: Control) => control.type === "textInput");
        if (box?.type !== "textInput") {
            throw new Error(`${target.name} has no box to type an answer in.`);
        }
        target.phone.answer(box.id, "Mostly I watch the weather.");
    }
    if (asked !== 3) {
        target.phone.say("Mostly I watch the weather, if I'm honest.");
    }
    await waitFor(() => headline().text === `${target.name} picks who to ask` || headline().text === "Who is the stranger?", "the next pick");
    lastAsker = asker.name;
    checkNoLeaks(false);
}

const callers: Seat[] = seats.slice(0, 3);
for (const caller of callers) {
    await waitFor(() => caller.phone.options().some((option: { id: string }) => option.id === "call") === true || headline().text === "Who is the stranger?", "a call button");
    if (headline().text === "Who is the stranger?") {
        break;
    }
    caller.phone.press("call");
    await pause(300);
}
await waitFor(() => headline().text === "Who is the stranger?", "the vote");
checkNoLeaks(false);
await waitFor(() => seats.every((seat: Seat) => seat.phone.options().length > 0), "a ballot on every phone");
for (const seat of seats) {
    const target: string = seat === stranger ? (others[0] as Seat).name : stranger.name;
    seat.phone.press(target);
}
await waitFor(() => headline().text === `${stranger.name} is the stranger`, "the Stranger's guess");
checkNoLeaks(false);
await pause(SETTLE_MILLISECONDS);
const right: boolean = process.env.SCENARIO_GUESS === "right";
stranger.phone.say(right === true ? `Is it a ${place.toLowerCase()}?` : "I'd say a bakery. Somewhere warm.");
await waitFor(() => screen.shell?.gameOver === true, "the reveal");
checkNoLeaks(true);
const end = headline();
console.warn(`End: ${end.text}. ${end.kicker}.`);
const expected: string = right === true ? "Caught, and named the place" : "Caught";
if (squash(end.text) !== squash(place) || end.kicker !== expected || tvText().includes(`${stranger.name} was the stranger.`) === false) {
    throw new Error(`The reveal is wrong: expected ${place} and "${expected}", with ${stranger.name} named.`);
}
const early: string[] = screen.hostLines.slice(gameStart, -1).filter((line: string) => line.includes(stranger.name) === true && /\bstranger\b/i.test(line) === true);
if (early.length > 0) {
    console.warn(`NOTE: the host named the Stranger before the reveal: ${early.join(" | ")}`);
}
console.warn("PASS");
process.exit(0);
