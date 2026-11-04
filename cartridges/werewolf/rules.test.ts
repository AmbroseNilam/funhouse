// Simulated-player tests for the Werewolf rules core: the role sets, each step of play, and the
// checks that no secret reaches the TV, the host or the wrong phone.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Cartridge, CartridgePlayer, Step } from "../../shared/cartridge.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import { canSee } from "../../shared/visibility.ts";
import { createWerewolf, rolesFor, presetSetup, describeRoles, WEREWOLF_GROUP, type Phase, type Role, type WerewolfState } from "./rules.ts";

/** Ten named players. */
const TABLE: CartridgePlayer[] = ["Ambrose", "Nick", "Sarah", "Maya", "Leo", "Ivy", "Omar", "Zed", "Kit", "Bea"].map((name, index) => ({ playerId: `p${index + 1}`, name }));

/** A predictable random source. */
const FIXED_RANDOM = (): number => 0;

/** The variants a room starts with. */
const VARIANTS: Record<string, boolean> = { dayTimer: true, revealOnDeath: true };

/**
 * Fires a timer the way the room does.
 * @param game the cartridge.
 * @param state the state.
 * @param timerId the timer.
 * @returns the step.
 */
function fire(game: Cartridge<WerewolfState>, state: WerewolfState, timerId: string): Step<WerewolfState> {
    const event: RoomEvent = { type: "timerFired", at: 0, timerId };
    return game.onEvent(state, event);
}

/**
 * Finds the player holding a role.
 * @param state the state.
 * @param role the role.
 * @returns their id.
 */
function holder(state: WerewolfState, role: Role): string {
    const seat = state.seats.find((candidate) => candidate.role === role && candidate.alive === true);
    assert.ok(seat !== undefined, `nobody alive is the ${role}`);
    return seat.playerId;
}

/**
 * Plays from the start to the first night.
 * @param game the cartridge.
 * @param count players.
 * @param setup special roles to switch on or off first, by name.
 * @returns the state at the first night.
 */
function toFirstNight(game: Cartridge<WerewolfState>, count: number, setup: string[] = []): WerewolfState {
    let state: WerewolfState = game.init(TABLE.slice(0, count), VARIANTS).state;
    for (const special of setup) {
        state = game.apply(state, "p1", `setup:${special}`).state;
    }
    state = game.apply(state, "p1", "setup:go").state;
    assert.equal(state.phase, "intro");
    for (const seat of state.seats) {
        state = game.apply(state, seat.playerId, "gotIt").state;
    }
    assert.equal(state.phase, "roles");
    for (const seat of state.seats) {
        state = game.apply(state, seat.playerId, "gotIt").state;
    }
    assert.equal(state.phase, "night");
    return state;
}

/**
 * Plays out a night from choices, then the hold.
 * @param game the cartridge.
 * @param state the night.
 * @param victim who the wolves choose.
 * @param healed who the doctor protects, if there is one.
 * @returns the step after the night.
 */
function playNight(game: Cartridge<WerewolfState>, state: WerewolfState, victim: string, healed?: string): Step<WerewolfState> {
    let next: WerewolfState = state;
    for (const seat of next.seats.filter((candidate) => candidate.alive === true)) {
        if (seat.role === "werewolf") {
            next = game.apply(next, seat.playerId, `kill:${victim}`).state;
        }
        if (seat.role === "seer") {
            const target = next.seats.find((candidate) => candidate.alive === true && candidate.playerId !== seat.playerId);
            next = game.apply(next, seat.playerId, `see:${target?.playerId ?? ""}`).state;
        }
        if (seat.role === "doctor") {
            next = game.apply(next, seat.playerId, `heal:${healed ?? seat.playerId}`).state;
        }
    }
    assert.equal(next.nightSettled, true, "every night choice should be in");
    return fire(game, next, "night");
}

/**
 * Everyone alive votes as told.
 * @param game the cartridge.
 * @param state the vote.
 * @param choose who a voter votes for.
 * @returns the last step.
 */
