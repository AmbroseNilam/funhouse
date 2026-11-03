// Twenty Doors' rules core. The host's model chooses the secret, which only the host is told.
// Every yes, no, sort-of or wrong guess opens a door. Twenty doors without the answer loses.

import { HOST_NAME } from "../../shared/brand.ts";
import type { Cartridge, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { TWENTY_DOORS_MANIFEST } from "./manifest.ts";

/** Doors the group gets. */
export const DOOR_COUNT: number = 20;

/** Questions the screen keeps showing. */
const SHOWN_QUESTIONS: number = 4;

/** Doors left at which the host is told to warn them. */
const WARNING_DOORS: number[] = [5, 1];

/** Longest secret accepted from the model; anything longer isn't one thing. */
const SECRET_CHARACTER_LIMIT: number = 40;

/** Categories to choose from, each with a secret to use if the model can't supply one. */
const CATEGORIES: { name: string; fallback: string }[] = [
    { name: "an animal", fallback: "platypus" },
    { name: "something in a kitchen", fallback: "whisk" },
    { name: "a famous landmark", fallback: "Eiffel Tower" },
    { name: "a food", fallback: "pineapple" },
    { name: "a job", fallback: "lighthouse keeper" },
    { name: "something you'd find at the beach", fallback: "sandcastle" },
    { name: "a musical instrument", fallback: "accordion" },
    { name: "a vehicle", fallback: "hot air balloon" },
];

/** Answers that open a door, with how the screen shows each. */
const DOOR_RULINGS: Record<string, string> = { yes: "Yes", no: "No", sortof: "Sort of", wrong: "Wrong guess" };

/** One question and its answer. */
export interface AskedQuestion {
    asker: string;
    question: string;
    answer: string;
}

/** The whole game, immutable between steps. */
export interface TwentyDoorsState {
    phase: "choosing" | "asking" | "end";
    players: CartridgePlayer[];
    category: string;
    fallback: string;
    secret: string;
    doorsOpened: number;
    asked: AskedQuestion[];
    /** The latest thing a player said, waiting for a ruling. */
    heard: { playerId: string; text: string } | null;
    won: boolean;
    finder: string | null;
    /** The picture of the secret, drawn in secret for the reveal. */
    revealPicture: string | null;
}

/**
 * Builds the Twenty Doors cartridge with an injectable random source.
 * @param random a function returning [0, 1); defaults to Math.random.
 * @returns the cartridge.
 */
export function createTwentyDoors(random: () => number = Math.random): Cartridge<TwentyDoorsState> {
    const publicFact = (kind: string, text: string, quiet: boolean = false): ScopedFact => ({ scope: { kind: "public" }, kind, text, quiet });
    const nameOf = (state: TwentyDoorsState, playerId: string): string => state.players.find((player) => player.playerId === playerId)?.name ?? "Someone";

    /**
     * Ends the game.
     * @param state the state.
     * @param won whether they found it.
     * @param finder who found it.
     * @param text what to tell the host.
     * @returns the step.
     */
    const finish = (state: TwentyDoorsState, won: boolean, finder: string | null, text: string): Step<TwentyDoorsState> => {
        return { state: { ...state, phase: "end", won, finder, heard: null }, facts: [publicFact("game-over", text)], nextPhaseId: "end" };
    };

    /**
     * Opens a door for a ruling, and ends the game on the last one.
     * @param state the state.
     * @param answer how the screen shows the ruling.
     * @returns the step.
     */
    const openDoor = (state: TwentyDoorsState, answer: string): Step<TwentyDoorsState> => {
        const doorsOpened: number = state.doorsOpened + 1;
        const entry: AskedQuestion = { asker: state.heard === null ? "Someone" : nameOf(state, state.heard.playerId), question: state.heard?.text ?? "", answer };
        const next: TwentyDoorsState = { ...state, doorsOpened, asked: [...state.asked, entry], heard: null };
        if (doorsOpened >= DOOR_COUNT) {
            return finish(next, false, null, `That was the last door. They're out. The secret was ${state.secret}.`);
        }
        const left: number = DOOR_COUNT - doorsOpened;
        return { state: next, facts: WARNING_DOORS.includes(left) === true ? [publicFact("doors-left", `Tell them only ${left} door${left === 1 ? " is" : "s are"} left.`)] : [] };
    };

    return {
        manifest: TWENTY_DOORS_MANIFEST,

        init(players: CartridgePlayer[]): Step<TwentyDoorsState> {
            const category: { name: string; fallback: string } = CATEGORIES[Math.floor(random() * CATEGORIES.length)] ?? { name: "an animal", fallback: "platypus" };
            const state: TwentyDoorsState = { phase: "choosing", players, category: category.name, fallback: category.fallback, secret: "", doorsOpened: 0, asked: [], heard: null, won: false, finder: null, revealPicture: null };
            return {
                state,
                facts: [],
                nextPhaseId: "choosing",
                contentRequest: [
                    `Choose one specific thing for a game of twenty questions. It must be ${category.name}, known to most adults,`,
                    "and a little surprising rather than the first thing anyone would say. Reply with only its name, in at most three words, with no punctuation.",
                ].join(" "),
            };
        },

        phaseOf(state: TwentyDoorsState): string {
            return state.phase;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: TwentyDoorsState): LegalAction[] {
            return state.phase === "asking" ? [{ actionId: "giveup", label: "We give up" }] : [];
        },

        apply(state: TwentyDoorsState, _playerId: string, actionId: string): Step<TwentyDoorsState> {
            if (state.phase !== "asking" || actionId !== "giveup") {
                return { state, facts: [] };
            }
            return finish(state, false, null, `They gave up after ${state.doorsOpened} doors. The secret was ${state.secret}.`);
        },

        onEvent(state: TwentyDoorsState, event: RoomEvent): Step<TwentyDoorsState> {
            if (event.type === "contentReady" && state.phase === "choosing") {
                const chosen: string = event.text.trim().replace(/[."'!]/g, "");
                const usable: string = chosen === "" || chosen.length > SECRET_CHARACTER_LIMIT ? state.fallback : chosen;
                const secret: string = `${usable.charAt(0).toUpperCase()}${usable.slice(1)}`;
                const next: TwentyDoorsState = { ...state, phase: "asking", secret };
                return {
                    state: next,
                    facts: [publicFact("ready", `The secret is chosen. Tell them it's ${state.category} and they have ${DOOR_COUNT} doors, and invite the first question.`)],
                    nextPhaseId: "asking",
                    draws: [{ id: "reveal", prompt: `A warm storybook painting of ${secret}, seen through an open wooden door, glowing light, rich color, no text or letters.` }],
                };
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
            if (state.heard === null && event.ruling !== "giveup") {
                return { state, facts: [] };
            }
            const answer: string | undefined = DOOR_RULINGS[event.ruling];
            if (answer !== undefined) {
                return openDoor(state, answer);
            }
            if (event.ruling === "correct") {
                const finder: string = state.heard === null ? "Someone" : nameOf(state, state.heard.playerId);
                return finish(state, true, finder, `${finder} found it after ${state.doorsOpened} doors. The secret was ${state.secret}. Announce it.`);
            }
            if (event.ruling === "giveup") {
                return finish(state, false, null, `They gave up after ${state.doorsOpened} doors. The secret was ${state.secret}.`);
            }
            return { state, facts: [] };
        },

        publicScene(state: TwentyDoorsState): Scene {
            if (state.phase === "choosing") {
                return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: "Twenty Doors" }, { type: "text", text: "Choosing a secret…", emphasis: "whisper" }] };
            }
            if (state.phase === "end") {
                const blocks: SceneBlock[] = [{ type: "title", text: state.secret, kicker: state.won === true ? `${state.finder ?? "Someone"} found it` : "The secret was" }];
                if (state.revealPicture !== null) {
                    blocks.push({ type: "image", src: state.revealPicture });
                }
                blocks.push({ type: "progress", label: "Doors opened", current: state.doorsOpened, max: DOOR_COUNT, marks: "door" });
                return { mood: state.won === true ? "victory" : "defeat", transition: "fade", blocks };
            }
            const recent: SceneBlock[] = state.asked.slice(-SHOWN_QUESTIONS).map((entry: AskedQuestion) => ({ type: "text", text: `${entry.question} ${entry.answer}.` }));
            return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: "Twenty Doors", kicker: `It's ${state.category}` }, { type: "progress", label: "Doors opened", current: state.doorsOpened, max: DOOR_COUNT, marks: "door" }, ...recent] };
        },

        privateControls(state: TwentyDoorsState): Control[] {
            if (state.phase === "choosing") {
                return [{ type: "waiting", text: `${HOST_NAME} is choosing a secret.` }];
            }
            if (state.phase === "end") {
                return [{ type: "waiting", text: state.won === true ? "You found it." : "Better luck next time." }];
            }
            return [
                { type: "waiting", text: `Ask a yes-or-no question out loud. ${DOOR_COUNT - state.doorsOpened} doors left.` },
                { type: "buttons", options: [{ id: "giveup", label: "We give up" }] },
            ];
        },

        hostFacts(state: TwentyDoorsState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.secret === "") {
                return [];
            }
            return [
                { scope: { kind: "host" }, kind: "secret", text: `The secret is: ${state.secret}.` },
                { scope: { kind: "public" }, kind: "doors", text: `${state.doorsOpened} of ${DOOR_COUNT} doors are open.` },
            ];
        },

        outcome(state: TwentyDoorsState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            return state.won === true ? `${state.finder ?? "Someone"} found ${state.secret}.` : `The secret was ${state.secret}.`;
        },
    };
}
