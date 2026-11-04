// Plays a whole game of Mind the Gap from a script with three fake phones and the real room: six cards,
// each placed in a growing row by a secret pick, then revealed and scored. The script reads the new
// card's name from the TV, looks its year up in the game's own card bank, works out the right gap itself
// and has Teacup pick it, Spoon pick a gap beside it and Saucer pick the very start, so each round's
// points are known. It fails if the new card's year shows anywhere before the reveal, if a pick shows
// on another phone before the reveal, if the row isn't in date order, if the card isn't placed where
// its year says, if the scores are wrong, or if the host says the year before the reveal. With no model
// key the host never replies, the script says so, and the last line is PASS (rules only).
//
// Run it:
//   GAME_ROOM_TEXT_ONLY=1 npm run room
//   ROOM_STUDIO=1 node tools/scenarios/mind-the-gap.ts      (in a second terminal)
// ROOM_STUDIO=1 makes the fake screen open its room with ?studio=1, the only kind of room whose shelf has
// this game. The room's log should show "[studio] starting blueprint mindTheGap on the line kit".
// A game takes about a minute and a half, because each reveal stays up for twelve seconds.
//
// This is test tooling, not the server: it prints every card, year and pick to its own terminal, which
// the room's log never does. Don't paste its output anywhere public.

import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { CARDS } from "../../studio/games/mind-the-gap/cards.ts";
import { slotFor, type LineCard } from "../../studio/kits/line.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** Cards to place in a game. */
const ROUNDS: number = 6;

/** One fake player. */
interface Seat {
    name: string;
    phone: FakePhone;
}

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const seats: Seat[] = ["Teacup", "Spoon", "Saucer"].map((name: string) => ({ name, phone: new FakePhone(screen.code, name) }));
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
 * The row on the table, as the TV shows it.
 * @returns the cards from the bank, in the order shown.
 */
function rowOnTv(): LineCard[] {
    const tally = screen.scene?.blocks.find((block: SceneBlock) => block.type === "tally") as { rows: { label: string }[] } | undefined;
    return (tally?.rows ?? []).map((row) => CARDS.find((card: LineCard) => card.name === row.label) as LineCard);
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
        return control.type === "choice" ? [control.prompt, ...control.options.map((option) => option.label)] : [];
    });
}

await seats[0]?.phone.startGame(screen, "Mind the Gap");
const [teacup, spoon, saucer] = seats;
if (teacup === undefined || spoon === undefined || saucer === undefined) {
    throw new Error("Expected three players.");
}
const expected: Record<string, number> = { Teacup: 0, Spoon: 0, Saucer: 0 };
let rowSize: number = 0;
for (let round = 0; round < ROUNDS; round += 1) {
    const ready = (): boolean => rowOnTv().length > rowSize && seats.every((seat: Seat) => seat.phone.options().length === rowOnTv().length + 1);
    await waitFor(ready, `gaps on every phone for card ${round + 1}`);
    const titleLine: string = (screen.scene?.blocks.find((block: SceneBlock) => block.type === "title") as { text: string } | undefined)?.text ?? "";
    const card: LineCard | undefined = CARDS.find((candidate: LineCard) => candidate.name === titleLine);
    if (card === undefined) {
        throw new Error(`The TV shows a card that is not in the bank: ${titleLine}`);
    }
    const row: LineCard[] = rowOnTv();
    rowSize = row.length;
    if (row.some((other: LineCard, index: number) => index > 0 && (row[index - 1]?.year ?? 0) >= other.year) === true) {
        throw new Error("The row on the TV is not in date order.");
    }
    const right: number = slotFor(row.map((other: LineCard) => other.year), card.year);
    console.warn(`Card ${round + 1}: ${card.id} (${card.year}), right gap ${right} of ${row.length + 1}.`);
    const roundStart: number = screen.hostLines.length;
    const yearShown: string[] = [...tvLines(), ...seats.flatMap(phoneLines)].filter((line: string) => line.includes(String(card.year)) === true);
    if (yearShown.length > 0) {
        throw new Error("The new card's year shows before the reveal.");
    }
    const picks: Record<string, number> = { Teacup: right, Spoon: right === 0 ? 1 : right - 1, Saucer: 0 };
    teacup.phone.press(teacup.phone.options()[picks.Teacup ?? 0]?.id ?? "");
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 400); });
    const pickShown: boolean = [spoon, saucer].some((seat: Seat) => phoneLines(seat).some((line: string) => line.startsWith("You put it")) === true);
    if (pickShown === true || tvLines().some((line: string) => line.startsWith("You put it")) === true) {
        throw new Error("A pick showed on another phone or the TV before the reveal.");
    }
    const early: string[] = screen.hostLines.slice(roundStart).filter((line: string) => line.includes(String(card.year)) === true);
    if (early.length > 0) {
        throw new Error(`The host said the year before the reveal: ${early.join(" | ")}`);
    }
    spoon.phone.press(spoon.phone.options()[picks.Spoon ?? 0]?.id ?? "");
    saucer.phone.press(saucer.phone.options()[picks.Saucer ?? 0]?.id ?? "");
    await waitFor(() => tvLines().includes(`It was ${card.year}`), "the reveal");
    const after: LineCard[] = rowOnTv();
    if (after.length !== row.length + 1 || after[right] !== card) {
        throw new Error("The card is not in the row where its year says.");
    }
    if (card.surprise !== null && tvLines().includes(card.surprise) === false) {
        throw new Error("A surprising card does not show why.");
    }
    for (const seat of seats) {
        const pick: number = picks[seat.name] ?? 0;
        expected[seat.name] = (expected[seat.name] ?? 0) + (pick === right ? 2 : Math.abs(pick - right) === 1 ? 1 : 0);
    }
    await waitFor(() => round === ROUNDS - 1 ? screen.shell?.gameOver === true : seats.every((seat: Seat) => seat.phone.options().length === row.length + 2), "the next card");
}

const tally = screen.scene?.blocks.find((block: SceneBlock) => block.type === "tally") as { rows: { label: string; count: number; highlight?: boolean }[] } | undefined;
const finalRows: Record<string, number> = Object.fromEntries(tally?.rows.map((row) => [row.label, row.count]) ?? []);
console.warn(`Final: ${JSON.stringify(finalRows)}`);
for (const seat of seats) {
    if (finalRows[seat.name] !== expected[seat.name]) {
        throw new Error(`Wrong score for ${seat.name}: ${finalRows[seat.name]}, expected ${expected[seat.name]}.`);
    }
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
