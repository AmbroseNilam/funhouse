// The kits and games the scan of this folder tree found, loaded once at startup. Nothing here lists a kit
// or a game: adding either is adding a folder (see discovery.ts).

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Blueprint } from "./blueprint.ts";
import { log } from "../room/log.ts";
import { discover, type Catalog, type SkippedFolder } from "./discovery.ts";
import type { KitDefinition } from "./kit/definition.ts";

export type { KitDefinition } from "./kit/definition.ts";

/** Every kit and game under studio/, found by scanning. A folder that fails sits out and is logged here. */
export const CATALOG: Catalog = await discover(dirname(fileURLToPath(import.meta.url)));

log("studio", `found ${Object.keys(CATALOG.kits).length} kits and ${CATALOG.games.length} games, ${CATALOG.skipped.length} left out`);
CATALOG.skipped.forEach((skipped: SkippedFolder) => { log("studio", `LEFT OUT ${skipped.folder}: ${skipped.reason}`); });

/** Every kit, by the name blueprints give it. */
export const KITS: Readonly<Record<string, KitDefinition<Blueprint>>> = CATALOG.kits;
