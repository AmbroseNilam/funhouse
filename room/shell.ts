// The console state for one room: where the highlight is, who is driving, and what each screen
// offers. It decides nothing about any game. Starting and leaving go back to the room through
// its stage, so the same paths work from a phone or from the host.

import type { NavAction, NavAxis, PadView, Seat, ShelfGame, ShellScreen, ShellView } from "../shared/shell.ts";

/** How long a driver may sit idle before anyone else's swipe takes over. */
const DRIVER_IDLE_MILLISECONDS: number = 10000;

/** The pause menu's fixed rows. */
const KEEP_PLAYING: string = "Keep playing";
const HOW_TO_PLAY: string = "How to play";
const LEAVE_GAME: string = "Leave this game";

/** Rows once a game has been decided. */
const GAME_OVER_MENU: string[] = ["Play again", "Back to the shelf"];

/** What the shell needs from its room. */
export interface ShellStage {
    games(): ShelfGame[];
    seats(): Omit<Seat, "driving">[];
    startGame(gameId: string): void;
    endGame(): void;
    /** True when the running game has a result. */
    gameOver(): boolean;
    /** The highlight landed on a game, or left the shelf, for the host to maybe remark on. */
    focusChanged(gameId: string | null): void;
    /** A person's request couldn't be done; the host says why. */
    refused(reason: string): void;
    /** The driver changed because the last one left. */
    driverChanged(name: string): void;
    /** The game was paused or resumed. */
    paused(paused: boolean): void;
    /** Someone chose an action from the pause menu that the game offers. */
    gameAction(playerId: string, actionId: string): void;
    /** The highlight hit the end of what it can move through. */
    edge(): void;
    /** Anything on the shell changed. */
    changed(): void;
}

/** One room's console. */
export class Shell {
    private readonly stage: ShellStage;
    private screen: ShellScreen = "home";
    private focus: number = 0;
    private shelfFocus: number = 0;
    private gameId: string | null = null;
    private driverId: string | null = null;
    private lastDriveAt: number = 0;
    private freeTimer: NodeJS.Timeout | null = null;

    /**
     * Creates a console on the shelf.
     * @param stage the room.
     */
    public constructor(stage: ShellStage) {
        this.stage = stage;
    }

    /**
     * Applies what a phone's thumb did. Only whoever is driving gets a say.
     * @param playerId who.
     * @param action what.
     */
    public act(playerId: string, action: NavAction): void {
        if (this.claimDrive(playerId) === false) {
            return;
        }
        if (action.kind === "back") {
            this.back();
            return;
        }
        if (action.kind === "step") {
            this.step(action.delta);
            return;
        }
        this.select(playerId);
    }

    /**
     * A game started, however it was asked for.
     * @param gameId the game.
     */
    public gameStarted(gameId: string): void {
        this.gameId = gameId;
        this.screen = "play";
        this.focus = 0;
        this.stage.focusChanged(null);
        this.stage.changed();
    }

    /** The game ended; back to its place on the shelf. */
    public gameEnded(): void {
        if (this.screen === "pause" || this.screen === "howTo") {
            this.stage.paused(false);
        }
        this.screen = "home";
        this.focus = this.shelfFocus;
        this.stage.changed();
    }

    /** The running game was decided, so its result takes over the screen. */
    public gameDecided(): void {
        if (this.screen === "pause" || this.screen === "howTo") {
            this.stage.paused(false);
        }
        this.screen = "play";
        this.focus = 0;
        this.stage.changed();
    }

    /** People came or went; makes sure someone can drive. */
    public seatsChanged(): void {
        const seats: Omit<Seat, "driving">[] = this.stage.seats();
        if (seats.some((seat) => seat.playerId === this.driverId) === true) {
            return;
        }
        const hadDriver: boolean = this.driverId !== null;
        const next: Omit<Seat, "driving"> | undefined = seats.find((seat) => seat.connected === true) ?? seats[0];
        this.driverId = next?.playerId ?? null;
        if (hadDriver === true && next !== undefined) {
            this.stage.driverChanged(next.name);
        }
    }

    /**
     * Whether this person has the controller.
     * @param playerId who.
     * @returns true for the driver.
     */
    public isDriving(playerId: string): boolean {
        return this.driverId === playerId;
    }

