// Plays Under the Cup from a script with four fake phones and the real room. Every phone reads its
// own dice from its secret card; the script knows all four hands, which no real player does, and
// plays an all-seeing table: it bluffs a little, raises while a raise is still true, and challenges
// a bid that is false. At every step it checks that nobody's dice appear on another phone, on the TV
// or in anything the host has said before the cups are lifted; after each challenge it checks that
// the TV shows exactly the dice that were dealt, that its count and verdict agree with the script's
// own count (ones wild), and that the right player lost a die. It fails if a round doesn't end.
//
// Run it on a machine with the room up:
//   GAME_ROOM_TEXT_ONLY=1 npm run room
//   ROOM_STUDIO=1 node tools/scenarios/under-the-cup.ts      (in a second terminal)
// ROOM_STUDIO=1 opens a room with the Studio shelf, the only kind that has Under the Cup. By default
// it plays three challenges (about two minutes); DICE_ROUNDS=all plays to the winner, which can take
// ten minutes. A pass prints PASS as its last line. The host needs model keys to speak; the rules do
// not, so without keys the checks on the TV and phones still run and the host checks see no lines.
// The room's log shows "[studio] starting blueprint underTheCup on the tap kit".
// This is test tooling: it prints every hand and the host's lines to its own terminal.

import type { Control } from "../../shared/controls.ts";
import type { SceneBlock } from "../../shared/scene.ts";
import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** Challenges to play before leaving, or Infinity to play to the end. */
const CHALLENGES: number = process.env.DICE_ROUNDS === "all" ? Number.POSITIVE_INFINITY : Number(process.env.DICE_ROUNDS ?? 3);

/** A fake player and what the script knows about their cup. */
interface Seat {
    name: string;
    phone: FakePhone;
    dice: number[];
}

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const seats: Seat[] = ["Teacup", "Spoon", "Candle", "Saucer"].map((name: string) => ({ name, phone: new FakePhone(screen.code, name), dice: [] }));
await waitFor(() => screen.shell?.seats.length === seats.length, "every phone to join");

/**
 * A phone's secret card, which holds its dice.
 * @param phone the phone.
 * @returns the card's body, or undefined when the phone holds none.
 */
function cardBody(phone: FakePhone): string | undefined {
    const card: Control | undefined = phone.view?.controls.find((control: Control) => control.type === "roleCard" && control.secret === true);
    return card?.type === "roleCard" ? card.body : undefined;
}

/**
 * Parses a card into dice.
 * @param body the card's text.
 * @returns the dice.
 */
function parseDice(body: string): number[] {
    return body.split(/\s+/).filter((part: string) => part !== "").map(Number);
}

/**
 * Every way a cup's dice could be printed that is not a bare run of digits, which would collide
 * with numbers the page already holds.
 * @param dice the dice.
 * @returns the strings to search for.
 */
function formsOf(dice: readonly number[]): string[] {
    return [dice.join("   "), dice.join(" "), dice.join(", "), dice.join(","), dice.join("-"), dice.join("  ")];
}

/**
 * The text of a block, if it has any.
 * @param block a block.
 * @returns its text.
 */
function textOf(block: SceneBlock): string {
    return block.type === "text" || block.type === "title" ? block.text : "";
}

/**
 * Fails if any cup's dice show up where they should not: another phone, the TV, or a line the host
 * has said. Cups with the same dice as the viewer's own are skipped, since they can't be told apart.
 * @param when names the moment for the failure message.
 * @param hostLinesBefore how many host lines had been said when the cups were dealt.
 */
function checkNoLeaks(when: string, hostLinesBefore: number): void {
    const tv: string = JSON.stringify(screen.scene);
    const said: string = screen.hostLines.slice(hostLinesBefore).join("\n");
    for (const owner of seats) {
        const forms: string[] = formsOf(owner.dice);
        if (owner.dice.length < 2) {
            continue;
        }
        if (forms.some((form: string) => tv.includes(form) || said.includes(form)) === true) {
            throw new Error(`${when}: ${owner.name}'s dice reached the TV or the host.`);
        }
        for (const viewer of seats) {
            const sameDice: boolean = viewer.dice.join(" ") === owner.dice.join(" ");
            if (viewer !== owner && sameDice === false && forms.some((form: string) => JSON.stringify(viewer.phone.view).includes(form)) === true) {
                throw new Error(`${when}: ${owner.name}'s dice reached ${viewer.name}'s phone.`);
            }
        }
    }
}

