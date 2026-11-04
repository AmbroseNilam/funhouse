// Runs one cartridge inside a room: holds its state, applies every step, starts its timers,
// sends each fact only where its scope allows, and fetches content the rules ask for. The
// rules stay the referee. The host hears facts and may only make rulings the phase allows.

import type { Turn } from "../shared/turn.ts";
import type { ContentGrounding, Cartridge, CartridgeManifest, CartridgePlayer, PhaseSpec, Step } from "../shared/cartridge.ts";
import type { Control, ListeningMode } from "../shared/controls.ts";
import type { Scene } from "../shared/scene.ts";
import type { RoomEvent } from "../shared/timeline.ts";
import type { ScopedFact } from "../shared/visibility.ts";

/** Whispers a phone keeps showing, newest last. */
const WHISPER_LIMIT: number = 3;

/** What a game can ask of the room it runs in. */
export interface GameStage {
    /** Something the host should react to out loud. */
    tellHost(line: string): void;
    /** The screen or phones have something new to show. */
    changed(): void;
    /** Asks the host's model for content the rules need; the result arrives as contentReady. */
    requestContent(prompt: string, grounding?: ContentGrounding): void;
    /** Asks which answers say the same thing; the result arrives as answersMerged. */
    requestMerge(id: string, question: string, answers: string[]): void;
    /** Draws a picture; the result arrives as drawingReady. */
    requestDrawing(id: string, prompt: string): void;
    /** Records something that happened on the room's timeline. */
    record(event: RoomEvent): void;
}

/** A running game of any kind. The room only ever talks to this. */
export interface RunningGame {
    readonly manifest: CartridgeManifest;
    start(players: CartridgePlayer[]): void;
    /** A player pressed a button or sent text. */
    input(playerId: string, value: string): void;
    /** Something happened in the room that the rules may care about. */
    event(event: RoomEvent): void;
    /** Who is out of the game but still at the table. */
    outIds(): string[];
    /** Whose turn it is, if the game says. */
    turn(): Turn | null;
    /** True when the current phase allows this ruling from the host. */
    allowsRuling(ruling: string): boolean;
    /** True when the host may speak up unprompted right now. */
    hostMayInterject(): boolean;
    /** True when players are mostly talking to each other, not the host. */
    hostMostlyQuiet(): boolean;
    /** True when this player could take this action right now. */
    hasAction(playerId: string, actionId: string): boolean;
    /** What the host needs to know right now, safe for it to act on. */
    brief(): string;
    scene(): Scene;
    controls(playerId: string): Control[];
    listening(playerId: string): ListeningMode;
    /** Winner description once the game is over, else null. */
    outcome(): string | null;
    /** Stops every timer; the game is over. */
    stop(): void;
    /** Holds every timer where it is. */
    pause(): void;
    /** Starts held timers again. */
    resume(): void;
}

/** One cartridge running in one room. */
export class GameSession<State> implements RunningGame {
    public readonly manifest: CartridgeManifest;
    private readonly cartridge: Cartridge<State>;
    private readonly stage: GameStage;
    private readonly timers: Map<string, NodeJS.Timeout> = new Map();
    private readonly timerEnds: Map<string, number> = new Map();
    private readonly heldTimers: Map<string, number> = new Map();
    private paused: boolean = false;
    private readonly whispers: Map<string, string[]> = new Map();
    private players: CartridgePlayer[] = [];
    private state: State | null = null;
    private stopped: boolean = false;

    /**
     * Readies a game; nothing happens until start.
     * @param cartridge the game.
     * @param stage the room it runs in.
     */
    public constructor(cartridge: Cartridge<State>, stage: GameStage) {
        this.cartridge = cartridge;
        this.manifest = cartridge.manifest;
        this.stage = stage;
    }

    /**
     * Starts the game with the manifest's default variants.
     * @param players everyone seated right now.
     */
    public start(players: CartridgePlayer[]): void {
        this.players = players;
        const variants: Record<string, boolean> = Object.fromEntries(this.manifest.variants.map((variant) => [variant.id, variant.defaultOn]));
        this.apply(this.cartridge.init(players, variants));
    }

    /**
     * Passes a player's button press or text to the rules.
     * @param playerId who.
     * @param value the option id or typed text.
     */
    public input(playerId: string, value: string): void {
        if (this.state === null) {
            return;
        }
        this.apply(this.cartridge.apply(this.state, playerId, value));
    }

    /**
     * Passes a room event to the rules.
     * @param event the event.
     */
    public event(event: RoomEvent): void {
        if (this.state === null || this.stopped === true) {
            return;
        }
        this.apply(this.cartridge.onEvent(this.state, event));
    }

