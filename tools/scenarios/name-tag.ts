// Plays a whole game of Name Tag from a script with four fake phones and the real host. Turn by
// turn: the script finds whose turn it is, reads that player's name tag off another phone (the
// way a person would), and checks it never reaches their own phone, the TV or any host line
// before the reveal. It then has someone out of turn speak (nothing may count), asks questions,
// and ends the turn by guessing right, passing, or running out of questions. It checks the scores
// on the TV add up at the end.
//
// Run it on a machine with model keys for the host's real lines (without keys the game still
// plays and every check still runs; the host just says nothing):
//   GAME_ROOM_TEXT_ONLY=1 npm run room
//   ROOM_STUDIO=1 node tools/scenarios/name-tag.ts      (in a second terminal)
// ROOM_STUDIO=1 opens a room with the Studio shelf, the only kind that has Name Tag. A pass
// prints PASS as its last line and takes about two minutes. The room's log shows
// "[studio] starting blueprint nameTag on the identity kit".
// This is test tooling: it prints the name tags and the host's lines to its own terminal.

import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** The players. Turn order is the room's seat order, which the script reads off the TV. */
const NAMES: string[] = ["Teacup", "Spoon", "Candle", "Saucer"];

/** Questions a turn allows, from the blueprint. */
const QUESTIONS: number = 12;

/** What happens on each turn: guess after two questions, guess after one, pass, run out. */
const PLAN: ("two" | "one" | "pass" | "out")[] = ["two", "one", "pass", "out"];

/** Points each ending is worth: a solve in two questions, in one, then the point for the story. */
const POINTS: number[] = [5, 5, 1, 1];

/** The points each player should have at the end, by name. */
const expected: Record<string, number> = {};

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const phones: FakePhone[] = NAMES.map((name: string) => new FakePhone(screen.code, name));
await waitFor(() => screen.shell?.seats.length === phones.length, "every phone to join");

/**
 * Every string a phone is showing, for searching.
 * @param phone the phone.
 * @returns its view as one string.
 */
function seenOn(phone: FakePhone): string {
    return JSON.stringify(phone.view ?? {});
}

/**
 * The block of a type on the TV.
 * @param type the block type.
 * @returns the block, or undefined.
 */
function blockOnScreen(type: SceneBlock["type"]): SceneBlock | undefined {
    return screen.scene?.blocks.find((block: SceneBlock) => block.type === type);
}

/**
 * The TV's title text.
 * @returns the title, or an empty string.
 */
function titleText(): string {
    const title: SceneBlock | undefined = blockOnScreen("title");
    return title?.type === "title" ? title.text : "";
}

/**
 * How many questions the TV says have been asked this turn.
 * @returns the count, or -1 when no counter is up.
 */
function questionsShown(): number {
    const progress: SceneBlock | undefined = blockOnScreen("progress");
    return progress?.type === "progress" ? progress.current : -1;
}

/**
 * The name tag a phone shows for the player on the spot: its first role card.
 * @param phone a phone that isn't theirs.
 * @returns the name tag.
 */
function tagShownOn(phone: FakePhone): string {
    const card: Control | undefined = phone.view?.controls.find((control: Control) => control.type === "roleCard");
    return card?.type === "roleCard" ? card.title : "";
}

await phones[0]?.startGame(screen, "Name Tag");
const answers: string[] = [];
for (let turn = 1; turn <= NAMES.length; turn += 1) {
    await waitFor(() => titleText().endsWith(", who are you?"), `turn ${turn} to open`);
    const name: string = titleText().replace(", who are you?", "");
    const spot: FakePhone | undefined = phones[NAMES.indexOf(name)];
    const watcher: FakePhone | undefined = phones.find((phone: FakePhone) => phone !== spot);
    if (spot === undefined || watcher === undefined || Object.keys(expected).includes(name) === true) {
        throw new Error(`Turn ${turn} is ${name}'s, who is not at the table or has already had a turn.`);
    }
    expected[name] = POINTS[turn - 1] ?? 1;
    await waitFor(() => tagShownOn(watcher) !== "", `${name}'s name tag on another phone`);
    const tag: string = tagShownOn(watcher);
    answers.push(tag);
    console.warn(`Turn ${turn}: ${name} is on the spot, and is ${tag}`);
    for (const other of phones.filter((phone: FakePhone) => phone !== spot)) {
        if (tagShownOn(other) !== tag) {
            throw new Error(`${tag} should be the first card on every other phone.`);
        }
    }
    const assertSecret = (when: string): void => {
        const hostSaid: string = screen.hostLines.join(" ");
        if (seenOn(spot).includes(tag) || JSON.stringify(screen.scene).includes(tag) || hostSaid.includes(tag)) {
            throw new Error(`LEAK ${when}: ${name}'s tag ${tag} reached their phone, the TV or the host.`);
        }
    };
    assertSecret("at the start of the turn");
    watcher.say(`I think ${name} is ${tag}`);
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 400); });
    if (questionsShown() !== 0) {
        throw new Error("Someone out of turn was counted as a question.");
    }
    const plan: "two" | "one" | "pass" | "out" = PLAN[turn - 1] ?? "out";
    const askFirst: number = plan === "two" ? 1 : plan === "one" ? 0 : plan === "out" ? QUESTIONS : 1;
    for (let question = 1; question <= askFirst; question += 1) {
        spot.say(`Am I something number ${question}?`);
        await waitFor(() => questionsShown() === question || blockOnScreen("tally") !== undefined && titleText() === tag, `question ${question} to count`);
    }
    if (plan !== "out") {
        assertSecret("after questions, before the end");
    }
    if (plan === "pass") {
        spot.press("Pass this turn");
    }
    if (plan === "two" || plan === "one") {
        spot.say(`Am I ${tag}?`);
    }
    await waitFor(() => titleText() === tag, `${tag} to be revealed`);
    console.warn(`  revealed: ${tag}`);
    await waitFor(() => titleText() !== tag, "the next turn or the end");
}
await waitFor(() => screen.shell?.gameOver === true, "the end of the game");
const tally: SceneBlock | undefined = screen.scene?.blocks.find((block: SceneBlock) => block.type === "tally");
const rows: { label: string; count: number }[] = tally?.type === "tally" ? tally.rows : [];
console.warn(`Points: ${rows.map((row) => `${row.label} ${row.count}`).join(", ")}`);
for (const [name, wanted] of Object.entries(expected)) {
    const points: number | undefined = rows.find((row) => row.label === name)?.count;
    if (points !== wanted) {
        throw new Error(`${name} should have ${wanted} points, the TV says ${points}.`);
    }
}
const everything: string = JSON.stringify(screen.scene);
for (const answer of answers) {
    if (everything.includes(answer) === false) {
        throw new Error(`The end screen should show that someone was ${answer}.`);
    }
}
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 3000); });
await phones[0]?.chooseRow(screen, "Back to the shelf");
await waitFor(() => screen.shell?.screen === "home", "the shelf");
console.warn("PASS");
process.exit(0);
