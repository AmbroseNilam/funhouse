// Checks an AI guest: that it answers a question once, that every failure of the model still ends in a
// legal move, that its prompt holds only what its own seat can see in real games, and that the names are
// labelled and safe. Which games take guests comes from their metadata, so that's checked here too.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cartridge } from "../shared/cartridge.ts";
import type { Control, PhoneView } from "../shared/controls.ts";
import { HOST_NAME } from "../shared/brand.ts";
import type { ScopedFact } from "../shared/visibility.ts";
import { createKitGame } from "../studio/blueprint.ts";
import { CATALOG, KITS } from "../studio/registry.ts";
import { nicknameCategory } from "./content-filter.ts";
import { askIn, fallbackMove, isStockWord, GuestDriver, GUEST_PERSONAS, guestPrompt, moveFrom, snapped, type Ask, type GuestModel, type GuestPersona, type GuestPlay, type GuestSeat, type Move } from "./guest.ts";

/** A persona with no waiting, for quick tests. */
const QUICK: GuestPersona = { ...(GUEST_PERSONAS[0] as GuestPersona), minimumDelayMilliseconds: 0, maximumDelayMilliseconds: 0 };

/**
 * A phone's view holding these controls.
 * @param controls the controls.
 * @returns the view.
 */
function viewOf(controls: Control[]): PhoneView {
    return {
        gameOn: false, hostVoice: { choice: "current", canChange: false }, playerName: QUICK.name, listening: "muted", status: "", controls, hearing: "", tapToTalk: false, talkWaiting: false, turn: null, guests: { seated: [], people: [], canAdd: false, canRemove: false, agents: null, picks: [], prompt: null, writing: false },
        pad: { colour: "#000000", axis: null, canPrevious: false, canNext: false, driving: false, driverName: "", controllerFree: false, watching: false, gameOver: false, canDrive: false, backLabel: null, canSelect: false, pausedBy: "", confirmEnd: false, startCard: [] },
    };
}

/** What a test seat did. */
interface Played {
    pressed: string[];
    answered: (string | number)[];
}

/**
 * A guest's seat that writes down what it does.
 * @param played where to write it.
 * @param overrides anything different from a plain seat.
 * @returns the seat.
 */
function seatFor(played: Played, overrides: Partial<GuestSeat> = {}): GuestSeat {
    return {
        playerId: "p2",
        persona: QUICK,
        press: (optionId: string): void => { played.pressed.push(optionId); },
        answer: (_controlId: string, value: string | number): void => { played.answered.push(value); },
        paused: (): boolean => false,
        play: (): GuestPlay => "model",
        rules: (): string => "",
        mayAskModel: (): boolean => true,
        ...overrides,
    };
}

/** Waits long enough for a quick guest to act. */
async function settle(): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 30); });
}

const BUTTONS: Control = { type: "buttons", prompt: "Pick", options: [{ id: "a", label: "Apple" }, { id: "b", label: "Boat" }, { id: "c", label: "Cart", disabled: true }] };

test("a guest answers a question once, however often its phone refreshes", async () => {
    const played: Played = { pressed: [], answered: [] };
    let asked: number = 0;
    const model: GuestModel = () => {
        asked += 1;
        return Promise.resolve("2");
    };
    const driver: GuestDriver = new GuestDriver(seatFor(played), model);
    for (let refresh = 0; refresh < 5; refresh += 1) {
        driver.see(viewOf([BUTTONS]));
    }
    await settle();
    driver.see(viewOf([BUTTONS]));
    await settle();
    assert.equal(asked, 1);
    assert.deepEqual(played.pressed, ["b"]);
});

test("the same question asked again after the phone stopped asking gets a new answer", async () => {
    const played: Played = { pressed: [], answered: [] };
    const driver: GuestDriver = new GuestDriver(seatFor(played), () => Promise.resolve("1"));
    driver.see(viewOf([BUTTONS]));
    await settle();
    driver.see(viewOf([{ type: "waiting", text: "Look at the screen." }]));
    driver.see(viewOf([BUTTONS]));
    await settle();
    assert.deepEqual(played.pressed, ["a", "a"]);
});

test("a model that fails, talks nonsense or picks a disabled option still ends in a legal move", async () => {
    const failing: GuestModel[] = [() => Promise.reject(new Error("down")), () => Promise.resolve("I'd rather not"), () => Promise.resolve("3"), () => Promise.resolve("99"), () => Promise.resolve("")];
    for (const model of failing) {
        const played: Played = { pressed: [], answered: [] };
        new GuestDriver(seatFor(played), model).see(viewOf([BUTTONS]));
        await settle();
        assert.equal(played.pressed.length, 1);
        assert.ok(["a", "b"].includes(played.pressed[0] ?? ""));
    }
});

test("a guest over its cap, or in a game played at random, never asks the model", async () => {
    for (const overrides of [{ mayAskModel: (): boolean => false }, { play: (): GuestPlay => "random" }]) {
        const played: Played = { pressed: [], answered: [] };
        let asked: number = 0;
        const model: GuestModel = () => {
            asked += 1;
            return Promise.resolve("1");
        };
        new GuestDriver(seatFor(played, overrides), model).see(viewOf([BUTTONS]));
        await settle();
        assert.equal(asked, 0);
        assert.equal(played.pressed.length, 1);
    }
});

