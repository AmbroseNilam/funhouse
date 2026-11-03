// Turns a blueprint into a cartridge. Written once; configured by the blueprint's decisions. The
// shape follows cartridges/twenty-doors/rules.ts so a blueprint of that game plays the same, and
// every fact it emits is followed by a system-scoped "because" fact naming the decision behind
// it. The room shows system facts to nobody and never briefs the host on them, so they cost
// nothing in play and give a rehearsal its explanations.

import { HOST_NAME } from "../shared/brand.ts";
import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../shared/cartridge.ts";
import type { Control } from "../shared/controls.ts";
import type { Scene, SceneBlock } from "../shared/scene.ts";
import type { RoomEvent } from "../shared/timeline.ts";
import type { Scope, ScopedFact } from "../shared/visibility.ts";
import { DECISIONS, rulingDecision, type Blueprint, type Ruling, type RulingEffect, type SecretCategory } from "./blueprint.ts";

/** The phases of the guessing family. */
export type GuessingPhase = "choosing" | "asking" | "end";

/** Lines the screen keeps showing. */
const SHOWN_LINES: number = 4;

/** The kind of the system fact that names a decision. */
export const BECAUSE_KIND: string = "because";

/** One thing a player said and how it was ruled. */
export interface SaidLine {
    speaker: string;
    text: string;
    answer: string;
}

/** The whole game, immutable between steps. */
export interface BlueprintState {
    phase: GuessingPhase;
    players: CartridgePlayer[];
    category: string;
    fallback: string;
    secret: string;
    spent: number;
    said: SaidLine[];
    /** The latest thing a player said, waiting for a ruling. */
    heard: { playerId: string; text: string } | null;
    won: boolean;
    finder: string | null;
    revealPicture: string | null;
}

/** A cartridge built from a blueprint, with what a rehearsal needs to check it. */
export interface BlueprintGame {
    blueprint: Blueprint;
    cartridge: Cartridge<BlueprintState>;
    /** Strings that must never reach a public fact or the public screen before the end. */
    secrets(state: BlueprintState): string[];
}

/**
 * Builds the manifest, the declarative half, from the blueprint.
 * @param blueprint the blueprint.
 * @returns the manifest.
 */
export function manifestOf(blueprint: Blueprint): CartridgeManifest {
    const rulings: Record<string, string> = Object.fromEntries(Object.entries(blueprint.judge.rulings).map(([name, ruling]: [string, Ruling]) => [name, ruling.when]));
    return {
        id: blueprint.id,
        name: blueprint.name,
        minPlayers: blueprint.minPlayers,
        maxPlayers: blueprint.maxPlayers,
        hostBrief: blueprint.host.game,
        keywords: blueprint.keywords,
        variants: [],
        phases: [
            { id: "choosing", hostBrief: blueprint.host.choosing, listening: { "*": "holdToTalk" }, hostMayInterject: false, silenceSeconds: 0 },
            { id: "asking", hostBrief: blueprint.host.asking, listening: { "*": "holdToTalk" }, hostMayInterject: true, silenceSeconds: 0, hostRulings: rulings },
            { id: "end", hostBrief: blueprint.host.end, listening: { "*": "holdToTalk" }, hostMayInterject: true, silenceSeconds: 0 },
        ],
    };
}

/**
 * A fact followed by the decision that produced it.
 * @param fact the fact.
 * @param decision the decision id.
 * @returns both facts, in order.
 */
function because(fact: ScopedFact, decision: string): ScopedFact[] {
    return [fact, { scope: { kind: "system" }, kind: BECAUSE_KIND, text: decision, quiet: true }];
}

/**
 * Builds a game from a blueprint with an injectable random source.
 * @param blueprint the blueprint; check it with blueprintProblems first.
 * @param random a function returning [0, 1); defaults to Math.random.
 * @returns the game.
 */