    /**
     * Who is out of the game but still at the table.
     * @returns their ids.
     */
    public outIds(): string[] {
        return this.state === null ? [] : this.cartridge.outOf?.(this.state) ?? [];
    }

    /**
     * Whose turn it is, once the game has begun and if it says.
     * @returns the turn, or null.
     */
    public turn(): Turn | null {
        return this.state === null ? null : this.cartridge.turn?.(this.state) ?? null;
    }

    /**
     * Checks a ruling against the current phase's list.
     * @param ruling the ruling's name.
     * @returns whether the host may make it now.
     */
    public allowsRuling(ruling: string): boolean {
        return this.phase()?.hostRulings?.[ruling] !== undefined;
    }

    /**
     * Whether a player could take an action right now.
     * @param playerId who.
     * @param actionId the action.
     * @returns true when the rules offer it.
     */
    public hasAction(playerId: string, actionId: string): boolean {
        return this.state !== null && this.cartridge.legalActions(this.state, playerId).some((action) => action.actionId === actionId);
    }

    /**
     * Whether players are mostly talking to each other in this phase.
     * @returns true when the host only reacts to its name.
     */
    public hostMostlyQuiet(): boolean {
        return this.phase()?.hostMostlyQuiet === true;
    }

    /**
     * Whether the host may speak up unprompted: the phase allows it and the game is still going.
     * @returns true when it may.
     */
    public hostMayInterject(): boolean {
        return this.phase()?.hostMayInterject === true && this.outcome() === null;
    }

    /**
     * Builds the host's standing brief: the game, the phase, the rulings it may make, and only
     * the facts the rules release to it.
     * @returns the brief.
     */
    public brief(): string {
        if (this.state === null) {
            return "";
        }
        const phase: PhaseSpec | undefined = this.phase();
        const rulings: [string, string][] = Object.entries(phase?.hostRulings ?? {});
        const facts: ScopedFact[] = this.cartridge.hostFacts(this.state, { kind: "host" });
        return [
            `Right now you are running ${this.manifest.name}. ${this.manifest.hostBrief}`,
            phase === undefined ? "" : `This moment: ${phase.hostBrief}`,
            facts.length === 0 ? "" : `What you know:\n${facts.map((fact: ScopedFact) => `- ${fact.text}`).join("\n")}`,
            rulings.length === 0 ? "" : `Rulings you may make now, written first in your reply exactly like [[name]]:\n${rulings.map(([name, when]: [string, string]) => `- [[${name}]] ${when}`).join("\n")}`,
        ].filter((part: string) => part !== "").join("\n\n");
    }