function playVote(game: Cartridge<WerewolfState>, state: WerewolfState, choose: (voter: string) => string): Step<WerewolfState> {
    let last: Step<WerewolfState> = { state, facts: [] };
    for (const seat of state.seats.filter((candidate) => candidate.alive === true)) {
        last = game.apply(last.state, seat.playerId, `vote:${choose(seat.playerId)}`);
    }
    return last;
}

/**
 * From dawn to the vote, by way of everyone tapping Ready.
 * @param game the cartridge.
 * @param state the dawn.
 * @returns the vote.
 */
function toVote(game: Cartridge<WerewolfState>, state: WerewolfState): WerewolfState {
    let next: WerewolfState = fire(game, state, "dawn").state;
    assert.equal(next.phase, "discussion");
    for (const seat of next.seats.filter((candidate) => candidate.alive === true)) {
        if (next.phase === "discussion") {
            next = game.apply(next, seat.playerId, "ready").state;
        }
    }
    assert.equal(next.phase, "vote");
    return next;
}

describe("werewolf role sets", () => {
    it("has a set for every table, with fewer wolves than half and an honest count", () => {
        const expected: Record<number, string> = {
            4: "1 werewolf, 1 seer, 2 villagers",
            5: "1 werewolf, 1 seer, 3 villagers",
            6: "1 werewolf, 1 seer, 4 villagers",
            7: "2 werewolves, 1 seer, 1 doctor, 3 villagers",
            8: "2 werewolves, 1 seer, 1 doctor, 4 villagers",
            9: "2 werewolves, 1 seer, 1 doctor, 1 hunter, 4 villagers",
            10: "3 werewolves, 1 seer, 1 doctor, 1 hunter, 4 villagers",
        };
        for (const [count, line] of Object.entries(expected)) {
            const roles: Role[] = rolesFor(Number(count), presetSetup(Number(count)));
            assert.equal(roles.length, Number(count));
            assert.equal(describeRoles(roles), line);
        }
    });
});

describe("werewolf pick step", () => {
    it("offers only the host's choice below six and fires by itself", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const start: Step<WerewolfState> = game.init(TABLE.slice(0, 5), VARIANTS);
        assert.equal(start.state.phase, "pick");
        assert.equal(start.timers?.pick, 15);
        assert.deepEqual(game.legalActions(start.state, "p1").map((action) => action.label), ["Start with these"]);
        const dealt: Step<WerewolfState> = fire(game, start.state, "pick");
        assert.equal(dealt.state.phase, "intro");
        assert.equal(dealt.state.seats.filter((seat) => seat.role === "werewolf").length, 1);
        assert.equal(dealt.state.seats.filter((seat) => seat.role === "seer").length, 1);
    });

    it("lets six or more toggle roles, restarts the clock, and deals what was chosen", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const start: WerewolfState = game.init(TABLE.slice(0, 6), VARIANTS).state;
        assert.ok(game.legalActions(start, "p2").some((action) => action.label === "Doctor: out"));
        const toggled: Step<WerewolfState> = game.apply(start, "p2", "setup:doctor");
        assert.equal(toggled.timers?.pick, 15);
        assert.ok(game.legalActions(toggled.state, "p2").some((action) => action.label === "Doctor: in"));
        const undone: Step<WerewolfState> = game.apply(toggled.state, "p2", "setup:host");
        assert.equal(undone.state.phase, "pick", "going back to the host's pick doesn't start the game");
        assert.equal(undone.state.setup.doctor, false);
        const dealt: WerewolfState = game.apply(toggled.state, "p3", "setup:go").state;
        assert.equal(dealt.seats.filter((seat) => seat.role === "doctor").length, 1);
        assert.equal(dealt.seats.filter((seat) => seat.role === "hunter").length, 0);
    });

    it("ends the game if the table falls too small before the deal", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const start: WerewolfState = game.init(TABLE.slice(0, 4), VARIANTS).state;
        const left: Step<WerewolfState> = game.onEvent(start, { type: "playerLeft", at: 0, playerId: "p1" });
        assert.equal(left.state.phase, "end");
        assert.equal(left.state.winner, "nobody");
    });
});

