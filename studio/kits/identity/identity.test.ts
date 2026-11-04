// Proves Name Tag: identities come from the model or the fallback bank and are dealt one per seat,
// the owner never sees their own, a guess is judged in code from the real name, questions and clocks
// end turns, scores add up, a leaver is handled, the blueprint passes the default check, and planted
// leaks (own name tag on the owner's phone, on the TV, to the host) are all caught.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Cartridge, CartridgePlayer, Step } from "../../../shared/cartridge.ts";
import type { Control } from "../../../shared/controls.ts";
import type { Scene } from "../../../shared/scene.ts";
import type { ScopedFact } from "../../../shared/visibility.ts";
import { blueprintProblems } from "../../blueprint.ts";
import { checkBlueprint } from "../../check.ts";
import { NAME_TAG_BLUEPRINT } from "../../games/name-tag/blueprint.ts";
import type { KitGame } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { identityNameCheck, identityPersonas } from "../../personas.ts";
import { PAPER_PLAYERS, rehearseMany, stringsIn, type RoleCheck } from "../../rehearse.ts";
import { createIdentityGame, editDistance, identitiesToDeal, namesOf, parseIdentities, PASS_ACTION, saidIdentity, solvePoints, type Identity, type IdentityDecisions, type IdentityState } from "./identity.ts";

/** Four at the table. */
const FOUR: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);

/** The decisions under test. */
const DECISIONS: IdentityDecisions = NAME_TAG_BLUEPRINT.decisions;

/**
 * Builds the game and opens the intro with the fallback bank.
 * @returns the game and the state in the intro.
 */
function start(): { game: KitGame<IdentityState>; state: IdentityState } {
    const game: KitGame<IdentityState> = createIdentityGame(NAME_TAG_BLUEPRINT.box, DECISIONS, seededRandom(7));
    const opened: Step<IdentityState> = game.cartridge.onEvent(game.cartridge.init(FOUR, {}).state, { type: "contentReady", at: 0, text: "" });
    return { game, state: opened.state };
}

/**
 * Builds the game and opens the first turn.
 * @returns the game and the state on the first turn.
 */
function firstTurn(): { game: KitGame<IdentityState>; state: IdentityState } {
    const { game, state } = start();
    return { game, state: game.cartridge.onEvent(state, { type: "timerFired", at: 12, timerId: "intro" }).state };
}

/**
 * The player on the spot says something.
 * @param game the game.
 * @param state the state.
 * @param text the words.
 * @param playerId who speaks; the player on the spot by default.
 * @returns the step.
 */
function say(game: KitGame<IdentityState>, state: IdentityState, text: string, playerId: string = state.current ?? ""): Step<IdentityState> {
    return game.cartridge.onEvent(state, { type: "speechEnded", at: 20, playerId, text });
}

