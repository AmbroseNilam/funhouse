// Plays a whole game with one scripted person and AI guests in the seats that are left, against the
// real room, for any game that takes guests. It seats the first guest from the game's page on the TV
// and the rest from the phone's menu, checks each is marked on the TV and named as an AI, plays to the
// end, then checks that no guest's prompt held anything its seat couldn't see: the person's own card,
// or in a game with a secret word, that word in the prompt of the guest who didn't get it. Then it
// sends the guests home and leaves, and checks a guest doesn't keep playing to an empty table.
//
// Needs the trace, which only exists in the test mode:
//   node tools/fake-meta.ts      (or real model keys; the stand-in proves the room and the rules, not how guests play)
//   META_BASE_URL=http://localhost:8741/v1 META_MODEL_API_KEY=<any text> GAME_ROOM_TEXT_ONLY=1 GUEST_PACE=0.2 GUEST_TRACE_FILE=<a file> npm run room
//   ROOM_STUDIO=1 GUEST_TRACE_FILE=<the same file> GUEST_GAME="Under the Cup" node tools/scenarios/guests.ts
// Optional: GUEST_COUNT sets how many guests (at least enough for the game), and GUEST_TRANSCRIPT a file
// to write what happened to. A pass prints PASS as its last line.
//
// This is test tooling: it prints the table's cards and words to its own terminal. Don't paste it anywhere public.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { GUEST_PERSONAS } from "../../room/guest.ts";
import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** The game to play. */
const GAME: string = process.env.GUEST_GAME ?? "Under the Cup";

/** Fewest players each game needs, so the script knows how many guests to seat. */
const MINIMUM: Record<string, number> = { "Under the Cup": 3, "Stray Word": 4, "Off by a Mile": 3, "Who Fits": 3, "Same Page": 3 };

/** How many guests to seat. */
const GUESTS: number = Number(process.env.GUEST_COUNT ?? Math.max(2, (MINIMUM[GAME] ?? 3) - 1));

/** Longest a whole game may take. */
const GAME_LIMIT_MILLISECONDS: number = 900000;

/** How long to stay after the end, so the host's closing lines are heard. */
const WRAP_UP_MILLISECONDS: number = 10000;

/** What the scripted person types. */
const WORDS: readonly string[] = ["lantern", "copper", "harbour", "juniper", "velvet", "mustard", "gravel", "tinsel", "bobbin", "quiver"];

/** Where the guests' prompts are written. */
const TRACE_FILE: string = process.env.GUEST_TRACE_FILE ?? "";

/** Where to write what happened, if anywhere. */
const TRANSCRIPT_FILE: string = process.env.GUEST_TRANSCRIPT ?? "";

/** One line of a guest's trace, as far as this script reads it. */
interface TraceLine {
    guest: string;
    prompt: { role: string; content: string }[];
    reply: string;
    fellBack: boolean;
}

/**
 * Prints a line, and keeps it for the transcript.
 * @param line the line.
 */
function say(line: string): void {
    console.warn(line);
    if (TRANSCRIPT_FILE !== "") {
        appendFileSync(TRANSCRIPT_FILE, `${line}\n`);
    }
}

/**
 * Waits a moment.
 * @param milliseconds how long.
 */
async function pause(milliseconds: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); });
}

/**
 * The words on a TV block.
 * @param block the block.
 * @returns its text, if any.
 */
function blockText(block: SceneBlock): string {
    if (block.type === "title" || block.type === "text") {
        return block.text;
    }
    return block.type === "caption" ? `${block.speaker}: ${block.text}` : "";
}

/**
 * Reads the trace written since this run began.
 * @param from how many characters to skip.
 * @returns the lines.
 */
function readTrace(from: number): TraceLine[] {
    if (TRACE_FILE === "" || existsSync(TRACE_FILE) === false) {
        return [];
    }
    return readFileSync(TRACE_FILE, "utf8").slice(from).split("\n").filter((line: string) => line !== "").map((line: string) => JSON.parse(line) as TraceLine);
}

const traceStart: number = TRACE_FILE !== "" && existsSync(TRACE_FILE) === true ? readFileSync(TRACE_FILE, "utf8").length : 0;
const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const person: FakePhone = new FakePhone(screen.code, "Teacup");
await waitFor(() => screen.shell?.seats.length === 1, "the person to sit down");

const target: number = screen.shell?.games.findIndex((game) => game.name === GAME) ?? -1;
if (target === -1) {
    throw new Error(`${GAME} isn't on this shelf. Use ROOM_STUDIO=1.`);
}
person.nav({ kind: "step", delta: target - (screen.shell?.focus ?? 0) });
await waitFor(() => screen.shell?.focus === target, "the highlight to move");
person.nav({ kind: "select" });
await waitFor(() => screen.shell?.screen === "game", "the game's page");
if (screen.shell?.games[target]?.blocked === null) {
    throw new Error("One person alone shouldn't be able to start this game.");
}
await person.chooseRow(screen, "Add an AI guest");
await waitFor(() => screen.shell?.seats.length === 2, "the first guest, from the TV's row");
for (let seated = 1; seated < GUESTS; seated += 1) {
    person.guest("add");
    await waitFor(() => screen.shell?.seats.length === seated + 2, "a guest from the phone's menu");
}
if (GUESTS === 3) {
    person.guest("add");
    await pause(300);
    if (screen.shell?.seats.length !== 4) {
        throw new Error("A fourth guest sat down, over the cap.");
    }
}
const guests = screen.shell?.seats.filter((seat) => seat.guest === true) ?? [];
for (const guest of guests) {
    if (guest.name.includes("the AI") === false || GUEST_PERSONAS.some((persona) => persona.name === guest.name) === false) {
        throw new Error(`A guest has a name that isn't a labelled preset: ${guest.name}`);
    }
}
if (guests.some((guest) => guest.driving === true)) {
    throw new Error("An AI guest has the controller.");
}
say(`At the table: Teacup and ${guests.map((guest) => guest.name).join(", ")}`);

