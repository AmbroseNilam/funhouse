// Proves Who Fits: prompts come from the model or the fallback bank, everyone taps someone else
// once, the TV reveals only counts when all have tapped or the clock runs out, totals add up over
// the rounds, a stale clock is ignored, leaving drops that player's taps, and the secrecy check
// catches a TV that gives away who tapped whom.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Cartridge, CartridgePlayer, LegalAction, Step } from "../../../shared/cartridge.ts";
import type { Control } from "../../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import { blueprintProblems } from "../../blueprint.ts";
import { checkBlueprint } from "../../check.ts";
import { WHO_FITS_BLUEPRINT } from "../../games/who-fits/blueprint.ts";
import type { KitGame } from "../../kit/kit.ts";
import { fitsPersonas, fitsTapCheck } from "../../personas.ts";
import { PAPER_PLAYERS, rehearseMany, stringsIn, type RoleCheck } from "../../rehearse.ts";
import { createFitsGame, FITS_PREFIX, type FitsDecisions, type FitsState } from "./tap-fits.ts";

/** Four at the table. */
const FOUR: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);

/** Who Fits' decisions. */
const DECISIONS: FitsDecisions = WHO_FITS_BLUEPRINT.decisions;

/**
 * Builds Who Fits and opens the first round with the fallback prompts.
 * @returns the game and the state while tapping.
 */
function start(): { game: KitGame<FitsState>; state: FitsState } {
    const game: KitGame<FitsState> = createFitsGame(WHO_FITS_BLUEPRINT.box, DECISIONS);
    const opened: Step<FitsState> = game.cartridge.onEvent(game.cartridge.init(FOUR, {}).state, { type: "contentReady", at: 0, text: "" });
    return { game, state: opened.state };
}

/**
 * Taps for each listed player.
 * @param game the game.
 * @param state the state.
 * @param taps target by tapper.
 * @returns the last step.
 */
function tapAll(game: KitGame<FitsState>, state: FitsState, taps: Record<string, string>): Step<FitsState> {
    let step: Step<FitsState> = { state, facts: [] };
    for (const [tapper, target] of Object.entries(taps)) {
        step = game.cartridge.apply(step.state, tapper, `${FITS_PREFIX}${target}`);
    }
    return step;
}

