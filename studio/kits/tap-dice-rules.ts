// The pure rules of Under the Cup, the dice bidding game on the tap kit: what a bid is, which bid
// beats which, how dice are counted when ones are wild, how likely a bid is from the number of dice
// alone, and how bids are spoken. Nothing here knows about phones, the TV or the host; the cartridge
// in tap-dice.ts calls these, and the unit tests call them directly.

/** A bid that there are at least this many dice showing this face, across every cup on the table. */
export interface Bid {
    playerId: string;
    quantity: number;
    face: number;
}

/** Faces on a die. */
export const FACES: number = 6;

/** Most quantity buttons a phone is offered at once, counting up from the lowest legal raise. */
export const QUANTITY_BUTTONS: number = 8;

const SINGULAR: readonly string[] = ["one", "two", "three", "four", "five", "six"];
const PLURAL: readonly string[] = ["ones", "twos", "threes", "fours", "fives", "sixes"];
const NUMBER_WORDS: readonly string[] = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

/**
 * Rolls dice.
 * @param count how many.
 * @param random a function returning [0, 1).
 * @returns the faces, each 1 to 6.
 */
export function rollDice(count: number, random: () => number): number[] {
    return Array.from({ length: count }, (): number => Math.min(FACES, Math.floor(random() * FACES) + 1));
}

/**
 * A number in words up to twenty, digits beyond.
 * @param value a whole number.
 * @returns the word.
 */
export function numberWord(value: number): string {
    return NUMBER_WORDS[value] ?? String(value);
}

/**
 * A face in words.
 * @param face 1 to 6.
 * @param plural whether it is "fours" rather than "four".
 * @returns the word.
 */
export function faceWord(face: number, plural: boolean): string {
    return (plural === true ? PLURAL : SINGULAR)[face - 1] ?? String(face);
}

/**
 * A bid as it is spoken, such as "three fives" or "one six".
 * @param quantity how many.
 * @param face which face.
 * @returns the words, lower case.
 */
export function sayBid(quantity: number, face: number): string {
    return `${numberWord(quantity)} ${faceWord(face, quantity !== 1)}`;
}

/**
 * Whether one bid beats another: more dice, or the same number of a higher face.
 * @param quantity the new bid's quantity.
 * @param face the new bid's face.
 * @param standing the bid to beat, or null for an opening bid.
 * @returns true when the new bid is allowed.
 */
export function beats(quantity: number, face: number, standing: Bid | null): boolean {
    if (Number.isInteger(quantity) === false || Number.isInteger(face) === false || quantity < 1 || face < 1 || face > FACES) {
        return false;
    }
    if (standing === null) {
        return true;
    }
    return quantity > standing.quantity || (quantity === standing.quantity && face > standing.face);
}

/**
 * The fewest dice a raise can name: the standing quantity if a higher face is left, else one more.
 * @param standing the bid to beat, or null for an opening bid.
 * @returns the quantity.
 */
export function lowestRaiseQuantity(standing: Bid | null): number {
    if (standing === null) {
        return 1;
    }
    return standing.face < FACES ? standing.quantity : standing.quantity + 1;
}

/**
 * The quantities a phone offers: from the lowest legal raise upward, capped at the dice on the table.
 * @param standing the bid to beat, or null.
 * @param totalDice dice on the table.
 * @returns the quantities, ascending, at most QUANTITY_BUTTONS of them.
 */
export function quantityChoices(standing: Bid | null, totalDice: number): number[] {
    const lowest: number = lowestRaiseQuantity(standing);
    const choices: number[] = [];
    for (let quantity = lowest; quantity <= totalDice && choices.length < QUANTITY_BUTTONS; quantity += 1) {
        choices.push(quantity);
    }
    return choices;
}

/**
 * The faces a bid of this quantity may name.
 * @param quantity the chosen quantity.
 * @param standing the bid to beat, or null.
 * @returns the faces, ascending.
 */
