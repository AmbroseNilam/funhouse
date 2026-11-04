// Helpers for playing a whole game from a script, with no microphones and no voice. Start the
// room with GAME_ROOM_TEXT_ONLY=1, then fake phones say text straight to it and tap controls.
// Each scenario in tools/scenarios uses these. Muse Spark still replies for real.

import WebSocket from "ws";
import { rawDataToText } from "../providers/meta/transcribe.ts";
import type { Control, PhoneView } from "../shared/controls.ts";
import type { RoomToPhoneMessage, RoomToScreenMessage } from "../shared/protocol.ts";
import { HOST_NAME } from "../shared/brand.ts";
import type { Scene } from "../shared/scene.ts";
import type { NavAction, ShellView } from "../shared/shell.ts";

/** Where the local room listens. */
const ROOM_URL: string = process.env.ROOM_URL ?? "ws://localhost:8740";

/** How long a scenario waits for something before failing. */
const WAIT_LIMIT_MILLISECONDS: number = 45000;

/** How often a wait checks its condition. */
const WAIT_POLL_MILLISECONDS: number = 50;

/**
 * Waits until a condition holds.
 * @param condition checked repeatedly.
 * @param label names the wait when it fails.
 */
export async function waitFor(condition: () => boolean, label: string): Promise<void> {
    const startedAt: number = Date.now();
    while (condition() === false) {
        if (Date.now() - startedAt > WAIT_LIMIT_MILLISECONDS) {
            throw new Error(`Timed out waiting for ${label}.`);
        }
        await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, WAIT_POLL_MILLISECONDS); });
    }
}

/**
 * What the fake screen asks the room for: an existing room with ROOM_CODE, and a room with the
 * Studio shelf with ROOM_STUDIO=1.
 * @returns the query, possibly empty.
 */
function screenQuery(): string {
    const query: URLSearchParams = new URLSearchParams(process.env.ROOM_CODE === undefined ? process.env.ROOM_SWITCHES ?? "" : "");
    if (process.env.ROOM_CODE !== undefined) {
        query.set("room", process.env.ROOM_CODE);
    }
    if (process.env.ROOM_STUDIO === "1") {
        query.set("studio", "1");
    }
    return query.toString();
}

/** A fake big screen: holds the latest scene and everything the host has said. */
export class FakeScreen {
    public scene: Scene | null = null;
    /** Every scene the room has sent this screen, oldest first, for leak checks. */
    public readonly scenes: Scene[] = [];
    public shell: ShellView | null = null;
    public code: string = "";
    public thinking: boolean = false;
    public readonly hostLines: string[] = [];
    private readonly socket: WebSocket = new WebSocket(`${ROOM_URL}/ws/screen?${screenQuery()}`);

    /** Opens the screen and turns its sound on. */
    public constructor() {
        this.socket.on("open", () => { this.socket.send(JSON.stringify({ type: "ready" })); });
        this.socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
            if (isBinary === true) {
                return;
            }
            const message: RoomToScreenMessage = JSON.parse(rawDataToText(data)) as RoomToScreenMessage;
            if (message.type === "hostState") {
                this.thinking = message.thinking;
            }
            if (message.type === "shell") {
                this.shell = message.view;
            }
            if (message.type !== "scene") {
                return;
            }
            this.scene = message.scene;
            this.scenes.push(message.scene);
            this.code = message.roomCode;
            for (const block of message.scene.blocks) {
                if (block.type === "caption" && block.speaker === HOST_NAME && this.hostLines.at(-1) !== block.text) {
                    this.hostLines.push(block.text);
                    console.warn(`  ${HOST_NAME}: ${block.text}`);
                }
            }
        });
    }

    /**
     * The title of the current scene.
     * @returns the title text, or an empty string.
     */
    public title(): string {
        const block = this.scene?.blocks.find((candidate) => candidate.type === "title");
        return block?.type === "title" ? block.text : "";
    }

    /**
     * Waits for the host to finish a line beyond the number already heard.
     * @param heardBefore how many lines had been heard.
     * @returns the newest line.
     */
    public async nextHostLine(heardBefore: number): Promise<string> {
        await waitFor(() => this.hostLines.length > heardBefore, "the host to speak");
        return this.hostLines.at(-1) ?? "";
    }
}

/** A fake phone. */
export class FakePhone {
    public view: PhoneView | null = null;
    /** The seat this phone holds, for coming back to it. */
    public playerId: string = "";
    public resumeToken: string = "";
    /** Every view the room has sent this phone, oldest first, for leak checks. */
    public readonly views: PhoneView[] = [];
    private readonly socket: WebSocket;
    private readonly name: string;

    /**
     * Joins a room.
     * @param code the room code.
     * @param name the player's name.
     * @param seat the seat to come back to, for a phone reconnecting.
     */
    public constructor(code: string, name: string, seat?: { playerId: string; resumeToken: string }) {
        this.name = name;
        this.socket = new WebSocket(`${ROOM_URL}/ws/phone?room=${code}`);
        this.socket.on("open", () => { this.socket.send(JSON.stringify({ type: "hello", name, ...seat })); });
        this.socket.on("message", (data: WebSocket.RawData) => {
            const message: RoomToPhoneMessage = JSON.parse(rawDataToText(data)) as RoomToPhoneMessage;
            if (message.type === "welcome") {
                this.playerId = message.playerId;
                this.resumeToken = message.resumeToken;
            }
            if (message.type === "view") {
                this.view = message.view;
                this.views.push(message.view);
            }
        });
    }

