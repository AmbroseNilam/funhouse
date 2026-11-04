// The chain kit: one chain of lines and paintings goes round the table. The first player writes a
// line, the host paints it, the next player sees only the painting and describes it, the host
// paints that, and so on until everyone has written once. Then the whole chain is shown on the TV,
// one beat at a time, and the host comments. Code owns the order, the clocks, what each player may
// see and the "how far did it drift" count; the host paints through the room and only comments at
// the end, when it is told what the chain said. Painted Whispers is this kit.
//
// Pictures are slow and can fail, so a painting that has not come by its clock is given up on and
// the next player gets the line it was meant to show, in words. A painting that arrives late is
// still kept for the reveal. A player who writes nothing, or leaves, is covered by a stock line, so
// one empty phone never stops the table.

import type { Cartridge, CartridgeManifest, CartridgePlayer, LegalAction, Step } from "../../../shared/cartridge.ts";
import type { Control } from "../../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import type { Turn } from "../../../shared/turn.ts";
import type { Scope, ScopedFact } from "../../../shared/visibility.ts";
import { boxProblems, isShortText, isWholeIn, squash, type Box, type HiddenValue, type KitGame } from "../../kit/kit.ts";
import { cleanLine, isDrawingAddress, paintPrompt } from "../../kit/painting.ts";
import { because, frozenCopy, pick, shuffle } from "../../kit/primitives.ts";

/** Everything a creator may choose for a chain game. */
export interface ChainDecisions {
    /** Opening lines used when the first writer writes nothing. */
    starters: string[];
    /** Descriptions used when a later writer writes nothing or has left. */
    blanks: string[];
    /** Seconds a writer has. */
    writeSeconds: number;
    /** Seconds to wait for a painting before the next writer gets the words instead. */
    paintSeconds: number;
    /** Seconds each beat of the reveal stays up. */
    beatSeconds: number;
    /** Most characters in one line. */
    lineLimit: number;
}

/** The phases of the kit. */
export type ChainPhase = "write" | "paint" | "reveal" | "end";

/** One link: a line a player wrote and the painting made from it. */
export interface ChainLink {
    writerId: string;
    writerName: string;
    text: string;
    /** True when the line is a stock one because the writer wrote nothing or left. */
    stock: boolean;
    /** Where the room serves the painting, once it exists. */
    src: string | null;
    /** True once the table stopped waiting for this painting. */
    gaveUp: boolean;
}

/** The whole game, immutable between steps. */
export interface ChainState {
    phase: ChainPhase;
    /** Who writes, in the order the chain passes. */
    order: CartridgePlayer[];
    /** Players who have left. */
    gone: string[];
    /** The writer now up (write), or whose line is being painted (paint). */
    step: number;
    links: ChainLink[];
    /** A stock line for each step, chosen when the game began. */
    stock: string[];
    /** Which beat of the reveal is showing. */
    beat: number;
}

/** Decision ids a rehearsal names when it explains a moment. */
export const CHAIN_DECISIONS: { write: string; paint: string; beat: string; blanks: string } = { write: "writeSeconds", paint: "paintSeconds", beat: "beatSeconds", blanks: "blanks" };

/** The id of a control a writer answers. */
export const LINK_PREFIX: string = "link:";

/** The id of the picture asked for a link. */
export const PICTURE_PREFIX: string = "link-";

/** Fewest players: with two, the chain is a conversation. */
const MIN_PLAYERS: number = 3;

/** Most players: one picture each is the most the room draws for one game. */
const MAX_PLAYERS: number = 8;

/** Fewest stock lines a creator must give, so a silent table still gets variety. */
const MIN_STOCK_LINES: number = 4;

/** Longest stock line. */
const STOCK_LINE_LIMIT: number = 80;

/** Words shorter than this don't count when measuring how far a chain drifted. */
const DRIFT_WORD_LETTERS: number = 3;

/**
 * Checks a chain game's decisions.
 * @param decisions the decisions.
 * @returns the problems, in plain words.
 */
