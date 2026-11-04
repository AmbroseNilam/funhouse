// Opens a table for a real outside agent: one scripted person, a built-in guest, and whatever agent is
// given the link this writes to a file. The script waits for that agent to sit down, starts Same Page and
// plays the person's cards. Run it with the room started with AGENTS_ON=1, then give an agent the words:
//   ROOM_URL=ws://localhost:8740 AGENT_LINK_FILE=<a file> node tools/scenarios/agent-external.ts
// It prints PASS when the game ends, whether or not the agent played well; read what it did in the output.

import { writeFileSync } from "node:fs";
import type { Control } from "../../shared/controls.ts";
import type { ShellView } from "../../shared/shell.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** How long the agent gets to sit down. */
const SIT_DOWN_MILLISECONDS: number = 300000;

const screen: FakeScreen = new FakeScreen();

/**
 * The console as the TV has it now.
 * @returns the console.
 */
function shell(): ShellView | null {
    return screen.shell;
}

await waitFor(() => screen.code !== "", "a room");
const person: FakePhone = new FakePhone(screen.code, "Teacup");
await waitFor(() => shell()?.seats.length === 1, "the person");
person.guest("inviteAgent");
await waitFor(() => (person.view?.guests.agents?.link ?? "") !== "", "the link");
writeFileSync(process.env.AGENT_LINK_FILE ?? "agent-link.txt", `${person.view?.guests.agents?.link ?? ""}\n`);
console.warn("Link written. Waiting for the agent.");
const asked: number = Date.now();
while (shell()?.seats.some((seat) => seat.agent === true) !== true) {
    if (Date.now() - asked > SIT_DOWN_MILLISECONDS) {
        throw new Error("No agent sat down.");
    }
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 500); });
}
console.warn("The agent sat down.");
const GAME_ID: string = process.env.AGENT_GAME ?? "samePage";
if (GAME_ID === "samePage") {
    person.guest("add");
    await waitFor(() => shell()?.seats.length === 3, "a guest");
}
const target: number = shell()?.games.findIndex((game) => game.id === GAME_ID) ?? -1;
person.nav({ kind: "step", delta: target - (shell()?.focus ?? 0) });
await waitFor(() => shell()?.focus === target, "the highlight");
person.nav({ kind: "select" });
await waitFor(() => shell()?.screen === "game", "the page");
await waitFor(() => shell()?.games[target]?.blocked === null, "room to start");
person.nav({ kind: "select" });
await waitFor(() => shell()?.screen !== "game", "the start");
while (shell()?.screen !== "play") {
    person.nav({ kind: "select" });
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 800); });
}
console.warn(`Started ${GAME_ID}.`);
const answered: Set<string> = new Set();
const seen: Set<string> = new Set();
while (shell()?.gameOver !== true) {
    const box: Control | undefined = person.view?.controls.find((control: Control) => control.type === "textInput");
    if (box?.type === "textInput" && answered.has(box.id) === false) {
        answered.add(box.id);
        person.answer(box.id, "pizza");
    }
    for (const block of screen.scene?.blocks ?? []) {
        const line: string = JSON.stringify(block);
        if (seen.has(line) === false && block.type !== "timer") {
            seen.add(line);
            console.warn(`TV ${line.slice(0, 240)}`);
        }
    }
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 500); });
}
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 8000); });
console.warn(`END ${JSON.stringify(screen.scene?.blocks ?? []).slice(0, 800)}`);
console.warn("PASS");
process.exit(0);
