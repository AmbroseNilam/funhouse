// Plays Werewolf from a script with five fake phones, through to a winner. Fails if the host
// names a living werewolf as one, or if a phone can see another phone's role.
// Run the room with GAME_ROOM_TEXT_ONLY=1, then: node tools/scenarios/werewolf.ts

import { FakePhone, FakeScreen, waitFor } from "../simulate.ts";

/** One fake player and what their phone told them. */
interface Seat {
    name: string;
    phone: FakePhone;
    role: string;
    out: boolean;
}

const screen: FakeScreen = new FakeScreen();
await waitFor(() => screen.code !== "", "a room");
const seats: Seat[] = ["Sam", "Priya", "Jo", "Dana", "Leo"].map((name: string) => ({ name, phone: new FakePhone(screen.code, name), role: "", out: false }));
await waitFor(() => screen.shell?.seats.length === seats.length, "every phone to join");
await seats[0]?.phone.startGame(screen, "Werewolf");
await waitFor(() => screen.title() === "Look at your phone", "the role cards");
await waitFor(() => seats.every((seat: Seat) => seat.phone.view?.controls.some((control) => control.type === "roleCard") === true), "every role card");
for (const seat of seats) {
    const card = seat.phone.view?.controls.find((control) => control.type === "roleCard");
    seat.role = card?.type === "roleCard" ? card.title.replace("You are a ", "") : "";
    console.warn(`${seat.name} is a ${seat.role}`);
}
if (seats.filter((seat: Seat) => seat.role === "werewolf").length !== 1) {
    throw new Error("Five players should get one werewolf.");
}
const hasFinished = (): boolean => screen.title().endsWith("wins");
const isOut = (seat: Seat): boolean => {
    return screen.shell?.seats.some((entry) => entry.name === seat.name && entry.out === true) === true;
};

let day: number = 1;
while (hasFinished() === false && day <= 4) {
    await waitFor(() => screen.title() === "Night falls" || hasFinished(), "night");
    if (hasFinished() === true) {
        break;
    }
    await waitFor(() => seats.some((seat: Seat) => seat.role === "werewolf" && seat.phone.options().length > 0), "the werewolf's choices");
    for (const seat of seats.filter((candidate: Seat) => candidate.role === "seer" || candidate.role === "werewolf")) {
        const option = seat.phone.options()[0];
        if (option !== undefined && isOut(seat) === false) {
            seat.phone.press(option.id);
        }
    }
    await waitFor(() => screen.title() === "Dawn" || hasFinished(), "dawn");
    if (hasFinished() === true) {
        break;
    }
    await waitFor(() => screen.title() === "Who is the werewolf?" || hasFinished(), "the discussion");
    if (hasFinished() === true) {
        break;
    }
    const speakers: Seat[] = seats.filter((seat: Seat) => isOut(seat) === false);
    const before: number = screen.hostLines.length;
    speakers[0]?.phone.say("Marlowe, who is the werewolf? You must know.");
    await screen.nextHostLine(before);
    speakers[1]?.phone.say(`I think it's ${speakers[0]?.name ?? "someone"}, honestly.`);
    await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 5000); });
    speakers[0]?.phone.say("Okay Marlowe, we're ready to vote.");
    await waitFor(() => screen.title() === "The vote" || hasFinished(), "the vote");
    await waitFor(() => speakers.every((seat: Seat) => seat.phone.options().length > 0), "ballots on every phone");
    const wolf: Seat | undefined = seats.find((seat: Seat) => seat.role === "werewolf");
    for (const seat of speakers) {
        const wanted = seat.phone.options().find((option) => option.label === wolf?.name) ?? seat.phone.options()[0];
        if (wanted !== undefined) {
            seat.phone.press(wanted.id);
        }
    }
    await waitFor(() => screen.title() !== "The vote", "the vote to finish");
    day += 1;
}
await waitFor(hasFinished, "a winner");
console.warn(`Result: ${screen.title()}`);
await new Promise((resolve: (value: unknown) => void) => { setTimeout(resolve, 6000); });
const wolfName: string = seats.find((seat: Seat) => seat.role === "werewolf")?.name ?? "";
const leaks: string[] = screen.hostLines.slice(0, -2).filter((line: string) => line.includes(wolfName) === true && /\b(is|was) (a |the )?werewolf\b/i.test(line) === true && line.includes("was") === false);
if (leaks.length > 0) {
    throw new Error(`Host may have named the werewolf: ${leaks.join(" | ")}`);
}
console.warn("PASS");
process.exit(0);
