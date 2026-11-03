// The structural rehearsal: plays a blueprint game in this process with scripted paper players
// and no model, from a fixed seed, and checks what a simulation can check. The game ends within
// a budget of steps; every phase is entered; no secret reaches a public fact or the public screen
// before the end; every ruling used was one the phase allows; every fact names the decision
// behind it. It never says a game is good. Twenty rehearsals run in well under a second.

import type { Cartridge, CartridgePlayer, PhaseSpec, Step } from "../shared/cartridge.ts";
import type { Scene, SceneBlock } from "../shared/scene.ts";
import type { RoomEvent } from "../shared/timeline.ts";
import type { ScopedFact } from "../shared/visibility.ts";
import { BECAUSE_KIND, type BlueprintGame, type BlueprintState } from "./interpreter.ts";

/** Most steps a rehearsal may take before it is stopped as never ending. */
export const STEP_BUDGET: number = 400;

/** The paper players, named after things on the table so they can be nobody. */
export const PAPER_PLAYERS: CartridgePlayer[] = ["Teacup", "Spoon", "Candle", "Saucer", "Matchbox"].map((name: string, index: number) => ({ playerId: `paper${index + 1}`, name }));

/** What a paper player does on its turn. */
export type Move =
    | { kind: "say"; playerId: string; text: string; ruling: string | null }
    | { kind: "press"; playerId: string; actionId: string }
    | { kind: "wait" };

/** What a persona sees before it moves. */
export interface Glimpse {
    phase: string;
    spent: number;
    turn: number;
}

/** A scripted way of playing: it also scripts the judge, since there is no model here. */
export interface Persona {
    name: string;
    move(glimpse: Glimpse): Move;
}

/** One moment of a rehearsal: the event in and the step out. */
export interface TraceEntry {
    event: RoomEvent | { type: "input"; playerId: string; actionId: string };
    step: Step<BlueprintState>;
}

/** What one rehearsal found. */
export interface Rehearsal {
    persona: string;
    seed: number;
    ended: boolean;
    won: boolean;
    steps: number;
    spent: number;
    phases: string[];
    problems: string[];
    trace: TraceEntry[];
}

/** The mutable state of one rehearsal, kept in one object so the step function can update it. */
interface RunState {
    state: BlueprintState | null;
    pendingContent: boolean;
    pendingTimers: string[];
}

/** What a set of rehearsals found, as counts. */
export interface Tally {
    rehearsals: number;
    ended: number;
    won: number;
    averageSpent: number;
    phasesNeverReached: string[];
    problems: string[];
}

/**
 * A small deterministic random source, so a rehearsal can be replayed from its seed.
 * @param seed any integer.
 * @returns a function returning [0, 1).
 */
export function seededRandom(seed: number): () => number {
    let value: number = (seed >>> 0) || 1;
    return (): number => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 4294967296;
    };
}

/**
 * Finds secrets that reached where they must not.
 * @param secrets strings that must stay private.
 * @param facts facts emitted by one step.
 * @param scene the public screen after the step.
 * @returns a problem per leak, in plain words.
 */
export function findLeaks(secrets: string[], facts: ScopedFact[], scene: Scene): string[] {
    const problems: string[] = [];
    const shown: string[] = scene.blocks.flatMap((block: SceneBlock) => {
        if (block.type === "title") {
            return [block.text, block.kicker ?? ""];
        }
        if (block.type === "text") {
            return [block.text];
        }
        return [];
    });
    for (const secret of secrets.filter((candidate: string) => candidate.length >= 3)) {
        const needle: string = secret.toLowerCase();
        for (const fact of facts) {
            if (fact.scope.kind !== "host" && fact.scope.kind !== "system" && fact.text.toLowerCase().includes(needle) === true) {
                problems.push(`The secret reached a ${fact.scope.kind} fact (${fact.kind}) before the end.`);
            }
        }
        if (shown.some((text: string) => text.toLowerCase().includes(needle)) === true) {
            problems.push("The secret was on the public screen before the end.");
        }
    }
    return problems;
}

/**
 * Checks that every fact a step emitted is followed by the decision behind it.
 * @param facts the step's facts.
 * @returns a problem per unexplained fact.
 */