test("a paused room holds a guest, and the view after it resumes asks again", async () => {
    const played: Played = { pressed: [], answered: [] };
    let paused: boolean = true;
    const driver: GuestDriver = new GuestDriver(seatFor(played, { paused: (): boolean => paused }), () => Promise.resolve("1"));
    driver.see(viewOf([BUTTONS]));
    await settle();
    assert.deepEqual(played.pressed, []);
    paused = false;
    driver.see(viewOf([BUTTONS]));
    await settle();
    assert.deepEqual(played.pressed, ["a"]);
});

test("a guest that has left does nothing with a decision it was making", async () => {
    const played: Played = { pressed: [], answered: [] };
    const driver: GuestDriver = new GuestDriver(seatFor(played), () => Promise.resolve("1"));
    driver.see(viewOf([BUTTONS]));
    driver.stop();
    await settle();
    driver.see(viewOf([BUTTONS]));
    await settle();
    assert.deepEqual(played.pressed, []);
});

test("a typed answer that keeps being refused gets the model twice, then stock words, then quiet, even if each try is a new control", async () => {
    const played: Played = { pressed: [], answered: [] };
    let asked: number = 0;
    const model: GuestModel = () => {
        asked += 1;
        return Promise.resolve("meadow");
    };
    const driver: GuestDriver = new GuestDriver(seatFor(played), model);
    for (let attempt = 0; attempt < 6; attempt += 1) {
        driver.see(viewOf([{ type: "textInput", id: `word:${attempt}`, prompt: "Your word", maxLength: 20 }]));
        await settle();
    }
    assert.equal(asked, 2);
    assert.deepEqual(played.answered.slice(0, 2), ["meadow", "meadow"]);
    assert.equal(played.answered.length, 4);
    assert.ok(isStockWord(String(played.answered[2])));
    driver.see(viewOf([{ type: "waiting", text: "Look at the screen." }]));
    driver.see(viewOf([{ type: "textInput", id: "next", prompt: "Your word", maxLength: 20 }]));
    await settle();
    assert.equal(asked, 3, "the next turn starts afresh");
});

test("decisions made during a pause don't use up a guest's tries at a typed answer", async () => {
    const played: Played = { pressed: [], answered: [] };
    let paused: boolean = true;
    const driver: GuestDriver = new GuestDriver(seatFor(played, { paused: (): boolean => paused }), () => Promise.resolve("meadow"));
    const box: Control = { type: "textInput", id: "word", prompt: "Your word", maxLength: 20 };
    for (let view = 0; view < 6; view += 1) {
        driver.see(viewOf([box]));
        await settle();
    }
    assert.deepEqual(played.answered, []);
    paused = false;
    driver.see(viewOf([box]));
    await settle();
    assert.deepEqual(played.answered, ["meadow"]);
});

test("a seat that's only watching is asked nothing", () => {
    const view: PhoneView = viewOf([BUTTONS]);
    assert.equal(askIn({ ...view, pad: { ...view.pad, watching: true } }), null);
});

test("numbers land in range and on the steps the room checks, with noise", () => {
    assert.equal(snapped(13.7, 0, 100, 5), 15);
    assert.equal(snapped(-40, 0, 100, 5), 0);
    assert.equal(snapped(1000, 0, 99, 10), 90);
    assert.equal(snapped(0.3000000000004, 0, 1, 0.1), 0.3);
    const ask: Ask = { kind: "number", id: "n", prompt: "How many?", min: 10, max: 1000, step: 10, note: "" };
    const low: Move | null = moveFrom("About 500, I think.", ask, 0.2, () => 0);
    const high: Move | null = moveFrom("1,000", ask, 0.2, () => 0.99);
    assert.deepEqual(low, { kind: "answer", controlId: "n", value: 400 });
    assert.deepEqual(high, { kind: "answer", controlId: "n", value: 1000 });
    assert.equal(moveFrom("no idea", ask, 0.2), null);
    const fallback: Move = fallbackMove(ask, () => 0.5);
    assert.ok(fallback.kind === "answer" && Number(fallback.value) % 10 === 0);
});

test("typed replies are cut to one clean line", () => {
    const ask: Ask = { kind: "text", id: "t", prompt: "Your word", maxLength: 6, note: "" };
    assert.deepEqual(moveFrom("\"Kettle.\"\nBecause it's hot", ask, 0), { kind: "answer", controlId: "t", value: "Kettle" });
    assert.equal(moveFrom("  \n", ask, 0), null);
});

test("guest names are labelled, pass the nickname check, and aren't the host", () => {
    assert.equal(new Set(GUEST_PERSONAS.map((persona: GuestPersona) => persona.name)).size, 4);
    for (const persona of GUEST_PERSONAS) {
        assert.ok(persona.name.endsWith(" the AI"));
        assert.equal(nicknameCategory(persona.name, HOST_NAME), null);
        assert.equal(persona.name.toLowerCase().includes(HOST_NAME.toLowerCase()), false);
    }
});

