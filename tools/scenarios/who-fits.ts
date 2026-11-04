// Plays a whole game of Who Fits from a script with four fake phones and the real host. Every
// round each phone taps its first choice; the script checks the TV never shows a count while
// people are tapping, that each reveal counts exactly the taps made, and that the final totals add
// up. It fails if the TV names who tapped whom, or if a round doesn't end.
//
// Run it on a machine with model keys:
//   GAME_ROOM_TEXT_ONLY=1 npm run room
//   ROOM_STUDIO=1 node tools/scenarios/who-fits.ts      (in a second terminal)
// ROOM_STUDIO=1 opens a room with the Studio shelf, the only kind that has Who Fits. A pass
// prints PASS as its last line, takes about two minutes and costs a few cents of model calls.
// The room's log shows "[studio] starting blueprint whoFits on the tap kit".
// This is test tooling: it prints the prompts and the host's lines to its own terminal.

import type { SceneBlock } from "../../shared/scene.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** Prompts in a game, from the blueprint. */
const ROUNDS: number = 5;

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const phones: FakePhone[] = ["Teacup", "Spoon", "Candle", "Saucer"].map((name: string) => new FakePhone(screen.code, name));
await waitFor(() => screen.shell?.seats.length === phones.length, "every phone to join");

/**
 * The tally on the TV, if any.
 * @returns the block, or undefined.
 */
function tallyOnScreen(): SceneBlock | undefined {
    return screen.scene?.blocks.find((block: SceneBlock) => block.type === "tally");
}

/**
 * The kicker on the TV's title, such as "Prompt 2 of 5".
 * @returns the kicker, or an empty string.
 */
function kicker(): string {
    const title: SceneBlock | undefined = screen.scene?.blocks.find((block: SceneBlock) => block.type === "title");
    return title?.type === "title" ? title.kicker ?? "" : "";
}

await phones[0]?.startGame(screen, "Who Fits");
let tapped: number = 0;
for (let round = 1; round <= ROUNDS; round += 1) {
    const ready = (): boolean => kicker() === `Prompt ${round} of ${ROUNDS}` && phones.every((phone: FakePhone) => phone.options().length > 0);
    await waitFor(ready, `prompt ${round} with a ballot on every phone`);
    console.warn(`Prompt ${round}: ${screen.title()}`);
    if (tallyOnScreen() !== undefined) {
        throw new Error("The TV showed counts while people were tapping.");
    }
    for (const phone of phones) {
        const first: { id: string; label: string } | undefined = phone.options()[0];
        if (first === undefined) {
            throw new Error("A phone had no ballot.");
        }
        phone.press(first.id);
        tapped += 1;
    }
    await waitFor(() => tallyOnScreen() !== undefined, `the reveal for prompt ${round}`);
    const block: SceneBlock | undefined = tallyOnScreen();
    const counted: number = block?.type === "tally" ? block.rows.reduce((total: number, row) => total + row.count, 0) : -1;
    console.warn(`Reveal ${round}: ${block?.type === "tally" ? block.rows.map((row) => `${row.label} ${row.count}`).join(", ") : "none"}`);
    if (counted !== phones.length) {
        throw new Error(`Round ${round} counted ${counted} taps, expected ${phones.length}.`);
    }
}
await waitFor(() => screen.shell?.gameOver === true, "the end of the game");
const final: SceneBlock | undefined = tallyOnScreen();
const total: number = final?.type === "tally" ? final.rows.reduce((sum: number, row) => sum + row.count, 0) : -1;
console.warn(`Totals: ${final?.type === "tally" ? final.rows.map((row) => `${row.label} ${row.count}`).join(", ") : "none"}`);
if (total !== tapped) {
    throw new Error(`The totals add up to ${total}, expected ${tapped}.`);
}
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 6000); });
await phones[0]?.chooseRow(screen, "Back to the shelf");
await waitFor(() => screen.shell?.screen === "home", "the shelf");
console.warn("PASS");
process.exit(0);
