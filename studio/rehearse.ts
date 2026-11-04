// The structural rehearsal: plays a kit game in this process with scripted paper players and no
// model, from a fixed seed, on a virtual clock, and checks what a simulation can check. The game
// ends within a move budget; every phase is entered; no hidden value reaches a viewer who may not
// see it, on the TV, any phone or the host's brief, however it is spaced or reversed; every
// ruling used was allowed and did something; every fact names its decision; the rules never
// change state in place and never throw. It never says a game is good.

import type { Cartridge, CartridgePlayer, LegalAction, PhaseSpec, Step } from "../shared/cartridge.ts";
import type { RoomEvent } from "../shared/timeline.ts";
import type { Turn } from "../shared/turn.ts";
import type { ScopedFact } from "../shared/visibility.ts";
import { appears, appearsAsWord, squash, type HiddenValue, type KitGame } from "./kit/kit.ts";

export { appears };
import { BECAUSE_KIND, deepFreeze } from "./kit/primitives.ts";

/** Most moves a rehearsal may take before it is stopped as never ending. */
export const MOVE_BUDGET: number = 300;

/** Seconds that pass on the virtual clock when a paper player says or presses something. */
export const ACTION_SECONDS: number = 6;

/** The paper players, named after things on the table so they can be nobody. */
export const PAPER_PLAYERS: readonly CartridgePlayer[] = ["Teacup", "Spoon", "Candle", "Saucer", "Matchbox"].map((name: string, index: number) => ({ playerId: `paper${index + 1}`, name }));

/** What a paper player does next. */
export type Move =
    | { kind: "say"; playerId: string; text: string; ruling: string | null }
    | { kind: "press"; playerId: string; actionId: string }
    | { kind: "leave"; playerId: string }
    | { kind: "wait"; seconds: number };

/** What a persona sees before it moves. A persona also scripts the judge, so it may see the state. */
export interface Glimpse<State> {
    state: State;
    phase: string;
    /** Moves made so far. */
    turn: number;
    /** Seconds on the virtual clock. */
    now: number;
    /** Everyone still at the table. */
    players: readonly CartridgePlayer[];
    /** What a player may press right now. */
    legal(playerId: string): LegalAction[];
    /** Rulings the phase allows right now. */
    rulings: string[];
}

/** A scripted way of playing. */
export interface Persona<State> {
    name: string;
    move(glimpse: Glimpse<State>): Move;
}

/** What caused a step. */
export type TraceEvent = RoomEvent | { type: "input"; playerId: string; actionId: string };

/** One moment of a rehearsal: the event in and the step out. */
export interface TraceEntry<State> {
    event: TraceEvent;
    step: Step<State>;
}

/** What one rehearsal found. */
export interface Rehearsal<State> {
    persona: string;
    seed: number;
    ended: boolean;
    outcome: string | null;
    moves: number;
    phases: string[];
    problems: string[];
    trace: TraceEntry<State>[];
}

/** What a set of rehearsals found, as counts. */
export interface Tally {
    rehearsals: number;
    ended: number;
    /** How many rehearsals ended with each outcome. */
    outcomes: Record<string, number>;
    phasesNeverReached: string[];
    problems: string[];
}

/** Options for a rehearsal. */
export interface RehearsalOptions {
    /** What the host's model writes when content is asked for; empty means it failed. */
    content?: string;
    players?: readonly CartridgePlayer[];
}

/** How to check that a game's hidden role is invisible to everyone who doesn't hold it. */
export interface RoleCheck<State> {
    /** The same game, with the role dealt to the player in this seat. */
    deal(seat: number, players: readonly CartridgePlayer[]): KitGame<State>;
    /** Events and player inputs to play, the same whoever holds the role. */
    script: readonly TraceEvent[];
    /**
     * True when other players are meant to see the role, as in a game where everyone but its owner
     * can read each name tag. Then only the TV and the host must stay the same.
     */
    publicOnly?: boolean;
}