test("only the games cleared for guests say they take them", () => {
    const offered: Record<string, string> = Object.fromEntries(CATALOG.games.flatMap((game) => (game.meta.guests === undefined ? [] : [[game.meta.id, game.meta.guests]])));
    assert.deepEqual(offered, { offByAMile: "model", samePage: "model", strayWord: "model", underTheCup: "model", whoFits: "random" });
});

/**
 * Starts a real game from its blueprint, with its model content left out.
 * @param gameId the game.
 * @param names the seats.
 * @returns the cartridge and the state after the deal.
 */
function dealt(gameId: string, names: string[]): { cartridge: Cartridge<unknown>; state: unknown } {
    const blueprint = CATALOG.games.find((game) => game.meta.id === gameId)?.blueprint;
    assert.ok(blueprint !== undefined);
    const cartridge: Cartridge<unknown> = createKitGame(blueprint, Math.random, KITS).cartridge;
    const players = names.map((name: string, index: number) => ({ playerId: `p${index + 1}`, name }));
    return { cartridge, state: cartridge.init(players, {}).state };
}

/**
 * The prompt one seat's guest would be given, however little is being asked of it.
 * @param controls that seat's controls.
 * @returns the whole prompt as text.
 */
function promptFor(controls: Control[]): string {
    const view: PhoneView = viewOf(controls);
    const ask: Ask = askIn(view) ?? { kind: "text", id: "x", prompt: "?", maxLength: 10, note: "" };
    return JSON.stringify(guestPrompt(QUICK, view, [], ask));
}

test("under the cup: a guest's prompt holds its own dice and nobody else's", () => {
    const { cartridge, state } = dealt("underTheCup", ["Teacup", "Pip the AI", "Moth the AI"]);
    const cards: string[] = ["p1", "p2", "p3"].map((playerId: string) => {
        const card: Control | undefined = cartridge.privateControls(state, playerId).find((control: Control) => control.type === "roleCard");
        assert.ok(card?.type === "roleCard");
        return card.body;
    });
    assert.ok(/\d/.test(cards[0] ?? ""));
    for (const [index, playerId] of ["p1", "p2", "p3"].entries()) {
        const prompt: string = promptFor(cartridge.privateControls(state, playerId));
        for (const [other, card] of cards.entries()) {
            if (card === cards[index]) {
                assert.ok(other === index || prompt.includes(card));
                continue;
            }
            assert.equal(prompt.includes(card), false, `seat ${index} saw seat ${other}'s dice`);
        }
    }
});

test("no guest's prompt holds anything the host alone is told", () => {
    const { cartridge, state } = dealt("underTheCup", ["Teacup", "Pip the AI", "Moth the AI"]);
    const prompt: string = promptFor(cartridge.privateControls(state, "p2"));
    for (const fact of cartridge.hostFacts(state, { kind: "host" })) {
        assert.equal(prompt.includes(fact.text), false);
    }
});

test("stray word: the Stray guest's prompt never holds the word, and the host's facts stay with the host", () => {
    const { cartridge, state: started } = dealt("strayWord", ["Teacup", "Pip the AI", "Bramble the AI", "Moth the AI"]);
    const written: string = "FRUIT\nmango\nkiwi\nplum\ngrape\npear\nlemon\nlime\npeach";
    const ready: unknown = cartridge.onEvent(started, { type: "contentReady", at: 0, text: written }).state;
    const secret: ScopedFact | undefined = cartridge.hostFacts(ready, { kind: "host" }).find((fact: ScopedFact) => fact.kind === "word");
    const word: string = /The word is: (.+)\.$/.exec(secret?.text ?? "")?.[1] ?? "";
    assert.notEqual(word, "");
    let strays: number = 0;
    for (const playerId of ["p1", "p2", "p3", "p4"]) {
        const prompt: string = promptFor(cartridge.privateControls(ready, playerId)).toLowerCase();
        const isStray: boolean = prompt.includes("everyone else knows the word");
        strays += isStray === true ? 1 : 0;
        assert.equal(prompt.includes(word.toLowerCase()), isStray === false, `seat ${playerId}, stray ${isStray}`);
        assert.equal(prompt.includes("the word is:"), false);
    }
    assert.equal(strays, 1);
});

test("a choice between people reaches the model in a mixed-up order, and the reply still lands on the right one", async () => {
    const played: Played = { pressed: [], answered: [] };
    let shown: string = "";
    const model: GuestModel = (messages) => {
        shown = messages.at(-1)?.content ?? "";
        return Promise.resolve("1");
    };
    const vote: Control = { type: "choice", prompt: "Who?", multiple: false, options: [{ id: "a", label: "Ann" }, { id: "b", label: "Bob" }, { id: "c", label: "Cleo" }] };
    new GuestDriver(seatFor(played), model, () => 0).see(viewOf([vote]));
    await settle();
    assert.ok(shown.includes("1. Bob"));
    assert.deepEqual(played.pressed, ["b"]);
});
