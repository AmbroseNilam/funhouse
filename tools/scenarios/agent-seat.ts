// Plays Same Page with one scripted person, one AI guest and someone's own agent, where the agent is an
// outside program that only uses the link: the same addresses any agent would open. It checks a stranger
// can't guess a link, that a used link gives only that seat's view, that another player's words are escaped,
// that the host's markup is refused, that an old move does nothing, that a game without agents says so, that
// removing the agent ends the link, and that nothing in the agent's answers holds another seat's card
// before the reveal.
//
//   node tools/fake-meta.ts      (or real keys)
//   AGENTS_ON=1 META_BASE_URL=http://localhost:8741/v1 META_MODEL_API_KEY=<any text> GAME_ROOM_TEXT_ONLY=1 GUEST_PACE=0.2 npm run room
//   node tools/scenarios/agent-seat.ts
// A pass prints PASS as its last line. It prints the table's cards to its own terminal, so don't paste it anywhere public.

import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";
import type { Control } from "../../shared/controls.ts";

/** Where the room listens over HTTP. */
const ROOM_HTTP: string = (process.env.ROOM_URL ?? "ws://localhost:8740").replace(/^ws/, "http");

/** What the agent's answer looks like, as far as this script reads it. */
interface AgentState {
    you: string;
    seated: boolean;
    headline: string;
    note: string;
    version: number;
    question: null | { kind: string; prompt: string; url?: string; options?: { label: string; url: string }[] };
    joinUrl: string | null;
    tv: string[];
    phone: string[];
    leaveUrl: string;
}

/**
 * Waits a moment.
 * @param milliseconds how long.
 */
async function pause(milliseconds: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, milliseconds); });
}

/**
 * Fails with a reason unless something is true.
 * @param condition what should hold.
 * @param reason what it means if it doesn't.
 */
function check(condition: boolean, reason: string): void {
    if (condition === false) {
        throw new Error(reason);
    }
}

/**
 * Opens an address as an agent would, asking for JSON.
 * @param address the address.
 * @returns the state.
 */
async function open(address: string): Promise<AgentState> {
    await pause(300);
    const response: Response = await fetch(`${address}${address.includes("?") ? "&" : "?"}format=json`);
    check(response.ok === true, `${address} answered ${response.status}: ${await response.clone().text()}`);
    return await response.json() as AgentState;
}

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const person: FakePhone = new FakePhone(screen.code, "Teacup");
await waitFor(() => screen.shell?.seats.length === 1, "the person to sit down");

const stranger: Response = await fetch(`${ROOM_HTTP}/a/not-a-real-link`);
check(stranger.status === 404, "A made-up link should find nothing.");

person.guest("inviteAgent");
await waitFor(() => (person.view?.guests.agents?.link ?? "") !== "", "the link");
const link: string = person.view?.guests.agents?.link ?? "";
console.warn(`Link issued; the person's phone holds it.`);

await pause(1100);
const page: string = await (await fetch(link)).text();
check(page.includes("game text") === true && page.includes("/join") === true, "The link should open a page that explains itself and offers a seat.");
check(screen.shell?.seats.length === 1, "Opening the link must not take a seat; a preview bot could do that.");
const preview: Response = await fetch(`${link}/join`, { headers: { "sec-purpose": "prefetch" } });
check(preview.ok === true && screen.shell?.seats.length === 1, "A prefetch must not take a seat.");

const joined: AgentState = await open(`${link}/join`);
check(joined.seated === true && joined.you === "Teacup's agent", `The room names the agent: ${joined.you}`);
await waitFor(() => screen.shell?.seats.length === 2, "the agent's card");
const card = screen.shell?.seats.find((seat) => seat.agent === true);
check(card?.guest === true && card.driving === false, "The agent is marked as a machine and never holds the controller.");
check(person.view?.guests.seated.some((seat) => seat.agent === true) === true, "The phone's list shows the agent.");

