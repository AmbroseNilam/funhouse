// Plays a whole game of Off by a Mile from a script with four fake phones and the real room: five
// questions, each guessed on a number input, bet on, revealed and scored. The script reads the question
// from each phone, looks the answer up in the game's own question bank, and guesses the same way every
// round: one player a little under, one well over, one far under, one far over. Teacup is always closest;
// Teacup, Spoon and Matchbox back Teacup and Saucer backs someone else, so the scores after five rounds
// are known. It fails if the TV or any other phone shows a guess or the answer too early, if a number
// outside the allowed range is accepted, if the scores are wrong, or if the host says an answer before
// the reveal. With no model key the host never replies, the script says so, and the last line is
// PASS (rules only).
//
// Run it:
//   GAME_ROOM_TEXT_ONLY=1 npm run room
//   ROOM_STUDIO=1 node tools/scenarios/off-by-a-mile.ts      (in a second terminal)
// ROOM_STUDIO=1 makes the fake screen open its room with ?studio=1, the only kind of room whose shelf has
// this game. The room's log should show "[studio] starting blueprint offByAMile on the estimate kit".
// A game takes about a minute and a half, because each reveal stays up for fourteen seconds.
//
// This is test tooling, not the server: it prints every guess and answer to its own terminal, which the
// room's log never does. Don't paste its output anywhere public.

import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { QUESTIONS } from "../../studio/games/off-by-a-mile/questions.ts";
import { formatNumber, guessControlId, type EstimateQuestion } from "../../studio/kits/estimate/estimate.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** Rounds in a game. */
const ROUNDS: number = 5;

/** Each player's guess as a share of the answer. */
const SHARES: Record<string, number> = { Teacup: 0.95, Spoon: 1.3, Saucer: 0.5, Matchbox: 2 };

/** One fake player. */
interface Seat {
    name: string;
    phone: FakePhone;
}

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const seats: Seat[] = Object.keys(SHARES).map((name: string) => ({ name, phone: new FakePhone(screen.code, name) }));
await waitFor(() => screen.shell?.seats.length === seats.length, "every phone to join");

/**
 * Every readable line on the TV right now.
 * @returns the lines.
 */
function tvLines(): string[] {
    return (screen.scene?.blocks ?? []).flatMap((block: SceneBlock) => {
        if (block.type === "title") {
            return [block.text, block.kicker ?? ""];
        }
        if (block.type === "text") {
            return [block.text];
        }
        return block.type === "tally" ? [block.title, ...block.rows.map((row) => row.label)] : [];
    });
}

/**
 * The number box on a phone, if it has one.
 * @param seat whose phone.
 * @returns the control.
 */
function numberBox(seat: Seat): Extract<Control, { type: "numberInput" }> | undefined {
    const found: Control | undefined = seat.phone.view?.controls.find((control: Control) => control.type === "numberInput");
    return found?.type === "numberInput" ? found : undefined;
}

/**
 * Every readable line on a phone right now.
 * @param seat whose phone.
 * @returns the lines.
 */
function phoneLines(seat: Seat): string[] {
    return (seat.phone.view?.controls ?? []).flatMap((control: Control) => {
        if (control.type === "waiting" || control.type === "notice") {
            return [control.text];
        }
        return control.type === "numberInput" ? [control.prompt, control.note ?? ""] : control.type === "choice" ? control.options.map((option) => option.label) : [];
    });
}

/**
 * Letters and digits only, so a number is found however it is written.
 * @param text any text.
 * @returns the squashed text.
 */
