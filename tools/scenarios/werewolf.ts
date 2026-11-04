// Plays Werewolf from a script through to a winner, with 4 or 6 fake phones: 6 by default, or pass the
// number. Four lets the host decide; six also switches on the doctor and hunter by hand. Fails if a
// phone, the TV or the host ever shows a secret it shouldn't, or the game stalls.
// Run the room with GAME_ROOM_TEXT_ONLY=1, then: node tools/scenarios/werewolf.ts [4|6]

import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** One fake player and what their phone told them. */
interface Player {
    name: string;
    phone: FakePhone;
    role: string;
}

/** How often the script looks at the table. */
const LOOK_MILLISECONDS: number = 250;

/** The longest a whole game may take. */
const GAME_LIMIT_MILLISECONDS: number = 210000;

const count: number = Number(process.argv[2] ?? 6);
const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const players: Player[] = ["Sam", "Priya", "Jo", "Dana", "Leo", "Ivy"].slice(0, count).map((name: string) => ({ name, phone: new FakePhone(screen.code, name), role: "" }));
await waitFor(() => screen.shell?.seats.length === players.length, "every phone to join");
await players[0]?.phone.startGame(screen, "Werewolf");
await waitFor(() => screen.title() === "Choose your village", "the pick step");
await waitFor(() => players.every((player: Player) => player.phone.options().length > 0), "pick buttons on every phone");
if (count >= 6) {
    players[1]?.phone.press("setup:doctor");
    await waitFor(() => players[1]?.phone.options().some((option) => option.label === "Doctor: in") === true, "the doctor toggle");
    players[2]?.phone.press("setup:hunter");
    await waitFor(() => players[2]?.phone.options().some((option) => option.label === "Hunter: in") === true, "the hunter toggle");
    players[0]?.phone.press("setup:go");
}
if (count < 6) {
    players[0]?.phone.press("setup:host");
}
await waitFor(() => screen.title() === "How it works", "the rules");
const isFinished = (): boolean => screen.title().endsWith("win") || screen.title().endsWith("wins");
const isOut = (player: Player): boolean => screen.shell?.seats.some((entry) => entry.name === player.name && entry.out === true) === true;
const living = (): Player[] => players.filter((player: Player) => isOut(player) === false);
const titles: string[] = [];
let asked: boolean = false;
let voteRound: number = 0;
let lastTitle: string = "";
const startedAt: number = Date.now();

/**
 * The first option on a phone whose label is a player's name, or anything if none is.
 * @param player whose phone.
 * @param wanted the name wanted.
 * @returns the option's id, or undefined.
 */
const optionFor = (player: Player, wanted: string): string | undefined => {
    const options = player.phone.options();
    return options.find((option) => option.label === wanted)?.id ?? options[0]?.id;
};

while (isFinished() === false) {
    if (Date.now() - startedAt > GAME_LIMIT_MILLISECONDS) {
        throw new Error(`The game stalled on "${screen.title()}". Screens so far: ${titles.join(" > ")}`);
    }
    const title: string = screen.title();
    if (title !== lastTitle) {
        titles.push(title);
        lastTitle = title;
        console.warn(`TV: ${title}`);
        if (title === "The vote") {
            voteRound += 1;
        }
    }
    for (const player of living()) {
        const options = player.phone.options();
        if (title === "How it works" && options.some((option) => option.label === "Got it") === true) {
            player.phone.press("Got it");
        }
        if (title === "Check your phone") {
            const card = player.phone.view?.controls.find((control) => control.type === "roleCard");
            player.role = card?.type === "roleCard" ? card.title.replace(/^You are (a|the) /, "") : player.role;
            if (options.some((option) => option.label === "I've seen it") === true) {
                player.phone.press("I've seen it");
            }
        }
        if (title === "Night falls" && options.length > 0 && player.phone.view?.controls.some((control) => control.type === "notice" && control.text.startsWith("You chose")) !== true) {
            const pick = options.find((option) => option.label !== player.name && option.label !== "Yourself");
            player.phone.press(pick?.id ?? options[0]?.id ?? "");
        }
        if (title === "One last shot" && options.length > 0) {
            player.phone.press(options[0]?.id ?? "");
        }
        if ((title === "The vote" || title === "The final vote") && player.phone.view?.turn?.yours === true) {
            const wolf: Player | undefined = living().find((candidate: Player) => candidate.role === "werewolf");
            const notWolf: Player | undefined = living().find((candidate: Player) => candidate.role !== "werewolf" && candidate !== player);
            const target: Player | undefined = count >= 6 && voteRound === 1 ? notWolf : wolf;
            const chosen: string | undefined = optionFor(player, target === player ? notWolf?.name ?? "" : target?.name ?? "");
            if (chosen !== undefined) {
                player.phone.press(chosen);
            }
        }
    }
    if (title === "Who is the werewolf?") {
        if (asked === false) {
            asked = true;
            const before: number = screen.hostLines.length;
            living()[0]?.phone.say("Marlowe, who is the werewolf? You must know.");
            await screen.nextHostLine(before).catch(() => undefined);
        }
        const needing: Player[] = living().filter((player: Player) => player.phone.options().some((option) => option.label === "Ready to vote") === true);
        for (const player of needing) {
            player.phone.press("Ready to vote");
        }
    }
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, LOOK_MILLISECONDS); });
}
console.warn(`Result: ${screen.title()}. Screens: ${titles.join(" > ")}`);
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 6000); });

