// Plays a whole game of Magpie Pockets from a script with four fake phones and the real host. Each
// phone has its own nerve: it draws until its pocket is worth its limit, then stays; one never
// stays and so busts. The script checks, from outside, what a player at the table could check:
// the TV and every other phone look exactly the same after one player's choice (nothing leaks
// before the flip), a flip never shows while people are choosing, every point on the
// scoreboard after each round, and at the end, is one a phone banked by staying (the pocket it
// showed at that moment), and the game ends with a winner.
//
// Run it on a machine with model keys, or without them (the host then falls silent and the
// game plays from its fallback lines):
//   GAME_ROOM_TEXT_ONLY=1 npm run room
//   ROOM_STUDIO=1 node tools/scenarios/magpie-pockets.ts      (in a second terminal)
// ROOM_STUDIO=1 opens a room with the Studio shelf, the only kind that has Magpie Pockets. A pass
// prints PASS as its last line and takes about two minutes. The room's log shows
// "[studio] starting blueprint magpiePockets on the tap kit".
// This is test tooling: it prints the cards and the host's lines to its own terminal.

import type { SceneBlock } from "../../shared/scene.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** Points that end the game, from the blueprint. */
const TARGET: number = 30;

/** How much each phone's pocket must be worth before it stays. The last never stays. */
const LIMITS: number[] = [5, 8, 11, 999];

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const names: string[] = ["Teacup", "Spoon", "Candle", "Saucer"];
const phones: FakePhone[] = names.map((name: string) => new FakePhone(screen.code, name));
await waitFor(() => screen.shell?.seats.length === phones.length, "every phone to join");

/**
 * The kicker on the TV's title, such as "Round 2 of 8, card 3".
 * @returns the kicker, or an empty string.
 */
function kicker(): string {
    const title: SceneBlock | undefined = screen.scene?.blocks.find((block: SceneBlock) => block.type === "title");
    return title?.type === "title" ? title.kicker ?? "" : "";
}

/**
 * The rows of the first tally on the TV.
 * @returns label and count for each row, possibly none.
 */
function rows(): { label: string; count: number }[] {
    const block: SceneBlock | undefined = screen.scene?.blocks.find((candidate: SceneBlock) => candidate.type === "tally");
    return block?.type === "tally" ? block.rows.map((row) => ({ label: row.label, count: row.count })) : [];
}

/**
 * What a phone says its pocket is worth, from its card.
 * @param phone the phone.
 * @returns the points, or 0 when it has no card.
 */
function worth(phone: FakePhone): number {
    const card = phone.view?.controls.find((control) => control.type === "roleCard");
    const match: RegExpMatchArray | null = card?.type === "roleCard" ? card.title.match(/(\d+)/) : null;
    return Number(match?.[1] ?? 0);
}

/**
 * Whether the room says the game is over.
 * @returns true once it is.
 */
function gameOver(): boolean {
    return screen.shell?.gameOver === true;
}

/**
 * Whether the TV is asking people to choose.
 * @returns true while it is.
 */
function choosing(): boolean {
    return screen.title() === "Draw or stay?";
}

await phones[0]?.startGame(screen, "Magpie Pockets");
const expected: Record<string, number> = {};
let roundsPlayed: number = 0;
let lastKey: string = "";
let beats: number = 0;
while (gameOver() === false) {
    await waitFor(() => gameOver() === true || (choosing() === true && `${kicker()}` !== lastKey), "the next beat");
    if (gameOver() === true) {
        break;
    }
    lastKey = kicker();
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 400); });
    const waiting: FakePhone[] = phones.filter((phone: FakePhone) => phone.options().length > 0);
    console.warn(`Beat ${beats + 1} (${lastKey}): ${rows().map((row) => `${row.label} ${row.count}`).join(" | ")}`);
    const before: string = JSON.stringify(screen.scene);
    const bystander: FakePhone | undefined = waiting[1];
    const bystanderBefore: string = JSON.stringify(bystander?.view?.controls);
    for (const [index, phone] of waiting.entries()) {
        const stays: boolean = worth(phone) >= (LIMITS[phones.indexOf(phone)] ?? 0);
        if (stays === true) {
            const name: string = names[phones.indexOf(phone)] ?? "";
            expected[name] = (expected[name] ?? 0) + worth(phone);
        }
        phone.press(stays === true ? "push:stay" : "push:draw");
        if (index === 0 && waiting.length > 1) {
            await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 400); });
            if (choosing() === false) {
                throw new Error("The flip came before the others had chosen.");
            }
            if (JSON.stringify(screen.scene) !== before) {
                throw new Error("The TV changed after one player's choice, before the flip.");
            }
            if (JSON.stringify(bystander?.view?.controls) !== bystanderBefore) {
                throw new Error("Another phone changed after one player's choice, before the flip.");
            }
            console.warn("  Leak check: after one choice the TV and another phone were unchanged.");
        }
    }
    beats += 1;
    await waitFor(() => choosing() === false, "the flip");
    console.warn(`  ${screen.title()}: ${rows().map((row) => `${row.label} ${row.count}`).join(" | ")}`);
    if (screen.title().endsWith("is over") === true) {
        roundsPlayed += 1;
        console.warn(`  Round ${roundsPlayed} over.`);
        for (const row of rows()) {
            if (row.count !== (expected[row.label] ?? 0)) {
                throw new Error(`After round ${roundsPlayed}, ${row.label} showed ${row.count} but banked ${expected[row.label] ?? 0}.`);
            }
        }
    }
    await waitFor(() => gameOver() === true || choosing() === true || screen.title().endsWith("is over") === true || kicker() !== lastKey, "the next screen");
}
await waitFor(() => screen.title() !== "" && screen.scene?.blocks.some((block: SceneBlock) => block.type === "tally") === true, "the final scoreboard");
const final: { label: string; count: number }[] = rows();
console.warn(`Final: ${final.map((row) => `${row.label} ${row.count}`).join(", ")}`);
for (const row of final) {
    if (row.count !== (expected[row.label] ?? 0)) {
        throw new Error(`${row.label} finished with ${row.count} but banked ${expected[row.label] ?? 0}.`);
    }
}
const best: number = Math.max(...final.map((row) => row.count));
if (best < TARGET && roundsPlayed < 8) {
    throw new Error(`The game ended with the best score ${best} after ${roundsPlayed} rounds.`);
}
if (final.every((row, index) => index === 0 || row.count <= (final[index - 1]?.count ?? 0)) === false) {
    throw new Error("The scoreboard is not in order.");
}
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 6000); });
await phones[0]?.chooseRow(screen, "Back to the shelf");
await waitFor(() => screen.shell?.screen === "home", "the shelf");
console.warn("PASS");
process.exit(0);