/** Keys whose values are never shown to anyone: kinds, ids, styles and image addresses. */
const UNSHOWN_KEYS: ReadonlySet<string> = new Set(["type", "kind", "id", "playerId", "actionId", "mood", "transition", "emphasis", "marks", "tone", "src", "backdrop"]);

/**
 * The fields of an object a viewer could read.
 * @param value plain data.
 * @returns its entries, without keys that are never shown.
 */
function shownEntries(value: object): [string, unknown][] {
    return Object.entries(value).filter(([key]: [string, unknown]) => UNSHOWN_KEYS.has(key) === false);
}

/**
 * Every string inside a value a viewer could read, for searching what they see. Kinds, ids, styles
 * and image addresses are left out.
 * @param value plain data.
 * @returns the strings, each once.
 */
export function stringsIn(value: unknown): string[] {
    if (typeof value === "string") {
        return [value];
    }
    if (typeof value !== "object" || value === null) {
        return [];
    }
    return shownEntries(value).flatMap(([, inner]: [string, unknown]) => stringsIn(inner));
}

/**
 * The lines a viewer reads together: every object's own readable strings joined, such as a roster
 * entry's name and badge or a card's title and body. Kept apart from stringsIn, so the joined copies
 * are never glued onto the strings they came from.
 * @param value plain data.
 * @returns the joined lines, for objects with more than one string of their own.
 */
export function linesIn(value: unknown): string[] {
    if (typeof value !== "object" || value === null) {
        return [];
    }
    const entries: [string, unknown][] = shownEntries(value);
    const own: string[] = Array.isArray(value) === true ? [] : entries.map(([, inner]: [string, unknown]) => inner).filter((inner: unknown): inner is string => typeof inner === "string");
    return [...(own.length > 1 ? [own.join(" ")] : []), ...entries.flatMap(([, inner]: [string, unknown]) => linesIn(inner))];
}

/**
 * Finds hidden values a viewer sees but may not.
 * @param viewer who is looking: "screen", "host", or a player id.
 * @param seen what they see, as strings.
 * @param hidden what must stay hidden, and from whom.
 * @param together lines they read together, from linesIn, for values that only count beside another word.
 * @returns a problem per leak.
 */
export function findLeaks(viewer: string, seen: readonly string[], hidden: readonly HiddenValue[], together: readonly string[] = []): string[] {
    const problems: string[] = [];
    for (const value of hidden) {
        const near: string | undefined = value.near;
        const lines: readonly string[] = near === undefined ? seen : [...seen, ...together].filter((line: string) => squash(line).includes(squash(near)) === true);
        const found: boolean = near === undefined ? appears(seen, value.text) : appearsAsWord(lines, value.text);
        if (value.seenBy.includes(viewer) === false && found === true) {
            problems.push(`${value.label} reached ${viewer === "screen" || viewer === "host" ? `the ${viewer}` : `phone ${viewer}`}.`);
        }
    }
    return problems;
}

/**
 * Checks that every fact a step emitted is followed by the decision behind it.
 * @param facts the step's facts.
 * @returns a problem per unexplained fact.
 */
export function findUnexplained(facts: readonly ScopedFact[]): string[] {
    const problems: string[] = [];
    facts.forEach((fact: ScopedFact, index: number) => {
        if (fact.scope.kind !== "system" && facts[index + 1]?.kind !== BECAUSE_KIND) {
            problems.push(`The fact "${fact.kind}" names no decision.`);
        }
    });
    return problems;
}

/**
 * A turn as the TV and phones show it. A turn for one player singles them out: the TV highlights
 * their place card and other phones say "Waiting for" them, so their name is shown on one line
 * with the label. A turn for everyone singles a player out in the same way when they are the only
 * seat the TV leaves unticked, or the only player in the turn not done, whom the done phones wait
 * for; otherwise its names are shown each on their own, never beside the label. The TV ticks every
 * seat in doneIds, so a seat is unticked when it is at the table and not done, whatever playerIds says.
 * @param turn the turn, or null.
 * @param players who is at the table.
 * @returns the lines, empty when there is no turn.
 */
