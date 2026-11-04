// The kits and games the scan of this folder tree found, loaded once at startup. Nothing here lists a kit
// or a game: adding either is adding a folder (see discovery.ts).

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Blueprint } from "./blueprint.ts";
import { discover, type Catalog } from "./discovery.ts";
import type { KitDefinition } from "./kit/definition.ts";

export type { KitDefinition } from "./kit/definition.ts";

/** Every kit and game under studio/, found by scanning. Loading throws if any is wrong. */
export const CATALOG: Catalog = await discover(dirname(fileURLToPath(import.meta.url)));

/** Every kit, by the name blueprints give it. */
export const KITS: Readonly<Record<string, KitDefinition<Blueprint>>> = CATALOG.kits;
