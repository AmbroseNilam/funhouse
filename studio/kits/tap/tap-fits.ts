// Who Fits, a tap game: each round the TV shows a prompt such as "Would give the best wedding
// speech", everyone secretly taps the player it fits best, and the TV reveals only the counts. The
// host reads the prompt and, at the reveal, says something kind about it. Nobody sees who tapped
// whom, not even the host. Code counts the taps, runs the clocks and keeps the totals; the host
// makes no rulings at all.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { Turn } from "../../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../../shared/visibility.ts";
import { boxProblems, isWholeIn, type Box, type HiddenValue, type KitGame } from "../../kit/kit.ts";
import { because, frozenCopy, tally, type Tally } from "../../kit/primitives.ts";
import { ballot, everyoneTapped, isUsableLine, linesToPlay, nameIn, otherPlayers, parseLines, scoreboard } from "./tap.ts";

/** Everything a creator may choose for a Who Fits game. */
export interface FitsDecisions {
    style: "fits";
    /** How many prompts a game plays. */
    rounds: number;
    /** Seconds to tap. */
    tapSeconds: number;
    /** Seconds the reveal stays up while the host talks. */
    revealSeconds: number;
    /** Prompts to use when the model writes too few, in order. */
    prompts: string[];
}

/** The phases of the game. */
export type FitsPhase = "writing" | "tapping" | "reveal" | "end";

/** The whole game, immutable between steps. */
export interface FitsState {
    phase: FitsPhase;
    players: CartridgePlayer[];
    prompts: string[];
    /** Which prompt is up, from 0. */
    round: number;
    /** Who must tap this round, fixed when it opens. */
    tappers: string[];
    /** Each tapper's choice this round, by tapper id. Never shown to anyone. */
    taps: Record<string, string>;
    /** This round's counts, once revealed. */
    revealed: { playerId: string; votes: number }[];
    /** Taps received across the game, by player id. */
    totals: Record<string, number>;
}

/** The prefix on a tap's option id. */
export const FITS_PREFIX: string = "fits:";

/** Decision ids a rehearsal names when it explains a moment. */
export const FITS_DECISIONS: { prompts: string; rounds: string; tap: string; reveal: string } = { prompts: "prompts", rounds: "rounds", tap: "tapSeconds", reveal: "revealSeconds" };

/**
 * Checks a Who Fits game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function fitsProblems(decisions: FitsDecisions): string[] {
    const problems: string[] = [];
    if (isWholeIn(decisions.rounds, 2, 10) === false) {
        problems.push("A game plays a whole number of prompts from 2 to 10.");
    }
    if (isWholeIn(decisions.tapSeconds, 15, 90) === false || isWholeIn(decisions.revealSeconds, 5, 30) === false) {
        problems.push("Tapping takes 15 to 90 seconds and the reveal 5 to 30, in whole seconds.");
    }
    if (decisions.prompts.length < decisions.rounds || decisions.prompts.some((prompt: string) => isUsableLine(prompt) === false) === true) {
        problems.push("There must be at least one usable fallback prompt per round, each short and plain.");
    }
    return problems;
}

/**
 * Every problem with a Who Fits blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function fitsBlueprintProblems(box: Box, decisions: FitsDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...fitsProblems(decisions)];
    if (box.minPlayers < 3) {
        problems.push("Who Fits needs at least three people, or every tap is obvious.");
    }
    return problems;
}

/**
 * Builds the manifest, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 */