export function faceChoices(quantity: number, standing: Bid | null): number[] {
    return Array.from({ length: FACES }, (_unused: unknown, index: number): number => index + 1).filter((face: number) => beats(quantity, face, standing) === true);
}

/**
 * How many dice count towards a bid on a face. With ones wild, a one counts as any face, except
 * when the bid is on ones.
 * @param hands every cup on the table.
 * @param face the bid's face.
 * @param wildOnes whether ones are wild.
 * @returns the count.
 */
export function countFace(hands: readonly (readonly number[])[], face: number, wildOnes: boolean): number {
    let count: number = 0;
    for (const hand of hands) {
        for (const die of hand) {
            if (die === face || (wildOnes === true && die === 1)) {
                count += 1;
            }
        }
    }
    return count;
}

/**
 * The chance any one die counts towards a bid on a face.
 * @param face the bid's face.
 * @param wildOnes whether ones are wild.
 * @returns a probability.
 */
export function chancePerDie(face: number, wildOnes: boolean): number {
    return wildOnes === true && face !== 1 ? 2 / FACES : 1 / FACES;
}

/**
 * The chance that at least this many of a number of dice count, from the number of dice alone. It
 * knows nothing about any cup, so it is safe to say out loud.
 * @param totalDice dice on the table.
 * @param perDie the chance one die counts.
 * @param quantity the bid's quantity.
 * @returns a probability from 0 to 1.
 */
export function chanceAtLeast(totalDice: number, perDie: number, quantity: number): number {
    if (quantity <= 0) {
        return 1;
    }
    if (quantity > totalDice) {
        return 0;
    }
    let chance: number = 0;
    let choose: number = 1;
    for (let count = 0; count <= totalDice; count += 1) {
        if (count > 0) {
            choose = (choose * (totalDice - count + 1)) / count;
        }
        if (count >= quantity) {
            chance += choose * perDie ** count * (1 - perDie) ** (totalDice - count);
        }
    }
    return Math.min(1, Math.max(0, chance));
}

/** How a bid sounds, from the chance it is true on the dice count alone. */
export type Boldness = "safe" | "fair" | "stretch" | "longShot" | "wild";

/**
 * Names how bold a bid is.
 * @param chance the chance from chanceAtLeast.
 * @returns the grade.
 */
export function boldness(chance: number): Boldness {
    if (chance >= 0.65) {
        return "safe";
    }
    if (chance >= 0.35) {
        return "fair";
    }
    if (chance >= 0.15) {
        return "stretch";
    }
    return chance >= 0.04 ? "longShot" : "wild";
}

/** What the host is told about each grade, in plain words. */
export const BOLDNESS_WORDS: Readonly<Record<Boldness, string>> = {
    safe: "a safe bid",
    fair: "about even odds",
    stretch: "a stretch",
    longShot: "a long shot",
    wild: "nearly impossible",
};

/**
 * The bid the clock makes for a player who ran out of time to open: modest, from the dice count alone.
 * @param totalDice dice on the table.
 * @returns the quantity and face.
 */
export function clockOpening(totalDice: number): { quantity: number; face: number } {
    return { quantity: Math.max(1, Math.round(totalDice / FACES)), face: 2 };
}

/**
 * The seat after one that still has dice, going round the table.
 * @param seats every seat in order.
 * @param diceLeft dice each seat has left.
 * @param afterId the seat to start after, or null to start from the first seat.
 * @returns the id, or null when nobody has dice.
 */
export function nextWithDice(seats: readonly string[], diceLeft: Readonly<Record<string, number>>, afterId: string | null): string | null {
    const start: number = afterId === null ? -1 : seats.indexOf(afterId);
    for (let step = 1; step <= seats.length; step += 1) {
        const candidate: string | undefined = seats[(start + step + seats.length) % Math.max(1, seats.length)];
        if (candidate !== undefined && (diceLeft[candidate] ?? 0) > 0) {
            return candidate;
        }
    }
    return null;
}
