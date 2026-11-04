// The default check for any blueprint: rehearse it with its kit's paper players across seeds, with
// the model failing and succeeding, and, for a kit with a hidden role, check that who holds the
// role changes nothing anyone else sees. This is what "it passes rehearsal" means. How each kit is
// rehearsed lives with the kit in the registry.

import type { Blueprint } from "./blueprint.ts";
import { KITS, type KitDefinition } from "./registry.ts";
import type { RehearsalOptions, Tally } from "./rehearse.ts";

export { CHECK_SEEDS, rehearsePictureGame } from "./check-support.ts";

/**
 * Rehearses a blueprint the default way.
 * @param blueprint the game.
 * @param options content and players.
 * @returns the counts and every problem found.
 */
export function checkBlueprint(blueprint: Blueprint, options: RehearsalOptions = {}): Tally {
    const kit: KitDefinition<Blueprint> = KITS[blueprint.kit];
    return kit.check(blueprint, options);
}
