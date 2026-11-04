// Finds the games and kits by scanning folders, so adding either never edits a shared file. A kit is a
// folder under kits/ holding kit.meta.json ({ kit }) and an index.ts that exports KIT. A game is a
// folder under games/ holding game.meta.json ({ id, kit, level, reason?, order?, guests?, agents? }) and a blueprint.ts
// that exports its blueprint. Everything is checked at load. A folder that fails (no metadata, an unknown
// kit, a module that won't load, a blueprint its kit says can't run) sits out and is listed in `skipped`
// naming the culprit, so one bad folder can't stop a server that also runs the plain shelf. A test holds
// the real tree to an empty `skipped`, so a broken game fails the checks long before it reaches a server.

import type { GuestPlay } from "../room/guest.ts";
import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Blueprint } from "./blueprint.ts";
import type { KitDefinition } from "./kit/definition.ts";

/** How far a game is cleared: visible on every Studio shelf, or still being tried (hidden unless the shelf is switched to show it). */
export type GameLevel = "visible" | "testing" | "held";

/** What a game folder's game.meta.json says. */
export interface GameMeta {
    id: string;
    kit: string;
    level: GameLevel;
    /** How AI guests play this game; left out, the game isn't offered to a table with guests. */
    guests?: GuestPlay;
    /** True when someone's own agent may sit in; left out, agents are told they can't. */
    agents?: boolean;
    /** Decisions that differ when an agent is at the table, such as a longer clock for one working through a browser. */
    agentDecisions?: Record<string, number>;
    /** Offers a choice of clock at the start, with No timer first: which decision it sets, and the seconds for each pace. */
    timeChoice?: { decision: string; relaxed: number; normal: number; quick: number };
    /** Why the game is not yet visible; required for testing and held. */
    reason?: string;
    /** Where it stands on the shelf, lowest first; games without one come last, by id. */
    order?: number;
}

/** One game found on disk. */
export interface DiscoveredGame {
    meta: GameMeta;
    blueprint: Blueprint;
    folder: string;
}

/** A folder that sat out of the scan, and why. */
export interface SkippedFolder {
    folder: string;
    reason: string;
}

/** Everything a scan finds. */
export interface Catalog {
    kits: Readonly<Record<string, KitDefinition<Blueprint>>>;
    games: readonly DiscoveredGame[];
    skipped: readonly SkippedFolder[];
}

const GAME_LEVELS: readonly string[] = ["visible", "testing", "held"];

/**
 * The sub-folders of a folder, by name, leaving out hidden ones.
 * @param folder the folder to list.
 * @returns the directory names, sorted.
 */
function foldersIn(folder: string): string[] {
    if (existsSync(folder) === false) {
        return [];
    }
    return readdirSync(folder, { withFileTypes: true })
        .filter((entry: Dirent) => entry.isDirectory() === true && entry.name.startsWith(".") === false)
        .map((entry: Dirent) => entry.name)
        .sort();
}

/**
 * Reads a metadata file as an object.
 * @param file the metadata path.
 * @param folder the folder it belongs to, for the error.
 * @returns the parsed object.
 * @throws when the file is missing or is not a JSON object.
 */
function readMeta(file: string, folder: string): Record<string, unknown> {
    if (existsSync(file) === false) {
        throw new Error(`${folder} has no ${file.slice(file.lastIndexOf("/") + 1)}.`);
    }
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) === true) {
        throw new Error(`${file} must hold one JSON object.`);
    }
    return parsed as Record<string, unknown>;
}

/**
 * Checks and returns a game's metadata.
 * @param raw the parsed JSON.
 * @param folder the game folder, for errors.
 * @returns the metadata.
 * @throws when a field is missing or wrong.
 */
function gameMetaOf(raw: Record<string, unknown>, folder: string): GameMeta {
    if (typeof raw.id !== "string" || raw.id === "" || typeof raw.kit !== "string" || raw.kit === "") {
        throw new Error(`${folder}/game.meta.json needs a text "id" and a text "kit".`);
    }
    if (typeof raw.level !== "string" || GAME_LEVELS.includes(raw.level) === false) {
        throw new Error(`Game ${raw.id} (${folder}) needs a "level" of visible, testing or held.`);
    }
    if (raw.level !== "visible" && (typeof raw.reason !== "string" || raw.reason === "")) {
        throw new Error(`Game ${raw.id} (${folder}) is ${raw.level} and needs a "reason".`);
    }
    if (raw.order !== undefined && typeof raw.order !== "number") {
        throw new Error(`Game ${raw.id} (${folder}) has an "order" that is not a number.`);
    }
    if (raw.guests !== undefined && raw.guests !== "model" && raw.guests !== "random") {
        throw new Error(`Game ${raw.id} (${folder}) has "guests" that is not model or random.`);
    }
    const meta: GameMeta = { id: raw.id, kit: raw.kit, level: raw.level as GameLevel };
    if (raw.guests !== undefined) {
        meta.guests = raw.guests;
    }
    if (raw.agents === true) {
        meta.agents = true;
    }
    if (typeof raw.agentDecisions === "object" && raw.agentDecisions !== null) {
        meta.agentDecisions = raw.agentDecisions as Record<string, number>;
    }
    if (typeof raw.timeChoice === "object" && raw.timeChoice !== null) {
        meta.timeChoice = raw.timeChoice as NonNullable<GameMeta["timeChoice"]>;
    }
    if (typeof raw.reason === "string") {
        meta.reason = raw.reason;
    }
    if (typeof raw.order === "number") {
        meta.order = raw.order;
    }
    return meta;
}

/**
 * Whether a value has the shape of a blueprint.
 * @param value anything a game module exports.
 * @returns true when it carries a kit name, a box and decisions.
 */
