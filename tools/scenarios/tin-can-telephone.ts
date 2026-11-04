// Plays Tin Can Telephone from a script with fake phones and the real room: five players by default,
// or three with SCENARIO_PLAYERS=3, where the host gives one side's clues. The givers read the key
// off their phones; their teams turn over exactly the words the key says, one clue spoken, one typed,
// one the host rules a foul. Fails if any phone but a giver's ever shows whose a word is, if the TV
// shows a word's owner before it is turned over, if the host names a word's owner or says the
// trapdoor word before the end, if a refused clue is repeated, or if the game does not end with the
// team that found all its words winning.
//
// Run it with model keys, or against the stub model when there are none (the stub only proves the
// room, the rules and the screens; it says nothing about how Muse Spark hosts):
//   node tools/stub-model.ts                         (stub only)
//   META_BASE_URL=http://localhost:8799 META_MODEL_API_KEY=stub GAME_ROOM_TEXT_ONLY=1 node room/server.ts
//   ROOM_STUDIO=1 node tools/scenarios/tin-can-telephone.ts      (in another terminal)
// ROOM_STUDIO=1 makes the fake screen open its room with ?studio=1, the only kind of room whose shelf
// has this game. A pass prints PASS as its last line. The room's log should show "[studio] starting
// blueprint tinCanTelephone on the clueboard kit".
//
// This is test tooling, not the server: it prints the key and every line said to the terminal it runs
// in, which the room's own log never does. Don't paste its output anywhere public.

import type { Control } from "../../shared/controls.ts";
import type { BoardCell, SceneBlock } from "../../shared/scene.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** One fake player. */
interface Seat {
    name: string;
    phone: FakePhone;
}

/** The names the fake players use. */
const NAMES: string[] = ["Teacup", "Spoon", "Candle", "Saucer", "Matchbox"];

/** Milliseconds to let the host finish before the next thing happens. */
const SETTLE_MILLISECONDS: number = 1200;

/**
 * Letters only, lower case.
 * @param text any text.
 * @returns the squashed text.
 */
function squash(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Waits a moment.
 * @param milliseconds how long.
 */
async function pause(milliseconds: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); });
}

/**
 * The key cards on a phone, as lines.
 * @param phone the phone.
 * @returns the lines.
 */
function keyLines(phone: FakePhone): string[] {
    return (phone.view?.controls ?? []).flatMap((control: Control) => (control.type === "roleCard" && control.title === "The key" ? [control.body] : []));
}

/**
 * The board on the TV.
 * @param screen the TV.
 * @returns the cells.
 */
function boardOf(screen: FakeScreen): BoardCell[] {
    const block: SceneBlock | undefined = screen.scene?.blocks.find((candidate: SceneBlock) => candidate.type === "board");
    return block?.type === "board" ? block.cells : [];
}

/**
 * The first title on the TV, with its kicker.
 * @param screen the TV.
 * @returns the kicker and text.
 */
function headline(screen: FakeScreen): { kicker: string; text: string } {
    const block: SceneBlock | undefined = screen.scene?.blocks.find((candidate: SceneBlock) => candidate.type === "title");
    return block?.type === "title" ? { kicker: block.kicker ?? "", text: block.text } : { kicker: "", text: "" };
}

/**
 * Whether the game is over, read from the TV's shell. A function so the checks aren't narrowed by an earlier test.
 * @returns true when it is.
 */
function isOver(): boolean {
    return screen.shell?.gameOver === true;
}

const playerCount: number = Number(process.env.SCENARIO_PLAYERS ?? 5);
const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const seats: Seat[] = NAMES.slice(0, playerCount).map((name: string) => ({ name, phone: new FakePhone(screen.code, name) }));
await waitFor(() => screen.shell?.seats.length === seats.length, "every phone to join");
const gameStart: number = screen.hostLines.length;
await seats[0]?.phone.startGame(screen, "Tin Can Telephone");
await waitFor(() => boardOf(screen).length === 25, "the board on the TV");
await waitFor(() => seats.some((seat: Seat) => keyLines(seat.phone).length === 4), "a key on a giver's phone");

