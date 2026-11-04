// Plays a whole round of Cold Read from a script with four fake phones and a host. The table picks a
// category, agrees on a thing, and answers the host's questions with Yes, No and Sometimes taps; the
// host asks, guesses and is judged. The script fails if the host asks more questions than the budget
// or while one is open, if the TV shows how anyone answered while a question is open, if the thing
// is named anywhere before the host guesses it, if the progress count disagrees with the questions
// really asked, if a bracket reaches a caption, or if the round never ends.
//
// Two plans, picked with SCENARIO=win (the default) or SCENARIO=lose:
//   win:  every answer is Yes, so the host guesses "a lighthouse" after a few questions, the table says
//         so out loud and taps that it was right.
//   lose: every answer is No or Sometimes, so the host uses all fifteen questions, makes its final
//         guess, and the table taps that it was wrong.
//
// Run it against the stand-in model, which needs no key:
//   META_BASE_URL=http://localhost:8741/v1 META_MODEL_API_KEY=stand-in GAME_ROOM_TEXT_ONLY=1 npm run room
//   STUB_PLAN=win node tools/stub-host-model.ts              (STUB_PLAN=lose for SCENARIO=lose)
//   ROOM_STUDIO=1 node tools/scenarios/cold-read.ts          (in a third terminal)
// or against the real host on a machine with model keys, leaving out the first two commands' variables.
// ROOM_STUDIO=1 opens a room with the Studio shelf, the only kind that has Cold Read. A pass prints PASS
// as its last line. The room's log shows "[studio] starting blueprint coldRead on the hostGuess kit".
// This is test tooling: it prints the questions and the host's lines to its own terminal.

import type { SceneBlock } from "../../shared/scene.ts";
import { COLD_READ_BLUEPRINT } from "../../studio/games/cold-read/blueprint.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** Which plan this run plays. */
const PLAN: string = process.env.SCENARIO === "lose" ? "lose" : "win";

/** The thing the table agreed on. Only said out loud at the reveal. */
const THING: string = "lighthouse";

/** Questions the host may ask. */
const BUDGET: number = COLD_READ_BLUEPRINT.decisions.questions;

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const phones: FakePhone[] = ["Teacup", "Spoon", "Candle", "Saucer"].map((name: string) => new FakePhone(screen.code, name));
await waitFor(() => screen.shell?.seats.length === phones.length, "every phone to join");

/**
 * Every string on the TV right now.
 * @returns the texts.
 */
function screenTexts(): string[] {
    return (screen.scene?.blocks ?? []).flatMap((block: SceneBlock) => {
        if (block.type === "title") {
            return [block.text, block.kicker ?? ""];
        }
        if (block.type === "text" || block.type === "caption") {
            return [block.text];
        }
        if (block.type === "tally") {
            return [block.title, ...block.rows.map((row) => row.label)];
        }
        return [];
    });
}

/**
 * The question currently open on the phones, if any.
 * @returns its text, or an empty string.
 */
function openQuestion(): string {
    const control = phones[0]?.view?.controls.find((candidate) => candidate.type === "buttons");
    const labels: string = control?.type === "buttons" ? control.options.map((option) => option.label).join("/") : "";
    return control?.type === "buttons" && labels === "Yes/No/Sometimes" ? control.prompt ?? "" : "";
}

/**
 * The questions-asked count on the TV.
 * @returns the count, or -1 when no progress bar is up.
 */
function progressOnScreen(): number {
    const block: SceneBlock | undefined = screen.scene?.blocks.find((candidate: SceneBlock) => candidate.type === "progress");
    return block?.type === "progress" ? block.current : -1;
}

/**
 * What the first phone is being asked to judge, if anything.
 * @returns "reveal" for the final guess, "guess" for an earlier one, or null.
 */
function judging(): "guess" | "reveal" | null {
    const labels: string[] = phones[0]?.options().map((option) => option.label) ?? [];
    if (labels.includes("The host was right") === true) {
        return "reveal";
    }
    return labels.includes("Yes, that's it") === true ? "guess" : null;
}

/**
 * Waits for the next thing the table has to do: a new question, a guess to judge, or the end.
 * @param after the question just answered, so the same one isn't taken twice.
 * @returns what came up.
 */