function looksLikeBlueprint(value: unknown): value is Blueprint {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate: Record<string, unknown> = value as Record<string, unknown>;
    return typeof candidate.kit === "string" && typeof candidate.box === "object" && candidate.box !== null && candidate.decisions !== undefined;
}

/**
 * Loads one kit folder.
 * @param root the scan root.
 * @param name the folder name under kits/.
 * @returns the kit's name and its definition.
 */
async function loadKit(root: string, name: string): Promise<[string, KitDefinition<Blueprint>]> {
    const folder: string = join(root, "kits", name);
    const meta: Record<string, unknown> = readMeta(join(folder, "kit.meta.json"), `kits/${name}`);
    if (typeof meta.kit !== "string" || meta.kit === "") {
        throw new Error(`kits/${name}/kit.meta.json needs a text "kit".`);
    }
    const entry: string = join(folder, "index.ts");
    if (existsSync(entry) === false) {
        throw new Error(`Kit ${meta.kit} (kits/${name}) has no index.ts.`);
    }
    const loaded: { KIT?: KitDefinition<Blueprint> } = (await import(pathToFileURL(entry).href)) as { KIT?: KitDefinition<Blueprint> };
    const kit: KitDefinition<Blueprint> | undefined = loaded.KIT;
    if (kit === undefined || typeof kit.problems !== "function" || typeof kit.create !== "function" || typeof kit.check !== "function" || typeof kit.pauseActions !== "function") {
        throw new Error(`Kit ${meta.kit} (kits/${name}) must export KIT with problems, create, check and pauseActions.`);
    }
    return [meta.kit, kit];
}

/**
 * Loads one game folder and checks it against its kit.
 * @param root the scan root.
 * @param name the folder name under games/.
 * @param kits the kits found.
 * @returns the game.
 * @throws naming the game when its metadata, kit or blueprint is wrong.
 */
async function loadGame(root: string, name: string, kits: Readonly<Record<string, KitDefinition<Blueprint>>>): Promise<DiscoveredGame> {
    const folder: string = join(root, "games", name);
    const meta: GameMeta = gameMetaOf(readMeta(join(folder, "game.meta.json"), `games/${name}`), `games/${name}`);
    const kit: KitDefinition<Blueprint> | undefined = kits[meta.kit];
    if (kit === undefined) {
        throw new Error(`Game ${meta.id} (games/${name}) names the kit "${meta.kit}", which does not exist.`);
    }
    const entry: string = join(folder, "blueprint.ts");
    if (existsSync(entry) === false) {
        throw new Error(`Game ${meta.id} (games/${name}) has no blueprint.ts.`);
    }
    const loaded: Record<string, unknown> = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
    const candidates: unknown[] = looksLikeBlueprint(loaded.default) === true ? [loaded.default] : Object.values(loaded).filter(looksLikeBlueprint);
    if (candidates.length !== 1) {
        throw new Error(`Game ${meta.id} (games/${name}) must export exactly one blueprint from blueprint.ts, found ${candidates.length}.`);
    }
    const blueprint: Blueprint = candidates[0] as Blueprint;
    if (blueprint.box.id !== meta.id) {
        throw new Error(`Game ${meta.id} (games/${name}) has a blueprint whose box id is ${blueprint.box.id}.`);
    }
    if (blueprint.kit !== meta.kit) {
        throw new Error(`Game ${meta.id} (games/${name}) says kit "${meta.kit}" but its blueprint says "${blueprint.kit}".`);
    }
    const problems: string[] = kit.problems(blueprint);
    if (problems.length > 0) {
        throw new Error(`Game ${meta.id} (games/${name}) can't run on the ${meta.kit} kit: ${problems.join(" ")}`);
    }
    return { meta, blueprint, folder: name };
}

/**
 * The words of whatever a failed load threw.
 * @param error what was thrown.
 * @returns its message.
 */
function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Scans a root for kits and games. A folder that fails sits out, listed in `skipped`, and the rest load.
 * @param root a folder holding kits/ and games/.
 * @returns the kits by name, the games in shelf order, and the folders that sat out.
 */
export async function discover(root: string): Promise<Catalog> {
    const skipped: SkippedFolder[] = [];
    const kits: Record<string, KitDefinition<Blueprint>> = {};
    for (const name of foldersIn(join(root, "kits"))) {
        try {
            const [kitName, kit]: [string, KitDefinition<Blueprint>] = await loadKit(root, name);
            if (kits[kitName] !== undefined) {
                throw new Error(`The kit "${kitName}" is defined twice (kits/${name}).`);
            }
            kits[kitName] = kit;
        } catch (error: unknown) {
            skipped.push({ folder: `kits/${name}`, reason: reasonOf(error) });
        }
    }
    const games: DiscoveredGame[] = [];
    for (const name of foldersIn(join(root, "games"))) {
        try {
            const game: DiscoveredGame = await loadGame(root, name, kits);
            if (games.some((other: DiscoveredGame) => other.meta.id === game.meta.id) === true) {
                throw new Error(`The game id "${game.meta.id}" is used twice (games/${name}).`);
            }
            games.push(game);
        } catch (error: unknown) {
            skipped.push({ folder: `games/${name}`, reason: reasonOf(error) });
        }
    }
    const placeOf = (game: DiscoveredGame): number => game.meta.order ?? Number.MAX_SAFE_INTEGER;
    games.sort((first: DiscoveredGame, second: DiscoveredGame) => {
        if (placeOf(first) === placeOf(second)) {
            return first.meta.id.localeCompare(second.meta.id);
        }
        return placeOf(first) < placeOf(second) ? -1 : 1;
    });
    return { kits, games, skipped };
}