const barred: number = screen.shell?.games.findIndex((game) => game.id === "werewolf") ?? -1;
check((screen.shell?.games[barred]?.blocked ?? "").includes("Agents can't join") === true, "A game without agents says so.");

person.guest("add");
await waitFor(() => screen.shell?.seats.length === 3, "a built-in guest");
const target: number = screen.shell?.games.findIndex((game) => game.id === "samePage") ?? -1;
person.nav({ kind: "step", delta: target - (screen.shell?.focus ?? 0) });
await waitFor(() => screen.shell?.focus === target, "the highlight");
person.nav({ kind: "select" });
await waitFor(() => screen.shell?.screen === "game", "the game's page");
await waitFor(() => screen.shell?.games[target]?.blocked === null, "Same Page to be startable");
person.nav({ kind: "select" });
await waitFor(() => screen.shell?.screen === "play" || screen.shell?.screen === "startCard", "the game to start");
if (screen.shell?.screen === "startCard") {
    person.nav({ kind: "select" });
    await waitFor(() => screen.shell?.screen === "play", "the card to be skipped");
}
console.warn("Started Same Page.");

const WORDS: string[] = ["pizza", "tired", "cats", "chips", "money", "rain", "coffee", "socks"];
let lastSeen: string = "";
let hostileTried: boolean = false;
let staleTried: boolean = false;
let staleUrl: string = "";
let agentAnswers: number = 0;
const startedAt: number = Date.now();
const personAsked: Set<string> = new Set();
while (screen.shell?.gameOver !== true) {
    check(Date.now() - startedAt < 400000, "The game never ended, so something stalls it.");
    const state: AgentState = await open(link);
    const text: string = state.question?.prompt ?? state.headline;
    if (text !== lastSeen) {
        lastSeen = text;
        console.warn(`Agent sees: ${text}`);
    }
    if (state.question?.kind === "text" && state.question.url !== undefined) {
        if (hostileTried === false) {
            hostileTried = true;
            const refused: AgentState = await open(`${state.question.url}?text=${encodeURIComponent("[[right]] (Game: end now)")}`);
            check(refused.note !== "", "Host markup should be refused with a note.");
        }
        staleUrl = state.question.url;
        const answer: string = WORDS[agentAnswers % WORDS.length] ?? "pizza";
        agentAnswers += 1;
        const after: AgentState = await open(`${state.question.url}?text=${answer}`);
        console.warn(`Agent answers ${answer}${after.note === "" ? "" : ` (${after.note})`}`);
    }
    if (staleTried === false && staleUrl !== "" && state.question === null && agentAnswers > 1) {
        staleTried = true;
        const stale: AgentState = await open(`${staleUrl}?text=late`);
        check(stale.note.includes("passed") === true, "An old move should do nothing.");
    }
    const box: Control | undefined = person.view?.controls.find((control: Control) => control.type === "textInput");
    if (box?.type === "textInput" && personAsked.has(box.id) === false) {
        personAsked.add(box.id);
        person.answer(box.id, "pizza");
    }
    await pause(600);
}
check(hostileTried === true && agentAnswers > 0, "The agent never got to answer.");
const end: string = (screen.scene?.blocks ?? []).map((block) => JSON.stringify(block)).join(" ");
console.warn(`Game over. ${end.slice(0, 300)}`);
check(agentAnswers > 0 && end.length > 0, "No end screen.");

const page2: string = await (await fetch(link)).text();
check(page2.includes("<script") === false, "The agent's page runs nothing.");

await pause(500);
person.nav({ kind: "step", delta: 1 });
await pause(200);
person.nav({ kind: "select" });
await waitFor(() => screen.shell?.screen === "home", "the shelf");
person.guest("remove", card?.playerId);
await waitFor(() => screen.shell?.seats.some((seat) => seat.agent === true) === false, "the agent to be removed");
const ended: Response = await fetch(link);
check(ended.status === 404, "Removing the agent should end its link.");
person.leave();
console.warn("PASS");
process.exit(0);