    /**
     * Types a line in place of talking.
     * @param text the words.
     */
    public type(text: string): void {
        console.warn(`${this.name} types: ${text}`);
        this.socket.send(JSON.stringify({ type: "typed", text }));
    }

    /**
     * Says a line, as if it had just been transcribed.
     * @param text the words.
     */
    public say(text: string): void {
        console.warn(`${this.name}: ${text}`);
        this.socket.send(JSON.stringify({ type: "textOnlySay", text }));
    }

    /**
     * Answers a textInput, numberInput or slider.
     * @param controlId the control.
     * @param value the answer.
     */
    public answer(controlId: string, value: string | number): void {
        console.warn(`${this.name} answers ${controlId}`);
        this.socket.send(JSON.stringify({ type: "answer", controlId, value }));
    }

    /**
     * The buttons this phone can press right now, from every control.
     * @returns one entry per enabled option.
     */
    public options(): { id: string; label: string }[] {
        const controls: Control[] = this.view?.controls ?? [];
        return controls.flatMap((control: Control) => (control.type === "buttons" || control.type === "choice" ? control.options : [])).filter((option) => option.disabled !== true);
    }

    /**
     * Presses a button by its id or label.
     * @param wanted the option's id or label.
     */
    public press(wanted: string): void {
        const option = this.options().find((candidate) => candidate.id === wanted || candidate.label === wanted);
        if (option === undefined) {
            throw new Error(`${this.name} has no option "${wanted}". Has: ${this.options().map((candidate) => candidate.label).join(", ")}`);
        }
        console.warn(`${this.name} presses ${option.label}`);
        this.socket.send(JSON.stringify({ type: "input", input: { value: option.id, controlIndex: 0 } }));
    }

    /**
     * Sends what a thumb would do.
     * @param action the action.
     */
    public nav(action: NavAction): void {
        this.socket.send(JSON.stringify({ type: "nav", action }));
    }

    /**
     * Walks the shelf to a game and starts it, the way a person would.
     * @param screen the TV.
     * @param name the game's name.
     */
    public async startGame(screen: FakeScreen, name: string): Promise<void> {
        await waitFor(() => screen.shell !== null, "the shelf");
        const target: number = screen.shell?.games.findIndex((game) => game.name === name) ?? -1;
        console.warn(`${this.name} opens ${name}`);
        this.nav({ kind: "step", delta: target - (screen.shell?.focus ?? 0) });
        await waitFor(() => screen.shell?.focus === target, "the highlight to move");
        this.nav({ kind: "select" });
        await waitFor(() => screen.shell?.screen === "game", "the game's page");
        this.nav({ kind: "select" });
        await waitFor(() => screen.shell?.screen === "pick" || screen.shell?.screen === "startCard" || screen.shell?.screen === "play", "the game to start or ask what to pick");
        if (screen.shell?.screen === "pick") {
            // Quizmaster's scenarios bring their own topic; anything else takes the surprise.
            const own: number = name === "Quizmaster" ? screen.shell.menu.indexOf("Say your own topic") : 0;
            this.nav({ kind: "choose", index: Math.max(0, own) });
        }
        await waitFor(() => screen.shell?.screen === "startCard" || screen.shell?.screen === "play", "the how-to card or the game");
        if (screen.shell?.screen === "startCard") {
            this.nav({ kind: "select" });
        }
        await waitFor(() => screen.shell?.screen === "play", "the game to start");
    }

    /**
     * Chooses a row on the TV's current menu.
     * @param screen the TV.
     * @param label the row.
     */
    public async chooseRow(screen: FakeScreen, label: string): Promise<void> {
        await waitFor(() => screen.shell?.menu.includes(label) === true, `a menu with "${label}"`);
        const shell: ShellView | null = screen.shell;
        this.nav({ kind: "step", delta: (shell?.menu.indexOf(label) ?? 0) - (shell?.focus ?? 0) });
        await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 150); });
        console.warn(`${this.name} chooses ${label}`);
        this.nav({ kind: "select" });
    }

    /**
     * Pauses the game and picks a row from the pause menu.
     * @param screen the TV.
     * @param label the row.
     */
    public async fromPauseMenu(screen: FakeScreen, label: string): Promise<void> {
        this.nav({ kind: "back" });
        await waitFor(() => screen.shell?.screen === "pause", "the pause menu");
        await this.chooseRow(screen, label);
    }

    /**
     * Seats or sends home an AI guest from the phone's menu.
     * @param action what to do.
     * @param playerId which guest; the newest if not said.
     */
    public guest(action: "add" | "remove", playerId?: string): void {
        this.socket.send(JSON.stringify({ type: "guest", action, ...(playerId === undefined ? {} : { playerId }) }));
    }

    /** Leaves the table for good, as the phone menu does. */
    public leave(): void {
        console.warn(`${this.name} leaves the table`);
        this.socket.send(JSON.stringify({ type: "leave" }));
    }

    /** Hangs up. */
    public close(): void {
        this.socket.close();
    }
}