async function nextMoment(after: string): Promise<"question" | "guess" | "reveal" | "end"> {
    const ready = (): boolean => screen.shell?.gameOver === true || judging() !== null || (openQuestion() !== "" && openQuestion() !== after);
    await waitFor(ready, "the host to ask, guess or finish");
    if (screen.shell?.gameOver === true) {
        return "end";
    }
    return judging() ?? "question";
}

await phones[0]?.startGame(screen, COLD_READ_BLUEPRINT.box.name);

// Pick a category: three of four tap "a place".
await waitFor(() => phones.every((phone: FakePhone) => phone.options().length > 0), "a category on every phone");
for (const [seat, phone] of phones.entries()) {
    phone.press(seat === 3 ? "a person" : "a place");
}
await waitFor(() => screenTexts().some((text: string) => text.includes("Agree on a place")), "the secret phase");
console.warn(`TV: ${screen.title()}`);

// Agree on the thing without a word of it reaching the room.
await waitFor(() => phones.every((phone: FakePhone) => phone.options().some((option) => option.label === "We've agreed")), "the ready button on every phone");
for (const phone of phones) {
    phone.press("We've agreed");
}

let asked: number = 0;
let previous: string = "";
let finished: boolean = false;
while (finished === false) {
    const moment: "question" | "guess" | "reveal" | "end" = await nextMoment(previous);
    if (screenTexts().some((text: string) => text.toLowerCase().includes(THING)) === true && moment === "question") {
        throw new Error("The thing was named before the host guessed it.");
    }
    if (moment === "question") {
        const question: string = openQuestion();
        asked += 1;
        console.warn(`Question ${asked}: ${question}`);
        if (asked > BUDGET) {
            throw new Error(`The host asked question ${asked}, over the budget of ${BUDGET}.`);
        }
        if (screen.title() !== question) {
            throw new Error("The TV did not show the question the phones were asked.");
        }
        phones[0]?.press(PLAN === "win" ? "Yes" : "No");
        await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 200); });
        const tallyShown: boolean = screen.scene?.blocks.some((block: SceneBlock) => block.type === "tally") === true;
        if (tallyShown === true) {
            throw new Error("The TV showed counts while a question was open.");
        }
        for (const [seat, phone] of phones.slice(1).entries()) {
            phone.press(PLAN === "win" ? "Yes" : seat % 2 === 0 ? "No" : "Sometimes");
        }
        await waitFor(() => progressOnScreen() === asked, `the progress bar to reach ${asked}`);
        previous = question;
        continue;
    }
    if (moment === "guess") {
        console.warn(`Guess to judge: ${screen.title()}`);
        for (const phone of phones) {
            phone.press(PLAN === "win" ? "Yes, that's it" : "No, not it");
        }
        await waitFor(() => judging() === null, "the guess to be judged");
        continue;
    }
    if (moment === "reveal") {
        console.warn(`Final guess: ${screen.title()}`);
        if (PLAN === "lose" && asked !== BUDGET) {
            throw new Error(`The final guess came after ${asked} questions, not ${BUDGET}.`);
        }
        phones[1]?.say(`It was a ${THING}`);
        await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 1500); });
        for (const phone of phones) {
            phone.press(PLAN === "win" ? "The host was right" : "The host was wrong");
        }
        finished = true;
        continue;
    }
    finished = true;
}
await waitFor(() => screen.shell?.gameOver === true, "the end of the round");
console.warn(`End: ${screen.title()} / ${screenTexts().join(" | ")}`);
const wanted: string = PLAN === "win" ? "got it" : "stumped";
if (screen.title().includes(wanted) === false) {
    throw new Error(`The end screen says "${screen.title()}", expected it to say "${wanted}".`);
}
if (PLAN === "lose" && asked !== BUDGET) {
    throw new Error(`The round used ${asked} questions, expected all ${BUDGET}.`);
}
if (screen.hostLines.some((line: string) => line.includes("[[")) === true) {
    throw new Error("A ruling reached a caption.");
}
await waitFor(() => screen.hostLines.length > 3, "the host to react");
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 3000); });
await phones[0]?.chooseRow(screen, "Back to the shelf");
await waitFor(() => screen.shell?.screen === "home", "the shelf");
console.warn("PASS");
process.exit(0);
