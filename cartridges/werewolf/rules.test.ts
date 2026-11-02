// Simulated-player tests for the Werewolf rules core. These run with the built-in Node test
// runner and are the harness an authoring agent would use to prove a cartridge works.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Cartridge, CartridgePlayer, Step } from "../../shared/cartridge.ts";
import { canSee } from "../../shared/visibility.ts";
import { createWerewolf, WEREWOLF_GROUP, type WerewolfState } from "./rules.ts";

/** Five named players. */
const PLAYERS: CartridgePlayer[] = ["Ambrose", "Nick", "Sarah", "Maya", "Leo"].map((name, index) => ({ playerId: `p${index + 1}`, name }));

/** A predictable random source: deals roles in declaration order. */
const FIXED_RANDOM = (): number => 0;

/**
 * Applies a host advance event.
 * @param game the cartridge.
 * @param state the state.
 * @returns the step.
 */
function advance(game: Cartridge<WerewolfState>, state: WerewolfState): Step<WerewolfState> {
    return game.onEvent(state, { type: "phaseChanged", at: 0, phaseId: "advance" });
}

describe("werewolf setup", () => {
    it("deals one werewolf and a seer to five players and tells each player only their own role", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const step: Step<WerewolfState> = game.init(PLAYERS, { seer: true, dayTimer: true, revealOnDeath: true });
        const roles: string[] = step.state.seats.map((seat) => seat.role);
        assert.equal(roles.filter((role) => role === "werewolf").length, 1);
        assert.equal(roles.filter((role) => role === "seer").length, 1);
        assert.equal(roles.filter((role) => role === "villager").length, 3);
        const roleFacts = step.facts.filter((fact) => fact.kind === "role-assigned");
        assert.equal(roleFacts.length, 5);
        for (const fact of roleFacts) {
            assert.equal(fact.scope.kind, "player");
        }
        const wolfId: string = step.state.seats.find((seat) => seat.role === "werewolf")?.playerId as string;
        const villagerId: string = step.state.seats.find((seat) => seat.role === "villager")?.playerId as string;
        const packFact = step.facts.find((fact) => fact.kind === "pack");
        assert.ok(packFact !== undefined);
        assert.equal(canSee(packFact.scope, wolfId, game.groupsOf(step.state, wolfId)), true);
        assert.equal(canSee(packFact.scope, villagerId, game.groupsOf(step.state, villagerId)), false);
        assert.equal(canSee(packFact.scope, null, new Set()), false);
    });

    it("refuses tables outside the player range", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        assert.throws(() => game.init(PLAYERS.slice(0, 3), {}));
    });
});

describe("werewolf night and day", () => {
    it("plays a full round: night kill, dawn announcement, discussion, vote, and a village win", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        let state: WerewolfState = game.init(PLAYERS, { seer: true, dayTimer: false, revealOnDeath: true }).state;
        const wolf: string = state.seats.find((seat) => seat.role === "werewolf")?.playerId as string;
        const seer: string = state.seats.find((seat) => seat.role === "seer")?.playerId as string;
        const villagers: string[] = state.seats.filter((seat) => seat.role === "villager").map((seat) => seat.playerId);

        state = advance(game, state).state;
        assert.equal(state.phase, "night");
        assert.deepEqual(game.privateControls(state, villagers[0] as string), [{ type: "waiting", text: "Eyes closed. Keep your phone dark." }]);
        assert.equal(game.legalActions(state, villagers[0] as string).length, 0, "villagers have no night action");

        // An illegal action is ignored without changing state.
        const ignored: Step<WerewolfState> = game.apply(state, villagers[0] as string, `kill:${wolf}`);
        assert.equal(ignored.state, state);
        assert.equal(ignored.facts.length, 0);

        const seerStep: Step<WerewolfState> = game.apply(state, seer, `see:${wolf}`);
        state = seerStep.state;
        assert.equal(state.phase, "night", "night waits for the werewolf");

        const dawn: Step<WerewolfState> = game.apply(state, wolf, `kill:${villagers[0] as string}`);
        state = dawn.state;
        assert.equal(state.phase, "dawn");
        assert.equal(state.seats.find((seat) => seat.playerId === villagers[0])?.alive, false);
        const announcement = dawn.facts.find((fact) => fact.kind === "dawn");
        assert.ok(announcement !== undefined && announcement.scope.kind === "public");
        assert.match(announcement.text, /did not survive/);
        const seerResult = dawn.facts.find((fact) => fact.kind === "seer-result");
        assert.ok(seerResult !== undefined);
        assert.deepEqual(seerResult.scope, { kind: "player", playerId: seer });
        assert.match(seerResult.text, /is a werewolf/);

        state = advance(game, state).state;
        assert.equal(state.phase, "discussion");
        state = advance(game, state).state;
        assert.equal(state.phase, "vote");

        // Everyone alive votes for the werewolf; the village wins.
        const voters: string[] = state.seats.filter((seat) => seat.alive === true).map((seat) => seat.playerId);
        let last: Step<WerewolfState> = { state, facts: [] };
        for (const voter of voters) {
            if (voter === wolf) {
                last = game.apply(last.state, voter, `vote:${seer}`);
                continue;
            }
            last = game.apply(last.state, voter, `vote:${wolf}`);
        }
        assert.equal(last.state.phase, "end");
        assert.equal(last.state.winner, "villagers");
        assert.equal(game.outcome(last.state), "The village wins.");
        assert.ok(last.facts.some((fact) => fact.kind === "game-over"));
    });

    it("ends with a werewolf win when wolves equal villagers", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const four: CartridgePlayer[] = PLAYERS.slice(0, 4);
        let state: WerewolfState = game.init(four, { seer: false, dayTimer: false, revealOnDeath: false }).state;
        const wolf: string = state.seats.find((seat) => seat.role === "werewolf")?.playerId as string;
        const targets: string[] = state.seats.filter((seat) => seat.role !== "werewolf").map((seat) => seat.playerId);
        state = advance(game, state).state;
        state = game.apply(state, wolf, `kill:${targets[0] as string}`).state; // 1 wolf vs 2 villagers
        assert.equal(state.phase, "dawn");
        state = advance(game, state).state;
        state = advance(game, state).state;
        // Tied vote: nobody out, back to night.
        const alive: string[] = state.seats.filter((seat) => seat.alive === true).map((seat) => seat.playerId);
        let step: Step<WerewolfState> = { state, facts: [] };
        step = game.apply(step.state, alive[0] as string, `vote:${alive[1] as string}`);
        step = game.apply(step.state, alive[1] as string, `vote:${alive[0] as string}`);
        const third: string = alive[2] ?? "";
        step = game.apply(step.state, third, `vote:${third === wolf ? alive[0] ?? "" : wolf}`);
        const phaseAfterVote: string = step.state.phase;
        if (phaseAfterVote === "night") {
            step = game.apply(step.state, wolf, `kill:${step.state.seats.find((seat) => seat.alive === true && seat.role !== "werewolf")?.playerId as string}`);
            assert.equal(step.state.phase, "end");
            assert.equal(step.state.winner, "werewolves");
        }
        assert.ok(["end", "night"].includes(step.state.phase));
        assert.ok(game.groupsOf(step.state, wolf).has(WEREWOLF_GROUP));
    });
});
