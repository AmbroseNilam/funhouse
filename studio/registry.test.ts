// Proves the registry hands the shelf what each kit promises: every shipped game has an entry, and the
// games whose blueprints switch the give-up button on show it in the pause menu.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blueprintPauseActions } from "./blueprint.ts";
import { MIND_THE_GAP_BLUEPRINT } from "./games/mind-the-gap/blueprint.ts";
import { OFF_BY_A_MILE_BLUEPRINT } from "./games/off-by-a-mile/blueprint.ts";
import { PAST_THE_GATE_BLUEPRINT } from "./games/past-the-gate/blueprint.ts";
import { BLUEPRINTS } from "./shelf.ts";

describe("kit registry", () => {
    it("shows the give-up row for gate, estimate and line games that turn it on", () => {
        for (const blueprint of [PAST_THE_GATE_BLUEPRINT, OFF_BY_A_MILE_BLUEPRINT, MIND_THE_GAP_BLUEPRINT]) {
            assert.deepEqual(blueprintPauseActions(blueprint), [{ id: "giveup", label: "We give up" }], blueprint.box.id);
        }
    });

    it("has a pause menu answer for every shelf game", () => {
        for (const blueprint of BLUEPRINTS) {
            assert.equal(Array.isArray(blueprintPauseActions(blueprint)), true, blueprint.box.id);
        }
    });
});