describe("name tag", () => {
    it("is runnable, asks the model for names, and plays the fallback bank when it fails", () => {
        assert.deepEqual(blueprintProblems(NAME_TAG_BLUEPRINT), []);
        const game: KitGame<IdentityState> = createIdentityGame(NAME_TAG_BLUEPRINT.box, DECISIONS);
        assert.match(game.cartridge.init(FOUR, {}).contentRequest ?? "", /JSON array/);
        const { state } = start();
        assert.equal(state.phase, "intro");
        const names: string[] = Object.values(state.dealt).map((identity: Identity) => identity.name);
        assert.equal(names.length, 4);
        assert.equal(new Set(names).size, 4, "nobody shares a name tag");
        assert.ok(names.every((name: string) => DECISIONS.identities.some((identity: Identity) => identity.name === name)));
    });

    it("uses the model's names first, drops blocked and malformed ones, and keeps the dealt names unique", () => {
        const text: string = 'Here you go: ["Marie Curie|person", "Hitler|person", "Walrus|creature", "Spoon|spoon", "Walrus|creature", 7, "A very long name that goes on and on and on|thing", "Sherlock Holmes|person"]';
        assert.deepEqual(parseIdentities(text).map((identity: Identity) => identity.name), ["Marie Curie", "Walrus", "Walrus", "Sherlock Holmes"]);
        const dealt: Identity[] = identitiesToDeal(parseIdentities(text), DECISIONS.identities, 4, seededRandom(3));
        assert.deepEqual(dealt.map((identity: Identity) => identity.name).slice(0, 3), ["Marie Curie", "Walrus", "Sherlock Holmes"]);
        assert.equal(new Set(dealt.map((identity: Identity) => identity.name)).size, 4);
        assert.deepEqual(parseIdentities("no list here"), []);
        assert.deepEqual(parseIdentities("[not json"), []);
        const tiedToSeat: Identity[] = identitiesToDeal([{ name: "Spoon", kind: "thing", also: [] }], DECISIONS.identities, 1, seededRandom(3), ["Spoon"]);
        assert.notEqual(tiedToSeat[0]?.name, "Spoon", "an identity that is also a player's name is skipped");
    });

    it("judges a guess in code: the real name, a surname, a misheard spelling, never a near miss on a short name", () => {
        const curie: Identity = { name: "Marie Curie", kind: "person", also: [] };
        assert.deepEqual(namesOf(curie), ["Marie Curie", "Curie"]);
        assert.equal(saidIdentity("am i marie curie", curie), true);
        assert.equal(saidIdentity("Is it Curie?", curie), true);
        assert.equal(saidIdentity("am i Marie Currie", curie), true, "one wrong letter is forgiven");
        assert.equal(saidIdentity("am I a scientist", curie), false);
        const moon: Identity = { name: "The Moon", kind: "thing", also: [] };
        assert.equal(saidIdentity("am i the moon", moon), true);
        assert.equal(saidIdentity("am i moan", moon), false, "short names must match exactly");
        assert.equal(editDistance("kitten", "sitting"), 3);
    });

    it("never shows anyone their own name tag, and shows everyone else's", () => {
        const { game, state } = firstTurn();
        for (const player of FOUR) {
            const own: string = state.dealt[player.playerId]?.name ?? "";
            const seen: string[] = stringsIn(game.cartridge.privateControls(state, player.playerId));
            assert.equal(seen.some((line: string) => line.includes(own)), false, `${player.name} must not see ${own}`);
            const shownTo: CartridgePlayer[] = player.playerId === state.current ? [] : FOUR.filter((candidate: CartridgePlayer) => candidate.playerId !== player.playerId);
            for (const other of shownTo) {
                assert.equal(seen.some((line: string) => line.includes(state.dealt[other.playerId]?.name ?? "?")), true, `${player.name} sees ${other.name}'s tag`);
            }
        }
        const tv: string = stringsIn(game.cartridge.publicScene(state)).join(" ");
        const host: string = JSON.stringify([game.cartridge.manifest, game.cartridge.hostFacts(state, { kind: "host" })]);
        for (const identity of Object.values(state.dealt)) {
            assert.equal(tv.includes(identity.name), false, "the TV never shows an unrevealed tag");
            assert.equal(host.includes(identity.name), false, "the host is never told one");
        }
    });

    it("lets only the player on the spot talk, and spends a question only on a real one", () => {
        const { game, state } = firstTurn();
        assert.equal(state.phase, "asking");
        assert.equal(state.current, "paper1");
        assert.equal(game.cartridge.roleOf(state, "paper1"), "spotlight");
        assert.equal(game.cartridge.roleOf(state, "paper2"), "player");
        const asking = game.cartridge.manifest.phases.find((phase) => phase.id === "asking");
        assert.deepEqual(asking?.listening, { spotlight: "holdToTalk", "*": "muted" });
        assert.equal(say(game, state, "Um").state.asked, 0, "one word is free");
        assert.equal(say(game, state, "Am I alive right now?", "paper2").state.asked, 0, "someone else's words do nothing");
        assert.equal(say(game, state, "Am I alive right now?").state.asked, 1);
        assert.deepEqual(game.cartridge.turn?.(state), { kind: "one", playerId: "paper1", label: "On the spot" });
    });

    it("solves a turn from the real name, scores by questions, reveals the tag and moves on", () => {
        const { game, state } = firstTurn();
        const name: string = state.dealt.paper1?.name ?? "";
        const asked: IdentityState = say(game, state, "Am I alive right now?").state;
        const solved: Step<IdentityState> = say(game, asked, `Am I ${name}?`);
        assert.equal(solved.state.phase, "between");
        assert.deepEqual(solved.state.records.paper1, { result: "solved", questions: 2, points: 5 });
        assert.equal(solved.state.scores.paper1, 5);
        assert.match(solved.facts[0]?.text ?? "", new RegExp(name));
        assert.equal(stringsIn(game.cartridge.publicScene(solved.state)).includes(name), true, "now it is out");
        const next: Step<IdentityState> = game.cartridge.onEvent(solved.state, { type: "timerFired", at: 30, timerId: "between1" });
        assert.equal(next.state.current, "paper2");
        assert.equal(next.state.turnNumber, 2);
        assert.equal(next.state.asked, 0);
        assert.equal(solvePoints(1), 5);
        assert.equal(solvePoints(4), 4);
        assert.equal(solvePoints(12), 2);
    });

    it("ends a turn on the last question, on the clock or on a pass, each for a point, and ignores a stale clock", () => {
        const { game, state } = firstTurn();
        let current: IdentityState = state;
        for (let count = 0; count < DECISIONS.questionsPerTurn; count += 1) {
            current = say(game, current, `Is it a wrong thing number ${count}?`).state;
        }
        assert.equal(current.records.paper1?.result, "questions");
        assert.equal(current.records.paper1.points, 1);
        const clock: IdentityState = game.cartridge.onEvent(state, { type: "timerFired", at: 75, timerId: "turn1" }).state;
        assert.equal(clock.records.paper1?.result, "clock");
        assert.equal(game.cartridge.onEvent(clock, { type: "timerFired", at: 76, timerId: "turn1" }).state, clock);
        const second: IdentityState = game.cartridge.onEvent(game.cartridge.onEvent(clock, { type: "timerFired", at: 90, timerId: "between1" }).state, { type: "timerFired", at: 91, timerId: "turn1" }).state;
        assert.equal(second.records.paper2, undefined, "last turn's clock does not end this one");
        assert.deepEqual(game.cartridge.legalActions(state, "paper1").map((action) => action.actionId), [PASS_ACTION]);
        assert.deepEqual(game.cartridge.legalActions(state, "paper2"), []);
        assert.equal(game.cartridge.apply(state, "paper2", PASS_ACTION).state, state, "only the player on the spot may pass");
        assert.equal(game.cartridge.apply(state, "paper1", PASS_ACTION).state.records.paper1?.result, "passed");
    });

    it("gives the hint to the player on the spot halfway through, on their phone only", () => {
        const { game, state } = firstTurn();
        const text = (viewer: string, from: IdentityState): string => stringsIn(game.cartridge.privateControls(from, viewer)).join(" ");
        assert.equal(/hint/i.test(text("paper1", state)), false);
        const hinted: IdentityState = game.cartridge.onEvent(state, { type: "timerFired", at: 37, timerId: "hint1" }).state;
        assert.match(text("paper1", hinted), /A hint: you are (a person|a creature|a thing)/);
        assert.equal(/hint/i.test(text("paper2", hinted)), false);
        assert.equal(game.cartridge.onEvent(state, { type: "timerFired", at: 37, timerId: "hint9" }).state, state, "a stale hint is ignored");
    });

    it("plays to the end with scores that add up, and reveals every tag", () => {
        const opened: { game: KitGame<IdentityState>; state: IdentityState } = firstTurn();
        let state: IdentityState = opened.state;
        const rules: Cartridge<IdentityState> = opened.game.cartridge;
        for (let guard = 0; guard < 40 && rules.outcome(state) === null; guard += 1) {
            const event = state.phase === "asking" ? { type: "timerFired" as const, at: 0, timerId: `turn${state.turnNumber}` } : { type: "timerFired" as const, at: 0, timerId: `between${state.turnNumber}` };
            state = rules.onEvent(state, event).state;
        }
        assert.equal(state.phase, "end");
        assert.deepEqual(Object.values(state.scores), [1, 1, 1, 1], "everyone gets a point for the story");
        const tv: string = stringsIn(rules.publicScene(state)).join(" ");
        assert.ok(Object.values(state.dealt).every((identity: Identity) => tv.includes(identity.name)));
    });

    it("moves on if the player on the spot leaves, drops a waiting leaver's turn, and ends below three", () => {
        const { game, state } = firstTurn();
        const gone: Step<IdentityState> = game.cartridge.onEvent(state, { type: "playerLeft", at: 30, playerId: "paper1" });
        assert.equal(gone.state.current, "paper2");
        assert.equal(gone.state.turnCount, 4, "their turn was taken, so it still counts");
        assert.equal(gone.state.records.paper1?.result, "left");
        const waiting: Step<IdentityState> = game.cartridge.onEvent(state, { type: "playerLeft", at: 30, playerId: "paper4" });
        assert.equal(waiting.state.turnCount, 3);
        assert.deepEqual(waiting.state.waiting, ["paper2", "paper3"]);
        const tooFew: IdentityState = game.cartridge.onEvent(waiting.state, { type: "playerLeft", at: 31, playerId: "paper3" }).state;
        assert.equal(tooFew.phase, "end");
    });

    it("tells the host to be kind and never to guess, and its rulings are none", () => {
        const { game } = start();
        assert.match(game.cartridge.manifest.hostBrief, /never guess at one/);
        assert.match(game.cartridge.manifest.hostBrief, /Tease the name tag, never the person/);
        assert.ok(game.cartridge.manifest.phases.every((phase) => phase.hostRulings === undefined));
    });

    it("passes the default check at three and five players and with hostile model content", () => {
        assert.deepEqual(checkBlueprint(NAME_TAG_BLUEPRINT).problems, []);
        assert.deepEqual(checkBlueprint(NAME_TAG_BLUEPRINT, { players: PAPER_PLAYERS.slice(0, 3) }).problems, []);
        assert.deepEqual(checkBlueprint(NAME_TAG_BLUEPRINT, { content: '["Spoon|thing", "Teacup|thing", "Candle Holder|thing", "Zeus|person"]' }).problems, []);
    });

    it("catches a leak of your own name tag to your phone, the TV or the host, and a TV that depends on the deal", () => {
        const make = (): KitGame<IdentityState> => createIdentityGame(NAME_TAG_BLUEPRINT.box, DECISIONS, seededRandom(2));
        const leaky = (patch: (rules: Cartridge<IdentityState>) => Partial<Cartridge<IdentityState>>): (() => KitGame<IdentityState>) => (): KitGame<IdentityState> => {
            const game: KitGame<IdentityState> = make();
            return { cartridge: { ...game.cartridge, ...patch(game.cartridge) }, hidden: (state: IdentityState) => game.hidden(state) };
        };
        const toOwner = leaky((rules: Cartridge<IdentityState>) => ({
            privateControls: (state: IdentityState, playerId: string): Control[] => [...rules.privateControls(state, playerId), { type: "notice", text: state.dealt[playerId]?.name ?? "", tone: "info" }],
        }));
        const toScreen = leaky((rules: Cartridge<IdentityState>) => ({
            publicScene: (state: IdentityState): Scene => ({ ...rules.publicScene(state), blocks: [...rules.publicScene(state).blocks, { type: "text", text: Object.values(state.dealt).map((identity: Identity) => identity.name).join(", ") }] }),
        }));
        const toHost = leaky((rules: Cartridge<IdentityState>) => ({
            hostFacts: (state: IdentityState, scope): ScopedFact[] => [...rules.hostFacts(state, scope), { scope: { kind: "public" }, kind: "oops", text: `They are ${state.dealt[state.current ?? ""]?.name ?? ""}` }],
        }));
        for (const [label, build, pattern] of [["owner's phone", toOwner, /name tag reached phone/], ["TV", toScreen, /reached the screen/], ["host", toHost, /reached the host/]] as const) {
            const found: string = rehearseMany(build, identityPersonas(), [1]).problems.join("\n");
            assert.match(found, pattern, `a leak to the ${label} is caught`);
        }
        const healthy: RoleCheck<IdentityState> = identityNameCheck(NAME_TAG_BLUEPRINT);
        const dependent: RoleCheck<IdentityState> = {
            ...healthy,
            deal: (seat: number, players: readonly CartridgePlayer[]): KitGame<IdentityState> => {
                const game: KitGame<IdentityState> = healthy.deal(seat, players);
                const rules: Cartridge<IdentityState> = game.cartridge;
                const scene = (state: IdentityState): Scene => ({ ...rules.publicScene(state), blocks: [...rules.publicScene(state).blocks, { type: "text", text: `${state.dealt.paper1?.kind ?? ""}` }] });
                return { cartridge: { ...rules, publicScene: scene }, hidden: (state: IdentityState) => game.hidden(state) };
            },
        };
        assert.match(rehearseMany(make, identityPersonas(), [1], { roleCheck: dependent }).problems.join("\n"), /role check: .*screen could tell/);
    });
});