export function turnAsShown(turn: Turn | null, players: readonly CartridgePlayer[]): string[] {
    if (turn === null) {
        return [];
    }
    const nameOf = (playerId: string): string => players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? playerId;
    if (turn.kind === "one") {
        return [`${turn.label} ${nameOf(turn.playerId)}`];
    }
    if (turn.kind === "everyone") {
        // Two ways one player is singled out: the only seat the TV leaves unticked, and the only player
        // in the turn not done, whom the done phones say they are waiting for. Each is checked.
        const unticked: string[] = players.map((player: CartridgePlayer) => player.playerId).filter((playerId: string) => turn.doneIds.includes(playerId) === false);
        const waitedFor: string[] = turn.playerIds.filter((playerId: string) => turn.doneIds.includes(playerId) === false);
        // Deliberately conservative: the TV never prints the label and the name together, but one
        // singled-out player beside a label is a visible tell, and this line is how the check sees it.
        // The cost is that a legal turn for everyone labelled with a secret word and one player left fails.
        const singled: string[] = [...new Set([unticked, waitedFor].filter((group: string[]) => group.length === 1).flat())];
        const lines: string[] = [turn.label, ...[...turn.playerIds, ...turn.doneIds].map(nameOf)];
        return [...singled.map((playerId: string) => `${turn.label} ${nameOf(playerId)}`), ...lines];
    }
    return [turn.label];
}

/**
 * What every viewer sees right now, whole: the TV, each phone (which sees the TV too), and the
 * host. Facts are what the step just emitted, routed the way the room routes them. Kept as the
 * data itself, not just its words, so a difference in a number or a highlight counts.
 * @param cartridge the rules.
 * @param state the state.
 * @param players who is at the table.
 * @param facts what the step emitted.
 * @returns each viewer's view, by viewer.
 */
export function viewsOf<State>(cartridge: Cartridge<State>, state: State, players: readonly CartridgePlayer[], facts: readonly ScopedFact[]): Map<string, unknown[]> {
    const turn: Turn | null = cartridge.turn?.(state) ?? null;
    const screen: unknown[] = [cartridge.publicScene(state), turn, turnAsShown(turn, players), facts.filter((fact: ScopedFact) => fact.scope.kind === "public")];
    const views: Map<string, unknown[]> = new Map([["screen", screen]]);
    const phase: PhaseSpec | undefined = cartridge.manifest.phases.find((candidate: PhaseSpec) => candidate.id === cartridge.phaseOf(state));
    const told: ScopedFact[] = facts.filter((fact: ScopedFact) => fact.scope.kind === "public" || fact.scope.kind === "host");
    views.set("host", [cartridge.manifest.hostBrief, phase ?? null, cartridge.hostFacts(state, { kind: "host" }), told]);
    for (const player of players) {
        const groups: ReadonlySet<string> = cartridge.groupsOf(state, player.playerId);
        const whispered: ScopedFact[] = facts.filter((fact: ScopedFact) => {
            return (fact.scope.kind === "player" && fact.scope.playerId === player.playerId) || (fact.scope.kind === "group" && groups.has(fact.scope.groupId) === true);
        });
        views.set(player.playerId, [...screen, cartridge.privateControls(state, player.playerId), cartridge.legalActions(state, player.playerId), whispered]);
    }
    return views;
}

/** The rehearsal's own running state, kept in one object so its step function can update it. */
interface Run<State> {
    state: State | null;
    players: CartridgePlayer[];
    pendingContent: boolean;
    /** When each running timer is due, by id, in seconds on the virtual clock. */
    timers: Map<string, number>;
    now: number;
    stopped: boolean;
}

