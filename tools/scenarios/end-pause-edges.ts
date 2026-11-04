// Five phones and a TV through the awkward cases of pausing and ending: a holder who drops or leaves,
// someone joining late, phones that come back, two people pressing at once, and ending while the
// host is mid-reply. Every phone and the TV must agree afterwards. Prints each check and PASS.
// Usage: GAME_ROOM_TEXT_ONLY=1 npm run room, then node tools/scenarios/end-pause-edges.ts

import type { PadView } from "../../shared/shell.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** The menu row a phone's confirm button means. */
const END_FOR_EVERYONE_ROW: number = 1;

const screen: FakeScreen = new FakeScreen();
const failures: string[] = [];

/**
 * Waits a moment.
 * @param milliseconds how long.
 */
async function wait(milliseconds: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); });
}

/**
 * Records one check, carrying on either way so a run shows everything that's wrong.
 * @param passed whether it held.
 * @param what what should be true.
 */
function check(passed: boolean, what: string): void {
    if (passed === false) {
        failures.push(what);
    }
    console.warn(`${passed === true ? "ok" : "FAIL"}: ${what}`);
}

/**
 * A phone's pad, read fresh, since waiting can change it.
 * @param phone the phone.
 * @returns its pad.
 */
function pad(phone: FakePhone): PadView | undefined {
    return phone.view?.pad;
}

/**
 * Whether a phone shows exactly what a phone on the shelf should, with nothing of the game left.
 * @param phone the phone.
 * @returns true when it does.
 */
function onShelf(phone: FakePhone): boolean {
    const view = phone.view;
    return view !== null && view.pad.axis === "x" && view.pad.pausedBy === "" && view.pad.confirmEnd === false && view.pad.watching === false && view.pad.startCard.length === 0 && view.controls.length === 0 && view.turn === null && view.status !== "Paused";
}

/**
 * Drops a phone and brings it straight back to the same seat.
 * @param phone the phone.
 * @param name its name.
 * @returns the phone that came back.
 */
async function reconnect(phone: FakePhone, name: string): Promise<FakePhone> {
    const seat: { playerId: string; resumeToken: string } = { playerId: phone.playerId, resumeToken: phone.resumeToken };
    phone.close();
    await waitFor(() => screen.shell?.seats.find((candidate) => candidate.playerId === seat.playerId)?.connected === false, `${name} to drop`);
    const back: FakePhone = new FakePhone(screen.code, name, seat);
    await waitFor(() => back.view !== null, `${name} to come back`);
    return back;
}

await waitFor(() => screen.code !== "", "a room");
let ana: FakePhone = new FakePhone(screen.code, "Ana");
await waitFor(() => screen.shell?.seats.length === 1, "Ana to sit down first");
let ben: FakePhone = new FakePhone(screen.code, "Ben");
let cy: FakePhone = new FakePhone(screen.code, "Cy");
const dee: FakePhone = new FakePhone(screen.code, "Dee");
await waitFor(() => screen.shell?.seats.length === 4 && [ana, ben, cy, dee].every((phone: FakePhone) => phone.view !== null), "four phones");

// One game: Resume by someone else, a late joiner, and coming back during a pause.
await ana.startGame(screen, "Twenty Doors");
await waitFor(() => pad(ana)?.backLabel === "Pause", "the game");
const eli: FakePhone = new FakePhone(screen.code, "Eli");
await waitFor(() => pad(eli)?.watching === true, "Eli to join late");
check(pad(eli)?.backLabel === null && pad(eli)?.canDrive === false, "a late joiner can't pause");
eli.nav({ kind: "back" });
await wait(300);
check(screen.shell?.screen === "play", "a late joiner's Pause does nothing");
eli.say("pause the game");
await wait(800);
check(screen.shell?.screen === "play", "a late joiner saying pause does nothing");
ana.nav({ kind: "back" });
await waitFor(() => screen.shell?.screen === "pause", "the pause");
await wait(300);
check([ana, ben, cy, dee, eli].every((phone: FakePhone) => pad(phone)?.pausedBy === "Ana") && screen.shell?.pausedBy === "Ana", "all five phones and the TV say Ana paused");
check(pad(eli)?.backLabel === null && pad(ben)?.backLabel === null, "only the holder sees Resume");
ben.nav({ kind: "back" });
ben.nav({ kind: "choose", index: 0 });
eli.nav({ kind: "choose", index: 0 });
await wait(400);
check(screen.shell?.screen === "pause", "Resume by anyone else does nothing");
cy = await reconnect(cy, "Cy");
check(pad(cy)?.pausedBy === "Ana" && pad(cy)?.backLabel === null, "a phone coming back during a pause lands on the pause, without Resume");
ana.nav({ kind: "choose", index: 0 });
await waitFor(() => screen.shell?.screen === "play", "the holder's resume");
await wait(300);
check([ana, ben, cy, dee, eli].every((phone: FakePhone) => pad(phone)?.pausedBy === ""), "resume clears the pause on all five phones");