export function chainProblems(decisions: ChainDecisions): string[] {
    const problems: string[] = [];
    for (const [name, lines] of [["starters", decisions.starters], ["blanks", decisions.blanks]] as const) {
        if (lines.length < MIN_STOCK_LINES) {
            problems.push(`There must be at least ${MIN_STOCK_LINES} ${name}.`);
        }
        if (lines.some((line: string) => cleanLine(line, STOCK_LINE_LIMIT) !== line || line === "") === true) {
            problems.push(`Every one of the ${name} must be one plain line of letters, up to ${STOCK_LINE_LIMIT} characters.`);
        }
    }
    if (isWholeIn(decisions.writeSeconds, 20, 180) === false) {
        problems.push("Writing time must be a whole number of seconds from 20 to 180.");
    }
    if (isWholeIn(decisions.paintSeconds, 15, 120) === false) {
        problems.push("The wait for a painting must be a whole number of seconds from 15 to 120.");
    }
    if (isWholeIn(decisions.beatSeconds, 3, 15) === false) {
        problems.push("Each reveal beat must last a whole number of seconds from 3 to 15.");
    }
    if (isWholeIn(decisions.lineLimit, 20, 120) === false) {
        problems.push("A line must be a whole number of characters from 20 to 120.");
    }
    return problems;
}

/**
 * Every problem with a chain blueprint, box included.
 * @param box the box.
 * @param decisions the decisions.
 * @returns the problems.
 */
export function chainBlueprintProblems(box: Box, decisions: ChainDecisions): string[] {
    const problems: string[] = [...boxProblems(box, []), ...chainProblems(decisions)];
    if (box.minPlayers < MIN_PLAYERS || box.maxPlayers > MAX_PLAYERS) {
        problems.push(`A chain needs from ${MIN_PLAYERS} to ${MAX_PLAYERS} people: with fewer it is a chat, with more the room can't draw a picture for each.`);
    }
    if (isShortText(box.name) === false) {
        problems.push("The game needs a short name.");
    }
    return problems;
}

/**
 * Builds the manifest, with every host line from the kit.
 * @param box the box.
 * @returns the manifest.
 */
export function chainManifest(box: Box): CartridgeManifest {
    return {
        id: box.id,
        name: box.name,
        minPlayers: box.minPlayers,
        maxPlayers: box.maxPlayers,
        hostBrief: [
            `You're running ${box.name}. One chain of lines and paintings goes round the table.`,
            "A player writes a line, you paint it, the next player sees only the painting and describes it, and so on.",
            "You are never shown the lines until the reveal. Don't guess what anyone wrote and don't describe a painting out loud.",
            "Say very little while they write. At the reveal you'll be told every link of the chain.",
        ].join(" "),
        keywords: box.keywords,
        variants: [],
        phases: [
            {
                id: "write",
                hostBrief: "When you're told the game has begun, explain in two short sentences: the first person writes something to be painted, and everyone after only sees the painting. Then stop and stay quiet.",
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "paint",
                hostBrief: "A painting is being made. Stay quiet unless you're told something went wrong with a painting; then say so in one short line, with no blame.",
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "reveal",
                hostBrief: "The chain is being shown one beat at a time on the screen. Stay quiet. You'll be told when it's over.",
                listening: { "*": "muted" },
                hostMayInterject: false,
                silenceSeconds: 0,
            },
            {
                id: "end",
                hostBrief: [
                    "You'll be told the whole chain and how far it drifted. Comment in three or four short sentences: where it started, the turn that changed it most, where it ended.",
                    "Name the writer behind that turn, kindly. Quote a line only if it's short. Then ask if they want another chain.",
                ].join(" "),
                listening: { "*": "holdToTalk" },
                hostMayInterject: true,
                silenceSeconds: 0,
            },
        ],
    };
}

/**
 * How much of a chain's first line survived in its last, as a share of words from 0 to 1.
 * @param first the opening line.
 * @param last the closing line.
 * @returns the share of the two lines' words that they have in common.
 */
export function driftOverlap(first: string, last: string): number {
    const words = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word: string) => word.length >= DRIFT_WORD_LETTERS));
    const before: Set<string> = words(first);
    const after: Set<string> = words(last);
    const union: Set<string> = new Set([...before, ...after]);
    if (union.size === 0) {
        return 0;
    }
    return [...before].filter((word: string) => after.has(word)).length / union.size;
}