describe("werewolf intro and role card", () => {
    it("shows the rules and Got it on every phone, then each player's own role, face up then hidden", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        let state: WerewolfState = game.apply(game.init(TABLE.slice(0, 5), VARIANTS).state, "p1", "setup:go").state;
        for (const seat of state.seats) {
            const controls = game.privateControls(state, seat.playerId);
            assert.ok(controls.some((control) => control.type === "roleCard" && control.title === "How it works" && control.secret === false));
            assert.ok(controls.some((control) => control.type === "buttons" && control.options[0]?.label === "Got it"));
        }
        state = fire(game, state, "intro").state;
        assert.equal(state.phase, "roles");
        for (const seat of state.seats) {
            const card = game.privateControls(state, seat.playerId).find((control) => control.type === "roleCard");
            assert.ok(card?.type === "roleCard" && card.secret === true && card.startHidden === false && card.title.includes(seat.role));
        }
        state = fire(game, state, "roles").state;
        assert.equal(state.phase, "night");
        const card = game.privateControls(state, "p1").find((control) => control.type === "roleCard");
        assert.ok(card?.type === "roleCard" && card.startHidden === true);
    });
});

describe("werewolf night", () => {
    it("holds after the last choice, kills at dawn, tells only the seer, and rejects illegal actions", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const state: WerewolfState = toFirstNight(game, 5);
        const wolf: string = holder(state, "werewolf");
        const seer: string = holder(state, "seer");
        const villager: string = holder(state, "villager");
        const ignored: Step<WerewolfState> = game.apply(state, villager, `kill:${seer}`);
        assert.equal(ignored.state, state);
        const seen: Step<WerewolfState> = game.apply(state, seer, `see:${wolf}`);
        assert.equal(seen.state.nightSettled, false);
        const chosen: Step<WerewolfState> = game.apply(seen.state, wolf, `kill:${villager}`);
        assert.equal(chosen.state.nightSettled, true);
        assert.equal(chosen.state.phase, "night", "the night holds a moment");
        assert.equal(chosen.timers?.night, 6);
        const dawn: Step<WerewolfState> = fire(game, chosen.state, "night");
        assert.equal(dawn.state.phase, "dawn");
        const result = dawn.facts.find((fact) => fact.kind === "seer-result");
        assert.ok(result !== undefined);
        assert.deepEqual(result.scope, { kind: "player", playerId: seer });
        assert.match(result.text, /is a werewolf/);
    });

    it("lets the doctor save, says nothing of why, and refuses the same save twice running", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const state: WerewolfState = toFirstNight(game, 7);
        const villager: string = holder(state, "villager");
        const dawn: Step<WerewolfState> = playNight(game, state, villager, villager);
        assert.equal(dawn.state.seats.find((seat) => seat.playerId === villager)?.alive, true);
        assert.equal(dawn.state.moment?.heading, "Everyone survived the night");
        assert.equal(JSON.stringify(dawn.facts).includes("doctor"), false);
        const nextNight: WerewolfState = { ...dawn.state, phase: "night" };
        assert.equal(game.legalActions(nextNight, holder(nextNight, "doctor")).some((action) => action.actionId === `heal:${villager}`), false);
    });

    it("settles a split pack at random between their picks", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const state: WerewolfState = toFirstNight(game, 7);
        const wolves: string[] = state.seats.filter((seat) => seat.role === "werewolf").map((seat) => seat.playerId);
        const targets: string[] = state.seats.filter((seat) => seat.role === "villager").map((seat) => seat.playerId);
        const split: WerewolfState = { ...state, nightChoices: { [wolves[0] ?? ""]: targets[0] ?? "", [wolves[1] ?? ""]: targets[1] ?? "" } };
        const dawn: Step<WerewolfState> = fire(game, split, "night");
        assert.equal(dawn.state.seats.filter((seat) => seat.alive === false).length, 1);
    });
});