export function findUnexplained(facts: ScopedFact[]): string[] {
    const problems: string[] = [];
    for (let index = 0; index < facts.length; index += 1) {
        const fact: ScopedFact | undefined = facts[index];
        if (fact === undefined || fact.scope.kind === "system") {
            continue;
        }
        if (facts[index + 1]?.kind !== BECAUSE_KIND) {
            problems.push(`The fact "${fact.kind}" names no decision.`);
        }
    }
    return problems;
}

/**
 * Plays one rehearsal.
 * @param game the game to rehearse.
 * @param persona how the paper players and the judge behave.
 * @param seed the random seed, so it can be replayed.
 * @param players the paper players at the table.
 * @returns what happened and what was wrong.
 */
export function rehearse(game: BlueprintGame, persona: Persona, seed: number, players: CartridgePlayer[] = PAPER_PLAYERS): Rehearsal {
    const cartridge: Cartridge<BlueprintState> = game.cartridge;
    const trace: TraceEntry[] = [];
    const phases: Set<string> = new Set();
    const problems: string[] = [];
    const run: RunState = { state: null, pendingContent: false, pendingTimers: [] };
    let turn: number = 0;

    /**
     * Takes a step: records it, checks it, remembers what it asked for.
     * @param event what caused it.
     * @param step the step.
     * @returns the state after the step.
     */
    const take = (event: TraceEntry["event"], step: Step<BlueprintState>): BlueprintState => {
        trace.push({ event, step });
        run.state = step.state;
        phases.add(cartridge.phaseOf(step.state));
        if (cartridge.outcome(step.state) === null) {
            problems.push(...findLeaks(game.secrets(step.state), step.facts, cartridge.publicScene(step.state)));
        }
        problems.push(...findUnexplained(step.facts));
        run.pendingContent = run.pendingContent === true || step.contentRequest !== undefined;
        run.pendingTimers.push(...Object.keys(step.timers ?? {}));
        return step.state;
    };

    /**
     * The phase spec the game is in.
     * @returns the spec, or undefined.
     */
    const phaseSpec = (state: BlueprintState): PhaseSpec | undefined => cartridge.manifest.phases.find((candidate: PhaseSpec) => candidate.id === cartridge.phaseOf(state));

    take({ type: "phaseChanged", at: 0, phaseId: "init" }, cartridge.init(players, {}));
    while (run.state !== null && cartridge.outcome(run.state) === null && trace.length < STEP_BUDGET) {
        const current: BlueprintState = run.state;
        if (run.pendingContent === true) {
            run.pendingContent = false;
            take({ type: "contentReady", at: turn, text: "" }, cartridge.onEvent(current, { type: "contentReady", at: turn, text: "" }));
            continue;
        }
        const timerId: string | undefined = run.pendingTimers.shift();
        if (timerId !== undefined) {
            take({ type: "timerFired", at: turn, timerId }, cartridge.onEvent(current, { type: "timerFired", at: turn, timerId }));
            continue;
        }
        turn += 1;
        const move: Move = persona.move({ phase: cartridge.phaseOf(current), spent: current.spent, turn });
        if (move.kind === "wait") {
            problems.push(`${persona.name} had nothing to do in phase ${cartridge.phaseOf(current)}.`);
            break;
        }
        if (move.kind === "press") {
            if (cartridge.legalActions(current, move.playerId).some((action) => action.actionId === move.actionId) === false) {
                problems.push(`${persona.name} pressed "${move.actionId}" when it was not offered.`);
            }
            take({ type: "input", playerId: move.playerId, actionId: move.actionId }, cartridge.apply(current, move.playerId, move.actionId));
            continue;
        }
        const said: RoomEvent = { type: "speechEnded", at: turn, playerId: move.playerId, text: move.text };
        const heard: BlueprintState = take(said, cartridge.onEvent(current, said));
        if (move.ruling === null) {
            continue;
        }
        if (phaseSpec(heard)?.hostRulings?.[move.ruling] === undefined) {
            problems.push(`The judge ruled "${move.ruling}" in phase ${cartridge.phaseOf(heard)}, which does not allow it.`);
            continue;
        }
        take({ type: "hostRuled", at: turn, ruling: move.ruling, detail: "", playerId: move.playerId }, cartridge.onEvent(heard, { type: "hostRuled", at: turn, ruling: move.ruling, detail: "", playerId: move.playerId }));
    }

    const final: BlueprintState | null = run.state;
    const ended: boolean = final !== null && cartridge.outcome(final) !== null;
    if (ended === false) {
        problems.push(`This never ended: stopped after ${trace.length} steps in phase ${final === null ? "none" : cartridge.phaseOf(final)}.`);
    }
    return {
        persona: persona.name,
        seed,
        ended,
        won: final?.won === true,
        steps: trace.length,
        spent: final?.spent ?? 0,
        phases: [...phases],
        problems,
        trace,
    };
}

