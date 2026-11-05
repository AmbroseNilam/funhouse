// The console state for one room: where the highlight is, who is driving, and what each screen
// offers. It decides nothing about any game. Starting and leaving go back to the room through
// its stage, so the same paths work from a phone or from the host.

import type { GamePick } from "../shared/cartridge.ts";
import { START_PICK_SEPARATOR, startPickAt, type NavAction, type NavAxis, type PadView, type Seat, type ShelfGame, type ShellScreen, type ShellView, type StartPick } from "../shared/shell.ts";

/** How long a driver may sit idle before anyone else's swipe takes over. */
const DRIVER_IDLE_MILLISECONDS: number = 10000;

/** The pause menu's fixed rows. */
const RESUME: string = "Resume";
const HOW_TO_PLAY: string = "How to play";
const END_GAME: string = "End the game";

/** The question before a game ends for everyone. The safe answer comes first. */
const CONFIRM_END_MENU: string[] = ["Keep playing", "End for everyone"];

/** How long the question about ending waits for an answer before it goes away. */
const END_QUESTION_MILLISECONDS: number = 8000;

/** How long after the question is answered a further tap is taken as the same tap, not a choice on the next screen. */
const ANSWER_SETTLE_MILLISECONDS: number = 600;

/** How long a start pick waits for a choice before taking the highlighted one. */
const PICK_MILLISECONDS: number = 15000;

/** How long a how-to card stays up unless someone skips it. */
const START_CARD_MILLISECONDS: number = 25000;

/** The how-to card's one row. */
const START_NOW: string = "Start now";

/** The game page's rows for AI guests, and its way back. */
const ADD_GUEST: string = "Add an AI guest";
const REMOVE_GUEST: string = "Remove an AI guest";
const REMOVE_AGENT: string = "Remove an agent";
const BACK_TO_SHELF: string = "Back to the shelf";

/** The rows for adding someone from the table. */
const ADD_PLAYER: string = "Add a player";
const AI_GUEST: string = "AI guest";
const BRING_AGENT: string = "Bring your agent";
const CREATE_GUEST: string = "Create your own";
const BACK: string = "Back";

/** Rows once a game has been decided. */
const GAME_OVER_MENU: string[] = ["Play again", "Back to the shelf"];

/** What the shell needs from its room. */
export interface ShellStage {
    games(): ShelfGame[];
    seats(): Omit<Seat, "driving">[];
    /** Starts a game, with what was chosen for it if it asks for a choice. */
    startGame(gameId: string, pick?: string): void;
    /** A question the running game has for the picker, if it's setting itself up. */
    gamePick(): GamePick | null;
    /** A choice before a game has opened, for the host to mention. */
    pickOpened(hostLine: string): void;
    endGame(): void;
    /** True when the running game has a result. */
    gameOver(): boolean;
    /** The highlight landed on a game, or left the shelf, for the host to maybe remark on. */
    focusChanged(gameId: string | null): void;
    /** A person's request couldn't be done; the host says why. */
    refused(reason: string): void;
    /** The driver changed because the last one left. */
    driverChanged(name: string): void;
    /** Whether every seat in the running game has dropped. */
    steppedOut(): boolean;
    /** The game was paused or resumed. */
    paused(paused: boolean): void;
    /** Someone chose an action from the pause menu that the game offers. */
    gameAction(playerId: string, actionId: string): void;
    /** The highlight hit the end of what it can move through. */
    edge(): void;
    /** Anything on the shell changed. */
    changed(): void;
    /** Whether another AI guest could sit down now. */
    mayAddGuest(): boolean;
    /** Seats another AI guest. */
    addGuest(): void;
    /** Sends the newest AI guest home. */
    removeGuest(): void;
    /** The guests who could sit down now, by name, with a label for the row. */
    guestPicks(): { name: string; label: string }[];
    /** Seats the guest with this name. */
    addNamedGuest(name: string): void;
    /** Whether someone could bring their own agent now. */
    mayBringAgent(): boolean;
    /** Sends this person's phone to describe a guest. */
    askGuestLine(playerId: string): void;
    /** Sends this person's phone to the sheet with their agent's link. The link never goes on the TV. */
    askAgentLink(playerId: string): void;
}