export function createBlueprintGame(blueprint: Blueprint, random: () => number = Math.random): BlueprintGame {
    const manifest: CartridgeManifest = manifestOf(blueprint);
    const { count, secret, judge, giveUp }: Blueprint = blueprint;
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });
    const nameOf = (state: BlueprintState, playerId: string): string => state.players.find((player: CartridgePlayer) => player.playerId === playerId)?.name ?? "Someone";
    const unitOf = (left: number): string => (left === 1 ? count.unit.singular : count.unit.plural);

    /**
     * Ends the game.
     * @param state the state.
     * @param won whether they found it.
     * @param finder who found it.
     * @param text what to tell the host.
     * @param decision the decision that ended it.
     * @returns the step.
     */
    const finish = (state: BlueprintState, won: boolean, finder: string | null, text: string, decision: string): Step<BlueprintState> => {
        return { state: { ...state, phase: "end", won, finder, heard: null }, facts: because(publicFact("game-over", text), decision), nextPhaseId: "end" };
    };

    /**
     * Spends one of the count for a ruling, and ends the game on the last one.
     * @param state the state.
     * @param answer how the screen shows the ruling.
     * @returns the step.
     */
    const spend = (state: BlueprintState, answer: string): Step<BlueprintState> => {
        const spent: number = state.spent + 1;
        const line: SaidLine = { speaker: state.heard === null ? "Someone" : nameOf(state, state.heard.playerId), text: state.heard?.text ?? "", answer };
        const next: BlueprintState = { ...state, spent, said: [...state.said, line], heard: null };
        if (spent >= count.budget) {
            return finish(next, false, null, `That was the last ${count.unit.singular}. They're out. The secret was ${state.secret}.`, DECISIONS.budget ?? "");
        }
        const left: number = count.budget - spent;
        if (count.warnAt.includes(left) === false) {
            return { state: next, facts: [] };
        }
        return { state: next, facts: because(publicFact("count-left", `Tell them only ${left} ${unitOf(left)} ${left === 1 ? "is" : "are"} left.`), DECISIONS.warnAt ?? "") };
    };

    /**
     * Applies a ruling's effect.
     * @param state the state, with something heard.
     * @param name the ruling's name.
     * @returns the step.
     */
    const rule = (state: BlueprintState, name: string): Step<BlueprintState> => {
        const effect: RulingEffect | undefined = judge.rulings[name]?.effect;
        if (effect === undefined || effect.kind === "free") {
            return { state, facts: [] };
        }
        if (effect.kind === "spend") {
            return spend(state, effect.label);
        }
        if (effect.kind === "win") {
            const finder: string = state.heard === null ? "Someone" : nameOf(state, state.heard.playerId);
            const text: string = `${finder} found it after ${state.spent} ${unitOf(state.spent)}. The secret was ${state.secret}. Announce it.`;
            return finish(state, true, finder, text, rulingDecision(name));
        }
        return finish(state, false, null, `They gave up after ${state.spent} ${unitOf(state.spent)}. The secret was ${state.secret}.`, rulingDecision(name));
    };

    const cartridge: Cartridge<BlueprintState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<BlueprintState> {
            const first: SecretCategory = secret.categories[0] ?? { name: "an animal", fallback: "platypus" };
            const category: SecretCategory = secret.categories[Math.floor(random() * secret.categories.length)] ?? first;
            const state: BlueprintState = { phase: "choosing", players, category: category.name, fallback: category.fallback, secret: "", spent: 0, said: [], heard: null, won: false, finder: null, revealPicture: null };
            return { state, facts: [], nextPhaseId: "choosing", contentRequest: secret.request.replaceAll("{category}", category.name) };
        },

        phaseOf(state: BlueprintState): string {
            return state.phase;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: BlueprintState): LegalAction[] {
            if (state.phase !== "asking" || giveUp === null) {
                return [];
            }
            return [{ actionId: giveUp.actionId, label: giveUp.label }];
        },

        apply(state: BlueprintState, _playerId: string, actionId: string): Step<BlueprintState> {
            if (state.phase !== "asking" || giveUp === null || actionId !== giveUp.actionId) {
                return { state, facts: [] };
            }
            return finish(state, false, null, `They gave up after ${state.spent} ${unitOf(state.spent)}. The secret was ${state.secret}.`, DECISIONS.giveUp ?? "");
        },

        onEvent(state: BlueprintState, event: RoomEvent): Step<BlueprintState> {
            if (event.type === "contentReady" && state.phase === "choosing") {
                const chosen: string = event.text.trim().replace(/[."'!]/g, "");
                const usable: string = chosen === "" || chosen.length > secret.maxLength ? state.fallback : chosen;
                const picked: string = `${usable.charAt(0).toUpperCase()}${usable.slice(1)}`;
                const next: BlueprintState = { ...state, phase: "asking", secret: picked };
                const ready: ScopedFact = publicFact("ready", `The secret is chosen. Tell them it's ${state.category} and they have ${count.budget} ${count.unit.plural}, and invite the first question.`);
                const draws: { id: string; prompt: string }[] = secret.drawing === "" ? [] : [{ id: "reveal", prompt: secret.drawing.replaceAll("{secret}", picked) }];
                return { state: next, facts: because(ready, DECISIONS.categories ?? ""), nextPhaseId: "asking", draws };
            }
            if (event.type === "drawingReady" && event.id === "reveal") {
                return { state: { ...state, revealPicture: event.src }, facts: [] };
            }
            if (event.type === "speechEnded" && state.phase === "asking") {
                return { state: { ...state, heard: { playerId: event.playerId, text: event.text } }, facts: [] };
            }
            if (event.type !== "hostRuled" || state.phase !== "asking") {
                return { state, facts: [] };
            }
            const effect: RulingEffect | undefined = judge.rulings[event.ruling]?.effect;
            if (state.heard === null && effect?.kind !== "lose") {
                return { state, facts: [] };
            }
            return rule(state, event.ruling);
        },

        publicScene(state: BlueprintState): Scene {
            if (state.phase === "choosing") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: blueprint.name }, { type: "text", text: "Choosing a secret…", emphasis: "whisper" }] };
            }
            const progress: SceneBlock = { type: "progress", label: count.label, current: state.spent, max: count.budget, marks: count.marks };
            if (state.phase === "end") {
                const blocks: SceneBlock[] = [{ type: "title", text: state.secret, kicker: state.won === true ? `${state.finder ?? "Someone"} found it` : "The secret was" }];
                blocks.push(state.revealPicture === null ? { type: "text", text: "Still painting it…", emphasis: "whisper" } : { type: "image", src: state.revealPicture });
                blocks.push(progress);
                return { mood: state.won === true ? "victory" : "defeat", transition: "fade", blocks };
            }
            const recent: SceneBlock[] = state.said.slice(-SHOWN_LINES).map((line: SaidLine) => ({ type: "text", text: `${line.text} ${line.answer}.` }));
            return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: `It's ${state.category}`, kicker: blueprint.name }, progress, ...recent] };
        },

        privateControls(state: BlueprintState): Control[] {
            if (state.phase === "choosing") {
                return [{ type: "waiting", text: `${HOST_NAME} is choosing a secret.` }];
            }
            if (state.phase === "end") {
                return [{ type: "waiting", text: state.won === true ? "You found it." : "Better luck next time." }];
            }
            return [{ type: "waiting", text: "Ask a yes-or-no question" }];
        },

        hostFacts(state: BlueprintState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.secret === "") {
                return [];
            }
            return [
                { scope: { kind: "host" }, kind: "secret", text: `The secret is: ${state.secret}.` },
                { scope: { kind: "public" }, kind: "count", text: `${state.spent} of ${count.budget} ${count.unit.plural} are used.` },
            ];
        },

        outcome(state: BlueprintState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            return state.won === true ? `${state.finder ?? "Someone"} found ${state.secret}.` : `The secret was ${state.secret}.`;
        },
    };

    return {
        blueprint,
        cartridge,
        secrets(state: BlueprintState): string[] {
            return state.secret === "" ? [] : [state.secret];
        },
    };
}