/**
 * The TV's line of dice left, by name, such as "Dice left: Teacup 3, Spoon 2".
 * @returns the counts.
 */
function diceLeft(): Record<string, number> {
    const line: string = screen.scene?.blocks.map(textOf).find((text: string) => text.startsWith("Dice left: ")) ?? "";
    const counts: [string, number][] = line.slice("Dice left: ".length).split(", ").filter((part: string) => part !== "").map((part: string): [string, number] => {
        const space: number = part.lastIndexOf(" ");
        return [part.slice(0, space), Number(part.slice(space + 1))];
    });
    return Object.fromEntries(counts);
}

/**
 * Dice counting towards a bid, with ones wild unless the bid is on ones.
 * @param face the bid's face.
 * @returns the count across every cup.
 */
function countFace(face: number): number {
    return seats.flatMap((seat: Seat) => seat.dice).filter((die: number) => die === face || (face !== 1 && die === 1)).length;
}

/**
 * Whether a phone holds dice this round.
 * @param seat the seat.
 * @returns true when its card is up.
 */
function holdsDice(seat: Seat): boolean {
    return cardBody(seat.phone) !== undefined;
}

/**
 * What an all-seeing player does: challenge a bid that is false; otherwise raise by the smallest
 * amount that is still true; open with a small bluff of their own dice plus one; challenge if no true
 * raise is left. Only options the phone offers are chosen.
 * @param bidder who is bidding.
 * @param standing the standing bid, if any.
 * @returns a bid to make, or "challenge".
 */
function chooseMove(bidder: Seat, standing: { face: number; quantity: number } | null): { face: number; quantity: number } | "challenge" {
    const offered: string[] = bidder.phone.options().map((option: { id: string; label: string }) => option.id);
    if (standing !== null && countFace(standing.face) < standing.quantity) {
        return "challenge";
    }
    const quantities: number[] = offered.filter((id: string) => id.startsWith("qty:")).map((id: string) => Number(id.slice(4)));
    const candidates: { face: number; quantity: number }[] = quantities.flatMap((quantity: number) => [1, 2, 3, 4, 5, 6].map((face: number) => ({ face, quantity })));
    const legal = (bid: { face: number; quantity: number }): boolean => {
        return standing === null || bid.quantity > standing.quantity || (bid.quantity === standing.quantity && bid.face > standing.face);
    };
    if (standing === null) {
        const tallies: { face: number; count: number }[] = [1, 2, 3, 4, 5, 6].map((face: number) => ({ face, count: bidder.dice.filter((die: number) => die === face).length }));
        const mostCommon: { face: number; count: number } | undefined = tallies.sort((first, second) => second.count - first.count)[0];
        return { face: mostCommon?.face === 1 ? 2 : mostCommon?.face ?? 2, quantity: Math.min(5, (mostCommon?.count ?? 0) + 1) };
    }
    const raise: { face: number; quantity: number } | undefined = candidates.filter(legal).find((bid: { face: number; quantity: number }) => countFace(bid.face) >= bid.quantity);
    return raise ?? "challenge";
}

/** A bid standing on the table. */
interface Standing {
    face: number;
    quantity: number;
    by: string;
}

/**
 * Plays one round's bidding until someone challenges.
 * @param round which round, for messages.
 * @param hostLinesBefore how many host lines had been said when the cups were dealt.
 * @returns the bid that was challenged and who challenged it.
 */
async function playBids(round: number, hostLinesBefore: number): Promise<{ standing: Standing; called: Seat }> {
    let standing: Standing | null = null;
    for (;;) {
        await waitFor(() => seats.some((seat: Seat) => seat.phone.options().length > 0), "someone to be asked to bid");
        const bidder: Seat | undefined = seats.find((seat: Seat) => seat.phone.options().length > 0);
        if (bidder === undefined) {
            throw new Error("Nobody could bid.");
        }
        const wanted: { face: number; quantity: number } | "challenge" = chooseMove(bidder, standing);
        if (wanted === "challenge") {
            if (standing === null) {
                throw new Error("A challenge came before any bid.");
            }
            bidder.phone.press("challenge");
            return { standing, called: bidder };
        }
        bidder.phone.press(`qty:${wanted.quantity}`);
        await waitFor(() => bidder.phone.options().some((option) => option.id.startsWith("face:")), "the faces");
        bidder.phone.press(`face:${wanted.face}`);
        standing = { ...wanted, by: bidder.name };
        await waitFor(() => bidder.phone.options().length === 0, "the turn to pass");
        checkNoLeaks(`Round ${round}, bid by ${bidder.name}`, hostLinesBefore);
    }
}