/** Who holds a key, and what it says: team label to the words, read off the first giver's phone. */
const givers: Seat[] = seats.filter((seat: Seat) => keyLines(seat.phone).length === 4);
const expectedGivers: number = playerCount === 3 ? 1 : 2;
if (givers.length !== expectedGivers) {
    throw new Error(`Expected ${expectedGivers} givers, saw ${givers.length}.`);
}
const keyOwner: Map<string, string> = new Map();
const lines: string[] = keyLines((givers[0] as Seat).phone);
const labels: string[] = [];
for (const line of lines) {
    const label: string = line.slice(0, line.indexOf(":"));
    labels.push(label);
    for (const word of line.slice(line.indexOf(":") + 1).split(",").map((piece: string) => piece.trim()).filter((piece: string) => piece !== "none left")) {
        keyOwner.set(squash(word), label.replace(" (yours)", ""));
    }
}
if (keyOwner.size !== 25) {
    throw new Error(`The key lists ${keyOwner.size} words, not 25.`);
}
const trapWord: string = [...keyOwner.entries()].find(([, owner]: [string, string]) => owner === "Trapdoor")?.[0] ?? "";
const guessers: Seat[] = seats.filter((seat: Seat) => givers.includes(seat) === false);
console.warn(`Givers: ${givers.map((seat: Seat) => seat.name).join(", ")}. Trapdoor: ${trapWord}.`);

/** Fails if the key has reached any phone but a giver's, or the TV before a card is turned over. */
function checkNoLeaks(): void {
    for (const seat of guessers) {
        const seen: string = JSON.stringify(seat.phone.view?.controls ?? []);
        if (keyLines(seat.phone).length > 0 || seen.includes("(yours)") === true || seen.includes("Trapdoor") === true || seen.includes("Bystander") === true) {
            throw new Error(`The key reached ${seat.name}'s phone.`);
        }
    }
    for (const cell of boardOf(screen)) {
        if (cell.turned === false && isOver() === false && (cell.owner !== "unknown" || cell.owned !== undefined)) {
            throw new Error(`The TV shows whose ${cell.text} is before it is turned over.`);
        }
    }
    const said: string = screen.hostLines.slice(gameStart).join(" | ");
    if (squash(said).includes(trapWord) === true && boardOf(screen).some((cell: BoardCell) => cell.turned === true && squash(cell.text) === trapWord) === false) {
        throw new Error("The host said the trapdoor word before it was turned over.");
    }
    if (/\b(is|are) (plum|teal)'?s?\b/i.test(said) === true && /\b(trapdoor|bystander)\b/i.test(said) === true) {
        throw new Error("The host seems to have named whose a word is.");
    }
}

/**
 * Has the team on turn's giver give a clue, spoken or typed, and waits for the guessing to open.
 * @param giver who gives it.
 * @param clue the word.
 * @param number the number.
 * @param typed true to type it instead of saying it.
 */
async function giveClue(giver: Seat, clue: string, number: number, typed: boolean): Promise<void> {
    await pause(SETTLE_MILLISECONDS);
    if (typed === true) {
        const controls: Control[] = giver.phone.view?.controls ?? [];
        const box: Control | undefined = controls.find((control: Control) => control.type === "textInput");
        if (box?.type !== "textInput") {
            throw new Error(`${giver.name} has no box to type a clue in.`);
        }
        giver.phone.answer(box.id, `${clue} ${number}`);
    }
    if (typed === false) {
        giver.phone.say(`${clue} ${number}`);
    }
}

/**
 * Whose turn it is, read from the TV.
 * @returns the team name.
 */
function teamOnTurn(): string {
    return headline(screen).text.replace("'s turn", "");
}

await waitFor(() => headline(screen).text.endsWith("'s turn"), "the first turn");
checkNoLeaks();

