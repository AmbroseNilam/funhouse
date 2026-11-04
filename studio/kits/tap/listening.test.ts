// Proves the tap games never listen: every phase of Who Fits, Under the Cup and Magpie Pockets is muted, so
// the phone neither asks for the microphone for them nor shows hold-to-talk.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PhaseSpec } from "../../../shared/cartridge.ts";
import { listeningAllowsTalk } from "../../../shared/controls.ts";
import { createKitGame, type Blueprint } from "../../blueprint.ts";
import { MAGPIE_POCKETS_BLUEPRINT } from "../../games/magpie-pockets/blueprint.ts";
import { UNDER_THE_CUP_BLUEPRINT } from "../../games/under-the-cup/blueprint.ts";
import { WHO_FITS_BLUEPRINT } from "../../games/who-fits/blueprint.ts";

describe("tap games", () => {
    it("declare every phase muted, so no phone offers to talk", () => {
        const games: Blueprint[] = [WHO_FITS_BLUEPRINT, UNDER_THE_CUP_BLUEPRINT, MAGPIE_POCKETS_BLUEPRINT];
        for (const blueprint of games) {
            for (const phase of createKitGame(blueprint).cartridge.manifest.phases) {
                const spec: PhaseSpec = phase;
                assert.equal(listeningAllowsTalk(spec.listening["*"] ?? "holdToTalk"), false, `${blueprint.box.id} ${spec.id}`);
            }
        }
    });
});
