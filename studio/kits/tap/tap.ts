// The tap kit's shared parts: games where people play by tapping a button on their phone, and the
// host only talks. Each tap game (who fits, dice bidding, push your luck) is its own file built on
// these. Here: the seats, a ballot of buttons, collecting secret taps until everyone is in, going
// round the table, a scoreboard, and lines the host's model writes at play time, checked, with a
// fallback bank. Code decides every outcome.

import type { CartridgePlayer } from "../../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../../shared/controls.ts";
import type { SceneBlock, TallyRow } from "../../../shared/scene.ts";

/** Longest line the model may write for a tap game. */
export const LINE_CHARACTER_LIMIT: number = 90;

/**
 * A player's name, or "Someone" for a seat that has gone.
 * @param players who is at the table.
 * @param playerId the player.
 * @returns the name.
 */
export function nameIn(players: readonly CartridgePlayer[], playerId: string | null): string {
    return players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
}

/**
 * A ballot: one button per option, sent back as the option's id.
 * @param prompt what the phone asks.
 * @param options the choices.
 * @returns the control.
 */
export function ballot(prompt: string, options: readonly ControlOption[]): Control {
    return { type: "buttons", prompt, options: [...options] };
}

/**
 * Buttons for choosing someone at the table other than yourself.
 * @param players who is at the table.
 * @param chooserId who is choosing.
 * @param prefix put before each player id in the option id.
 * @returns the options.
 */
export function otherPlayers(players: readonly CartridgePlayer[], chooserId: string, prefix: string): ControlOption[] {
    const others: CartridgePlayer[] = players.filter((player: CartridgePlayer) => player.playerId !== chooserId);
    return others.map((player: CartridgePlayer): ControlOption => ({ id: `${prefix}${player.playerId}`, label: player.name }));
}

/**
 * Whether everyone who should tap has tapped.
 * @param tappers who should tap.
 * @param taps what each has tapped, by player id.
 * @returns true when nobody is missing.
 */
export function everyoneTapped(tappers: readonly string[], taps: Readonly<Record<string, string>>): boolean {
    return tappers.every((playerId: string) => taps[playerId] !== undefined);
}

/**
 * The next seat round the table after one, skipping nobody.
 * @param players who is at the table, in seat order.
 * @param afterId the seat to start after, or null for the first seat.
 * @returns the next player's id, or null when the table is empty.
 */
export function nextSeat(players: readonly CartridgePlayer[], afterId: string | null): string | null {
    if (players.length === 0) {
        return null;
    }
    const index: number = players.findIndex((player: CartridgePlayer) => player.playerId === afterId);
    return players[(index + 1) % players.length]?.playerId ?? null;
}

/**
 * A scoreboard for the TV, highest first, with the leaders highlighted.
 * @param title what it is called.
 * @param players who is at the table.
 * @param scores points by player id.
 * @returns the block.
 */
export function scoreboard(title: string, players: readonly CartridgePlayer[], scores: Readonly<Record<string, number>>): SceneBlock {
    const rows: TallyRow[] = players.map((player: CartridgePlayer): TallyRow => ({ label: player.name, count: scores[player.playerId] ?? 0 }));
    rows.sort((first: TallyRow, second: TallyRow) => second.count - first.count);
    const top: number = rows[0]?.count ?? 0;
    return { type: "tally", title, rows: rows.map((row: TallyRow): TallyRow => ({ ...row, highlight: top > 0 && row.count === top })) };
}

/**
 * Whether a line the model wrote is one a tap game will show: short, plain, no brackets that could
 * open a ruling or an aside.
 * @param line the line.
 * @returns true when it can be used.
 */
export function isUsableLine(line: string): boolean {
    const trimmed: string = line.trim();
    return trimmed.length >= 8 && trimmed.length <= LINE_CHARACTER_LIMIT && /[[\]{}<>]/.test(trimmed) === false;
}

/**
 * Reads the model's lines defensively: a JSON array of strings, the usable ones only.
 * @param text whatever the model wrote, ideally a JSON array of strings.
 * @returns the usable lines found, possibly none.
 */
export function parseLines(text: string): string[] {
    const start: number = text.indexOf("[");
    const end: number = text.lastIndexOf("]");
    if (start === -1 || end <= start) {
        return [];
    }
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
        return [];
    }
    if (Array.isArray(parsed) === false) {
        return [];
    }
    return (parsed as unknown[]).filter((item: unknown): item is string => typeof item === "string").map((line: string) => line.trim()).filter(isUsableLine);
}

/**
 * The lines to play with: the model's usable lines first, topped up from the fallback bank in order,
 * so a game always has enough.
 * @param written the model's usable lines.
 * @param fallback the bank.
 * @param count how many are needed.
 * @returns exactly that many lines, or as many as both together have.
 */
export function linesToPlay(written: readonly string[], fallback: readonly string[], count: number): string[] {
    const unique: string[] = [...new Set([...written, ...fallback])];
    return unique.slice(0, count);
}