    /**
     * The whole console, for the TV.
     * @returns the view.
     */
    public view(): ShellView {
        const seats: Seat[] = this.stage.seats().map((seat) => ({ ...seat, driving: seat.playerId === this.driverId }));
        return { screen: this.screen, axis: this.axis(), focus: this.focus, games: this.stage.games(), gameId: this.gameId, menu: this.menu(), seats, gameOver: this.isDecided() };
    }

    /**
     * What one phone's surface can do.
     * @param playerId the player.
     * @param colour their seat colour.
     * @returns the view.
     */
    public pad(playerId: string, colour: string): PadView {
        const driver: Omit<Seat, "driving"> | undefined = this.stage.seats().find((seat) => seat.playerId === this.driverId);
        const count: number = this.itemCount();
        const canDrive: boolean = this.mayDrive(playerId);
        return {
            colour,
            axis: this.axis(),
            canPrevious: this.focus > 0,
            canNext: this.focus < count - 1,
            driving: playerId === this.driverId,
            driverName: driver?.name ?? "",
            controllerFree: driver?.connected !== true,
            watching: false,
            canDrive,
            backLabel: canDrive === true ? this.backLabel() : null,
            canSelect: count > 0 && canDrive === true,
        };
    }

    /**
     * Whether someone else is actively driving, so this person has to wait.
     * @param playerId who's asking.
     * @returns true when the controller is theirs or free.
     */
    private mayDrive(playerId: string): boolean {
        const driverPresent: boolean = this.stage.seats().some((seat) => seat.playerId === this.driverId && seat.connected === true);
        return this.driverId === playerId || driverPresent === false || Date.now() - this.lastDriveAt >= DRIVER_IDLE_MILLISECONDS;
    }

    /**
     * Gives this person the controller if they may have it, and tells every phone when it
     * changes hands or comes free.
     * @param playerId who.
     * @returns false while someone else is actively driving.
     */
    private claimDrive(playerId: string): boolean {
        if (this.mayDrive(playerId) === false) {
            return false;
        }
        const changedHands: boolean = this.driverId !== playerId;
        this.driverId = playerId;
        this.lastDriveAt = Date.now();
        if (this.freeTimer !== null) {
            clearTimeout(this.freeTimer);
        }
        this.freeTimer = setTimeout(() => { this.stage.changed(); }, DRIVER_IDLE_MILLISECONDS);
        this.freeTimer.unref();
        if (changedHands === true) {
            this.stage.changed();
        }
        return true;
    }

    /**
     * Rows on the current screen.
     * @returns the labels.
     */
    private menu(): string[] {
        if (this.screen === "game") {
            return [this.currentGame()?.blocked === null ? "Play" : "Can't start yet", "Back to the shelf"];
        }
        if (this.screen === "players") {
            return ["Back to the shelf"];
        }
        if (this.screen === "pause") {
            return [KEEP_PLAYING, HOW_TO_PLAY, ...(this.currentGame()?.pauseActions ?? []).map((action) => action.label), LEAVE_GAME];
        }
        if (this.screen === "howTo") {
            return ["Back"];
        }
        return this.isDecided() === true ? GAME_OVER_MENU : [];
    }

    /**
     * Which way swipes move on this screen.
     * @returns the axis, or null when there's nothing to move through.
     */
    private axis(): NavAxis {
        if (this.screen === "home") {
            return "x";
        }
        return this.itemCount() > 1 ? "y" : null;
    }

    /**
     * How many items can take the highlight here. The shelf ends with the players box.
     * @returns the count.
     */
    private itemCount(): number {
        return this.screen === "home" ? this.stage.games().length + 1 : this.menu().length;
    }

    /**
     * What the back corner says here.
     * @returns the label, or null.
     */
    private backLabel(): string | null {
        if (this.screen === "game" || this.screen === "players" || this.screen === "howTo") {
            return "Back";
        }
        if (this.screen === "pause") {
            return "Resume";
        }
        return this.screen === "play" && this.isDecided() === false ? "Pause" : null;
    }

