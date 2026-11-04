// Plays a whole game of Blank Verdict from a script with four fake phones. The first player chooses
// the tone; every round everyone but the judge plays a card, the judge waits out the host's reading
// and picks, and the script checks the rules from the outside: each phone holds its own cards and
// never another's, the TV shows no name beside a play until the reveal, the judge rotates through
// every seat, the winner on the TV is the player whose card the judge picked, the points add up, and
// the final scoreboard matches. Fails on any of those. What the host says is printed, and a hand
// card spoken aloud before it is played fails the run, but the script never waits for the host and
// never judges its words: with no model keys the rules still run and the host is simply quiet.
//
// Run it:
//   GAME_ROOM_TEXT_ONLY=1 npm run room
//   ROOM_STUDIO=1 node tools/scenarios/blank-verdict.ts      (in a second terminal)
// ROOM_STUDIO=1 makes the fake screen open its room with ?studio=1, the only kind of room whose
// shelf has Blank Verdict. The game runs on real clocks, so a whole game of four takes about five
// minutes. A pass prints PASS as its last line. The room's log should also show "[studio] starting
// blueprint blankVerdict on the hand kit", which proves the blueprint version is the one that ran.
//
// This is test tooling, not the server: it prints names, cards and everything the host says to the
// terminal it runs in, which the room's own log never does. Don't paste its output anywhere public.

import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** One fake player. */
interface Seat {
    name: string;
    phone: FakePhone;
    /** What they are playing this round, once they have played it. */
    played: string;
}

/** The names, in the order they join, which is the order they sit. */
const NAMES: readonly string[] = ["Teacup", "Spoon", "Candle", "Saucer"];

/**
 * Every word a phone shows, as one string.
 * @param phone the phone.
 * @returns its controls as text.
 */
function shownOn(phone: FakePhone): string {
    return JSON.stringify(phone.view?.controls ?? []);
}

/**
 * The labels on a phone's choice buttons, enabled or not.
 * @param phone the phone.
 * @returns the labels.
 */
function labelsOn(phone: FakePhone): string[] {
    const controls: Control[] = phone.view?.controls ?? [];
    return controls.flatMap((control: Control) => (control.type === "choice" || control.type === "buttons" ? control.options.map((option) => option.label) : []));
}

/**
 * Every word the TV shows, as one string.
 * @param screen the TV.
 * @returns the scene as text.
 */
function shownOnTv(screen: FakeScreen): string {
    return JSON.stringify(screen.scene?.blocks ?? []);
}

/**
 * The text of the TV's blocks of one type.
 * @param screen the TV.
 * @param type the block type.
 * @returns the texts, in order.
 */
function textsOf(screen: FakeScreen, type: "text" | "title"): string[] {
    return (screen.scene?.blocks ?? []).filter((block: SceneBlock) => block.type === type).map((block: SceneBlock) => (block.type === "text" || block.type === "title" ? block.text : ""));
}

/**
 * The kicker of the TV's title.
 * @param screen the TV.
 * @returns the kicker, or an empty string.
 */
function kickerOf(screen: FakeScreen): string {
    const title: SceneBlock | undefined = screen.scene?.blocks.find((block: SceneBlock) => block.type === "title");
    return title?.type === "title" ? title.kicker ?? "" : "";
}

/**
 * The scores on the TV's tally, by name.
 * @param screen the TV.
 * @returns the scores.
 */
function tallyOn(screen: FakeScreen): Record<string, number> {
    const tally: SceneBlock | undefined = screen.scene?.blocks.find((block: SceneBlock) => block.type === "tally");
    return tally?.type === "tally" ? Object.fromEntries(tally.rows.map((row) => [row.label, row.count])) : {};
}

/**
 * Pauses.
 * @param milliseconds how long.
 */
async function pause(milliseconds: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); });
}

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const seats: Seat[] = [];
for (const name of NAMES) {
    seats.push({ name, phone: new FakePhone(screen.code, name), played: "" });
    await waitFor(() => screen.shell?.seats.length === seats.length, `${name} to join`);
}
const [chooser, ...others] = seats;
if (chooser === undefined) {
    throw new Error("No seats.");
}

