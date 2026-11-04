// Quizmaster with four answers, through the real room: every phone taps or speaks, a tap is locked in,
// the question waits for everyone, and nothing on a phone or the TV says which answer is right.
// Usage: GAME_ROOM_TEXT_ONLY=1 npm run room, then node --env-file-if-exists=.env tools/scenarios/quiz-choices.ts
// A pass prints PASS.

import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const [sam, alex] = ["Sam", "Alex"].map((name: string) => new FakePhone(screen.code, name));
if (sam === undefined || alex === undefined) {
    throw new Error("Expected two phones.");
}
await waitFor(() => screen.shell?.seats.length === 2, "both phones to join");
await waitFor(() => screen.shell?.screen === "home" && sam.view !== null, "the shelf");
sam.nav({ kind: "step", delta: 1 });
await waitFor(() => screen.shell?.focus === 1, "the highlight to move");
sam.nav({ kind: "select" });
await waitFor(() => screen.shell?.screen === "game", "the game's page");
sam.nav({ kind: "select" });
await waitFor(() => screen.shell?.screen === "pick", "the pick");
sam.nav({ kind: "choose", index: screen.shell?.menu.indexOf("Animals") ?? 0 });
await waitFor(() => screen.shell?.screen === "startCard", "the how-to card");
sam.nav({ kind: "select" });

/**
 * The four answers on the TV right now.
 * @returns them, or none between questions.
 */
function onTv(): string[] {
    const block = screen.scene?.blocks.find((candidate) => candidate.type === "choices");
    return block?.type === "choices" ? block.options : [];
}

let before: string = "";
for (let round = 1; round <= 6; round += 1) {
    const sameOn = (phone: FakePhone): boolean => phone.options().map((option) => option.label).join() === onTv().join();
    await waitFor(() => onTv().length === 4 && screen.title() !== before && sameOn(sam) === true && sameOn(alex) === true, `question ${round}'s four answers on the TV and both phones`);
    console.warn(`Q${round}: ${screen.title()} | ${onTv().join(" | ")}`);
    const asked: string = screen.title();
    before = asked;
    sam.press(sam.options()[0]?.id ?? "");
    await waitFor(() => sam.options().length === 0, "Sam's tap to lock in");
    if (screen.title() !== asked) {
        throw new Error("The question moved on before everyone had answered.");
    }
    if (round === 2) {
        // Speaking still works: the host hears the answer and rules on it.
        const said: string = (alex.options()[1]?.label ?? "").replace(/^[A-D]\. /, "");
        alex.say(`I think it's ${said}`);
    }
    if (round !== 2) {
        alex.press(alex.options()[round % 4]?.id ?? "");
    }
    await waitFor(() => screen.title() !== asked || screen.shell?.gameOver === true, "the question to move on");
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 1500); });
    console.warn(`  host: ${screen.hostLines.at(-1)?.slice(0, 90) ?? ""}`);
}
await waitFor(() => screen.shell?.gameOver === true, "the end");
console.warn(`End: ${screen.title()} | ${JSON.stringify(screen.scene?.blocks.filter((block) => block.type === "text"))}`);
console.warn("PASS");
process.exit(0);
