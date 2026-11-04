// Plays a whole game of Quizmaster from a script with two fake players: a right answer, a wrong answer,
// a repeat answer, a timed-out question, a skip and a question where everyone answers. Fails if the
// host says an answer before it is revealed. Run the room with GAME_ROOM_TEXT_ONLY=1, then:
// node tools/scenarios/quizmaster.ts
// This is the open-answer game: start the room with QUIZ_OPEN_ANSWERS=1. quiz-choices.ts plays the default, with four answers.

import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** The topic: sums the script can solve from the question text, so it can answer right without seeing the answer. */
const TOPIC: string = "Easy sums: every question must be a single plus sum of two small whole numbers like what is 3 plus 4, written with digits, nothing else";

/** Number words the script understands in a question. */
const NUMBER_WORDS: string[] = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** Questions in a game. */
const QUESTION_COUNT: number = 6;

/** Seconds the rules give a question; the script waits a little longer than this for a timeout. */
const QUESTION_SECONDS: number = 30;

/** Milliseconds to let the host finish speaking before the next player talks. */
const SETTLE_MILLISECONDS: number = 2500;

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const sam: FakePhone = new FakePhone(screen.code, "Sam");
await waitFor(() => screen.shell?.seats.length === 1, "Sam to join");
const alex: FakePhone = new FakePhone(screen.code, "Alex");
await waitFor(() => alex.view !== null, "Alex to join");

/** Host lines heard while each question was open, by question number. */
const heardDuring: Map<number, string[]> = new Map();

/** The revealed answer to each question, by question number. */
const answers: Map<number, string> = new Map();

/** The text of each question, by question number. */
const questions: Map<number, string> = new Map();

/** Questions whose remaining host lines are reactions to a right answer, which may name it. */
const closed: Set<number> = new Set();

let linesSeen: number = 0;
let lastQuestion: number = 0;

/**
 * The question number on screen.
 * @returns the number, or 0 when no question is showing.
 */
function current(): number {
    const block = screen.scene?.blocks.find((candidate) => candidate.type === "progress");
    return block?.type === "progress" ? block.current : 0;
}

/**
 * A player's score on the screen.
 * @param name the player.
 * @returns their points, or -1 when they aren't listed.
 */
function scoreOf(name: string): number {
    const tally = screen.scene?.blocks.find((candidate) => candidate.type === "tally");
    return tally?.type === "tally" ? (tally.rows.find((row) => row.label === name)?.count ?? -1) : -1;
}

/**
 * Solves the arithmetic in the question on screen, left to right: plus, minus, times, divided by, half of, or double.
 * @returns the result as digits, or a guess that will be wrong when no sum is found.
 */
function solve(): string {
    watch();
    const text: string = (questions.get(current()) ?? "").toLowerCase();
    const half: RegExpMatchArray | null = text.match(/half of (\d+)/);
    if (half !== null) {
        return String(Number(half[1]) / 2);
    }
    const double: RegExpMatchArray | null = text.match(/double (\d+)/);
    if (double !== null) {
        return String(Number(double[1]) * 2);
    }
    const tokens: string[] = [...text.matchAll(/\d+|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|plus|minus|times|divided|multiplied)\b/g)].map((match) => match[0]);
    let total: number | null = null;
    let operator: string = "plus";
    for (const token of tokens) {
        const index: number = NUMBER_WORDS.indexOf(token);
        const value: number = index === -1 ? Number(token) : index;
        if (Number.isNaN(value) === true) {
            operator = token;
            continue;
        }
        if (total === null) {
            total = value;
            continue;
        }
        total = operator === "minus" ? total - value : operator === "times" || operator === "multiplied" ? total * value : operator === "divided" ? total / value : total + value;
    }
    return total === null ? "banana" : String(total);
}

/** Watches the screen: files host lines under the open question and learns each revealed answer. */
function watch(): void {
    const blocks = screen.scene?.blocks ?? [];
    const ended: boolean = blocks.some((block) => block.type === "title" && block.kicker === "Final scores");
    const number: number = ended === true ? QUESTION_COUNT : current();
    for (const block of blocks) {
        if (block.type === "title" && number > 0) {
            questions.set(number, block.text);
        }
        if (block.type === "text" && block.text.startsWith("Last answer: ") === true && number > 0) {
            answers.set(ended === true ? QUESTION_COUNT : number - 1, block.text.slice("Last answer: ".length));
        }
    }
    if (number > 0) {
        lastQuestion = number;
    }
    while (linesSeen < screen.hostLines.length) {
        const line: string = screen.hostLines[linesSeen] ?? "";
        linesSeen += 1;
        if (closed.has(lastQuestion) === false && ended === false) {
            heardDuring.set(lastQuestion, [...(heardDuring.get(lastQuestion) ?? []), line]);
        }
    }
}

