// Plays a game for a set time with simple scripted players and reports dollars per minute by
// service, read from the owner's spend page. Run a room with COST_LIMITS=1, COST_DIR, COST_OWNER_CODE
// and GAME_ROOM_TEXT_ONLY=1, then: GAME="Quizmaster" PLAYERS=4 MINUTES=3 ROOM_URL=ws://localhost:8751 node tools/cost-play.ts
// One player says something every fifteen seconds; every player answers whatever their phone asks.

import { FakePhone, FakeScreen, waitFor } from "./simulate.ts";

const GAME: string = process.env.GAME ?? "Quizmaster";
const PLAYERS: number = Number(process.env.PLAYERS ?? 1);
const MINUTES: number = Number(process.env.MINUTES ?? 3);
const HTTP_URL: string = (process.env.ROOM_URL ?? "ws://localhost:8740").replace(/^ws/, "http");
const NAMES: string[] = ["Sam", "Alex", "Rio", "Jo", "Kit", "Ash"];
const LINES: string[] = ["Is it something you could hold?", "Hmm, tell us more.", "Is it alive?", "I think I know this one.", "Could it be bigger than a car?", "That's a tricky one."];
const WORDS: string[] = ["lantern", "copper", "harbour", "juniper", "velvet", "mustard", "gravel", "tinsel"];

/** Reads the day's spend. */
async function spend(): Promise<Record<string, unknown>> {
    const response: Response = await fetch(`${HTTP_URL}/owner/spend`, { headers: { "x-owner-code": process.env.COST_OWNER_CODE ?? "" } });
    return await response.json() as Record<string, unknown>;
}

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const phones: FakePhone[] = [];
for (const name of NAMES.slice(0, PLAYERS)) {
    const phone: FakePhone = new FakePhone(screen.code, name);
    phones.push(phone);
    await waitFor(() => phone.view !== null, "a phone to join");
}
const first: FakePhone | undefined = phones[0];
if (first === undefined) {
    throw new Error("PLAYERS must be at least 1.");
}
const beforeGame: Record<string, unknown> = await spend();
await first.startGame(screen, GAME);
const startedAt: number = Date.now();
const said: { count: number } = { count: 0 };
const acted: WeakMap<FakePhone, string> = new WeakMap();

// Keeps the game moving: answers setup menus, buttons and text boxes as they appear.
const actions: NodeJS.Timeout = setInterval(() => {
    const menu: string[] = screen.shell?.menu ?? [];
    if (screen.shell?.screen === "setup") {
        const start: number = menu.indexOf("Just start");
        first.nav({ kind: "choose", index: start >= 0 ? start : 0 });
    }
    for (const phone of phones) {
        const fingerprint: string = JSON.stringify(phone.view?.controls ?? []);
        if (acted.get(phone) === fingerprint) {
            continue;
        }
        acted.set(phone, fingerprint);
        const box = phone.view?.controls.find((control) => control.type === "textInput");
        if (box !== undefined) {
            phone.answer(box.id, WORDS[Math.floor(Math.random() * WORDS.length)] ?? "lantern");
            continue;
        }
        const options = phone.options();
        const pick = options[Math.floor(Math.random() * options.length)];
        if (pick !== undefined) {
            phone.press(pick.label);
        }
    }
}, 3000);
const talk: NodeJS.Timeout = setInterval(() => {
    said.count += 1;
    phones[said.count % phones.length]?.say(LINES[said.count % LINES.length] ?? "Hm.");
}, 15000);
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, MINUTES * 60000); });
clearInterval(actions);
clearInterval(talk);
const summary: Record<string, unknown> = await spend();
console.log(JSON.stringify({ game: GAME, players: PLAYERS, minutes: (Date.now() - startedAt) / 60000, said: said.count, hostLines: screen.hostLines.length, title: screen.title(), beforeGameDollars: beforeGame.siteDollars, beforeGameByService: beforeGame.byService, ...summary }));
process.exit(0);
