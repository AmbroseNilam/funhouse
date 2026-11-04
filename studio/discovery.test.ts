// Proves discovery needs no edit elsewhere: a game folder and a kit folder dropped into a scan root appear
// on the shelf. A folder that fails to load sits out, named, while the rest load, and the real tree has none.

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

    it("finds the real games with none left out, Twenty Doors first", async () => {
        const catalog: Catalog = await discover(join(import.meta.dirname));
        assert.deepEqual(catalog.skipped, []);
        assert.equal(catalog.games[0]?.meta.id, "twentyDoors");
    });

    it("leaves out a game whose kit is unknown, naming it, and keeps the rest", async () => {
        await withRoot(async (root: string) => {
            writeKit(root);
            writeGame(root, "good", { id: "goodGame", kit: "echo", level: "visible" }, "echo", "goodGame");
            writeGame(root, "lost", { id: "lostGame", kit: "nowhere", level: "visible" }, "nowhere", "lostGame");
            const catalog: Catalog = await discover(root);
            assert.deepEqual(catalog.games.map((game) => game.meta.id), ["goodGame"]);
            assert.deepEqual(catalog.skipped.map((skipped) => skipped.folder), ["games/lost"]);
            assert.match(catalog.skipped[0]?.reason ?? "", /lostGame.*"nowhere"/);
        });
    });

    it("leaves out a game folder or a kit folder with no metadata", async () => {
        await withRoot(async (root: string) => {
            writeKit(root);
            writeGame(root, "bare", null, "echo", "bareGame");
            mkdirSync(join(root, "kits", "empty"), { recursive: true });
            const catalog: Catalog = await discover(root);
            assert.deepEqual(Object.keys(catalog.kits), ["echo"]);
            assert.deepEqual(catalog.skipped.map((skipped) => skipped.folder), ["kits/empty", "games/bare"]);
            assert.match(catalog.skipped[1]?.reason ?? "", /games\/bare has no game\.meta\.json/);
        });
    });

    it("leaves out a game its kit rejects, one that won't parse, and one that throws as it loads", async () => {
        await withRoot(async (root: string) => {
            writeKit(root);
            writeGame(root, "good", { id: "goodGame", kit: "echo", level: "visible" }, "echo", "goodGame");
            mkdirSync(join(root, "games", "broken"), { recursive: true });
            writeFileSync(join(root, "games", "broken", "game.meta.json"), JSON.stringify({ id: "brokenGame", kit: "echo", level: "visible" }));
            const blueprint: object = { kit: "echo", box: { ...WHO_FITS_BLUEPRINT.box, id: "brokenGame" }, decisions: { ...WHO_FITS_BLUEPRINT.decisions, prompts: [] } };
            writeFileSync(join(root, "games", "broken", "blueprint.ts"), `export const BLUEPRINT = ${JSON.stringify(blueprint)};\n`);
            mkdirSync(join(root, "games", "garbled"), { recursive: true });
            writeFileSync(join(root, "games", "garbled", "game.meta.json"), "{ not json");
            mkdirSync(join(root, "games", "throwing"), { recursive: true });
            writeFileSync(join(root, "games", "throwing", "game.meta.json"), JSON.stringify({ id: "throwingGame", kit: "echo", level: "visible" }));
            writeFileSync(join(root, "games", "throwing", "blueprint.ts"), "throw new Error(\"boom at load\");\n");
            const catalog: Catalog = await discover(root);
            assert.deepEqual(catalog.games.map((game) => game.meta.id), ["goodGame"]);
            assert.deepEqual(catalog.skipped.map((skipped) => skipped.folder), ["games/broken", "games/garbled", "games/throwing"]);
            assert.match(catalog.skipped[0]?.reason ?? "", /brokenGame.*can't run/);
            assert.match(catalog.skipped[2]?.reason ?? "", /boom at load/);
        });
    });

    it("keeps a kit that won't load from taking its neighbours with it", async () => {
        await withRoot(async (root: string) => {
            writeKit(root);
            writeGame(root, "good", { id: "goodGame", kit: "echo", level: "visible" }, "echo", "goodGame");
            mkdirSync(join(root, "kits", "bad"), { recursive: true });
            writeFileSync(join(root, "kits", "bad", "kit.meta.json"), JSON.stringify({ kit: "bad" }));
            writeFileSync(join(root, "kits", "bad", "index.ts"), "this is not code\n");
            writeGame(root, "orphan", { id: "orphanGame", kit: "bad", level: "visible" }, "bad", "orphanGame");
            const catalog: Catalog = await discover(root);
            assert.deepEqual(catalog.games.map((game) => game.meta.id), ["goodGame"]);
            assert.deepEqual(catalog.skipped.map((skipped) => skipped.folder), ["kits/bad", "games/orphan"]);
        });
    });

    it("leaves a game off the shelf if it can't be installed, and keeps the rest", async () => {
        await withRoot(async (root: string) => {
            writeKit(root);
            writeGame(root, "good", { id: "goodGame", kit: "echo", level: "visible" }, "echo", "goodGame");
            mkdirSync(join(root, "kits", "fragile"), { recursive: true });
            writeFileSync(join(root, "kits", "fragile", "kit.meta.json"), JSON.stringify({ kit: "fragile" }));
            writeFileSync(join(root, "kits", "fragile", "index.ts"), DUMMY_KIT.replace("create: (blueprint) => createFitsGame(blueprint.box, blueprint.decisions)", "create: () => { throw new Error(\"can't start\"); }"));
            writeGame(root, "fragile-game", { id: "fragileGame", kit: "fragile", level: "visible" }, "fragile", "fragileGame");
            const catalog: Catalog = await discover(root);
            assert.deepEqual(studioShelf([], false, catalog).map((game: InstalledGame) => game.manifest.id), ["goodGame"]);
        });
    });
});