export function fitsManifest(box: Box): CartridgeManifest {
    const listening: Record<string, "holdToTalk"> = { "*": "holdToTalk" };
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're hosting ${box.name}. Each round there's a prompt, everyone secretly taps the person it fits best, and the screen shows only the counts.`,
            "Nobody, you included, ever knows who tapped whom, so never guess or ask.",
            "Your tone: warm and generous. Make the people with the most taps look good, tease the prompt rather than any person, and never make one person the joke.",
            "If someone seems put out, turn it into a compliment. No remarks about anyone's looks, body, money, age or love life.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            { id: "writing", hostBrief: "You're writing the prompts. One short line at most, then wait.", listening, hostMayInterject: false, silenceSeconds: 0 },
            { id: "tapping", hostBrief: "When you're told the prompt, read it out in one line and tell them to tap. Then reply exactly (quiet) unless someone speaks to you.", listening, hostMayInterject: false, silenceSeconds: 0 },
            { id: "reveal", hostBrief: "You'll be told the counts. One or two kind sentences about the result, about the prompt and the people it fits, never at anyone's expense.", listening, hostMayInterject: true, silenceSeconds: 0 },
            { id: "end", hostBrief: "The game is over. Two sentences: who the night's prompts fitted most, kindly, and that everyone came out of it well. Then ask if they want another game.", listening, hostMayInterject: true, silenceSeconds: 0 },
        ],
    };
}

/**
 * Builds a Who Fits game.
 * @param givenBox the box; copied.
 * @param givenDecisions the decisions; copied. Check them with fitsProblems first.
 * @returns the game.
 */
export function createFitsGame(givenBox: Box, givenDecisions: FitsDecisions): KitGame<FitsState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: FitsDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = fitsManifest(box);
    const publicFact = (kind: string, text: string): ScopedFact => ({ scope: { kind: "public" }, kind, text });

    /**
     * Opens a round for tapping.
     * @param state the state, with prompts.
     * @param round which prompt.
     * @param decision the decision that opened it.
     * @returns the step.
     */
    const open = (state: FitsState, round: number, decision: string): Step<FitsState> => {
        const next: FitsState = { ...state, phase: "tapping", round, tappers: state.players.map((player: CartridgePlayer) => player.playerId), taps: {}, revealed: [] };
        const prompt: string = state.prompts[round] ?? "";
        const text: string = `Prompt ${round + 1} of ${state.prompts.length}: "${prompt}". Read it out and tell them to tap who it fits best.`;
        return { state: next, facts: because(publicFact("prompt", text), decision), nextPhaseId: "tapping", timers: { [`tap${round}`]: decisions.tapSeconds } };
    };

    /**
     * Reveals this round's counts and adds them to the totals.
     * @param state the state while tapping.
     * @returns the step.
     */
    const reveal = (state: FitsState): Step<FitsState> => {
        const counted: Tally = tally(state.taps, state.players.map((player: CartridgePlayer) => player.playerId));
        const revealed: { playerId: string; votes: number }[] = counted.rows.filter((row: { playerId: string; votes: number }) => row.votes > 0);
        const totals: Record<string, number> = { ...state.totals };
        for (const row of revealed) {
            totals[row.playerId] = (totals[row.playerId] ?? 0) + row.votes;
        }
        const next: FitsState = { ...state, phase: "reveal", revealed, totals };
        const counts: string = revealed.length === 0 ? "nobody tapped anyone" : revealed.map((row: { playerId: string; votes: number }) => `${nameIn(state.players, row.playerId)} ${row.votes}`).join(", ");
        const text: string = `For "${state.prompts[state.round] ?? ""}": ${counts}. Say something kind about it.`;
        return { state: next, facts: because(publicFact("reveal", text), FITS_DECISIONS.tap), nextPhaseId: "reveal", timers: { [`reveal${state.round}`]: decisions.revealSeconds } };
    };

    /**
     * Ends the game with the totals.
     * @param state the state.
     * @returns the step.
     */
    const finish = (state: FitsState): Step<FitsState> => {
        const ranked: [string, number][] = Object.entries(state.totals).sort((first: [string, number], second: [string, number]) => second[1] - first[1]);
        const top: string = ranked.slice(0, 2).map(([playerId, votes]: [string, number]) => `${nameIn(state.players, playerId)} with ${votes}`).join(" and ");
        const text: string = `That was the last prompt. Most taps over the game: ${top === "" ? "nobody" : top}.`;
        return { state: { ...state, phase: "end" }, facts: because(publicFact("game-over", text), FITS_DECISIONS.rounds), nextPhaseId: "end" };
    };

    /**
     * Someone left: they stop tapping, taps for them are dropped, and the round reveals at once if
     * everyone left has tapped.
     * @param state the state.
     * @param playerId who left.
     * @returns the step.
     */
    const left = (state: FitsState, playerId: string): Step<FitsState> => {
        const kept: [string, string][] = Object.entries(state.taps).filter(([tapper, target]: [string, string]) => tapper !== playerId && target !== playerId);
        const taps: Record<string, string> = Object.fromEntries(kept);
        const next: FitsState = {
            ...state,
            players: state.players.filter((player: CartridgePlayer) => player.playerId !== playerId),
            tappers: state.tappers.filter((tapper: string) => tapper !== playerId),
            taps,
        };
        if (next.phase === "tapping" && next.tappers.length > 0 && everyoneTapped(next.tappers, next.taps) === true) {
            return reveal(next);
        }
        return { state: next, facts: [] };
    };

    /**
     * What a player may tap now: anyone else, once, while the round is open.
     * @param state the state.
     * @param playerId the player.
     * @returns the actions.
     */
    const legalFor = (state: FitsState, playerId: string): LegalAction[] => {
        if (state.phase !== "tapping" || state.tappers.includes(playerId) === false || state.taps[playerId] !== undefined) {
            return [];
        }
        return otherPlayers(state.players, playerId, FITS_PREFIX).map((option: ControlOption): LegalAction => ({ actionId: option.id, label: option.label }));
    };

    const cartridge: Cartridge<FitsState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<FitsState> {
            const state: FitsState = { phase: "writing", players, prompts: [], round: 0, tappers: [], taps: {}, revealed: [], totals: {} };
            const request: string = [
                `Write ${decisions.rounds} short prompts for a friendly party game where everyone secretly picks the person each prompt fits best.`,
                "Each starts with \"Would\", flatters or teases gently, could fit anyone at the table, and never embarrasses anyone or mentions looks, money, age or love life.",
                "Reply with only a JSON array of strings.",
            ].join(" ");
            return { state, facts: [], nextPhaseId: "writing", contentRequest: request };
        },

        phaseOf(state: FitsState): string {
            return state.phase;
        },

        turn(state: FitsState): Turn | null {
            return state.phase === "tapping" ? { kind: "everyone", playerIds: state.tappers, doneIds: Object.keys(state.taps), label: "Tap who it fits" } : null;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: FitsState, playerId: string): LegalAction[] {
            return legalFor(state, playerId);
        },

        apply(state: FitsState, playerId: string, actionId: string): Step<FitsState> {
            if (legalFor(state, playerId).some((action: LegalAction) => action.actionId === actionId) === false) {
                return { state, facts: [] };
            }
            const next: FitsState = { ...state, taps: { ...state.taps, [playerId]: actionId.slice(FITS_PREFIX.length) } };
            return everyoneTapped(next.tappers, next.taps) === true ? reveal(next) : { state: next, facts: [] };
        },

        onEvent(state: FitsState, event: RoomEvent): Step<FitsState> {
            if (event.type === "contentReady" && state.phase === "writing") {
                const prompts: string[] = linesToPlay(parseLines(event.text), decisions.prompts, decisions.rounds);
                return open({ ...state, prompts }, 0, FITS_DECISIONS.prompts);
            }
            if (event.type === "timerFired" && state.phase === "tapping" && event.timerId === `tap${state.round}`) {
                return reveal(state);
            }
            if (event.type === "timerFired" && state.phase === "reveal" && event.timerId === `reveal${state.round}`) {
                return state.round + 1 >= state.prompts.length ? finish(state) : open(state, state.round + 1, FITS_DECISIONS.reveal);
            }
            if (event.type === "playerLeft" && state.players.some((player: CartridgePlayer) => player.playerId === event.playerId) === true) {
                return left(state, event.playerId);
            }
            return { state, facts: [] };
        },

        publicScene(state: FitsState): Scene {
            if (state.phase === "writing") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: box.name }, { type: "text", text: "Writing the prompts…", emphasis: "whisper" }] };
            }
            const prompt: string = state.prompts[state.round] ?? "";
            const kicker: string = `Prompt ${state.round + 1} of ${state.prompts.length}`;
            if (state.phase === "tapping") {
                return {
                    mood: "neutral",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: prompt, kicker },
                        { type: "text", text: "Tap who it fits best. Nobody will know who you picked.", emphasis: "large" },
                        { type: "timer", seconds: decisions.tapSeconds, label: `to tap, prompt ${state.round + 1}`, running: true },
                    ],
                };
            }
            if (state.phase === "reveal") {
                const rows: TallyRow[] = state.revealed.map((row: { playerId: string; votes: number }): TallyRow => {
                    return { label: nameIn(state.players, row.playerId), count: row.votes };
                });
                const blocks: SceneBlock[] = [{ type: "title", text: prompt, kicker }];
                blocks.push(rows.length === 0 ? { type: "text", text: "Nobody tapped anyone.", emphasis: "large" } : { type: "tally", title: "It fits", rows });
                return { mood: "dawn", transition: "fade", blocks };
            }
            return { mood: "victory", transition: "fade", blocks: [{ type: "title", text: "Who it fitted", kicker: box.name }, scoreboard("Taps over the game", state.players, state.totals)] };
        },

        privateControls(state: FitsState, playerId: string): Control[] {
            if (legalFor(state, playerId).length > 0) {
                return [ballot("Who does it fit best?", otherPlayers(state.players, playerId, FITS_PREFIX))];
            }
            if (state.phase === "tapping") {
                return [{ type: "waiting", text: state.tappers.includes(playerId) === true ? "Tapped. Waiting for the others." : "Watching this round." }];
            }
            return [{ type: "waiting", text: state.phase === "writing" ? "Getting the prompts ready." : "Look at the screen." }];
        },

        hostFacts(state: FitsState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase !== "tapping") {
                return [];
            }
            return [{ scope: { kind: "public" }, kind: "progress", text: `${Object.keys(state.taps).length} of ${state.tappers.length} have tapped.` }];
        },

        outcome(state: FitsState): string | null {
            return state.phase === "end" ? "That's every prompt." : null;
        },
    };

    return {
        cartridge,
        hidden(): HiddenValue[] {
            return [];
        },
    };
}