// The holder drops in play, someone takes it, and the holder comes back without it.
const anaSeat: { playerId: string; resumeToken: string } = { playerId: ana.playerId, resumeToken: ana.resumeToken };
ana.close();
await waitFor(() => screen.shell?.seats.find((seat) => seat.name === "Ana")?.connected === false, "Ana to drop");
await wait(300);
check(pad(ben)?.canDrive === true && pad(ben)?.backLabel === "Pause" && pad(eli)?.canDrive === false, "a holder dropping in play frees the controller, not for a watcher");
ben.nav({ kind: "back" });
await waitFor(() => screen.shell?.screen === "pause", "Ben's pause");
await wait(300);
check(screen.shell?.pausedBy === "Ben" && pad(ben)?.backLabel === "Resume" && pad(cy)?.backLabel === null, "whoever takes it holds it");
ana = new FakePhone(screen.code, "Ana", anaSeat);
await waitFor(() => ana.view !== null, "Ana to come back");
check(pad(ana)?.pausedBy === "Ben" && pad(ana)?.backLabel === null && pad(ana)?.driving === false, "the old holder comes back without the controller");

// The holder drops during a pause: the game must not be stuck.
const benSeat: { playerId: string; resumeToken: string } = { playerId: ben.playerId, resumeToken: ben.resumeToken };
ben.close();
await waitFor(() => screen.shell?.seats.find((seat) => seat.name === "Ben")?.connected === false, "Ben to drop");
await wait(300);
check(pad(cy)?.backLabel === "Resume" && pad(eli)?.backLabel === null, "a holder dropping during a pause lets someone playing resume");

// Two phones press End at once, with the controller free: one gets the question, nobody ends yet.
const endRow: number = screen.shell?.menu.indexOf("End the game") ?? -1;
cy.nav({ kind: "choose", index: endRow });
dee.nav({ kind: "choose", index: endRow });
await wait(400);
check(screen.shell?.screen === "confirmEnd", "End pressed twice at once asks, and doesn't end");
check(pad(cy)?.confirmEnd === true && pad(dee)?.confirmEnd === false, "only the first gets the question");
dee.nav({ kind: "choose", index: END_FOR_EVERYONE_ROW });
await wait(300);
check(screen.shell?.screen === "confirmEnd", "the second can't answer it");

// Cancel, then not answering at all.
cy.nav({ kind: "choose", index: 0 });
await wait(800);
check(screen.shell?.screen === "pause" && pad(cy)?.confirmEnd === false && screen.shell.pausedBy === "Ben", "Cancel goes back to the pause");
cy.nav({ kind: "choose", index: endRow });
await waitFor(() => pad(cy)?.confirmEnd === true, "the question again");
await wait(8500);
check(screen.shell?.screen === "pause" && pad(cy)?.confirmEnd === false, "not answering for about 8 s cancels");

// The holder leaves while being asked: the next holder must not inherit the question.
if (screen.shell?.screen !== "confirmEnd") {
    cy.nav({ kind: "choose", index: endRow });
}
await waitFor(() => pad(cy)?.confirmEnd === true, "the question once more");
cy.leave();
await waitFor(() => screen.shell?.seats.length === 4, "Cy to go");
await wait(300);
check(screen.shell?.screen === "pause" && [ana, dee].every((phone: FakePhone) => pad(phone)?.confirmEnd === false), "a holder leaving mid-question takes the question with them");
const heir: FakePhone = pad(ana)?.driving === true ? ana : dee;
check(pad(heir)?.driving === true && pad(heir)?.backLabel === "Resume", "someone playing holds the controller after that");
check(pad(eli)?.driving === false, "the watcher doesn't");

