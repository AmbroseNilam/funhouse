// Quizmaster with four answers, through the real room and host: a tap, a typed answer and a spoken one
// each score, points wait for the reveal, the question waits for everyone, and the phones and TV match.
// The topic is typed, on easy sums, so the script knows the right answer.
// Usage: GAME_ROOM_TEXT_ONLY=1 npm run room, then node --env-file-if-exists=.env tools/scenarios/quiz-choices.ts
// A pass prints PASS.

import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const [sam, alex] = ["Sam", "Alex"].map((name: string) => new FakePhone(screen.code, name));
if (sam === undefined || alex === undefined) {
    throw new Error("Expected two phones.");
}
await waitFor(() => screen.shell?.screen === "home" && sam.view !== null, "the shelf");
sam.nav({ kind: "step", delta: 1 });
await waitFor(() => screen.shell?.focus === 1, "the highlight to move");
sam.nav({ kind: "select" });
await waitFor(() => screen.shell?.screen === "game", "the game's page");
sam.nav({ kind: "select" });
await waitFor(() => screen.shell?.screen === "pick", "the pick");
sam.nav({ kind: "choose", index: screen.shell?.menu.indexOf("Say your own topic") ?? 0 });
await waitFor(() => screen.shell?.screen === "startCard", "the how-to card");
sam.nav({ kind: "select" });
await waitFor(() => screen.title() === "Choose a topic…" || screen.title() === "Quizmaster", "the topic step");
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 4000); });
sam.type("Easy plus sums, like what is 2 plus 3");
await waitFor(() => screen.shell?.screen === "setup", "setup");
sam.nav({ kind: "choose", index: screen.shell?.menu.indexOf("Just start") ?? 0 });

/**
 * The four answers on the TV right now.
 * @returns them, or none between questions.
 */
function onTv(): string[] {
    const block = screen.scene?.blocks.find((candidate) => candidate.type === "choices");
    return block?.type === "choices" ? block.options : [];
}

/**
 * What the TV says someone has scored.
 * @param name who.
 * @returns their points.
 */
function pointsOf(name: string): number {
    const title = screen.scene?.blocks.find((candidate) => candidate.type === "title");
    const match: RegExpExecArray | null = new RegExp(`${name} (\\d+)`).exec(title?.type === "title" ? title.kicker ?? "" : "");
    return Number(match?.[1] ?? "0");
}

/**
 * Works out the sum on the TV.
 * @returns the answer's text, or an empty string if it isn't a sum.
 */
function rightAnswer(): string {
    const match: RegExpExecArray | null = /(\d+) plus (\d+)/.exec(screen.title());
    return match === null ? "" : String(Number(match[1]) + Number(match[2]));
}

/**
 * Finds a phone's button for an answer.
 * @param phone the phone.
 * @param right true for the right answer, false for a wrong one.
 * @returns the button's id.
 */
function buttonFor(phone: FakePhone, right: boolean): string {
    const answer: string = rightAnswer();
    return phone.options().find((option) => option.label.endsWith(`. ${answer}`) === right)?.id ?? "";
}

let before: string = "";
let samExpected: number = 0;
let alexExpected: number = 0;
for (let round = 1; round <= 3; round += 1) {
    const sameOn = (phone: FakePhone): boolean => phone.options().map((option) => option.label).join() === onTv().join();
    await waitFor(() => onTv().length === 4 && screen.title() !== before && sameOn(sam) === true && sameOn(alex) === true, `question ${round}'s four answers on the TV and both phones`);
    const asked: string = screen.title();
    before = asked;
    console.warn(`Q${round}: ${asked} | ${onTv().join(" | ")}`);
    if (rightAnswer() === "") {
        throw new Error(`Question ${round} isn't a sum, so the script can't check it: ${asked}`);
    }
    const right: string = rightAnswer();
    if (round === 1) {
        alex.press(buttonFor(alex, true));
        alexExpected += 2;
    }
    if (round === 2) {
        alex.type(`I think it's ${right}`);
        alexExpected += 2;
    }
    if (round === 3) {
        alex.say(`I think it's ${right}`);
        alexExpected += 2;
    }
    await waitFor(() => alex.options().length === 0, `Alex's answer to lock in on question ${round}`);
    if (screen.title() !== asked) {
        throw new Error("The question moved on before everyone had answered.");
    }
    if (pointsOf("Alex") === alexExpected) {
        throw new Error("The score showed before the reveal, which gives the answer away.");
    }
    sam.press(buttonFor(sam, false));
    await waitFor(() => screen.title() !== asked, "the question to move on");
    await waitFor(() => pointsOf("Alex") === alexExpected && pointsOf("Sam") === samExpected, `the score after question ${round}: Alex ${alexExpected}, Sam ${samExpected}`);
    console.warn(`  ok: round ${round} scored; ${screen.hostLines.at(-1)?.slice(0, 80) ?? ""}`);
    samExpected += 0;
}
console.warn("PASS");
process.exit(0);