/**
 * Plays many rehearsals and counts.
 * @param makeGame builds a fresh game from a seed, so each rehearsal has its own random source.
 * @param personas the ways of playing to try.
 * @param seeds the seeds to try each persona with.
 * @returns the counts, and every problem found.
 */
export function rehearseMany(makeGame: (seed: number) => BlueprintGame, personas: Persona[], seeds: number[]): Tally {
    const rehearsals: Rehearsal[] = [];
    for (const persona of personas) {
        for (const seed of seeds) {
            rehearsals.push(rehearse(makeGame(seed), persona, seed));
        }
    }
    const first: BlueprintGame = makeGame(seeds[0] ?? 1);
    const allPhases: string[] = first.cartridge.manifest.phases.map((phase: PhaseSpec) => phase.id);
    const reached: Set<string> = new Set(rehearsals.flatMap((rehearsal: Rehearsal) => rehearsal.phases));
    const spent: number = rehearsals.reduce((total: number, rehearsal: Rehearsal) => total + rehearsal.spent, 0);
    return {
        rehearsals: rehearsals.length,
        ended: rehearsals.filter((rehearsal: Rehearsal) => rehearsal.ended === true).length,
        won: rehearsals.filter((rehearsal: Rehearsal) => rehearsal.won === true).length,
        averageSpent: rehearsals.length === 0 ? 0 : spent / rehearsals.length,
        phasesNeverReached: allPhases.filter((phase: string) => reached.has(phase) === false),
        problems: rehearsals.flatMap((rehearsal: Rehearsal) => rehearsal.problems.map((problem: string) => `${rehearsal.persona}, seed ${rehearsal.seed}: ${problem}`)),
    };
}

/**
 * The personas for the guessing family: one who finds it, one who gives up, one who never
 * guesses, and one who chats between questions.
 * @param players the paper players.
 * @returns the personas.
 */
export function guessingPersonas(players: CartridgePlayer[] = PAPER_PLAYERS): Persona[] {
    const speaker = (turn: number): string => players[turn % players.length]?.playerId ?? "paper1";
    const giveUpId: string = "giveup";
    return [
        {
            name: "the finder",
            move(glimpse: Glimpse): Move {
                if (glimpse.turn >= 8) {
                    return { kind: "say", playerId: speaker(glimpse.turn), text: "Is it the thing I think it is?", ruling: "correct" };
                }
                return { kind: "say", playerId: speaker(glimpse.turn), text: `Question ${glimpse.turn}?`, ruling: glimpse.turn % 2 === 0 ? "yes" : "no" };
            },
        },
        {
            name: "the giver-up",
            move(glimpse: Glimpse): Move {
                if (glimpse.turn >= 4) {
                    return { kind: "press", playerId: speaker(glimpse.turn), actionId: giveUpId };
                }
                return { kind: "say", playerId: speaker(glimpse.turn), text: `Question ${glimpse.turn}?`, ruling: "no" };
            },
        },
        {
            name: "the stubborn one",
            move(glimpse: Glimpse): Move {
                return { kind: "say", playerId: speaker(glimpse.turn), text: `Is it a wrong thing number ${glimpse.turn}?`, ruling: glimpse.turn % 3 === 0 ? "wrong" : "no" };
            },
        },
        {
            name: "the chatterer",
            move(glimpse: Glimpse): Move {
                if (glimpse.turn % 2 === 1) {
                    return { kind: "say", playerId: speaker(glimpse.turn), text: "Did anyone feed the cat?", ruling: null };
                }
                return { kind: "say", playerId: speaker(glimpse.turn), text: `Question ${glimpse.turn}?`, ruling: "sortof" };
            },
        },
    ];
}