await seats[0]?.phone.startGame(screen, "Under the Cup");
let challenges: number = 0;
let round: number = 0;
while (challenges < CHALLENGES && screen.shell?.gameOver !== true) {
    round += 1;
    await waitFor(() => screen.title() === "Look at your dice" && seats.filter(holdsDice).length >= 2, `round ${round} to be dealt`);
    const hostLinesBefore: number = screen.hostLines.length;
    const before: Record<string, number> = diceLeft();
    for (const seat of seats) {
        seat.dice = holdsDice(seat) === true ? parseDice(cardBody(seat.phone) ?? "") : [];
        if (seat.dice.length !== (before[seat.name] ?? 0)) {
            throw new Error(`${seat.name} holds ${seat.dice.length} dice but the TV says ${before[seat.name] ?? 0}.`);
        }
        console.warn(`  ${seat.name}: ${seat.dice.join(" ") || "out"}`);
    }
    checkNoLeaks(`Round ${round}, looking`, hostLinesBefore);
    await waitFor(() => screen.title() !== "Look at your dice", "bidding to open");
    const { standing, called } = await playBids(round, hostLinesBefore);
    await waitFor(() => screen.title() === "Cups up", "the cups to come up");
    checkNoLeaks(`Round ${round}, cups still down`, hostLinesBefore);
    await waitFor(() => screen.title() === "The bid held" || screen.title() === "A bluff", "the reveal");
    challenges += 1;
    const actual: number = countFace(standing.face);
    const held: boolean = actual >= standing.quantity;
    const loser: string = held === true ? called.name : standing.by;
    const lines: string[] = screen.scene?.blocks.map(textOf).filter((text: string) => text !== "") ?? [];
    for (const seat of seats.filter((candidate: Seat) => candidate.dice.length > 0)) {
        const shown: string = `${seat.name}: ${[...seat.dice].sort((first: number, second: number) => first - second).join(" · ")}`;
        if (lines.some((line: string) => line.split("  |  ").includes(shown)) === false) {
            throw new Error(`The TV did not show ${seat.name}'s cup as dealt. Wanted "${shown}", saw ${JSON.stringify(lines)}.`);
        }
    }
    if ((screen.title() === "The bid held") !== held) {
        throw new Error(`The TV called the bid ${screen.title()} but the script counted ${actual} against ${standing.quantity}.`);
    }
    if (lines.some((text: string) => text.startsWith(`${actual} counted. ${loser} `)) === false) {
        throw new Error(`The TV's count or loser is wrong. Wanted ${actual} counted and ${loser}; saw ${JSON.stringify(lines)}.`);
    }
    const after: Record<string, number> = diceLeft();
    const lost: number = (before[loser] ?? 0) - (after[loser] ?? 0);
    const others: boolean = Object.keys(before).every((name: string) => name === loser || before[name] === after[name]);
    if (lost < 1 || lost > 2 || others === false) {
        throw new Error(`Dice left went from ${JSON.stringify(before)} to ${JSON.stringify(after)}; only ${loser} should have lost.`);
    }
    console.warn(`Challenge ${challenges}: ${called.name} called ${standing.by}'s ${standing.quantity} x ${standing.face}. There were ${actual}. ${loser} lost ${lost}.`);
    await waitFor(() => seats.every((seat: Seat) => holdsDice(seat) === false), "every cup to be put down after the reveal");
    if (challenges < CHALLENGES) {
        await waitFor(() => screen.title() === "Look at your dice" || screen.shell?.gameOver === true, "the next round or the end");
    }
}
if (screen.shell?.gameOver === true) {
    console.warn(`Winner: ${screen.title()}`);
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 3000); });
    await seats[0]?.phone.chooseRow(screen, "Back to the shelf");
}
if (screen.shell?.gameOver !== true) {
    await seats[0]?.phone.fromPauseMenu(screen, "End the game");
    await seats[0]?.phone.chooseRow(screen, "End for everyone");
}
await waitFor(() => screen.shell?.screen === "home", "the shelf");
console.warn("PASS");
process.exit(0);