function squash(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

await seats[0]?.phone.startGame(screen, "Off by a Mile");
const expected: Record<string, number> = { Teacup: 0, Spoon: 0, Saucer: 0, Matchbox: 0 };
const [teacup, spoon, saucer, matchbox] = seats;
if (teacup === undefined || spoon === undefined || saucer === undefined || matchbox === undefined) {
    throw new Error("Expected four players.");
}
for (let round = 0; round < ROUNDS; round += 1) {
    await waitFor(() => seats.every((seat: Seat) => numberBox(seat)?.id === guessControlId(round)), `a number box on every phone for round ${round + 1}`);
    const prompt: string = numberBox(teacup)?.prompt ?? "";
    const question: EstimateQuestion | undefined = QUESTIONS.find((candidate: EstimateQuestion) => candidate.prompt === prompt);
    if (question === undefined) {
        throw new Error(`The phone asks a question that is not in the bank: ${prompt}`);
    }
    console.warn(`Round ${round + 1}: ${question.id}, answer ${formatNumber(question.answer)} ${question.unit}.`);
    const roundStart: number = screen.hostLines.length;
    const box = numberBox(teacup);
    if (box === undefined || box.min !== question.min || box.max !== question.max || box.step !== question.step) {
        throw new Error("The number box does not match the question's range.");
    }
    if (squash(tvLines().join(" ")).includes(squash(formatNumber(question.answer))) === true) {
        throw new Error("The TV shows the answer while guesses are still open.");
    }
    // An out-of-range or off-grid number is ignored, so the box stays.
    teacup.phone.answer(box.id, question.max + question.step);
    teacup.phone.answer(box.id, question.min + question.step / 2);
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 400); });
    if (numberBox(teacup) === undefined) {
        throw new Error("A number outside what the box allows was accepted.");
    }
    const guesses: Record<string, number> = {};
    for (const seat of seats) {
        const wanted: number = question.answer * (SHARES[seat.name] ?? 1);
        const onGrid: number = question.min + Math.round((wanted - question.min) / question.step) * question.step;
        guesses[seat.name] = Math.min(question.max, Math.max(question.min, onGrid));
    }
    teacup.phone.answer(box.id, guesses.Teacup ?? 0);
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 400); });
    const guessText: string = squash(formatNumber(guesses.Teacup ?? 0));
    const shownElsewhere: string[] = [...tvLines(), ...[spoon, saucer, matchbox].flatMap(phoneLines)].filter((line: string) => squash(line).includes(guessText) === true);
    if (shownElsewhere.length > 0) {
        throw new Error("A guess showed on the TV or another phone before everyone had guessed.");
    }
    for (const seat of [spoon, saucer, matchbox]) {
        seat.phone.answer(numberBox(seat)?.id ?? "", guesses[seat.name] ?? 0);
    }
    await waitFor(() => seats.every((seat: Seat) => seat.phone.options().length >= seats.length), "bets to open");
    // Guesses are public now and the answer is not.
    if (squash(tvLines().join(" ")).includes(squash(formatNumber(question.answer))) === true) {
        throw new Error("The TV shows the answer while bets are open.");
    }
    const labels: string[] = teacup.phone.options().map((option) => option.label);
    const lowest: string = labels[0] ?? "";
    if (lowest.startsWith("Saucer:") === false) {
        throw new Error(`Guesses are not listed lowest first: ${labels.join(" | ")}`);
    }
    const early: string[] = screen.hostLines.slice(roundStart).filter((line: string) => squash(line).includes(squash(formatNumber(question.answer))) === true);
    if (early.length > 0) {
        throw new Error(`The host said the answer while guesses and bets were open: ${early.join(" | ")}`);
    }
    for (const seat of [teacup, spoon, matchbox]) {
        seat.phone.press(seat.phone.options().find((option) => option.label.startsWith("Teacup:"))?.id ?? "");
    }
    saucer.phone.press(saucer.phone.options().find((option) => option.label.startsWith("Matchbox:"))?.id ?? "");
    await waitFor(() => tvLines().some((line: string) => line === "The answer"), "the reveal");
    const title: string = (screen.scene?.blocks.find((block: SceneBlock) => block.type === "title") as { text: string } | undefined)?.text ?? "";
    if (title !== `${formatNumber(question.answer)} ${question.unit}`) {
        throw new Error(`The reveal shows ${title}, expected ${formatNumber(question.answer)} ${question.unit}.`);
    }
    if (tvLines().includes(question.aside) === false) {
        throw new Error("The reveal does not show the second true thing.");
    }
    expected.Teacup = (expected.Teacup ?? 0) + 3 + 2;
    expected.Spoon = (expected.Spoon ?? 0) + 2;
    expected.Matchbox = (expected.Matchbox ?? 0) + 2;
    await waitFor(() => round === ROUNDS - 1 ? screen.shell?.gameOver === true : numberBox(teacup)?.id === guessControlId(round + 1), "the next question");
}

const tally = screen.scene?.blocks.find((block: SceneBlock) => block.type === "tally") as { rows: { label: string; count: number; highlight?: boolean }[] } | undefined;
const finalRows: Record<string, number> = Object.fromEntries(tally?.rows.map((row) => [row.label, row.count]) ?? []);
console.warn(`Final: ${JSON.stringify(finalRows)}`);
if (JSON.stringify(finalRows) !== JSON.stringify({ Teacup: 25, Spoon: 10, Matchbox: 10, Saucer: 0 })) {
    throw new Error(`Wrong final scores: ${JSON.stringify(finalRows)}; expected ${JSON.stringify(expected)}.`);
}
if (tally?.rows[0]?.highlight !== true) {
    throw new Error("The winner is not highlighted.");
}
const heard: number = screen.hostLines.length;
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, heard === 0 ? 500 : 6000); });
await seats[0]?.phone.chooseRow(screen, "Back to the shelf");
await waitFor(() => screen.shell?.screen === "home", "the shelf");
console.warn(heard === 0 ? "PASS (rules only)" : "PASS");
process.exit(0);