describe("werewolf vote", () => {
    it("runs a runoff on a first tie and calls a second tie for nobody", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 6);
        const wolf: string = holder(night, "werewolf");
        const villagers: string[] = night.seats.filter((seat) => seat.role === "villager").map((seat) => seat.playerId);
        const dawn: WerewolfState = playNight(game, night, villagers[0] ?? "").state;
        const vote: WerewolfState = toVote(game, dawn);
        const living: string[] = vote.seats.filter((seat) => seat.alive === true).map((seat) => seat.playerId);
        const [first = "", second = ""] = living;
        const tied: Step<WerewolfState> = fire(game, { ...vote, dayVotes: { [first]: second, [second]: first } }, "vote");
        assert.equal(tied.state.phase, "vote", tied.state.phase);
        if (tied.state.runoff === null) {
            assert.fail("expected a runoff");
        }
        const runoff: string[] = tied.state.runoff;
        assert.equal(game.legalActions(tied.state, living[2] ?? "").every((action) => runoff.some((id) => action.actionId === `vote:${id}`)), true);
        const again: Step<WerewolfState> = fire(game, { ...tied.state, dayVotes: { [first]: second, [second]: first } }, "vote");
        assert.equal(again.state.phase, "verdict");
        assert.match(again.state.moment?.heading ?? "", /nobody is out/);
        assert.equal(game.groupsOf(again.state, wolf).has(WEREWOLF_GROUP), true);
    });

    it("keeps a live count on the TV, and shows a verdict before night", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 6);
        const wolf: string = holder(night, "werewolf");
        const villagers: string[] = night.seats.filter((seat) => seat.role === "villager").map((seat) => seat.playerId);
        const vote: WerewolfState = toVote(game, playNight(game, night, villagers[0] ?? "").state);
        const oneIn: WerewolfState = game.apply(vote, wolf, `vote:${villagers[1] ?? ""}`).state;
        const tally = game.publicScene(oneIn).blocks.find((block) => block.type === "tally");
        assert.ok(tally?.type === "tally" && tally.rows.some((row) => row.count === 1));
        const verdict: Step<WerewolfState> = playVote(game, vote, (voter) => (voter === villagers[1] ? wolf : villagers[1] ?? ""));
        assert.equal(verdict.state.phase, "verdict");
        assert.equal(fire(game, verdict.state, "verdict").state.phase, "night");
    });

    it("ends with a village win once the wolf is voted out", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 5);
        const wolf: string = holder(night, "werewolf");
        const vote: WerewolfState = toVote(game, playNight(game, night, holder(night, "villager")).state);
        const voted: Step<WerewolfState> = playVote(game, vote, (voter) => (voter === wolf ? holder(vote, "seer") : wolf));
        assert.equal(voted.state.winner, "villagers");
        assert.equal(game.outcome(voted.state), "The village wins.");
        const roster = game.publicScene(voted.state).blocks.find((block) => block.type === "roster");
        assert.ok(roster?.type === "roster" && roster.players.some((player) => player.badge === "werewolf"));
    });

    it("ends with a wolf win when the wolf matches the village", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 4);
        const wolf: string = holder(night, "werewolf");
        const seer: string = holder(night, "seer");
        const vote: WerewolfState = toVote(game, playNight(game, night, holder(night, "villager")).state);
        const voted: Step<WerewolfState> = playVote(game, vote, (voter) => (voter === seer ? wolf : seer));
        assert.equal(voted.state.winner, "werewolves");
    });
});

describe("werewolf hunter", () => {
    it("shoots at dawn before the game goes on, and keeps the shot if time runs out", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 6, ["hunter"]);
        const hunter: string = holder(night, "hunter");
        const wolf: string = holder(night, "werewolf");
        const shot: Step<WerewolfState> = playNight(game, night, hunter);
        assert.equal(shot.state.phase, "hunter");
        assert.deepEqual(game.turn?.(shot.state), { kind: "one", playerId: hunter, label: "The hunter aims" });
        const hit: Step<WerewolfState> = game.apply(shot.state, hunter, `shoot:${wolf}`);
        assert.equal(hit.state.winner, "villagers");
        const missed: Step<WerewolfState> = fire(game, shot.state, "hunter");
        assert.equal(missed.state.phase, "dawn");
    });
});