await waitFor(() => screen.shell?.games[target]?.blocked === null, "the game to be startable");
await person.chooseRow(screen, "Play");
await waitFor(() => screen.shell?.screen === "play" || screen.shell?.screen === "startCard", "the game to start");
if (screen.shell?.screen === "startCard") {
    person.nav({ kind: "select" });
    await waitFor(() => screen.shell?.screen === "play", "the how-to card to be skipped");
}
say(`Started ${GAME}`);

const startedAt: number = Date.now();
const secretCards: Set<string> = new Set();
const seenOnTv: Set<string> = new Set();
let lastAsked: string = "";
let words: number = 0;
while (screen.shell?.gameOver !== true) {
    if (Date.now() - startedAt > GAME_LIMIT_MILLISECONDS) {
        throw new Error("The game never ended, so something is stalling it.");
    }
    for (const block of screen.scene?.blocks ?? []) {
        const text: string = blockText(block);
        if (text !== "" && seenOnTv.has(text) === false) {
            seenOnTv.add(text);
            say(`TV  ${text}`);
        }
    }
    const controls: Control[] = person.view?.controls ?? [];
    for (const control of controls) {
        if (control.type === "roleCard" && control.secret === true) {
            secretCards.add(control.body);
            secretCards.add(control.title);
        }
    }
    const typed: Control | undefined = controls.find((control: Control) => control.type === "textInput" || control.type === "numberInput" || control.type === "slider");
    const options: { id: string; label: string }[] = person.options().filter((option) => option.id !== "reveal-now");
    const asked: string = JSON.stringify([typed, options]);
    if (asked !== lastAsked) {
        lastAsked = asked;
        if (typed?.type === "textInput") {
            words += 1;
            const word: string = WORDS[words % WORDS.length] ?? "lantern";
            say(`Teacup types ${word}`);
            person.answer(typed.id, word);
        }
        if (typed?.type === "numberInput" || typed?.type === "slider") {
            const step: number = typed.step ?? 1;
            const value: number = typed.min + Math.round((typed.max - typed.min) / 2 / step) * step;
            say(`Teacup answers ${value}`);
            person.answer(typed.id, value);
        }
        const choice: { id: string; label: string } | undefined = options[Math.floor(Math.random() * options.length)];
        if (typed === undefined && choice !== undefined) {
            say(`Teacup presses ${choice.label}`);
            person.press(choice.id);
        }
    }
    await pause(400);
}
say(`Game over in ${Math.round((Date.now() - startedAt) / 1000)} s`);
await pause(WRAP_UP_MILLISECONDS);
for (const block of screen.scene?.blocks ?? []) {
    say(`TV  ${blockText(block)}`);
}

const trace: TraceLine[] = readTrace(traceStart);
for (const line of trace) {
    say(`${line.guest} thought: ${line.prompt.at(-1)?.content.replaceAll("\n", " | ") ?? ""}`);
    say(`${line.guest} replied: ${line.reply}${line.fellBack === true ? "  (unusable, played a fallback)" : ""}`);
}
if (GAME !== "Who Fits" && trace.length === 0) {
    throw new Error("No guest ever asked the model. Is GUEST_TRACE_FILE set on the room and the script?");
}
if (trace.some((line) => line.guest === "Teacup") === true) {
    throw new Error("A person's seat was played by a guest.");
}

// The leak check: a guest's prompt must never hold the person's cups. A word card is checked below,
// because everyone but the Stray shares it.
// A guest's own card is left out of the search, because its own hand in some round can match the person's in another.
const everything: string = trace.map((line: TraceLine) => (line.prompt.at(-1)?.content ?? "").split("\n").filter((row: string) => row.startsWith("Your dice") === false).join("\n")).join("\n");
for (const secret of secretCards) {
    const isDice: boolean = /^\d(\s+\d)+$/.test(secret.trim());
    if (isDice === true && everything.includes(secret) === true) {
        throw new Error(`The person's dice reached a guest's prompt: ${secret}`);
    }
}
if (GAME === "Stray Word") {
    const shown: string[] = (screen.scene?.blocks ?? []).map(blockText);
    const named: number = shown.findIndex((text: string) => /was the stray/i.test(text));
    const word: string = (shown[named - 1] ?? "").toLowerCase();
    const stray: string = /^(.+?) was the stray/i.exec(shown[named] ?? "")?.[1] ?? "";
    say(`  (the word: ${word === "" ? "not found on the TV" : word}; the Stray: ${stray})`);
    if (word === "" || stray === "") {
        throw new Error("The end of the game didn't show the word and the Stray.");
    }
    // A Stray can guess the word and say it, and then the table's list of words holds it. Anywhere else in its prompt would be a leak.
    const notSaid = (line: TraceLine): string => (line.prompt.at(-1)?.content ?? "").split("\n").filter((row: string) => row.startsWith("Said so far:") === false).join("\n").toLowerCase();
    if (trace.filter((line: TraceLine) => line.guest === stray).some((line: TraceLine) => notSaid(line).includes(word) === true)) {
        throw new Error("The Stray guest's prompt held the secret word.");
    }
}

await person.chooseRow(screen, "Back to the shelf");
await waitFor(() => screen.shell?.screen === "home", "the shelf");
person.guest("remove");
await waitFor(() => screen.shell?.seats.length === guests.length, "a guest to go home");
person.close();
say("PASS");
process.exit(0);