/** One room's console. */
export class Shell {
    private readonly stage: ShellStage;
    private screen: ShellScreen = "home";
    private focus: number = 0;
    private shelfFocus: number = 0;
    private gameId: string | null = null;
    private driverId: string | null = null;
    private gamePickKey: string = "";
    private pickStep: number = 0;
    private pickAnswers: string[] = [];
    private lastDriveAt: number = 0;
    private freeTimer: NodeJS.Timeout | null = null;
    private pickTimer: NodeJS.Timeout | null = null;
    private pausedBy: string = "";
    private endQuestionTimer: NodeJS.Timeout | null = null;
    private endAnsweredAt: number = 0;
    /** What was chosen for the game about to begin. */
    private chosen: string | undefined = undefined;
    /** Games whose how-to card this room has seen, so a replay gets straight on with it. */
    private readonly cardsSeen: Set<string> = new Set();

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
        this.followGamePick();
        const takingTheQuestion: boolean = this.screen === "confirmEnd" && this.driverId !== playerId;
        if (this.claimDrive(playerId) === false || takingTheQuestion === true) {
            return;
        }
        if ((action.kind === "select" || action.kind === "choose") && Date.now() - this.endAnsweredAt < ANSWER_SETTLE_MILLISECONDS) {
            return;
        }
        if (action.kind === "back") {
            this.back(playerId);
            return;
        }
        if (action.kind === "choose") {
            this.choose(playerId, action.index);
            return;
        }
        if (action.kind === "step") {
            this.step(action.delta);
            return;
        }
        this.select(playerId);
    }

    /**
     * A mouse on the TV that opened the room. It steers for whoever holds the controller and is
     * nobody itself, so it can't take a seat or the controller, and its choices are theirs. With
     * nobody seated it can only look through the shelf and game pages; no game starts from it.
     * @param action what it chose.
     */
    public actFromScreen(action: NavAction): void {
        if (this.driverId !== null) {
            this.act(this.driverId, action);
            return;
        }
        if (this.screen !== "home" && this.screen !== "game" && this.screen !== "players") {
            return;
        }
        if (this.screen === "game" && action.kind !== "back" && action.kind !== "step" && this.menu()[action.kind === "choose" ? action.index : this.focus] !== BACK_TO_SHELF) {
            return;
        }
        if (action.kind === "back") {
            this.back("");
            return;
        }
        if (action.kind === "choose") {
            this.choose("", action.index);
            return;
        }
        if (action.kind === "step") {
            this.step(action.delta);
            return;
        }
        this.select("");
    }

    /**
     * A game started, however it was asked for.
     * @param gameId the game.
     */
    public gameStarted(gameId: string): void {
        this.stopPickTimer();
        this.gameId = gameId;
        this.screen = "play";
        this.focus = 0;
        this.stage.focusChanged(null);
        this.stage.changed();
    }

    /** The game ended; back to its place on the shelf. */
    public gameEnded(): void {
        this.stopEndQuestionTimer();
        if (this.isPausedScreen() === true) {
            this.stage.paused(false);
        }
        this.screen = "home";
        this.focus = this.shelfFocus;
        this.pausedBy = "";
        // The shelf is anyone's now, so nobody's phone sits there unable to do anything.
        this.lastDriveAt = 0;
        this.stage.changed();
    }

    /** The running game was decided, so its result takes over the screen. */
    public gameDecided(): void {
        this.stopEndQuestionTimer();
        if (this.isPausedScreen() === true) {
            this.stage.paused(false);
        }
        this.screen = "play";
        this.focus = 0;
        this.pausedBy = "";
        this.stage.changed();
    }

    /** People came or went; makes sure someone can drive. */
    public seatsChanged(): void {
        this.focus = this.screen === "game" ? Math.max(0, Math.min(this.focus, this.itemCount() - 1)) : this.focus;
        const seats: Omit<Seat, "driving">[] = this.stage.seats().filter((seat) => seat.guest === false);
        if (seats.some((seat) => seat.playerId === this.driverId) === true) {
            return;
        }
        const hadDriver: boolean = this.driverId !== null;
        const here: Omit<Seat, "driving">[] = seats.filter((seat) => seat.connected === true);
        const next: Omit<Seat, "driving"> | undefined = here.find((seat) => seat.watching === false && seat.out === false) ?? here.find((seat) => seat.watching === false) ?? here[0] ?? seats[0];
        this.driverId = next?.playerId ?? null;
        this.dropEndQuestion();
        if (hadDriver === true && next !== undefined) {
            this.stage.driverChanged(next.name);
        }
    }

    /**
     * The running game's question for the picker, unless a pause or anything else is on top.
     * @returns the pick, if there is one.
     */
    private gamePick(): GamePick | null {
        return this.screen === "play" ? this.stage.gamePick() : null;
    }

    /** Puts the highlight back on the first row when the game moves to a new question. */
    private followGamePick(): void {
        const key: string = this.gamePick()?.prompt ?? "";
        if (key !== this.gamePickKey) {
            this.gamePickKey = key;
            this.focus = 0;
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
     * Whether this person may make the holder's calls in a game. When the holder has dropped or put
     * their phone down, the next person here may, so nobody who's gone can hold up the room.
     * @param playerId who.
     * @returns true when they may.
     */
    public holdsControl(playerId: string): boolean {
        if (this.driverId === playerId) {
            return true;
        }
        const seats: Omit<Seat, "driving">[] = this.stage.seats().filter((seat) => seat.guest === false);
        const present = (seat: Omit<Seat, "driving">): boolean => seat.connected === true && seat.phoneDown === false;
        if (seats.some((seat) => seat.playerId === this.driverId && present(seat)) === true) {
            return false;
        }
        const here: Omit<Seat, "driving">[] = seats.filter(present);
        const next: Omit<Seat, "driving"> | undefined = here.find((seat) => seat.watching === false && seat.out === false) ?? here.find((seat) => seat.watching === false) ?? here[0];
        return next?.playerId === playerId;
    }

    /**
     * The whole console, for the TV.
     * @returns the view.
     */
    public view(): ShellView {
        this.followGamePick();
        const pick: GamePick | null = this.gamePick();
        const seats: Seat[] = this.stage.seats().map((seat) => ({ ...seat, driving: seat.playerId === this.driverId }));
        return {
            screen: pick === null ? this.screen : "setup",
            setup: pick === null ? null : { prompt: pick.prompt, kicker: pick.kicker },
            axis: this.axis(),
            focus: this.focus,
            games: this.stage.games(),
            gameId: this.gameId,
            menu: this.menu(),
            seats,
            gameOver: this.isDecided(),
            pickStep: this.pickStep,
            steppedOut: this.stage.steppedOut(),
            pausedBy: this.pausedBy,
        };
    }

    /**
     * What one phone's surface can do.
     * @param playerId the player.
     * @param colour their seat colour.
     * @returns the view.
     */
    public pad(playerId: string, colour: string): PadView {
        this.followGamePick();
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
            controllerFree: driver?.connected !== true || driver.phoneDown === true,
            watching: false,
            gameOver: this.isDecided(),
            canDrive,
            backLabel: canDrive === true ? this.backLabel() : null,
            canSelect: count > 0 && canDrive === true,
            pausedBy: this.pausedBy,
            confirmEnd: this.screen === "confirmEnd" && playerId === this.driverId,
            startCard: this.screen === "startCard" ? this.currentGame()?.startCard ?? [] : [],
        };
    }

    /**
     * Whether someone else is actively driving, so this person has to wait.
     * @param playerId who's asking.
     * @returns true when the controller is theirs or free.
     */
    private mayDrive(playerId: string): boolean {
        const driverPresent: boolean = this.stage.seats().some((seat) => seat.playerId === this.driverId && seat.connected === true && seat.phoneDown === false && seat.out === false && seat.watching === false);
        if (this.driverId === playerId || driverPresent === false) {
            return true;
        }
        // During a game the controller decides for everyone, so it can't be taken just because it's been quiet.
        return this.gameIsOn() === false && Date.now() - this.lastDriveAt >= DRIVER_IDLE_MILLISECONDS;
    }

    /**
     * Whether a game is in play or paused, rather than the shelf or a finished game.
     * @returns true while a game is on.
     */
    private gameIsOn(): boolean {
        return this.isPausedScreen() === true || (this.screen === "play" && this.isDecided() === false);
    }

    /**
     * Whether the game is paused behind this screen.
     * @returns true when it is.
     */
    private isPausedScreen(): boolean {
        return this.screen === "pause" || this.screen === "howTo" || this.screen === "confirmEnd";
    }

    /**
     * Whether this person may pause, resume or end the game for everyone, taking the controller if it's free.
     * @param playerId who.
     * @returns false while someone else holds it.
     */
    public claimForGame(playerId: string): boolean {
        return this.claimDrive(playerId);
    }

    /**
     * Who holds the controller.
     * @returns their name, or an empty string.
     */
    public driverName(): string {
        return this.nameOf(this.driverId);
    }

    /**
     * Finds someone's name.
     * @param playerId who.
     * @returns the name, or an empty string.
     */
    private nameOf(playerId: string | null): string {
        return this.stage.seats().find((seat) => seat.playerId === playerId)?.name ?? "";
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
        if (changedHands === true) {
            this.dropEndQuestion();
        }
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
        const pick: GamePick | null = this.gamePick();
        if (pick !== null) {
            return pick.choices.map((choice) => choice.label);
        }
        if (this.screen === "game") {
            return [this.currentGame()?.blocked === null ? "Play" : "Can't start yet", ...this.guestRows(), BACK_TO_SHELF];
        }
        if (this.screen === "players") {
            return [...(this.stage.mayAddGuest() === true || this.stage.mayBringAgent() === true ? [ADD_PLAYER] : []), ...this.removeRow(), BACK_TO_SHELF];
        }
        if (this.screen === "addPlayer") {
            return [...(this.stage.mayAddGuest() === true ? [AI_GUEST] : []), ...(this.stage.mayBringAgent() === true ? [BRING_AGENT] : []), BACK];
        }
        if (this.screen === "addGuest") {
            return this.stage.mayAddGuest() === true ? [...this.stage.guestPicks().map((pick) => pick.label), CREATE_GUEST, BACK] : [BACK];
        }
        if (this.screen === "guestLine" || this.screen === "agentOnPhone") {
            return [BACK];
        }
        if (this.screen === "pick") {
            return (startPickAt(this.currentGame()?.startPick, this.pickStep)?.choices ?? []).map((choice) => choice.label);
        }
        if (this.screen === "startCard") {
            return [START_NOW];
        }
        if (this.screen === "confirmEnd") {
            return CONFIRM_END_MENU;
        }
        if (this.screen === "pause") {
            return [RESUME, HOW_TO_PLAY, ...(this.currentGame()?.pauseActions ?? []).map((action) => action.label), END_GAME];
        }
        if (this.screen === "howTo") {
            return ["Back"];
        }
        return this.isDecided() === true ? GAME_OVER_MENU : [];
    }

    /**
     * The game page's row for AI guests: one at most, because a fourth row runs under the host's
     * caption on the TV. Adding comes first while it's possible; otherwise this page can send one home,
     * so the way past "remove them first" is right there. The phone's menu can always remove any guest.
     * @returns the labels.
     */
    private guestRows(): string[] {
        if (this.currentGame()?.guestsWelcome === true && this.stage.mayAddGuest() === true) {
            return [ADD_GUEST];
        }
        return this.removeRow();
    }

    /**
     * The row that sends the newest machine at the table home, if there is one.
     * @returns the labels.
     */
    private removeRow(): string[] {
        const newest: Omit<Seat, "driving"> | undefined = this.stage.seats().filter((seat) => seat.guest === true).at(-1);
        if (newest === undefined) {
            return [];
        }
        return [newest.agent === true ? REMOVE_AGENT : REMOVE_GUEST];
    }

    /**
     * Which way swipes move on this screen.
     * @returns the axis, or null when there's nothing to move through.
     */
    private axis(): NavAxis {
        if (this.screen === "home" || this.screen === "pick" || this.gamePick() !== null) {
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
        if (this.screen === "game" || this.screen === "pick" || this.screen === "startCard" || this.screen === "players" || this.screen === "addPlayer" || this.screen === "addGuest" || this.screen === "guestLine" || this.screen === "agentOnPhone" || this.screen === "howTo" || this.screen === "confirmEnd") {
            return "Back";
        }
        if (this.screen === "pause") {
            return RESUME;
        }
        return this.screen === "play" && this.isDecided() === false ? "Pause" : null;
    }

    /**
     * Moves the highlight, stopping at the ends.
     * @param delta how far.
     */
    private step(delta: number): void {
        if (this.screen === "pick") {
            this.restartPickTimer();
        }
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
        const pick: GamePick | null = this.gamePick();
        if (pick !== null) {
            const choice = pick.choices[this.focus];
            if (choice !== undefined) {
                this.stage.gameAction(playerId, choice.id);
            }
            return;
        }
        if (this.screen === "home") {
            this.selectOnShelf();
            return;
        }
        if (this.screen === "game") {
            this.selectOnGamePage();
            return;
        }
        if (this.screen === "pick") {
            this.takePick();
            return;
        }
        if (this.screen === "startCard") {
            this.beginGame();
            return;
        }
        if (this.screen === "players" || this.screen === "addPlayer" || this.screen === "addGuest") {
            this.selectAtTable(playerId);
            return;
        }
        if (this.screen === "guestLine" || this.screen === "agentOnPhone" || this.screen === "howTo") {
            this.back(playerId);
            return;
        }
        if (this.screen === "pause") {
            this.selectOnPause(playerId);
            return;
        }
        if (this.screen === "confirmEnd") {
            this.selectOnConfirmEnd(playerId);
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

    /**
     * Does what the highlighted row says on the screens for adding someone from the table.
     * @param playerId who chose it.
     */
    private selectAtTable(playerId: string): void {
        const row: string | undefined = this.menu()[this.focus];
        const opened: Partial<Record<string, ShellScreen>> = { [ADD_PLAYER]: "addPlayer", [AI_GUEST]: "addGuest", [BRING_AGENT]: "agentOnPhone", [CREATE_GUEST]: "guestLine" };
        const next: ShellScreen | undefined = row === undefined ? undefined : opened[row];
        if (next !== undefined) {
            if (row === BRING_AGENT) {
                this.stage.askAgentLink(playerId);
            }
            if (row === CREATE_GUEST) {
                this.stage.askGuestLine(playerId);
            }
            this.screen = next;
            this.focus = 0;
            this.stage.changed();
            return;
        }
        if (row === REMOVE_GUEST || row === REMOVE_AGENT) {
            this.stage.removeGuest();
            this.focus = Math.max(0, Math.min(this.focus, this.itemCount() - 1));
            this.stage.changed();
            return;
        }
        const pick: { name: string; label: string } | undefined = this.stage.guestPicks().find((candidate) => candidate.label === row);
        if (pick !== undefined && this.screen === "addGuest") {
            this.stage.addNamedGuest(pick.name);
            this.guestSeated();
            return;
        }
        this.back(playerId);
    }

    /** A guest has just sat down, so the screens for adding one go back to the table to show it. */
    public guestSeated(): void {
        if (this.screen !== "addGuest" && this.screen !== "guestLine") {
            return;
        }
        this.screen = "players";
        this.focus = 0;
        this.stage.changed();
    }

    /** Play, or back, on a game's page. */
    private selectOnGamePage(): void {
        const row: string | undefined = this.menu()[this.focus];
        if (row === BACK_TO_SHELF) {
            this.back(this.driverId ?? "");
            return;
        }
        if (row === ADD_GUEST) {
            this.stage.addGuest();
            this.focus = this.currentGame()?.blocked === null ? 0 : this.focus;
            this.stage.changed();
            return;
        }
        if (row === REMOVE_GUEST || row === REMOVE_AGENT) {
            this.stage.removeGuest();
            this.stage.changed();
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
        this.gameId = game.id;
        this.chosen = undefined;
        if (game.startPick !== null) {
            this.openPick(game);
            return;
        }
        this.showCardOrBegin(game);
    }

    /**
     * Opens a game's choice, with its first choice highlighted.
     * @param game the game.
     */
    private openPick(game: ShelfGame): void {
        this.gameId = game.id;
        this.screen = "pick";
        this.focus = 0;
        this.pickStep = 0;
        this.pickAnswers = [];
        this.restartPickTimer();
        this.stage.pickOpened(game.startPick?.hostLine ?? "");
        this.stage.changed();
    }

    /** Takes whatever is highlighted and moves on to the game. */
    private takePick(): void {
        this.stopPickTimer();
        const game: ShelfGame | undefined = this.currentGame();
        const question: StartPick | null = startPickAt(game?.startPick, this.pickStep);
        const choice: { id: string; label: string } | undefined = question?.choices[this.focus];
        if (game === undefined || choice === undefined) {
            return;
        }
        // Coming back to a question from further on answers it again, not as well.
        this.pickAnswers = [...this.pickAnswers.slice(0, this.pickStep), choice.id];
        if (question?.then !== undefined) {
            this.pickStep += 1;
            this.focus = 0;
            this.restartPickTimer();
            this.stage.pickOpened(question.then.hostLine);
            this.stage.changed();
            return;
        }
        this.chosen = this.pickAnswers.join(START_PICK_SEPARATOR);
        this.showCardOrBegin(game);
    }

    /**
     * Shows a game's how-to card the first time this room plays it, and otherwise begins.
     * @param game the game.
     */
    private showCardOrBegin(game: ShelfGame): void {
        if (game.startCard === null || this.cardsSeen.has(game.id) === true) {
            this.beginGame();
            return;
        }
        this.cardsSeen.add(game.id);
        this.screen = "startCard";
        this.focus = 0;
        this.stopPickTimer();
        this.pickTimer = setTimeout(() => { this.beginGame(); }, START_CARD_MILLISECONDS);
        this.pickTimer.unref();
        this.stage.changed();
    }

    /** Begins the game on the page. If it can't begin, goes back to its page. */
    private beginGame(): void {
        this.stopPickTimer();
        const game: ShelfGame | undefined = this.currentGame();
        if (game === undefined) {
            return;
        }
        this.stage.startGame(game.id, this.chosen);
        if (this.screen === "pick" || this.screen === "startCard") {
            this.screen = "game";
            this.focus = 0;
            this.stage.changed();
        }
    }

    /** Gives a choice its full time again, so it isn't taken from under someone's thumb. */
    private restartPickTimer(): void {
        this.stopPickTimer();
        if (startPickAt(this.currentGame()?.startPick, this.pickStep)?.waits === true) {
            return;
        }
        this.pickTimer = setTimeout(() => { this.takePick(); }, PICK_MILLISECONDS);
        this.pickTimer.unref();
    }

    /** Stops waiting for a choice. */
    private stopPickTimer(): void {
        if (this.pickTimer !== null) {
            clearTimeout(this.pickTimer);
            this.pickTimer = null;
        }
    }

    /** Stops anything still waiting, as the room closes. */
    public close(): void {
        this.stopPickTimer();
        this.stopEndQuestionTimer();
    }

    /**
     * Chooses a row straight from a phone's own button, as if the highlight were on it.
     * @param playerId who.
     * @param index the row.
     */
    private choose(playerId: string, index: number): void {
        if (Number.isInteger(index) === false || index < 0 || index >= this.itemCount()) {
            return;
        }
        this.focus = index;
        this.select(playerId);
    }

    /**
     * Does what the highlighted pause row says.
     * @param playerId who chose it.
     */
    private selectOnPause(playerId: string): void {
        const row: string | undefined = this.menu()[this.focus];
        if (row === RESUME) {
            this.back(playerId);
            return;
        }
        if (row === HOW_TO_PLAY) {
            this.screen = "howTo";
            this.focus = 0;
            this.stage.changed();
            return;
        }
        if (row === END_GAME) {
            this.screen = "confirmEnd";
            this.focus = 0;
            this.endQuestionTimer = setTimeout(() => {
                this.dropEndQuestion();
                this.stage.changed();
            }, END_QUESTION_MILLISECONDS);
            this.endQuestionTimer.unref();
            this.stage.changed();
            return;
        }
        const action: { id: string; label: string } | undefined = this.currentGame()?.pauseActions.find((candidate) => candidate.label === row);
        if (action !== undefined) {
            this.screen = "play";
            this.focus = 0;
            this.pausedBy = "";
            this.stage.paused(false);
            this.stage.gameAction(playerId, action.id);
            this.stage.changed();
        }
    }

    /**
     * Answers whether to end the game for everyone.
     * @param playerId who answered.
     */
    private selectOnConfirmEnd(playerId: string): void {
        this.stopEndQuestionTimer();
        this.endAnsweredAt = Date.now();
        if (this.focus === 1) {
            this.stage.endGame();
            return;
        }
        this.back(playerId);
    }

    /** Takes the question about ending away, leaving the game paused, since only the person who asked can answer it. */
    private dropEndQuestion(): void {
        this.stopEndQuestionTimer();
        if (this.screen === "confirmEnd") {
            this.screen = "pause";
            this.focus = 0;
        }
    }

    /** Stops the wait for an answer about ending. */
    private stopEndQuestionTimer(): void {
        if (this.endQuestionTimer !== null) {
            clearTimeout(this.endQuestionTimer);
            this.endQuestionTimer = null;
        }
    }

    /** Play again, or back to the shelf, once a game is decided. */
    private selectAfterGame(): void {
        const again: boolean = this.focus === 0;
        const game: ShelfGame | undefined = this.currentGame();
        this.stage.endGame();
        if (again === false || game === undefined) {
            return;
        }
        this.chosen = undefined;
        if (game.startPick !== null) {
            this.openPick(game);
            return;
        }
        this.showCardOrBegin(game);
    }

    /**
     * Pauses a game in play, for a spoken request.
     * @param playerId who asked.
     * @returns true when it paused.
     */
    public pauseGame(playerId: string): boolean {
        if (this.screen !== "play" || this.isDecided() === true) {
            return false;
        }
        this.back(playerId);
        return true;
    }

    /**
     * Goes to the parent screen; in a game, pauses.
     * @param playerId who asked, who's named if this pauses the game.
     */
    private back(playerId: string): void {
        this.stopPickTimer();
        this.stopEndQuestionTimer();
        const parent: ShellScreen | null = this.parentScreen();
        if (parent === null) {
            return;
        }
        const leaving: ShellScreen = this.screen;
        this.screen = parent;
        this.focus = parent === "home" ? this.shelfFocus : leaving === "howTo" ? 1 : 0;
        if (parent === "pick") {
            this.restartPickTimer();
        }
        if (leaving === "play") {
            this.pausedBy = this.nameOf(playerId);
            this.stage.paused(true);
        }
        if (parent === "play") {
            this.pausedBy = "";
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
        if (this.screen === "addPlayer") {
            return "players";
        }
        if (this.screen === "addGuest" || this.screen === "agentOnPhone") {
            return "addPlayer";
        }
        if (this.screen === "guestLine") {
            return "addGuest";
        }
        if (this.screen === "pick") {
            return "game";
        }
        if (this.screen === "startCard") {
            return this.currentGame()?.startPick === null ? "game" : "pick";
        }
        if (this.screen === "howTo" || this.screen === "confirmEnd") {
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