describe("who fits", () => {
    it("is runnable, asks the model for prompts, and plays the fallback bank when it fails", () => {
        assert.deepEqual(blueprintProblems(WHO_FITS_BLUEPRINT), []);
        const game: KitGame<FitsState> = createFitsGame(WHO_FITS_BLUEPRINT.box, DECISIONS);
        assert.match(game.cartridge.init(FOUR, {}).contentRequest ?? "", /JSON array/);
        const { state } = start();
        assert.equal(state.phase, "tapping");
        assert.deepEqual(state.prompts, DECISIONS.prompts.slice(0, 5));
        const written: Step<FitsState> = game.cartridge.onEvent(game.cartridge.init(FOUR, {}).state, { type: "contentReady", at: 0, text: '["Would win a pie contest"]' });
        assert.equal(written.state.prompts[0], "Would win a pie contest");
        assert.equal(written.state.prompts.length, 5, "topped up from the bank");
    });

    it("lets each player tap someone else once, and shows nobody who tapped whom", () => {
        const { game, state } = start();
        const options: string[] = game.cartridge.legalActions(state, "paper1").map((action: LegalAction) => action.actionId);
        assert.deepEqual(options, [`${FITS_PREFIX}paper2`, `${FITS_PREFIX}paper3`, `${FITS_PREFIX}paper4`]);
        assert.equal(game.cartridge.apply(state, "paper1", `${FITS_PREFIX}paper1`).state, state, "not yourself");
        const tapped: FitsState = game.cartridge.apply(state, "paper1", `${FITS_PREFIX}paper2`).state;
        assert.equal(game.cartridge.apply(tapped, "paper1", `${FITS_PREFIX}paper3`).state, tapped, "only once");
        assert.equal(stringsIn(game.cartridge.publicScene(tapped)).join(" ").includes("Spoon"), false, "the TV names nobody while tapping");
        const control: Control | undefined = game.cartridge.privateControls(tapped, "paper1")[0];
        assert.equal(control?.type, "waiting");
    });

    it("reveals only counts when everyone has tapped, then moves on and keeps totals", () => {
        const { game, state } = start();
        const revealed: Step<FitsState> = tapAll(game, state, { paper1: "paper2", paper2: "paper3", paper3: "paper2", paper4: "paper2" });
        assert.equal(revealed.state.phase, "reveal");
        assert.deepEqual(revealed.state.revealed, [{ playerId: "paper2", votes: 3 }, { playerId: "paper3", votes: 1 }]);
        assert.match(revealed.facts[0]?.text ?? "", /Spoon 3, Candle 1/);
        const tallyBlock: SceneBlock | undefined = game.cartridge.publicScene(revealed.state).blocks.find((block: SceneBlock) => block.type === "tally");
        assert.ok(tallyBlock?.type === "tally");
        assert.deepEqual(tallyBlock.rows.map((row) => `${row.label} ${row.count}`), ["Spoon 3", "Candle 1"]);
        const next: Step<FitsState> = game.cartridge.onEvent(revealed.state, { type: "timerFired", at: 60, timerId: "reveal0" });
        assert.equal(next.state.phase, "tapping");
        assert.equal(next.state.round, 1);
        assert.deepEqual(next.state.taps, {});
        assert.deepEqual(next.state.totals, { paper2: 3, paper3: 1 });
    });

    it("reveals what it has when the clock runs out, ignores a stale clock, and ends after the last prompt", () => {
        const { game, state } = start();
        const partial: FitsState = tapAll(game, state, { paper1: "paper2" }).state;
        const timedOut: Step<FitsState> = game.cartridge.onEvent(partial, { type: "timerFired", at: 40, timerId: "tap0" });
        assert.equal(timedOut.state.phase, "reveal");
        assert.equal(game.cartridge.onEvent(timedOut.state, { type: "timerFired", at: 41, timerId: "tap0" }).state, timedOut.state);
        let current: FitsState = timedOut.state;
        while (game.cartridge.outcome(current) === null) {
            const event: RoomEvent = current.phase === "tapping" ? { type: "timerFired", at: 0, timerId: `tap${current.round}` } : { type: "timerFired", at: 0, timerId: `reveal${current.round}` };
            current = game.cartridge.onEvent(current, event).state;
        }
        assert.equal(current.phase, "end");
        assert.equal(current.round, 4);
        assert.deepEqual(current.totals, { paper2: 1 });
    });

    it("drops a leaver's taps and taps for them, and reveals at once if everyone left has tapped", () => {
        const { game, state } = start();
        const tapped: FitsState = tapAll(game, state, { paper1: "paper4", paper2: "paper3", paper3: "paper2" }).state;
        const after: Step<FitsState> = game.cartridge.onEvent(tapped, { type: "playerLeft", at: 5, playerId: "paper4" });
        assert.equal(after.state.phase, "tapping", "the tap for the leaver is gone, so paper1 taps again");
        assert.equal(after.state.taps.paper1, undefined);
        const done: Step<FitsState> = game.cartridge.apply(after.state, "paper1", `${FITS_PREFIX}paper2`);
        assert.equal(done.state.phase, "reveal");
    });

    it("tells the host to be kind, and never who tapped whom", () => {
        const { game, state } = start();
        assert.match(game.cartridge.manifest.hostBrief, /never make one person the joke/);
        const told: string = game.cartridge.hostFacts(tapAll(game, state, { paper1: "paper2" }).state, { kind: "host" }).map((fact) => fact.text).join(" ");
        assert.equal(told, "1 of 4 have tapped.");
    });

    it("passes the default check, and its secrecy check catches a TV that shows a tap", () => {
        assert.deepEqual(checkBlueprint(WHO_FITS_BLUEPRINT).problems, []);
        assert.deepEqual(checkBlueprint(WHO_FITS_BLUEPRINT, { players: PAPER_PLAYERS.slice(0, 3) }).problems, []);
        const healthy: RoleCheck<FitsState> = fitsTapCheck(WHO_FITS_BLUEPRINT);
        const telling: RoleCheck<FitsState> = {
            script: healthy.script,
            deal: (seat: number, players: readonly CartridgePlayer[]): KitGame<FitsState> => {
                const game: KitGame<FitsState> = healthy.deal(seat, players);
                const rules: Cartridge<FitsState> = game.cartridge;
                const scene = (state: FitsState): Scene => ({ ...rules.publicScene(state), blocks: [...rules.publicScene(state).blocks, { type: "text", text: Object.values(state.taps).join(",") }] });
                return { cartridge: { ...rules, publicScene: scene }, hidden: (state: FitsState) => game.hidden(state) };
            },
        };
        const make = (): KitGame<FitsState> => createFitsGame(WHO_FITS_BLUEPRINT.box, DECISIONS);
        assert.match(rehearseMany(make, fitsPersonas(), [1], { roleCheck: telling }).problems.join("\n"), /role check: .*screen could tell/);
    });
});