/**
 * Builds a chain game.
 * @param givenBox the box; copied, so later changes can't reach the game.
 * @param givenDecisions the decisions; copied likewise. Check them with chainProblems first.
 * @param random a function returning [0, 1): used once, to set the order and the stock lines.
 * @returns the game.
 */
export function createChainGame(givenBox: Box, givenDecisions: ChainDecisions, random: () => number = Math.random): KitGame<ChainState> {
    const box: Box = frozenCopy(givenBox);
    const decisions: ChainDecisions = frozenCopy(givenDecisions);
    const manifest: CartridgeManifest = chainManifest(box);
    const publicFact = (kind: string, text: string, quiet: boolean = false): ScopedFact => ({ scope: { kind: "public" }, kind, text, ...(quiet === true ? { quiet: true } : {}) });
    const present = (state: ChainState, playerId: string): boolean => state.gone.includes(playerId) === false;
    const writerOf = (state: ChainState): CartridgePlayer | undefined => state.order[state.step];
    const beatsOf = (state: ChainState): number => state.links.length * 2;
    const quoted = (text: string): string => `“${text}”`;

    /**
     * Opens the reveal, or ends the game when nothing was written.
     * @param state the state.
     * @returns the step.
     */
    const toReveal = (state: ChainState): Step<ChainState> => {
        if (state.links.length === 0) {
            const empty: ChainState = { ...state, phase: "end" };
            return { state: empty, facts: because(publicFact("game-over", "Everyone left before anything was written. Say so in one line and wish them a better night."), CHAIN_DECISIONS.write), nextPhaseId: "end" };
        }
        const next: ChainState = { ...state, phase: "reveal", beat: 0 };
        const text: string = "The chain is done. Say in one short line that you'll show how it went, then stay quiet while it plays.";
        return { state: next, facts: [...because(publicFact("reveal", text), CHAIN_DECISIONS.beat), ...beatFacts(next)], nextPhaseId: "reveal", timers: { "beat:0": decisions.beatSeconds } };
    };

    /**
     * What the host learns as a beat appears: quiet, so it knows without speaking.
     * @param state the state, at the beat now showing.
     * @returns the facts.
     */
    const beatFacts = (state: ChainState): ScopedFact[] => {
        const link: ChainLink | undefined = state.links[Math.floor(state.beat / 2)];
        if (link === undefined) {
            return [];
        }
        const shown: string = state.beat % 2 === 0 ? `${link.writerName} wrote ${quoted(link.text)}.` : link.src === null ? "That line was never painted." : "That line was painted.";
        return because(publicFact("beat", shown, true), CHAIN_DECISIONS.beat);
    };

    /**
     * Begins the next writer's turn, covering a writer who has already left.
     * @param state the state, with step set to the next writer.
     * @returns the step.
     */
    const beginWrite = (state: ChainState): Step<ChainState> => {
        const writer: CartridgePlayer | undefined = writerOf(state);
        if (writer === undefined) {
            return toReveal(state);
        }
        if (present(state, writer.playerId) === false) {
            return addLink({ ...state, phase: "write" }, state.stock[state.step] ?? "", true);
        }
        const fresh: ChainState = { ...state, phase: "write" };
        const text: string = state.step === 0
            ? `${writer.name} writes the first line. Say, in a few words, that ${writer.name} is first, then stay quiet.`
            : `${writer.name} is describing the last painting. Stay quiet.`;
        return { state: fresh, facts: because(publicFact("writing", text, state.step !== 0), CHAIN_DECISIONS.write), nextPhaseId: "write", timers: { [`write:${state.step}`]: decisions.writeSeconds } };
    };

    /**
     * Records a link and asks the room to paint it.
     * @param state the state, in the write phase at the writer's step.
     * @param text the line.
     * @param stock whether it is a stock line.
     * @returns the step.
     */
    const addLink = (state: ChainState, text: string, stock: boolean): Step<ChainState> => {
        const writer: CartridgePlayer | undefined = writerOf(state);
        if (writer === undefined) {
            return { state, facts: [] };
        }
        const link: ChainLink = { writerId: writer.playerId, writerName: writer.name, text, stock, src: null, gaveUp: false };
        const next: ChainState = { ...state, phase: "paint", links: [...state.links, link] };
        return {
            state: next,
            facts: because(publicFact("painting", "A painting is being made.", true), CHAIN_DECISIONS.paint),
            nextPhaseId: "paint",
            timers: { [`paint:${state.step}`]: decisions.paintSeconds },
            draws: [{ id: `${PICTURE_PREFIX}${state.step}`, prompt: paintPrompt(text) }],
        };
    };

    /**
     * Moves on once the painting is in or given up on.
     * @param state the state in the paint phase.
     * @returns the step.
     */
    const nextWriter = (state: ChainState): Step<ChainState> => beginWrite({ ...state, step: state.step + 1 });

    /**
     * Closes the game with the chain and how far it drifted.
     * @param state the state in the reveal.
     * @returns the step.
     */
    const finish = (state: ChainState): Step<ChainState> => {
        const first: ChainLink | undefined = state.links[0];
        const last: ChainLink | undefined = state.links[state.links.length - 1];
        const overlap: number = first === undefined || last === undefined ? 0 : driftOverlap(first.text, last.text);
        const drift: string = overlap === 0 ? "It drifted all the way: nothing of the first line survived." : overlap >= 0.5 ? "It held together remarkably well." : "It drifted, but something of the first line survived.";
        const chain: string = state.links.map((link: ChainLink, index: number) => `${index + 1}. ${link.writerName} ${index === 0 ? "wrote" : "described"} ${quoted(link.text)}${link.src === null ? " (never painted)" : ""}`).join(" ");
        const text: string = `Here is the whole chain. ${chain} ${drift}`;
        return { state: { ...state, phase: "end" }, facts: because(publicFact("game-over", text), CHAIN_DECISIONS.beat), nextPhaseId: "end" };
    };

    /**
     * Someone left.
     * @param state the state.
     * @param playerId who.
     * @returns the step.
     */
    const left = (state: ChainState, playerId: string): Step<ChainState> => {
        if (state.phase === "end" || state.order.some((player: CartridgePlayer) => player.playerId === playerId) === false || present(state, playerId) === false) {
            return { state, facts: [] };
        }
        const next: ChainState = { ...state, gone: [...state.gone, playerId] };
        const stillHere: number = next.order.filter((player: CartridgePlayer) => present(next, player.playerId)).length;
        if ((state.phase === "write" || state.phase === "paint") && stillHere < 2) {
            // One person can't pass anything on, so show what the chain has. A line still in the writer's hands is dropped.
            return toReveal({ ...next, phase: "paint" });
        }
        if (state.phase === "write" && writerOf(next)?.playerId === playerId) {
            return addLink(next, state.stock[state.step] ?? "", true);
        }
        return { state: next, facts: [] };
    };

    const cartridge: Cartridge<ChainState> = {
        manifest,

        init(players: CartridgePlayer[]): Step<ChainState> {
            const order: CartridgePlayer[] = shuffle(players, random);
            const stock: string[] = order.map((_player: CartridgePlayer, index: number) => pick(index === 0 ? decisions.starters : decisions.blanks, random));
            const state: ChainState = { phase: "write", order, gone: [], step: 0, links: [], stock, beat: 0 };
            return beginWrite(state);
        },

        phaseOf(state: ChainState): string {
            return state.phase;
        },

        turn(state: ChainState): Turn | null {
            const writer: CartridgePlayer | undefined = writerOf(state);
            if (state.phase === "write" && writer !== undefined) {
                return { kind: "one", playerId: writer.playerId, label: state.step === 0 ? "Writing the first line" : "Describing the painting" };
            }
            return null;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(): LegalAction[] {
            return [];
        },

        apply(state: ChainState): Step<ChainState> {
            return { state, facts: [] };
        },

        onEvent(state: ChainState, event: RoomEvent): Step<ChainState> {
            if (event.type === "playerLeft") {
                return left(state, event.playerId);
            }
            if (event.type === "answered" && state.phase === "write") {
                const writer: CartridgePlayer | undefined = writerOf(state);
                if (writer === undefined || event.playerId !== writer.playerId || event.controlId !== `${LINK_PREFIX}${state.step}` || typeof event.value !== "string") {
                    return { state, facts: [] };
                }
                const text: string = cleanLine(event.value, decisions.lineLimit);
                return text === "" ? addLink(state, state.stock[state.step] ?? "", true) : addLink(state, text, false);
            }
            if (event.type === "timerFired" && event.timerId === `write:${state.step}` && state.phase === "write") {
                return addLink(state, state.stock[state.step] ?? "", true);
            }
            if (event.type === "drawingReady" && event.id.startsWith(PICTURE_PREFIX) === true && isDrawingAddress(event.src) === true) {
                const index: number = Number(event.id.slice(PICTURE_PREFIX.length));
                const link: ChainLink | undefined = state.links[index];
                if (link === undefined || link.src !== null) {
                    return { state, facts: [] };
                }
                const links: ChainLink[] = state.links.map((candidate: ChainLink, at: number) => (at === index ? { ...candidate, src: event.src } : candidate));
                const next: ChainState = { ...state, links };
                if (state.phase === "paint" && index === state.step) {
                    return nextWriter(next);
                }
                return { state: next, facts: [] };
            }
            if (event.type === "timerFired" && event.timerId === `paint:${state.step}` && state.phase === "paint") {
                const links: ChainLink[] = state.links.map((candidate: ChainLink, at: number) => (at === state.step ? { ...candidate, gaveUp: true } : candidate));
                const given: Step<ChainState> = nextWriter({ ...state, links });
                const note: ScopedFact[] = because(publicFact("paint-failed", "A painting didn't come in time, so the next player gets the words instead. Say so in one short line, with no blame."), CHAIN_DECISIONS.paint);
                return { ...given, facts: [...note, ...given.facts] };
            }
            if (event.type === "timerFired" && event.timerId === `beat:${state.beat}` && state.phase === "reveal") {
                const moved: ChainState = { ...state, beat: state.beat + 1 };
                if (moved.beat >= beatsOf(moved)) {
                    return finish(state);
                }
                return { state: moved, facts: beatFacts(moved), timers: { [`beat:${moved.beat}`]: decisions.beatSeconds } };
            }
            return { state, facts: [] };
        },

        publicScene(state: ChainState): Scene {
            const writer: CartridgePlayer | undefined = writerOf(state);
            const progress: SceneBlock = { type: "progress", label: "Links", current: Math.min(state.step + (state.phase === "write" ? 0 : 1), state.order.length), max: state.order.length, marks: "card" };
            if (state.phase === "write" && writer !== undefined) {
                const timer: SceneBlock = { type: "timer", seconds: decisions.writeSeconds, label: `for ${writer.name}`, running: true };
                if (state.step === 0) {
                    return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: box.name, kicker: "A chain of paintings" }, { type: "text", text: `${writer.name} writes something for the host to paint.`, emphasis: "large" }, progress, timer] };
                }
                const previous: ChainLink | undefined = state.links[state.step - 1];
                const seen: SceneBlock[] = previous === undefined
                    ? []
                    : previous.src !== null
                        ? [{ type: "image", src: previous.src, caption: `${writer.name} describes this` }]
                        : [{ type: "text", text: `The painting didn't come. This is what it was meant to show: ${quoted(previous.text)}`, emphasis: "large" }, { type: "text", text: `${writer.name} puts it in their own words.` }];
                return { mood: "neutral", transition: "fade", blocks: [...seen, progress, timer] };
            }
            if (state.phase === "paint") {
                const wrote: ChainLink | undefined = state.links[state.step];
                return {
                    mood: "dawn",
                    transition: "fade",
                    blocks: [
                        { type: "title", text: "Painting", ...(wrote === undefined ? {} : { kicker: `${wrote.writerName}'s line is in` }) },
                        { type: "text", text: "The host is mixing the colours. This takes a moment.", emphasis: "whisper" },
                        progress,
                        { type: "timer", seconds: decisions.paintSeconds, label: "before the host stops waiting", running: true },
                    ],
                };
            }
            if (state.phase === "reveal") {
                return revealScene(state);
            }
            return endScene(state);
        },

        privateControls(state: ChainState, playerId: string): Control[] {
            const writer: CartridgePlayer | undefined = writerOf(state);
            if (state.phase === "write" && writer?.playerId === playerId) {
                return [{
                    type: "textInput",
                    id: `${LINK_PREFIX}${state.step}`,
                    prompt: state.step === 0 ? "Write something for the host to paint." : "Describe the painting on the screen.",
                    placeholder: state.step === 0 ? "A line about anything at all" : "What you see, in one line",
                    maxLength: decisions.lineLimit,
                    note: state.step === 0 ? "One line. The host paints it, and the next person only sees the painting." : "Say what you see. Don't guess what it was meant to be.",
                }];
            }
            if (state.phase === "write" && writer !== undefined) {
                return [{ type: "waiting", text: `${writer.name} is writing. Watch the screen.` }];
            }
            if (state.phase === "paint") {
                return [{ type: "waiting", text: "The host is painting. Watch the screen." }];
            }
            return [{ type: "waiting", text: state.phase === "end" ? "That was the chain." : "Watch the screen." }];
        },

        hostFacts(state: ChainState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.phase === "end") {
                return [];
            }
            return [publicFact("links", `${state.links.length} of ${state.order.length} links are done.`, true)];
        },

        outcome(state: ChainState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            const first: ChainLink | undefined = state.links[0];
            const last: ChainLink | undefined = state.links[state.links.length - 1];
            return first === undefined || last === undefined ? "Nothing was written." : `It started as ${quoted(first.text)} and ended as ${quoted(last.text)}.`;
        },
    };

    /**
     * The TV during the reveal: one beat, either a line or its painting.
     * @param state the state.
     * @returns the scene.
     */
    function revealScene(state: ChainState): Scene {
        const index: number = Math.floor(state.beat / 2);
        const link: ChainLink | undefined = state.links[index];
        const kicker: string = `Link ${index + 1} of ${state.links.length}`;
        if (link === undefined) {
            return { mood: "victory", transition: "fade", blocks: [{ type: "title", text: box.name }] };
        }
        if (state.beat % 2 === 0) {
            const verb: string = index === 0 ? "wrote" : "described";
            return { mood: "victory", transition: "fade", blocks: [{ type: "title", text: `${link.writerName} ${verb}`, kicker }, { type: "text", text: quoted(link.text), emphasis: "large" }] };
        }
        if (link.src === null) {
            return { mood: "victory", transition: "fade", blocks: [{ type: "title", text: "No painting here", kicker }, { type: "text", text: "The host ran out of paint for this one.", emphasis: "whisper" }] };
        }
        return { mood: "victory", transition: "fade", blocks: [{ type: "title", text: "The host painted", kicker }, { type: "image", src: link.src, caption: quoted(link.text) }] };
    }

    /**
     * The TV at the end: where the chain began and where it landed.
     * @param state the state.
     * @returns the scene.
     */
    function endScene(state: ChainState): Scene {
        const first: ChainLink | undefined = state.links[0];
        const last: ChainLink | undefined = state.links[state.links.length - 1];
        if (first === undefined || last === undefined) {
            return { mood: "defeat", transition: "fade", blocks: [{ type: "title", text: box.name }, { type: "text", text: "Nobody was left to write.", emphasis: "large" }] };
        }
        const blocks: SceneBlock[] = [
            { type: "title", text: "It started as", kicker: first.writerName },
            { type: "text", text: quoted(first.text), emphasis: "large" },
            { type: "title", text: "It ended as", kicker: last.writerName },
            { type: "text", text: quoted(last.text), emphasis: "large" },
        ];
        return { mood: "victory", transition: "fade", blocks };
    }

    return {
        cartridge,
        hidden(state: ChainState): HiddenValue[] {
            if (state.phase === "end") {
                return [];
            }
            const shownIndex: number = Math.floor(state.beat / 2);
            const asWords: number | null = state.phase === "write" && state.step > 0 && state.links[state.step - 1]?.src === null ? state.step - 1 : null;
            const isShown = (index: number): boolean => (state.phase === "reveal" && index <= shownIndex) || index === asWords;
            const shownLines: string[] = state.links.filter((_link: ChainLink, index: number) => isShown(index)).map((link: ChainLink) => squash(link.text));
            return state.links.flatMap((link: ChainLink, index: number): HiddenValue[] => {
                // Two players can write the same words; once those words are on show they are no secret in another link.
                if (isShown(index) === true || shownLines.some((line: string) => line.includes(squash(link.text)) === true) === true) {
                    return [];
                }
                return [{ label: `link ${index + 1}`, text: link.text, seenBy: [] }];
            });
        },
    };
}