setInterval(watch, 25);

/**
 * Waits for a question to be on screen and notes it before anything else happens.
 * @param number the question number.
 * @param label names the wait when it fails.
 */
async function reach(number: number, label: string): Promise<void> {
    await waitFor(() => current() === number, label);
    watch();
}

/**
 * Lets the host finish speaking, then has a player say something and waits for the host's reply.
 * @param phone who speaks.
 * @param line the words.
 * @param closes true when the line should end the question, so the host's reaction may name the answer.
 */
async function answer(phone: FakePhone, line: string, closes: boolean): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, SETTLE_MILLISECONDS); });
    await waitFor(() => screen.thinking === false, "the host to be quiet");
    if (closes === true) {
        closed.add(current());
    }
    const before: number = screen.hostLines.length;
    phone.say(line);
    await screen.nextHostLine(before);
}

await sam.startGame(screen, "Quizmaster");
await waitFor(() => screen.title() === "Quizmaster", "Quizmaster to start");
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, SETTLE_MILLISECONDS); });
const topicBefore: number = screen.hostLines.length;
sam.say(`Let's do this topic: ${TOPIC}.`);
await waitFor(() => screen.shell?.screen === "setup", "setup");
sam.nav({ kind: "choose", index: screen.shell?.menu.indexOf("Just start") ?? 0 });
await screen.nextHostLine(topicBefore);
await reach(1, "the first question");

// Question 1: a right answer moves on at once.
await answer(sam, solve(), true);
await reach(2, "question 2 after a right answer");
if (scoreOf("Sam") !== 2) {
    throw new Error(`Expected Sam on 2 after a right answer, saw ${scoreOf("Sam")}.`);
}

// Question 2: a wrong answer, a repeat that must be ignored, then a timeout.
await answer(sam, "A banana, I think.", false);
if (current() !== 2) {
    throw new Error("A wrong answer from one of two players moved the game on.");
}
await answer(sam, solve(), false);
if (current() !== 2 || scoreOf("Sam") !== 2) {
    throw new Error(`A repeat answer counted: question ${current()}, Sam ${scoreOf("Sam")}.`);
}
console.warn(`Waiting out the ${QUESTION_SECONDS} second timer.`);
await reach(3, "the timer to move past question 2");

// Question 3: a skip.
await sam.fromPauseMenu(screen, "Skip this question");
await reach(4, "a skip to move on");

// Question 4: Alex answers right.
await answer(alex, solve(), true);
await reach(5, "question 5");
if (scoreOf("Alex") !== 2) {
    throw new Error(`Expected Alex on 2, saw ${scoreOf("Alex")}.`);
}

// Question 5: both answer wrong, so it moves on without anyone being right.
await answer(sam, "Maybe a walrus.", false);
if (current() !== 5) {
    throw new Error("The game moved on before everyone had answered.");
}
await answer(alex, "A walrus too.", false);
await reach(6, "question 6 after everyone answered");

// Question 6: Sam gets it right and the game ends.
await answer(sam, solve(), true);
await waitFor(() => screen.shell?.gameOver === true, "the end of the game");
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, SETTLE_MILLISECONDS); });
watch();

const tally = screen.scene?.blocks.find((candidate) => candidate.type === "tally");
const highlighted: string[] = tally?.type === "tally" ? tally.rows.filter((row) => row.highlight === true).map((row) => row.label) : [];
console.warn(`Final: Sam ${scoreOf("Sam")}, Alex ${scoreOf("Alex")}; highlighted ${highlighted.join(", ")}`);
console.warn(`Answers revealed: ${[...answers.entries()].map(([number, text]) => `${number}=${text}`).join("; ")}`);
if (scoreOf("Sam") !== 4 || scoreOf("Alex") !== 2 || highlighted.join(",") !== "Sam") {
    throw new Error("The final tally is wrong.");
}
for (const [number, lines] of heardDuring) {
    const secret: string = answers.get(number) ?? "";
    const question: string = questions.get(number) ?? "";
    if (secret.length < 3 || answers.get(number - 1) === secret || question.toLowerCase().includes(secret.toLowerCase()) === true) {
        continue;
    }
    const leaked: string[] = lines.filter((line: string) => line.toLowerCase().includes(secret.toLowerCase()));
    if (leaked.length > 0) {
        throw new Error(`Host said the answer to question ${number} (${secret}) too early: ${leaked.join(" | ")}`);
    }
}
for (let number = 1; number <= QUESTION_COUNT; number += 1) {
    if (answers.has(number) === false) {
        throw new Error(`Never saw the revealed answer to question ${number}.`);
    }
}
console.warn("PASS");
process.exit(0);