describe("werewolf for the eliminated", () => {
    it("gives a ghost a guess and no vote, and shows the right guesses at the end", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 6);
        const wolf: string = holder(night, "werewolf");
        const ghost: string = holder(night, "villager");
        const dawn: WerewolfState = playNight(game, night, ghost).state;
        const vote: WerewolfState = toVote(game, dawn);
        assert.equal(game.apply(vote, ghost, `vote:${wolf}`).state, vote, "the dead don't vote");
        const guessed: WerewolfState = game.apply(vote, ghost, `ghost:${wolf}`).state;
        assert.equal(JSON.stringify(game.publicScene(guessed)).includes("called it"), false);
        const voted: Step<WerewolfState> = playVote(game, guessed, (voter) => (voter === wolf ? holder(guessed, "seer") : wolf));
        assert.equal(voted.state.winner, "villagers");
        assert.match(JSON.stringify(game.publicScene(voted.state)), /called it/);
    });
});

describe("werewolf phone screens", () => {
    it("asks one question on the pick step, with one big action and no leftover hint", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const start: WerewolfState = game.init(TABLE.slice(0, 4), VARIANTS).state;
        const controls = game.privateControls(start, "p1");
        assert.equal(controls.some((control) => control.type === "waiting"), false);
        const card = controls[0];
        assert.ok(card?.type === "roleCard" && card.title === "Play this village?");
        assert.deepEqual(card.lines, ["1 werewolf", "1 seer", "2 villagers"]);
        const last = controls.at(-1);
        assert.ok(last?.type === "buttons" && last.options.length === 1 && last.options[0]?.style === "primary");
        assert.equal(game.turn?.(start)?.kind, "anyone");
    });

    it("marks what a player chose, and only on their own phone", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 6);
        const wolf: string = holder(night, "werewolf");
        const villager: string = holder(night, "villager");
        const chosen: WerewolfState = game.apply(night, wolf, `kill:${villager}`).state;
        const choice = game.privateControls(chosen, wolf).find((control) => control.type === "choice");
        assert.ok(choice?.type === "choice" && choice.options.some((option) => option.selected === true && option.id === `kill:${villager}`));
        assert.equal(JSON.stringify(game.privateControls(chosen, villager)).includes("You chose"), false);
    });

    it("tells every phone who won and every role at the end, but not before", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 5);
        const wolf: string = holder(night, "werewolf");
        const seer: string = holder(night, "seer");
        const vote: WerewolfState = toVote(game, playNight(game, night, holder(night, "villager")).state);
        assert.equal(JSON.stringify(game.privateControls(vote, seer)).includes(": werewolf"), false);
        const voted: WerewolfState = playVote(game, vote, (voter) => (voter === wolf ? seer : wolf)).state;
        const card = game.privateControls(voted, seer)[0];
        assert.ok(card?.type === "roleCard" && card.title === "The village wins" && card.lines?.some((line) => line.endsWith(": werewolf")) === true);
    });
});