/**
 * Plays one rehearsal.
 * @param game the game to rehearse.
 * @param persona how the paper players and the judge behave.
 * @param seed the seed the game was built with, for the report.
 * @param options content and players.
 * @returns what happened and what was wrong.
 */
export function rehearse<State>(game: KitGame<State>, persona: Persona<State>, seed: number, options: RehearsalOptions = {}): Rehearsal<State> {
    const cartridge: Cartridge<State> = game.cartridge;
    const trace: TraceEntry<State>[] = [];
    const phases: Set<string> = new Set();
    const problems: string[] = [];
    const run: Run<State> = { state: null, players: [...(options.players ?? PAPER_PLAYERS)], pendingContent: false, timers: new Map(), now: 0, stopped: false };

    /**
     * Calls the rules safely: a throw, including one from changing frozen state, becomes a problem.
     * @param what names the call for the report.
     * @param call the call.
     * @returns the step, or null when it threw.
     */
    const guarded = (what: string, call: () => Step<State>): Step<State> | null => {
        try {
            return call();
        } catch (error: unknown) {
            problems.push(`The rules threw during ${what}: ${error instanceof Error ? error.message : String(error)}`);
            run.stopped = true;
            return null;
        }
    };

    /**
     * Takes a step: freezes, records and checks it, and remembers what it asked for.
     * @param event what caused it.
     * @param call the rules call that makes the step.
     * @returns the step, or null when the rules threw.
     */
    const take = (event: TraceEvent, call: () => Step<State>): Step<State> | null => {
        const step: Step<State> | null = guarded(event.type, call);
        if (step === null) {
            return null;
        }
        deepFreeze(step.state);
        trace.push({ event, step });
        run.state = step.state;
        phases.add(cartridge.phaseOf(step.state));
        problems.push(...findUnexplained(step.facts));
        try {
            const hidden: HiddenValue[] = game.hidden(step.state);
            for (const [viewer, seen] of viewsOf(cartridge, step.state, run.players, step.facts)) {
                problems.push(...findLeaks(viewer, stringsIn(seen), hidden, linesIn(seen)));
            }
        } catch (error: unknown) {
            problems.push(`The rules threw while drawing a view after ${event.type}: ${error instanceof Error ? error.message : String(error)}`);
            run.stopped = true;
        }
        run.pendingContent = run.pendingContent === true || step.contentRequest !== undefined;
        for (const [timerId, seconds] of Object.entries(step.timers ?? {})) {
            run.timers.set(timerId, run.now + seconds);
        }
        return step;
    };

    /** Fires every timer that is due, earliest first, as the room would. */
    const fireDue = (): void => {
        const due: [string, number][] = [...run.timers.entries()]
            .filter(([, at]: [string, number]) => at <= run.now)
            .sort((first: [string, number], second: [string, number]) => first[1] - second[1]);
        for (const [timerId] of due) {
            run.timers.delete(timerId);
            const current: State | null = run.state;
            if (current === null || run.stopped === true || cartridge.outcome(current) !== null) {
                return;
            }
            const event: RoomEvent = { type: "timerFired", at: run.now, timerId };
            take(event, () => cartridge.onEvent(current, event));
        }
    };

    take({ type: "phaseChanged", at: 0, phaseId: "init" }, () => cartridge.init([...run.players], {}));
    let moves: number = 0;
    while (run.state !== null && run.stopped === false && cartridge.outcome(run.state) === null && moves < MOVE_BUDGET) {
        const current: State = run.state;
        if (run.pendingContent === true) {
            run.pendingContent = false;
            const event: RoomEvent = { type: "contentReady", at: run.now, text: options.content ?? "" };
            take(event, () => cartridge.onEvent(current, event));
            continue;
        }
        moves += 1;
        const phase: PhaseSpec | undefined = cartridge.manifest.phases.find((candidate: PhaseSpec) => candidate.id === cartridge.phaseOf(current));
        const move: Move = persona.move({
            state: current,
            phase: cartridge.phaseOf(current),
            turn: moves,
            now: run.now,
            players: run.players,
            legal: (playerId: string) => cartridge.legalActions(current, playerId),
            rulings: Object.keys(phase?.hostRulings ?? {}),
        });
        if (move.kind === "wait") {
            run.now += Math.max(1, move.seconds);
            fireDue();
            continue;
        }
        run.now += ACTION_SECONDS;
        fireDue();
        if (run.state !== current) {
            continue;
        }
        if (move.kind === "leave") {
            run.players = run.players.filter((player: CartridgePlayer) => player.playerId !== move.playerId);
            const event: RoomEvent = { type: "playerLeft", at: run.now, playerId: move.playerId };
            take(event, () => cartridge.onEvent(current, event));
            fireDue();
            continue;
        }
        if (move.kind === "press") {
            if (cartridge.legalActions(current, move.playerId).some((action: LegalAction) => action.actionId === move.actionId) === false) {
                problems.push(`${persona.name} pressed "${move.actionId}" when it was not offered.`);
            }
            take({ type: "input", playerId: move.playerId, actionId: move.actionId }, () => cartridge.apply(current, move.playerId, move.actionId));
            fireDue();
            continue;
        }
        const said: RoomEvent = { type: "speechEnded", at: run.now, playerId: move.playerId, text: move.text };
        const heard: Step<State> | null = take(said, () => cartridge.onEvent(current, said));
        if (heard === null || move.ruling === null) {
            fireDue();
            continue;
        }
        if (phase?.hostRulings?.[move.ruling] === undefined) {
            problems.push(`The judge ruled "${move.ruling}" in phase ${cartridge.phaseOf(heard.state)}, which does not allow it.`);
            fireDue();
            continue;
        }
        const ruled: RoomEvent = { type: "hostRuled", at: run.now, ruling: move.ruling, detail: "", playerId: move.playerId };
        const after: Step<State> | null = take(ruled, () => cartridge.onEvent(heard.state, ruled));
        if (after !== null && after.state === heard.state && after.facts.length === 0) {
            problems.push(`The ruling "${move.ruling}" was allowed but did nothing.`);
        }
        fireDue();
    }

    const final: State | null = run.state;
    const outcome: string | null = final === null ? null : cartridge.outcome(final);
    if (outcome === null && run.stopped === false) {
        problems.push(`This never ended: stopped after ${moves} moves in phase ${final === null ? "none" : cartridge.phaseOf(final)}.`);
    }
    return { persona: persona.name, seed, ended: outcome !== null, outcome, moves, phases: [...phases], problems, trace };
}

