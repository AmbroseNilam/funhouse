// Three phones: only whoever holds the controller can pause, resume or end for everyone, and when a
// game ends every phone and the TV land on the shelf together, with the controller free.
// Usage: GAME_ROOM_TEXT_ONLY=1 npm run room, then node --env-file-if-exists=.env tools/scenarios/end-and-pause.ts
// A pass prints PASS.

import type { PadView, ShellScreen } from "../../shared/shell.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/**
 * Waits a moment.
 * @param milliseconds how long.
 */
async function pause(milliseconds: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); });
}

const screen: FakeScreen = new FakeScreen();

/**
 * Which screen the TV is on, read fresh, since waiting can change it.
 * @returns the screen.
 */
function screenNow(): ShellScreen | undefined {
    return screen.shell?.screen;
}

/**
 * What a phone's surface can do, read fresh.
 * @param phone the phone.
 * @returns its pad.
 */
function padOf(phone: FakePhone): PadView | undefined {
    return phone.view?.pad;
}

await waitFor(() => screen.code !== "", "a room");
const [ana, ben, cy] = ["Ana", "Ben", "Cy"].map((name: string) => new FakePhone(screen.code, name));
if (ana === undefined || ben === undefined || cy === undefined) {
    throw new Error("Expected three phones.");
}
await waitFor(() => screen.shell?.seats.length === 3, "every phone to join");
await ana.startGame(screen, "Twenty Doors");
await waitFor(() => ana.view?.pad.backLabel === "Pause", "the holder to be able to pause");

ben.nav({ kind: "back" });
await pause(800);
if (screenNow() !== "play" || padOf(ben)?.backLabel !== null) {
    throw new Error("Someone without the controller could pause.");
}
console.warn("ok: Ben can't pause");

ben.say("end the game");
await pause(3000);
ben.say("end the game");
await pause(3000);
if (screenNow() !== "play") {
    throw new Error("Someone without the controller ended the game by voice.");
}
console.warn("ok: Ben can't end it by voice");

ana.nav({ kind: "back" });
await waitFor(() => screen.shell?.screen === "pause", "the pause");
await waitFor(() => screen.shell?.pausedBy === "Ana" && ben.view?.pad.pausedBy === "Ana" && cy.view?.pad.pausedBy === "Ana", "everyone to see who paused");
if (padOf(ben)?.canDrive === true) {
    throw new Error("Someone without the controller could use the pause menu.");
}
console.warn("ok: everyone sees Paused by Ana");

await ana.chooseRow(screen, "Resume");
await waitFor(() => screen.shell?.screen === "play" && ben.view?.pad.pausedBy === "", "the game to resume for everyone");
console.warn("ok: Ana resumed it");

await ana.fromPauseMenu(screen, "End the game");
await waitFor(() => screen.shell?.screen === "confirmEnd" && ana.view?.pad.confirmEnd === true, "the question on Ana's phone");
if (padOf(ben)?.confirmEnd === true) {
    throw new Error("The question went to the wrong phone.");
}
ben.nav({ kind: "choose", index: 1 });
await pause(800);
if (screenNow() !== "confirmEnd") {
    throw new Error("Someone else answered the question.");
}
ana.nav({ kind: "choose", index: 1 });
await waitFor(() => screen.shell?.screen === "home", "the TV to reach the shelf");
await waitFor(() => [ana, ben, cy].every((phone: FakePhone) => phone.view?.pad.axis === "x" && phone.view.pad.canDrive === true && phone.view.controls.length === 0), "every phone to reach the shelf, able to drive");
console.warn("ok: everyone is back at the shelf together, and nobody is stuck");
console.warn("PASS");
process.exit(0);
