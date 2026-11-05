// Someone sits down during each shelf game: they're told they're watching, nothing in the game is theirs
// to touch, and the next game seats them. Prints each check and PASS.
// Usage: GAME_ROOM_TEXT_ONLY=1 npm run room, then node tools/scenarios/late-join.ts

import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

const GAMES: readonly [string, number][] = [["Twenty Doors", 3], ["Quizmaster", 3], ["Same Page", 4], ["Painted Whispers", 4], ["Werewolf", 5]];
const NAMES: readonly string[] = ["Ana", "Ben", "Cy", "Dee", "Eli"];

/**
 * Waits a moment.
 * @param milliseconds how long.
 */
async function wait(milliseconds: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); });
}

for (const [game, count] of GAMES) {
    const screen: FakeScreen = new FakeScreen();
    await waitFor(() => screen.code !== "", "a room");
    const phones: FakePhone[] = [];
    for (const name of NAMES.slice(0, count)) {
        phones.push(new FakePhone(screen.code, name));
        await waitFor(() => screen.shell?.seats.length === phones.length, `${name} to sit down`);
    }
    const holder: FakePhone | undefined = phones[0];
    if (holder === undefined) {
        throw new Error("Expected a holder.");
    }
    await holder.startGame(screen, game);
    await wait(1000);
    const late: FakePhone = new FakePhone(screen.code, "Lou");
    await waitFor(() => late.view?.pad.watching === true, `Lou to be watching ${game}`);
    if (late.view?.controls.length !== 0 || late.view.turn !== null || late.view.pad.canSelect === true) {
        throw new Error(`Lou has something to act on in ${game}: ${JSON.stringify(late.view?.controls)}`);
    }
    console.warn(`ok: ${game} gives a late joiner nothing to act on`);
    holder.nav({ kind: "back" });
    await waitFor(() => screen.shell?.screen === "pause", "the pause");
    await holder.chooseRow(screen, "End the game");
    await waitFor(() => holder.view?.pad.confirmEnd === true, "the question");
    holder.nav({ kind: "choose", index: 1 });
    await waitFor(() => screen.shell?.screen === "home" && late.view?.pad.watching === false, "the shelf");
    console.warn(`ok: after ${game}, Lou is at the table for the next one`);
    [late, ...phones].forEach((phone: FakePhone) => { phone.close(); });
}
console.warn("PASS");
process.exit(0);