    /**
     * Moves the highlight, stopping at the ends.
     * @param delta how far.
     */
    private step(delta: number): void {
        const next: number = Math.max(0, Math.min(this.itemCount() - 1, this.focus + delta));
        if (next === this.focus) {
            this.stage.edge();
            return;
        }
        this.focus = next;
        if (this.screen === "home") {
            this.shelfFocus = next;
            this.stage.focusChanged(this.stage.games()[next]?.id ?? null);
        }
        this.stage.changed();
    }

    /**
     * Does what the highlighted item says.
     * @param playerId who chose it.
     */
    private select(playerId: string): void {
        if (this.screen === "home") {
            this.selectOnShelf();
            return;
        }
        if (this.screen === "game") {
            this.selectOnGamePage();
            return;
        }
        if (this.screen === "players" || this.screen === "howTo") {
            this.back();
            return;
        }
        if (this.screen === "pause") {
            this.selectOnPause(playerId);
            return;
        }
        if (this.isDecided() === true) {
            this.selectAfterGame();
        }
    }

    /** Opens the highlighted box. */
    private selectOnShelf(): void {
        const game: ShelfGame | undefined = this.stage.games()[this.focus];
        this.stage.focusChanged(null);
        this.gameId = game?.id ?? this.gameId;
        this.screen = game === undefined ? "players" : "game";
        this.focus = 0;
        this.stage.changed();
    }

    /** Play, or back, on a game's page. */
    private selectOnGamePage(): void {
        if (this.focus === 1) {
            this.back();
            return;
        }
        const game: ShelfGame | undefined = this.currentGame();
        if (game === undefined) {
            return;
        }
        if (game.blocked !== null) {
            this.stage.refused(game.blocked);
            return;
        }
        this.stage.startGame(game.id);
    }

    /**
     * Does what the highlighted pause row says.
     * @param playerId who chose it.
     */
    private selectOnPause(playerId: string): void {
        const row: string | undefined = this.menu()[this.focus];
        if (row === KEEP_PLAYING) {
            this.back();
            return;
        }
        if (row === HOW_TO_PLAY) {
            this.screen = "howTo";
            this.focus = 0;
            this.stage.changed();
            return;
        }
        if (row === LEAVE_GAME) {
            this.stage.endGame();
            return;
        }
        const action: { id: string; label: string } | undefined = this.currentGame()?.pauseActions.find((candidate) => candidate.label === row);
        if (action !== undefined) {
            this.screen = "play";
            this.focus = 0;
            this.stage.paused(false);
            this.stage.gameAction(playerId, action.id);
            this.stage.changed();
        }
    }

    /** Play again, or back to the shelf, once a game is decided. */
    private selectAfterGame(): void {
        const again: boolean = this.focus === 0;
        const gameId: string | null = this.gameId;
        this.stage.endGame();
        if (again === true && gameId !== null) {
            this.stage.startGame(gameId);
        }
    }

    /** Goes to the parent screen; in a game, pauses. */
    private back(): void {
        const parent: ShellScreen | null = this.parentScreen();
        if (parent === null) {
            return;
        }
        const leaving: ShellScreen = this.screen;
        this.screen = parent;
        this.focus = parent === "home" ? this.shelfFocus : leaving === "howTo" ? 1 : 0;
        if (leaving === "play") {
            this.stage.paused(true);
        }
        if (parent === "play") {
            this.stage.paused(false);
        }
        this.stage.changed();
    }

    /**
     * Where back goes from here.
     * @returns the screen, or null when back does nothing.
     */
    private parentScreen(): ShellScreen | null {
        if (this.screen === "game" || this.screen === "players") {
            return "home";
        }
        if (this.screen === "howTo") {
            return "pause";
        }
        if (this.screen === "pause") {
            return "play";
        }
        return this.screen === "play" && this.isDecided() === false ? "pause" : null;
    }

    /**
     * The game whose page is open.
     * @returns the game.
     */
    private currentGame(): ShelfGame | undefined {
        return this.stage.games().find((game: ShelfGame) => game.id === this.gameId);
    }

    /**
     * Whether the game on screen has a result.
     * @returns true on the play screen once it's over.
     */
    private isDecided(): boolean {
        return this.screen === "play" && this.stage.gameOver() === true;
    }
}