/**
 * Plays many rehearsals and counts.
 * @param makeGame builds a fresh game from a seed, so each rehearsal has its own random source.
 * @param personas the ways of playing to try.
 * @param seeds the seeds to try each persona with.
 * @param options content and players, the same for every rehearsal.
 * @returns the counts, and every problem found.
 */
export function rehearseMany<State>(
    makeGame: (seed: number) => KitGame<State>,
    personas: readonly Persona<State>[],
    seeds: readonly number[],
    options: RehearsalOptions & { roleCheck?: RoleCheck<State> } = {},
): Tally {
    const rehearsals: Rehearsal<State>[] = [];
    for (const persona of personas) {
        for (const seed of seeds) {
            rehearsals.push(rehearse(makeGame(seed), persona, seed, options));
        }
    }
    const allPhases: string[] = makeGame(seeds[0] ?? 1).cartridge.manifest.phases.map((phase: PhaseSpec) => phase.id);
    const reached: Set<string> = new Set(rehearsals.flatMap((rehearsal: Rehearsal<State>) => rehearsal.phases));
    const outcomes: Record<string, number> = {};
    for (const rehearsal of rehearsals) {
        const key: string = rehearsal.outcome ?? "never ended";
        outcomes[key] = (outcomes[key] ?? 0) + 1;
    }
    return {
        rehearsals: rehearsals.length,
        ended: rehearsals.filter((rehearsal: Rehearsal<State>) => rehearsal.ended === true).length,
        outcomes,
        phasesNeverReached: allPhases.filter((phase: string) => reached.has(phase) === false),
        problems: [
            ...rehearsals.flatMap((rehearsal: Rehearsal<State>) => rehearsal.problems.map((problem: string) => `${rehearsal.persona}, seed ${rehearsal.seed}: ${problem}`)),
            ...roleProblems(options.roleCheck, options.players ?? PAPER_PLAYERS),
        ],
    };
}