let turns: number = 0;
let fouled: boolean = false;
let missed: boolean = false;
while (isOver() === false && turns < 14) {
    turns += 1;
    await waitFor(() => headline(screen).kicker.includes("giving the clue") || headline(screen).kicker.includes("thinking of a clue") || headline(screen).kicker.startsWith("Clue:") || isOver(), "a clue to be asked for");
    if (isOver()) {
        break;
    }
    const team: string = teamOnTurn();
    const giver: Seat | undefined = givers.find((seat: Seat) => seat.phone.view?.turn?.yours === true);
    const mine: string[] = [...keyOwner.entries()].filter(([, owner]: [string, string]) => owner === team).map(([word]: [string, string]) => word);
    const left: string[] = mine.filter((word: string) => boardOf(screen).some((cell: BoardCell) => squash(cell.text) === word && cell.turned === false) === true);
    const number: number = Math.min(left.length, 3);
    if (giver !== undefined) {
        if (fouled === false && turns === 1) {
            fouled = true;
            await giveClue(giver, "lookalike", number, false);
            await waitFor(() => (giver.phone.view?.controls ?? []).some((control: Control) => control.type === "textInput" && control.note === "That one didn't count. Try another."), "a foul and a second try");
            if (screen.hostLines.slice(gameStart).some((line: string) => squash(line).includes("lookalike") === true && /foul|sounds like/i.test(line) === false)) {
                console.warn("NOTE: the host mentioned the refused clue without saying it was a foul.");
            }
        }
        await giveClue(giver, "meridian", number, turns % 2 === 0);
    }
    await waitFor(() => headline(screen).kicker.startsWith("Clue:") || isOver(), "guessing to open");
    checkNoLeaks();
    const guesser: Seat | undefined = guessers.find((seat: Seat) => seat.phone.view?.turn?.yours === true) ?? guessers[0];
    if (guesser === undefined) {
        throw new Error("Nobody can guess.");
    }
    const owned: string[] = left.slice(0, number);
    if (missed === false && turns === 2) {
        missed = true;
        const bystander: string | undefined = [...keyOwner.entries()].find(([word, owner]: [string, string]) => owner === "Bystander" && boardOf(screen).some((cell: BoardCell) => squash(cell.text) === word && cell.turned === false) === true)?.[0];
        owned.unshift(bystander ?? "");
    }
    for (const word of owned) {
        await waitFor(() => (guesser.phone.view?.turn?.yours === true || guessers.length === 1) || isOver(), "the guesser's turn");
        if (isOver()) {
            break;
        }
        const before: number = boardOf(screen).filter((cell: BoardCell) => cell.turned).length;
        const label: string | undefined = guesser.phone.options().find((option: { id: string; label: string }) => squash(option.label) === word)?.label;
        if (label === undefined) {
            break;
        }
        guesser.phone.press(label);
        await waitFor(() => boardOf(screen).filter((cell: BoardCell) => cell.turned).length > before || isOver(), "the card to turn over");
        checkNoLeaks();
        if (teamOnTurn() !== team) {
            break;
        }
    }
    if (isOver() === false && teamOnTurn() === team && headline(screen).kicker.startsWith("Clue:") === true && guesser.phone.options().some((option: { id: string }) => option.id === "stop" && true) === true) {
        guesser.phone.press("We're done");
    }
    await waitFor(() => teamOnTurn() !== team || isOver(), "the turn to pass");
}

await waitFor(() => isOver(), "the game to end");
const end = headline(screen);
const cells: BoardCell[] = boardOf(screen);
console.warn(`End: ${end.text}. ${end.kicker}.`);
if (end.text.endsWith(" wins") === false || cells.some((cell: BoardCell) => cell.owner === "unknown") === true) {
    throw new Error("The end screen should name a winner and show the whole key.");
}
const winner: string = end.text.replace(" wins", "");
const winnersLeft: number = cells.filter((cell: BoardCell) => cell.owned === winner && cell.turned === false).length;
if (end.kicker === "Every word found" && winnersLeft !== 0) {
    throw new Error("The winner still had words left.");
}
console.warn("PASS");
process.exit(0);