const gameStart: number = screen.hostLines.length;
await chooser.phone.startGame(screen, "Blank Verdict");
await waitFor(() => chooser.phone.options().length === 2, "the tone buttons on the first player's phone");
if (others.some((seat: Seat) => seat.phone.options().length > 0) === true) {
    throw new Error("Someone besides the first player was offered the tone.");
}
console.warn(`Tone offered: ${labelsOn(chooser.phone).join(" | ")}`);
chooser.phone.press("tone:party");
await waitFor(() => (screen.scene?.blocks.some((block: SceneBlock) => block.type === "progress") ?? false) === true, "round one to open");

const rounds: number = NAMES.length * 2;
const judges: string[] = [];
const wins: Record<string, number> = Object.fromEntries(NAMES.map((name: string) => [name, 0]));
let hostLinesBeforeRound: number = gameStart;

for (let round = 1; round <= rounds; round += 1) {
    await waitFor(() => kickerOf(screen) === `Round ${round} of ${rounds}`, `round ${round} on the TV`);
    const judge: Seat | undefined = seats.find((seat: Seat) => shownOn(seat.phone).includes("You judge this round") === true);
    if (judge === undefined) {
        throw new Error(`Round ${round}: no phone says it is judging.`);
    }
    judges.push(judge.name);
    const players: Seat[] = seats.filter((seat: Seat) => seat !== judge);
    await waitFor(() => players.every((seat: Seat) => seat.phone.options().length >= 3), "a hand on every player's phone");
    const prompt: string = textsOf(screen, "title")[0] ?? "";

    // Each player's hand is their own: nothing in it shows on any other phone or on the TV.
    const hands: Map<string, string[]> = new Map(players.map((seat: Seat) => [seat.name, labelsOn(seat.phone)]));
    const leaksFrom = (): string[] => {
        const leaks: string[] = [];
        for (const [owner, hand] of hands) {
            for (const card of hand) {
                const elsewhere: string[] = [...seats.filter((seat: Seat) => seat.name !== owner).map((seat: Seat) => shownOn(seat.phone)), shownOnTv(screen)];
                if (elsewhere.some((shown: string) => shown.includes(JSON.stringify(card).slice(1, -1)) === true) === true) {
                    leaks.push(`${owner}'s card "${card}"`);
                }
            }
        }
        return leaks;
    };
    const handSizes: number[] = [...hands.values()].map((hand: string[]) => hand.length);
    if (new Set([...hands.values()].flat()).size !== handSizes.reduce((sum: number, size: number) => sum + size, 0)) {
        throw new Error(`Round ${round}: two hands share a card.`);
    }
    const early: string[] = leaksFrom();
    if (early.length > 0) {
        throw new Error(`Round ${round}: a hand reached another screen: ${early.join("; ")}`);
    }

    // Everyone but the judge plays their first, second, third... card, so different cards win over time.
    for (const [index, seat] of players.entries()) {
        const hand: string[] = hands.get(seat.name) ?? [];
        seat.played = hand[(round + index) % hand.length] ?? "";
        seat.phone.press(seat.played);
        // The last card in moves the game on to judging, so that phone says "Your play is in" instead.
        await waitFor(() => shownOn(seat.phone).includes(`You played: ${seat.played}`) === true || shownOn(seat.phone).includes("Your play is in") === true, `${seat.name}'s card to be taken`);
        hands.set(seat.name, hand.filter((card: string) => card !== seat.played));
        const mid: string[] = leaksFrom();
        if (mid.length > 0) {
            throw new Error(`Round ${round}: a card in hand reached another screen after a play: ${mid.join("; ")}`);
        }
        if (index < players.length - 1 && shownOnTv(screen).includes(JSON.stringify(seat.played).slice(1, -1)) === true) {
            throw new Error(`Round ${round}: ${seat.name}'s face-down card reached the TV before everyone had played.`);
        }
    }

    // The judge sees the plays but cannot choose until the host has had time to read them.
    await waitFor(() => labelsOn(judge.phone).length === players.length, "the plays on the judge's phone");
    const choiceBefore: number = judge.phone.options().length;
    if (choiceBefore !== 0) {
        throw new Error(`Round ${round}: the judge could choose while the host was still reading.`);
    }
    const onTv: string[] = textsOf(screen, "text").filter((text: string) => /^\d+\. /.test(text) === true);
    if (onTv.length !== players.length) {
        throw new Error(`Round ${round}: the TV shows ${onTv.length} plays, expected ${players.length}.`);
    }
    if (NAMES.some((name: string) => onTv.some((line: string) => line.includes(name) === true) === true) === true) {
        throw new Error(`Round ${round}: a name is shown beside a play before the reveal.`);
    }
    await waitFor(() => judge.phone.options().length === players.length, "the judge to be allowed to choose");
    const choices: { id: string; label: string }[] = judge.phone.options();
    const chosen: { id: string; label: string } | undefined = choices[(round * 2) % choices.length];
    if (chosen === undefined) {
        throw new Error(`Round ${round}: the judge has nothing to choose.`);
    }
    const chosenCard: string = chosen.label.replace(/^\d+\. /, "");
    const winner: Seat | undefined = players.find((seat: Seat) => seat.played === chosenCard);
    if (winner === undefined) {
        throw new Error(`Round ${round}: nobody played "${chosenCard}".`);
    }
    judge.phone.press(chosen.id);

    // A beat first: the TV says the verdict is in and names nobody. Then the reveal.
    await waitFor(() => textsOf(screen, "text").includes("The verdict is in.") === true || kickerOf(screen).endsWith("takes the round") === true, "the beat");
    if (kickerOf(screen).endsWith("takes the round") === true && textsOf(screen, "text").includes("The verdict is in.") === false) {
        console.warn(`Round ${round}: the beat passed before it could be seen; the reveal is checked anyway.`);
    }
    await waitFor(() => kickerOf(screen) === `${winner.name} takes the round`, `${winner.name} to be revealed`);
    wins[winner.name] = (wins[winner.name] ?? 0) + 1;
    const sentence: string = textsOf(screen, "title")[0] ?? "";
    if (sentence !== prompt.split("___").join(chosenCard.replace(/[.?]+$/, ""))) {
        throw new Error(`Round ${round}: the TV's sentence is "${sentence}", expected the prompt with "${chosenCard}" in the gap.`);
    }
    const scores: Record<string, number> = tallyOn(screen);
    for (const name of NAMES) {
        if (scores[name] !== wins[name]) {
            throw new Error(`Round ${round}: the TV says ${name} has ${scores[name] ?? "nothing"}, expected ${wins[name] ?? 0}.`);
        }
    }
    if (shownOn(winner.phone).includes("Yours won") === false) {
        throw new Error(`Round ${round}: the winner's phone doesn't say so.`);
    }
    console.warn(`Round ${round}: ${judge.name} judged; ${winner.name} won with "${chosenCard}".`);

    // The host may never have said a card still in someone's hand.
    const spokenThisRound: string[] = screen.hostLines.slice(hostLinesBeforeRound);
    const said = (card: string): boolean => spokenThisRound.some((line: string) => line.toLowerCase().includes(card.toLowerCase()) === true);
    const spoilt: string[] = [...hands.values()].flat().filter(said);
    if (spoilt.length > 0) {
        throw new Error(`Round ${round}: the host said cards that were still in hands: ${spoilt.join("; ")}`);
    }
    hostLinesBeforeRound = screen.hostLines.length;
    if (round < rounds) {
        await waitFor(() => kickerOf(screen) === `Round ${round + 1} of ${rounds}`, `round ${round + 1}`);
    }
}

await waitFor(() => screen.shell?.gameOver === true, "the final scores");
const finalScores: Record<string, number> = tallyOn(screen);
const expected: string = NAMES.map((name: string) => `${name}=${wins[name] ?? 0}`).join(" ");
if (NAMES.some((name: string) => finalScores[name] !== wins[name]) === true) {
    throw new Error(`The final scores on the TV (${JSON.stringify(finalScores)}) differ from the wins counted here (${expected}).`);
}
const turns: Record<string, number> = {};
for (const judge of judges) {
    turns[judge] = (turns[judge] ?? 0) + 1;
}
if (NAMES.some((name: string) => turns[name] !== 2) === true) {
    throw new Error(`Every player should have judged twice at a table of four: ${JSON.stringify(turns)}.`);
}
console.warn(`Final: ${expected}. Title: ${textsOf(screen, "title").join(" ")}.`);
console.warn(`The host spoke ${screen.hostLines.length - gameStart} lines${screen.hostLines.length === gameStart ? " (no model keys, so none are expected)" : ""}.`);
await pause(6000);
await chooser.phone.chooseRow(screen, "Back to the shelf");
await waitFor(() => screen.shell?.screen === "home", "the shelf");
console.warn("PASS");
process.exit(0);