    /**
     * What the public screen shows.
     * @returns the scene.
     */
    public scene(): Scene {
        if (this.state === null) {
            return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: this.manifest.name }] };
        }
        const scene: Scene = this.cartridge.publicScene(this.state);
        const phaseId: string = this.cartridge.phaseOf(this.state);
        const held: number | undefined = this.heldTimers.get(phaseId);
        const endsAt: number | undefined = this.timerEnds.get(phaseId);
        // A countdown shows the time really left, so a TV that opens or reloads part way through agrees with the rules.
        for (const block of scene.blocks) {
            if (block.type === "timer" && held !== undefined) {
                block.seconds = Math.ceil(held);
            }
            if (block.type === "timer" && held === undefined && endsAt !== undefined) {
                block.seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
            }
        }
        return scene;
    }

    /**
     * What one phone shows: its controls, then anything whispered to it.
     * @param playerId the player.
     * @returns the controls.
     */
    public controls(playerId: string): Control[] {
        if (this.state === null) {
            return [{ type: "waiting", text: "Getting the game ready." }];
        }
        const whispers: string[] = this.cartridge.outcome(this.state) === null ? this.whispers.get(playerId) ?? [] : [];
        const whispered: Control[] = whispers.map((text: string) => ({ type: "notice", text, tone: "secret" }));
        return [...this.cartridge.privateControls(this.state, playerId), ...whispered];
    }

    /**
     * How one phone's microphone behaves in this phase.
     * @param playerId the player.
     * @returns the mode; players can talk unless the phase says otherwise.
     */
    public listening(playerId: string): ListeningMode {
        if (this.state === null) {
            return "holdToTalk";
        }
        const listening: Record<string, ListeningMode> = this.phase()?.listening ?? {};
        return listening[this.cartridge.roleOf(this.state, playerId)] ?? listening["*"] ?? "holdToTalk";
    }

    /**
     * The game's result.
     * @returns the winner description, or null while it is still going.
     */
    public outcome(): string | null {
        return this.state === null ? null : this.cartridge.outcome(this.state);
    }

    /** Stops every timer and ignores anything still on its way. */
    public stop(): void {
        this.stopped = true;
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }

    /** Holds every timer with the time it has left. */
    public pause(): void {
        this.paused = true;
        for (const [timerId, timer] of this.timers) {
            clearTimeout(timer);
            this.heldTimers.set(timerId, Math.max(0, (this.timerEnds.get(timerId) ?? Date.now()) - Date.now()) / 1000);
        }
        this.timers.clear();
    }

    /** Starts held timers again with the time they had left. */
    public resume(): void {
        this.paused = false;
        for (const [timerId, seconds] of this.heldTimers) {
            this.startTimer(timerId, seconds);
        }
        this.heldTimers.clear();
    }

    /**
     * The current phase's spec.
     * @returns the spec, or undefined before the game starts.
     */
    private phase(): PhaseSpec | undefined {
        if (this.state === null) {
            return undefined;
        }
        const phaseId: string = this.cartridge.phaseOf(this.state);
        return this.manifest.phases.find((candidate: PhaseSpec) => candidate.id === phaseId);
    }

    /**
     * Takes one step from the rules: new state, facts, phase, timers, content.
     * @param step the step.
     */
    private apply(step: Step<State>): void {
        if (this.stopped === true) {
            return;
        }
        const previous: State | null = this.state;
        this.state = step.state;
        for (const fact of step.facts) {
            this.deliver(fact);
        }
        if (step.nextPhaseId !== undefined) {
            this.stage.record({ type: "phaseChanged", at: Date.now(), phaseId: step.nextPhaseId });
        }
        for (const [timerId, seconds] of Object.entries(step.timers ?? {})) {
            this.startTimer(timerId, seconds);
        }
        if (step.contentRequest !== undefined) {
            this.stage.requestContent(step.contentRequest, step.contentGrounding);
        }
        if (step.mergeRequest !== undefined) {
            this.stage.requestMerge(step.mergeRequest.id, step.mergeRequest.question, step.mergeRequest.answers);
        }
        for (const draw of step.draws ?? []) {
            this.stage.requestDrawing(draw.id, draw.prompt);
        }
        if (previous !== step.state) {
            this.stage.changed();
        }
    }

    /**
     * Sends one fact only where its scope allows. Public and host facts reach the host, unless
     * marked quiet. Player and group facts go to those phones and never to the host, so it
     * can't repeat them.
     * @param fact the fact.
     */
    private deliver(fact: ScopedFact): void {
        this.stage.record({ type: "fact", at: Date.now(), fact });
        if (fact.scope.kind === "public" || fact.scope.kind === "host") {
            if (fact.quiet !== true) {
                this.stage.tellHost(`(Game: ${fact.text})`);
            }
            return;
        }
        if (fact.scope.kind === "player") {
            this.whisper(fact.scope.playerId, fact.text);
            return;
        }
        if (fact.scope.kind !== "group" || this.state === null) {
            return;
        }
        for (const player of this.players) {
            if (this.cartridge.groupsOf(this.state, player.playerId).has(fact.scope.groupId) === true) {
                this.whisper(player.playerId, fact.text);
            }
        }
    }

    /**
     * Adds a line to one phone's whispers, keeping only the newest few.
     * @param playerId the player.
     * @param text the line.
     */
    private whisper(playerId: string, text: string): void {
        const lines: string[] = [...(this.whispers.get(playerId) ?? []), text];
        this.whispers.set(playerId, lines.slice(-WHISPER_LIMIT));
    }

    /**
     * Starts or restarts a timer that reports back to the rules.
     * @param timerId the timer's name.
     * @param seconds how long.
     */
    private startTimer(timerId: string, seconds: number): void {
        // Someone leaving can move a game on during a pause; its new countdown waits with the rest.
        if (this.paused === true) {
            this.heldTimers.set(timerId, seconds);
            return;
        }
        const running: NodeJS.Timeout | undefined = this.timers.get(timerId);
        if (running !== undefined) {
            clearTimeout(running);
        }
        this.timerEnds.set(timerId, Date.now() + seconds * 1000);
        this.timers.set(timerId, setTimeout(() => {
            this.timers.delete(timerId);
            const event: RoomEvent = { type: "timerFired", at: Date.now(), timerId };
            this.stage.record(event);
            this.event(event);
        }, seconds * 1000));
    }
}