/**
 * Runs a role check, if the game has one, with the role dealt to every seat in turn.
 * @param check the check, or undefined.
 * @param players who is at the table.
 * @returns the problems found.
 */
function roleProblems<State>(check: RoleCheck<State> | undefined, players: readonly CartridgePlayer[]): string[] {
    if (check === undefined) {
        return [];
    }
    const games: { game: KitGame<State>; holderId: string }[] = players.map((player: CartridgePlayer, seat: number) => {
        return { game: check.deal(seat, players), holderId: player.playerId };
    });
    return roleBlindness(games, check.script, players, check.publicOnly === true).map((problem: string) => `role check: ${problem}`);
}

/**
 * Checks that who holds a hidden role changes nothing anyone else sees. Plays the same script on
 * games that differ only in who was dealt the role, and compares the TV, the host's brief and
 * every phone that held no role in either game, step by step until the reveal.
 * @param games the same game dealt differently, with who holds the role in each.
 * @param script the events to play, the same for every game.
 * @param players who is at the table.
 * @param publicOnly compare only the TV and the host, for games where the other phones may see the role.
 * @returns a problem per difference found.
 */
export function roleBlindness<State>(
    games: readonly { game: KitGame<State>; holderId: string }[],
    script: readonly TraceEvent[],
    players: readonly CartridgePlayer[] = PAPER_PLAYERS,
    publicOnly: boolean = false,
): string[] {
    const problems: string[] = [];
    const runs: { holderId: string; views: Map<string, unknown[]>[] }[] = games.map(({ game, holderId }: { game: KitGame<State>; holderId: string }) => {
        const cartridge: Cartridge<State> = game.cartridge;
        let step: Step<State> = cartridge.init([...players], {});
        const views: Map<string, unknown[]>[] = [viewsOf(cartridge, step.state, players, step.facts)];
        for (const event of script) {
            if (cartridge.outcome(step.state) !== null) {
                break;
            }
            step = event.type === "input" ? cartridge.apply(step.state, event.playerId, event.actionId) : cartridge.onEvent(step.state, event);
            if (cartridge.outcome(step.state) !== null) {
                break;
            }
            views.push(viewsOf(cartridge, step.state, players, step.facts));
        }
        return { holderId, views };
    });
    const first: { holderId: string; views: Map<string, unknown[]>[] } | undefined = runs[0];
    if (first === undefined) {
        return problems;
    }
    for (const other of runs.slice(1)) {
        const length: number = Math.min(first.views.length, other.views.length);
        if (first.views.length !== other.views.length) {
            problems.push(`The game ran a different number of steps when ${other.holderId} held the role.`);
        }
        for (let index = 0; index < length; index += 1) {
            const phones: string[] = publicOnly === true ? [] : players.map((player: CartridgePlayer) => player.playerId).filter((id: string) => id !== first.holderId && id !== other.holderId);
            const viewers: string[] = ["screen", "host", ...phones];
            for (const viewer of viewers) {
                const seenFirst: string = JSON.stringify(first.views[index]?.get(viewer) ?? []);
                const seenOther: string = JSON.stringify(other.views[index]?.get(viewer) ?? []);
                if (seenFirst !== seenOther) {
                    problems.push(`Step ${index}: ${viewer} could tell whether ${first.holderId} or ${other.holderId} held the role.`);
                }
            }
        }
    }
    return problems;
}
