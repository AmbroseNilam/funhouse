// Proves discovery needs no edit elsewhere: a game folder and a kit folder dropped into a scan root appear
// on the shelf, and an unknown kit, a missing metadata file or a blueprint its kit rejects stops startup.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import type { InstalledGame } from "../cartridges/index.ts";
import { discover, type Catalog } from "./discovery.ts";
import { WHO_FITS_BLUEPRINT } from "./games/who-fits/blueprint.ts";
import { studioShelf } from "./shelf.ts";

const FITS_MODULE: string = pathToFileURL(join(import.meta.dirname, "kits", "tap", "tap-fits.ts")).href;

/** A kit that borrows the tap-fits rules under another name, written as a folder would be. */
const DUMMY_KIT: string = `import { createFitsGame, fitsBlueprintProblems } from "${FITS_MODULE}";
export const KIT = {
    problems: (blueprint) => fitsBlueprintProblems(blueprint.box, blueprint.decisions),
    create: (blueprint) => createFitsGame(blueprint.box, blueprint.decisions),
    check: () => { throw new Error("not rehearsed here"); },
    pauseActions: () => [],
};
`;

/**
 * Writes a game folder.
 * @param root the scan root.
 * @param folder the folder name.
 * @param meta the metadata object, or null to leave the file out.
 * @param kit the kit name the blueprint declares.
 * @param id the box id.
 */
function writeGame(root: string, folder: string, meta: object | null, kit: string, id: string): void {
    mkdirSync(join(root, "games", folder), { recursive: true });
    if (meta !== null) {
        writeFileSync(join(root, "games", folder, "game.meta.json"), JSON.stringify(meta));
    }
    const blueprint: object = { kit, box: { ...WHO_FITS_BLUEPRINT.box, id }, decisions: WHO_FITS_BLUEPRINT.decisions };
    writeFileSync(join(root, "games", folder, "blueprint.ts"), `export const BLUEPRINT = ${JSON.stringify(blueprint)};\n`);
}

/**
 * Writes the dummy kit folder.
 * @param root the scan root.
 */
function writeKit(root: string): void {
    mkdirSync(join(root, "kits", "echo"), { recursive: true });
    writeFileSync(join(root, "kits", "echo", "kit.meta.json"), JSON.stringify({ kit: "echo" }));
    writeFileSync(join(root, "kits", "echo", "index.ts"), DUMMY_KIT);
}

/**
 * Runs a body with a fresh scan root, then removes it.
 * @param body the test.
 */
async function withRoot(body: (root: string) => Promise<void>): Promise<void> {
    const root: string = mkdtempSync(join(tmpdir(), "studio-scan-"));
    try {
        await body(root);
        return;
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

describe("discovery", () => {
    it("puts a dropped-in kit and game on the shelf with no edit to any other file", async () => {
        await withRoot(async (root: string) => {
            writeKit(root);
            writeGame(root, "echo-game", { id: "echoGame", kit: "echo", level: "visible" }, "echo", "echoGame");
            writeGame(root, "echo-held", { id: "echoHeld", kit: "echo", level: "held", reason: "not run yet", order: 5 }, "echo", "echoHeld");
            const catalog: Catalog = await discover(root);
            assert.deepEqual(Object.keys(catalog.kits), ["echo"]);
            assert.deepEqual(catalog.games.map((game) => game.meta.id), ["echoHeld", "echoGame"]);
            const shown: string[] = studioShelf([], false, catalog).map((game: InstalledGame) => game.manifest.id);
            assert.deepEqual(shown, ["echoGame"]);
            const all: InstalledGame[] = studioShelf([], true, catalog);
            assert.deepEqual(all.map((game: InstalledGame) => game.manifest.id), ["echoHeld", "echoGame"]);
            assert.equal(all[0]?.pitch.startsWith("Testing. "), true);
        });
    });

    it("finds the real games in the real folders, in the shelf order the room has always had", async () => {
        const catalog: Catalog = await discover(join(import.meta.dirname));
        assert.equal(catalog.games[0]?.meta.id, "twentyDoors");
        assert.equal(catalog.games.length, 21);
        assert.equal(catalog.games.filter((game) => game.meta.level === "held").length, 9);
    });

    it("throws, naming the game, when its kit is unknown", async () => {
        await withRoot(async (root: string) => {
            writeKit(root);
            writeGame(root, "lost", { id: "lostGame", kit: "nowhere", level: "visible" }, "nowhere", "lostGame");
            await assert.rejects(discover(root), /lostGame.*"nowhere"/);
        });
    });

    it("throws when a game folder has no metadata, and when a kit folder has none", async () => {
        await withRoot(async (root: string) => {
            writeKit(root);
            writeGame(root, "bare", null, "echo", "bareGame");
            await assert.rejects(discover(root), /games\/bare has no game\.meta\.json/);
        });
        await withRoot(async (root: string) => {
            mkdirSync(join(root, "kits", "empty"), { recursive: true });
            await assert.rejects(discover(root), /kits\/empty has no kit\.meta\.json/);
        });
    });

    it("throws, naming the game, when its kit says the blueprint can't run", async () => {
        await withRoot(async (root: string) => {
            writeKit(root);
            mkdirSync(join(root, "games", "broken"), { recursive: true });
            writeFileSync(join(root, "games", "broken", "game.meta.json"), JSON.stringify({ id: "brokenGame", kit: "echo", level: "visible" }));
            const blueprint: object = { kit: "echo", box: { ...WHO_FITS_BLUEPRINT.box, id: "brokenGame" }, decisions: { ...WHO_FITS_BLUEPRINT.decisions, prompts: [] } };
            writeFileSync(join(root, "games", "broken", "blueprint.ts"), `export const BLUEPRINT = ${JSON.stringify(blueprint)};\n`);
            await assert.rejects(discover(root), /brokenGame.*can't run/);
        });
    });
});