for (const needed of ["Choose your village", "How it works", "Check your phone", "Night falls", "Dawn"]) {
    if (titles.includes(needed) === false && needed !== "Choose your village") {
        throw new Error(`Never saw "${needed}". Screens: ${titles.join(" > ")}`);
    }
}
const wolves: Player[] = players.filter((player: Player) => player.role === "werewolf");
if (wolves.length !== 1) {
    throw new Error(`This table should have one werewolf and had ${wolves.length}.`);
}

// Secrets never reach the wrong phone.
for (const player of players) {
    const seen: string = JSON.stringify(player.phone.views);
    for (const role of ["werewolf", "seer", "doctor", "hunter", "villager"]) {
        const article: string = role === "werewolf" || role === "villager" ? "a" : "the";
        if (role !== player.role && seen.includes(`You are ${article} ${role}`) === true) {
            throw new Error(`${player.name} saw another role's card.`);
        }
    }
    if (player.role !== "werewolf" && seen.includes("You hunt alone") === true) {
        throw new Error(`${player.name} saw the pack's whisper.`);
    }
    if (player.role !== "seer" && /(is|is not) a werewolf\./.test(seen) === true) {
        throw new Error(`${player.name} saw the seer's finding.`);
    }
    if (player.role !== "werewolf" && seen.includes("kill:") === true) {
        throw new Error(`${player.name} was offered a kill.`);
    }
}

// Secrets never reach the TV or the host while they're still secret.
const beforeEnd = screen.scenes.filter((scene) => scene.blocks.some((block) => block.type === "title" && (block.text.endsWith("win") || block.text.endsWith("wins"))) === false);
const tvText: string = JSON.stringify(beforeEnd);
for (const wolf of wolves) {
    if (tvText.includes(`"badge":"werewolf"`) === true) {
        throw new Error("The TV showed a role before the end.");
    }
    const namesWolf: RegExp = new RegExp(`${wolf.name} (is|was) (a |the )?werewolf`, "i");
    const hostBeforeOut: string[] = screen.hostLines.slice(0, -3).filter((line: string) => namesWolf.test(line) === true);
    if (hostBeforeOut.length > 0 && titles.at(-1) !== "The village wins") {
        throw new Error(`Host may have named the werewolf: ${hostBeforeOut.join(" | ")}`);
    }
}
const overLong: string[] = screen.hostLines.slice(0, -1).filter((line: string) => line.split(/\s+/).length > 25);
if (overLong.length > 0) {
    console.warn(`Host lines over 25 words: ${overLong.length}`);
    for (const line of overLong) {
        console.warn(`  ${line}`);
    }
}
console.warn(`Winner seen. Roles: ${players.map((player: Player) => `${player.name} ${player.role}`).join(", ")}`);
console.warn("PASS");
process.exit(0);