// Coming back to a dropped seat after the end, and a double tap on the confirm button.
ben = new FakePhone(screen.code, "Ben", benSeat);
await waitFor(() => ben.view !== null, "Ben to come back");
const deeSeat: { playerId: string; resumeToken: string } = { playerId: dee.playerId, resumeToken: dee.resumeToken };
const deeIsHeir: boolean = heir === dee;
if (deeIsHeir === false) {
    dee.close();
    await waitFor(() => screen.shell?.seats.find((seat) => seat.name === "Dee")?.connected === false, "Dee to drop before the end");
}
heir.nav({ kind: "choose", index: endRow });
await waitFor(() => pad(heir)?.confirmEnd === true, "the final question");
heir.nav({ kind: "choose", index: END_FOR_EVERYONE_ROW });
heir.nav({ kind: "choose", index: END_FOR_EVERYONE_ROW });
await waitFor(() => screen.shell?.screen !== "confirmEnd", "the end");
await wait(500);
check(screen.shell?.screen === "home", "a double tap on the confirm button ends up on the shelf, nowhere else");
const here: FakePhone[] = deeIsHeir === true ? [ana, ben, dee, eli] : [ana, ben, eli];
check(here.every(onShelf) === true, "every phone there has nothing of the game left, the watcher too");
if (deeIsHeir === false) {
    const deeBack: FakePhone = new FakePhone(screen.code, "Dee", deeSeat);
    await waitFor(() => deeBack.view !== null, "Dee to come back");
    check(onShelf(deeBack) === true, "a phone coming back after an end lands on the shelf");
    here.push(deeBack);
}

// Ending while the host is working on a reply.
await wait(5500);
const holder: FakePhone = here[0] ?? ana;
await holder.startGame(screen, "Twenty Doors");
await waitFor(() => pad(holder)?.backLabel === "Pause", "a second game");
await wait(2000);
holder.say("Is it bigger than a loaf of bread?");
await waitFor(() => screen.thinking === true, "the host to start on a reply");
const heardBefore: number = screen.hostLines.length;
holder.nav({ kind: "back" });
await waitFor(() => screen.shell?.screen === "pause", "a pause");
await holder.chooseRow(screen, "End the game");
await waitFor(() => pad(holder)?.confirmEnd === true, "the question");
holder.nav({ kind: "choose", index: END_FOR_EVERYONE_ROW });
await waitFor(() => screen.shell?.screen === "home", "the shelf");
await wait(9000);
check(screen.thinking === false, "the host isn't left thinking after an end");
console.warn(`after the end the host said: ${JSON.stringify(screen.hostLines.slice(heardBefore))}`);
check(here.every(onShelf) === true, "all phones are still on the shelf a while later");

// By voice: the holder's second saying ends it for everyone, anyone else's does nothing.
await wait(5500);
await holder.startGame(screen, "Twenty Doors");
await waitFor(() => pad(holder)?.backLabel === "Pause", "a third game");
await wait(1500);
const other: FakePhone = here[1] ?? ben;
const late: FakePhone = new FakePhone(screen.code, "Fay");
await waitFor(() => pad(late)?.watching === true, "Fay to join late");
other.say("end the game");
await wait(800);
other.say("end the game");
await wait(800);
late.say("end the game");
await wait(500);
late.say("end the game");
await wait(800);
check(screen.shell?.screen === "play", "voice end from someone else, or a watcher, said twice, does nothing");
holder.say("end the game");
await wait(800);
check(screen.shell?.screen === "play", "the holder saying it once does nothing yet");
holder.say("end the game");
await waitFor(() => screen.shell?.screen === "home", "the voice end");
await wait(400);
check([...here, late].every(onShelf) === true, "voice end lands every phone on the shelf, the late joiner too");

// Leaving is for yourself: the game carries on for everyone else.
await wait(5500);
await holder.startGame(screen, "Twenty Doors");
await waitFor(() => pad(holder)?.backLabel === "Pause", "a fourth game");
await wait(500);
const seatsBefore: number = screen.shell?.seats.length ?? 0;
holder.leave();
await waitFor(() => screen.shell?.seats.length === seatsBefore - 1, "the holder to leave");
await wait(400);
check(screen.shell?.screen === "play", "the holder leaving doesn't end it for the others");
const next: FakePhone | undefined = [...here, late].find((phone: FakePhone) => pad(phone)?.driving === true);
check(next !== undefined && pad(next)?.watching === false && pad(next)?.backLabel === "Pause", "the controller passes to someone playing");

console.warn(failures.length === 0 ? "PASS" : `FAILED ${failures.length}:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