describe("werewolf when someone leaves", () => {
    it("waits for the hunter's shot before calling a winner", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 6, ["hunter"]);
        const hunter: string = holder(night, "hunter");
        const wolf: string = holder(night, "werewolf");
        const villagers: string[] = night.seats.filter((seat) => seat.role === "villager").map((seat) => seat.playerId);
        const aiming: WerewolfState = { ...night, phase: "hunter", hunterId: hunter, seats: night.seats.map((seat) => (seat.playerId === hunter || seat.role === "seer" || seat.playerId === villagers[0] ? { ...seat, alive: false } : seat)) };
        const left: Step<WerewolfState> = game.onEvent(aiming, { type: "playerLeft", at: 0, playerId: villagers[1] ?? "" });
        assert.equal(left.state.phase, "hunter");
        assert.equal(game.apply(left.state, hunter, `shoot:${wolf}`).state.winner, "villagers");
    });

    it("moves on if the hunter leaves while aiming", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 6, ["hunter"]);
        const hunter: string = holder(night, "hunter");
        const shot: WerewolfState = playNight(game, night, hunter).state;
        assert.equal(game.onEvent(shot, { type: "playerLeft", at: 0, playerId: hunter }).state.phase, "dawn");
    });

    it("doesn't show the dead a role nobody announced", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 6);
        const villager: string = holder(night, "villager");
        const seer: string = holder(night, "seer");
        const dawn: WerewolfState = playNight(game, night, villager).state;
        const left: WerewolfState = game.onEvent(dawn, { type: "playerLeft", at: 0, playerId: seer }).state;
        assert.equal(JSON.stringify(game.privateControls(left, villager)).includes("was the seer"), false);
    });

    it("gives the night time again when someone leaving undoes its choices", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 6);
        const wolf: string = holder(night, "werewolf");
        const seer: string = holder(night, "seer");
        const villager: string = holder(night, "villager");
        const seen: WerewolfState = game.apply(night, seer, `see:${wolf}`).state;
        const settled: WerewolfState = game.apply(seen, wolf, `kill:${villager}`).state;
        assert.equal(settled.nightSettled, true);
        const left: Step<WerewolfState> = game.onEvent(settled, { type: "playerLeft", at: 0, playerId: villager });
        assert.equal(left.state.nightSettled, false);
        assert.equal(left.timers?.night, 20);
    });
});

describe("werewolf leak checks", () => {
    it("never shows a living player's secret to the TV, the host or another phone", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const night: WerewolfState = toFirstNight(game, 7);
        const wolves: string[] = night.seats.filter((seat) => seat.role === "werewolf").map((seat) => seat.playerId);
        const villager: string = holder(night, "villager");
        const healed: string = holder(night, "seer");
        const seen: Phase[] = [];
        const check = (state: WerewolfState): void => {
            seen.push(state.phase);
            const publicText: string = JSON.stringify([game.publicScene(state), game.hostFacts(state, { kind: "host" }), game.turn?.(state)]);
            for (const seat of state.seats.filter((candidate) => candidate.alive === true)) {
                assert.equal(publicText.includes(`${seat.name} was a`), false, `${seat.name}'s role showed in ${state.phase}`);
                assert.equal(publicText.includes(`${seat.name} is a`), false);
            }
            assert.equal(publicText.includes("wants"), false);
            for (const seat of state.seats) {
                const phone: string = JSON.stringify(game.privateControls(state, seat.playerId));
                for (const other of state.seats.filter((candidate) => candidate.playerId !== seat.playerId)) {
                    assert.equal(phone.includes(`You are ${other.role === "werewolf" ? "a werewolf" : "__"}`) && seat.role !== "werewolf", false);
                }
                if (seat.alive === true && seat.role !== "werewolf" && state.phase !== "end") {
                    assert.equal(phone.includes("wants"), false, "only the pack sees the pack's picks");
                    assert.equal(/kill:/.test(phone), false);
                }
            }
        };
        check(night);
        const choosing: WerewolfState = game.apply(night, wolves[0] ?? "", `kill:${villager}`).state;
        check(choosing);
        const dawn: WerewolfState = playNight(game, choosing, villager, healed).state;
        check(dawn);
        const vote: WerewolfState = toVote(game, dawn);
        check(vote);
        assert.ok(seen.includes("night") && seen.includes("dawn") && seen.includes("vote"));
    });

    it("gives the pack's fact to the pack and nobody else", () => {
        const game: Cartridge<WerewolfState> = createWerewolf(FIXED_RANDOM);
        const dealt: Step<WerewolfState> = game.apply(game.init(TABLE.slice(0, 7), VARIANTS).state, "p1", "setup:go");
        const pack = dealt.facts.find((fact) => fact.kind === "pack");
        assert.ok(pack !== undefined);
        for (const seat of dealt.state.seats) {
            assert.equal(canSee(pack.scope, seat.playerId, game.groupsOf(dealt.state, seat.playerId)), seat.role === "werewolf");
        }
        assert.equal(canSee(pack.scope, null, new Set()), false);
    });
});
