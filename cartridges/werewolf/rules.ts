// Werewolf's rules core: an immutable state and pure transitions. The host never touches
// this; it narrates the facts these functions emit, each carrying a visibility scope. The
// room drives phases by applying player actions and events through the Cartridge interface.
// The order of play and the role sets are explained in docs/werewolf-v2-design.md.

import { HOST_NAME } from "../../shared/brand.ts";
import type { Turn } from "../../shared/turn.ts";
import type { Cartridge, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../shared/controls.ts";
import type { Scene, SceneBlock, TallyRow } from "../../shared/scene.ts";
import { START_PICK_SEPARATOR, type StartPick } from "../../shared/shell.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { WEREWOLF_MANIFEST } from "./manifest.ts";

/** Roles a player can hold. */
export type Role = "werewolf" | "villager" | "seer" | "doctor" | "hunter";

/** Game phases, in play order; "end" is terminal. */
export type Phase = "intro" | "roles" | "night" | "dawn" | "discussion" | "vote" | "verdict" | "hunter" | "end";

/** Everything about one seat. */
export interface Seat {
    playerId: string;
    name: string;
    role: Role;
    alive: boolean;
    /** True when they left the table, which ends their game without announcing their role. */
    left?: boolean;
}

/** Which special roles the village will have. */
export interface RoleSetup {
    seer: boolean;
    doctor: boolean;
    hunter: boolean;
}

/** What the TV turns over for the last thing that happened; everything in it is public. */
export interface PublicMoment {
    kind: "dawn" | "out" | "shot" | "calm";
    heading: string;
    detail?: string;
}

/** The whole game, immutable between steps. */
export interface WerewolfState {
    phase: Phase;
    round: number;
    seats: Seat[];
    variants: Record<string, boolean>;
    /** The clock chosen before the game, or null when the day waits for people. */
    pace: Pace | null;
    /** Who has tapped through the current intro or role card. */
    tappedThrough: string[];
    /** Werewolf votes for tonight's victim, keyed by werewolf player id. */
    nightChoices: Record<string, string>;
    /** The seer's chosen target tonight, if any. */
    seerTarget: string | null;
    /** Who the doctor is protecting tonight, if anyone. */
    doctorTarget: string | null;
    /** Who the doctor protected last night, who can't be protected twice running. */
    lastProtected: string | null;
    /** True once everyone with a night action has chosen; the night then runs out a short hold. */
    nightSettled: boolean;
    /** Day votes, keyed by voter player id. */
    dayVotes: Record<string, string>;
    /** The tied players in a runoff, or null in a first vote. */
    runoff: string[] | null;
    /** The hunter taking a last shot, if any. */
    hunterId: string | null;
    /** The phase to go on to after the hunter's shot. */
    afterShot: "dawn" | "verdict";
    /** What the TV turns over, for dawn, a verdict or a shot. */
    moment: PublicMoment | null;
    /** The final count of the last vote. */
    lastTally: TallyRow[];
    /** Who the eliminated think the werewolf is, keyed by their player id. */
    ghostGuesses: Record<string, string>;
    /** Who died at the last dawn, for narration. */
    lastVictim: string | null;
    /** Who was voted out last, for narration. */
    lastLynched: string | null;
    winner: "werewolves" | "villagers" | null;
    /** Pictures drawn for this game, by id; the game plays fine without them. */
    art: Record<string, string>;
}

/** Starts the id of a call only the controller's holder can make; the rest names the phase. */
const HOLDER_ACTION: string = "holder:";

/** Group id shared by the werewolves, for group-scoped facts and controls. */
export const WEREWOLF_GROUP: string = "werewolves";

/** Seconds the night waits for choices before going on with what it has. */
export const NIGHT_SECONDS: number = 45;

/** Seconds a night holds after the last choice, so a change of mind works and timing gives little away. */
export const NIGHT_SETTLE_SECONDS: number = 6;

/** Seconds to choose again when someone leaving undoes a night's choices. */
export const NIGHT_RECHOOSE_SECONDS: number = 20;

/** Seconds for the dawn announcement before discussion opens. */
export const DAWN_SECONDS: number = 12;

/** Seconds the verdict stays on the TV. */
export const VERDICT_SECONDS: number = 10;

/** How long each untimed moment gets when the table chooses a clock. */
export interface Pace {
    intro: number;
    roles: number;
    discussion: number;
    vote: number;
    runoff: number;
    hunter: number;
}

/** The clocks a table can choose; with none, the day waits for people and the holder moves it on. */
export const PACES: Record<string, Pace> = {
    relaxed: { intro: 45, roles: 35, discussion: 300, vote: 60, runoff: 40, hunter: 30 },
    normal: { intro: 30, roles: 25, discussion: 180, vote: 45, runoff: 30, hunter: 20 },
    quick: { intro: 25, roles: 20, discussion: 120, vote: 30, runoff: 20, hunter: 15 },
};

/** The id of the village the host suggests for the table. */
const HOST_VILLAGE: string = "host";

/** Players needed before there's a choice of village; a small table moves too far on one role. */
export const TOGGLES_FROM_PLAYERS: number = 6;

/** Shared look for every picture in a game, so they read as one village. */
const ART_STYLE: string = "A painted storybook illustration of a small timber village in the woods, wide view, rich and moody, no people's faces, no text or letters.";

/** The pictures a game draws at the start, before anything needs them. */
const ART_PROMPTS: { id: string; prompt: string }[] = [
    { id: "night", prompt: `${ART_STYLE} Deep blue night, full moon, every window dark, something moving between the trees.` },
    { id: "dawn", prompt: `${ART_STYLE} Cold pink dawn, mist in the lanes, a single door hanging open.` },
    { id: "day", prompt: `${ART_STYLE} Overcast afternoon, the village square, a long table with empty chairs, tension in the air.` },
    { id: "villagers", prompt: `${ART_STYLE} Golden morning, lanterns and bunting across the square, a wolf's shadow fleeing into the distance.` },
    { id: "werewolves", prompt: `${ART_STYLE} Blood-red moon, the village abandoned, wolf silhouettes howling on the rooftops.` },
];

/**
 * Names the clock for one night, the same on the TV and every phone.
 * @param state the night.
 * @returns the name.
 */
function nightClock(state: WerewolfState): string {
    return `night-${state.round}`;
}

/**
 * Deterministic shuffle so tests can replay a seating.
 * @param items the list to shuffle.
 * @param random a function returning [0, 1).
 * @returns a new shuffled array.
 */
export function shuffle<Item>(items: readonly Item[], random: () => number): Item[] {
    const copy: Item[] = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap: number = Math.floor(random() * (index + 1));
        const held: Item | undefined = copy[index];
        const other: Item | undefined = copy[swap];
        if (held === undefined || other === undefined) {
            continue;
        }
        copy[index] = other;
        copy[swap] = held;
    }
    return copy;
}

/**
 * Number of werewolves for a table size: one up to six players, two up to nine, three at ten.
 * @param playerCount seats at the table.
 * @returns werewolf count.
 */
export function werewolfCount(playerCount: number): number {
    if (playerCount <= 6) {
        return 1;
    }
    return playerCount <= 9 ? 2 : 3;
}

/**
 * The special roles the host picks for a table size.
 * @param playerCount seats at the table.
 * @returns the setup.
 */
export function presetSetup(playerCount: number): RoleSetup {
    return { seer: true, doctor: playerCount >= 7, hunter: playerCount >= 9 };
}

/**
 * The village a choice stands for.
 * @param playerCount seats at the table.
 * @param village the choice's id: the host's pick, or which of doctor and hunter are in.
 * @returns the setup.
 */
function setupFor(playerCount: number, village: string): RoleSetup {
    const preset: RoleSetup = presetSetup(playerCount);
    return village === HOST_VILLAGE ? preset : { ...preset, doctor: village.includes("doctor") === true, hunter: village.includes("hunter") === true };
}

/**
 * What a table chooses on the TV before a game: which village at six or more, then whether to have a clock.
 * @param playerCount seats at the table.
 * @returns the first question.
 */
export function werewolfStartPick(playerCount: number): StartPick {
    const clock: StartPick = {
        prompt: "How long for each day?",
        hostLine: "Ask if they want a clock on each day. There's none unless they choose one.",
        waits: true,
        choices: [{ id: "none", label: "No timer" }, { id: "relaxed", label: "Relaxed, 5 minutes" }, { id: "normal", label: "Normal, 3 minutes" }, { id: "quick", label: "Quick, 2 minutes" }],
    };
    if (playerCount < TOGGLES_FROM_PLAYERS) {
        return clock;
    }
    const preset: RoleSetup = presetSetup(playerCount);
    const others: string[] = ["none", "doctor", "hunter", "doctor hunter"].filter((village: string) => {
        const setup: RoleSetup = setupFor(playerCount, village);
        return setup.doctor !== preset.doctor || setup.hunter !== preset.hunter;
    });
    const describe = (village: string): string => describeRoles(rolesFor(playerCount, setupFor(playerCount, village)));
    return {
        prompt: "Which village?",
        hostLine: "Say in a few words that they can choose the village on the TV, and the first is your pick.",
        waits: true,
        then: clock,
        choices: [{ id: HOST_VILLAGE, label: `${HOST_NAME}'s pick: ${describe(HOST_VILLAGE)}` }, ...others.map((village: string) => ({ id: village, label: describe(village) }))],
    };
}

/**
 * Every role in play for a table and a setup.
 * @param playerCount seats at the table.
 * @param setup the special roles.
 * @returns one role per seat, not yet shuffled.
 */
export function rolesFor(playerCount: number, setup: RoleSetup): Role[] {
    const roles: Role[] = Array.from({ length: werewolfCount(playerCount) }, (): Role => "werewolf");
    for (const special of ["seer", "doctor", "hunter"] as const) {
        if (setup[special] === true && roles.length < playerCount) {
            roles.push(special);
        }
    }
    while (roles.length < playerCount) {
        roles.push("villager");
    }
    return roles;
}

/**
 * Says the roles in play, such as "1 werewolf, 1 seer, 3 villagers". Only counts, and public.
 * @param roles every role in play.
 * @returns the line.
 */
export function describeRoles(roles: readonly Role[]): string {
    const parts: string[] = [];
    for (const role of ["werewolf", "seer", "doctor", "hunter", "villager"] as const) {
        const count: number = roles.filter((candidate: Role) => candidate === role).length;
        if (count > 0) {
            parts.push(`${count} ${count > 1 && role === "werewolf" ? "werewolves" : `${role}${count > 1 ? "s" : ""}`}`);
        }
    }
    return parts.join(", ");
}

/**
 * A role as said in a sentence, such as "a werewolf" or "the seer".
 * @param role the role.
 * @returns the words.
 */
function withArticle(role: Role): string {
    return role === "werewolf" || role === "villager" ? `a ${role}` : `the ${role}`;
}

/**
 * One line explaining what a role does, for the role card.
 * @param role the role.
 * @returns the blurb.
 */
function roleBlurb(role: Role): string {
    if (role === "werewolf") {
        return "Each night, choose a victim on this phone. By day, blend in and lie.";
    }
    if (role === "seer") {
        return "Each night, check one player. The answer appears on this card at dawn. Be careful who you tell.";
    }
    if (role === "doctor") {
        return "Each night, protect one player, yourself included, but never the same one twice running.";
    }
    if (role === "hunter") {
        return "You're a villager with one shot. When you die, you take someone with you.";
    }
    return "Find the werewolves before they find you. Argue by day, then vote.";
}

/**
 * The rules, in the order the host would give them, for the TV and every phone.
 * @param roles every role in play.
 * @returns the lines.
 */
function rulesLines(roles: readonly Role[]): string[] {
    const wolves: number = roles.filter((role: Role) => role === "werewolf").length;
    const lines: string[] = [
        wolves > 1 ? `${wolves} of you are werewolves. The rest are the village.` : "One of you is the werewolf. The rest are the village.",
        "At night, eyes close and the werewolves choose a victim on their phones.",
        "By day, argue out loud, then vote someone out.",
        wolves > 1 ? "The village wins when every werewolf is gone. The werewolves win when they match the village." : "The village wins when the werewolf is gone. The werewolf wins by matching the village.",
    ];
    const specials: string[] = [];
    if (roles.includes("seer") === true) {
        specials.push("The seer checks one player each night.");
    }
    if (roles.includes("doctor") === true) {
        specials.push("The doctor protects one.");
    }
    if (roles.includes("hunter") === true) {
        specials.push("The hunter shoots someone on dying.");
    }
    return specials.length === 0 ? lines : [...lines, specials.join(" ")];
}

/**
 * Builds the Werewolf cartridge with an injectable random source.
 * @param random a function returning [0, 1); defaults to Math.random.
 * @param pick what was chosen before the game: the village if it was asked, then the clock.
 * @returns the cartridge.
 */
export function createWerewolf(random: () => number = Math.random, pick: string = ""): Cartridge<WerewolfState> {
    const answers: string[] = pick.split(START_PICK_SEPARATOR);
    const chosenClock: string = answers.at(-1) ?? "";
    const chosenVillage: string = answers.length > 1 ? answers[0] ?? HOST_VILLAGE : HOST_VILLAGE;
    const seatOf = (state: WerewolfState, playerId: string): Seat | undefined => state.seats.find((seat) => seat.playerId === playerId);
    const alive = (state: WerewolfState): Seat[] => state.seats.filter((seat) => seat.alive === true);
    const aliveWerewolves = (state: WerewolfState): Seat[] => alive(state).filter((seat) => seat.role === "werewolf");
    const publicFact = (kind: string, text: string, quiet: boolean = false): ScopedFact => ({ scope: { kind: "public" }, kind, text, quiet });
    const nameOf = (state: WerewolfState, playerId: string): string => seatOf(state, playerId)?.name ?? "Someone";
    const paced = (state: WerewolfState, moment: keyof Pace, phase: Phase): { timers?: Record<string, number> } => (state.pace === null ? {} : { timers: { [phase]: state.pace[moment] } });

    /**
     * Checks for a winner and moves to the end phase when there is one.
     * @param state state after a death.
     * @param facts facts gathered so far.
     * @returns the finished step, or null when play continues.
     */
    const finishIfOver = (state: WerewolfState, facts: ScopedFact[]): Step<WerewolfState> | null => {
        const wolves: number = aliveWerewolves(state).length;
        const villagers: number = alive(state).length - wolves;
        if (wolves === 0) {
            const won: WerewolfState = { ...state, phase: "end", winner: "villagers" };
            return { state: won, facts: [...facts, publicFact("game-over", "The last werewolf is gone. The village wins.")], nextPhaseId: "end" };
        }
        if (wolves >= villagers) {
            const won: WerewolfState = { ...state, phase: "end", winner: "werewolves" };
            return { state: won, facts: [...facts, publicFact("game-over", "The werewolves match the village. The werewolves win.")], nextPhaseId: "end" };
        }
        return null;
    };

    /**
     * Starts a night.
     * @param state the state to start from.
     * @param round the round the night opens.
     * @param facts facts gathered so far.
     * @returns the step.
     */
    const startNight = (state: WerewolfState, round: number, facts: ScopedFact[]): Step<WerewolfState> => ({
        state: { ...state, phase: "night", round, nightChoices: {}, seerTarget: null, doctorTarget: null, nightSettled: false, dayVotes: {}, runoff: null, tappedThrough: [], moment: null, hunterId: null },
        facts: [...facts, publicFact("night", "Night falls on the village.")],
        nextPhaseId: "night",
        timers: { night: NIGHT_SECONDS },
    });

    /**
     * Opens dawn, or ends the game if the night decided it.
     * @param state state with the night's deaths applied.
     * @param facts facts gathered so far.
     * @returns the step.
     */
    const openDawn = (state: WerewolfState, facts: ScopedFact[]): Step<WerewolfState> => {
        const over: Step<WerewolfState> | null = finishIfOver(state, facts);
        if (over !== null) {
            return over;
        }
        return { state: { ...state, phase: "dawn" }, facts, nextPhaseId: "dawn", timers: { dawn: DAWN_SECONDS } };
    };

    /**
     * Opens the verdict, or ends the game if the vote decided it.
     * @param state state with the vote's death applied.
     * @param facts facts gathered so far.
     * @returns the step.
     */
    const openVerdict = (state: WerewolfState, facts: ScopedFact[]): Step<WerewolfState> => {
        const over: Step<WerewolfState> | null = finishIfOver(state, facts);
        if (over !== null) {
            return over;
        }
        return { state: { ...state, phase: "verdict" }, facts, nextPhaseId: "verdict", timers: { verdict: VERDICT_SECONDS } };
    };

    /**
     * Gives a hunter who just died their shot.
     * @param state state with the hunter dead.
     * @param hunter the hunter.
     * @param afterShot where play goes next.
     * @param facts facts gathered so far.
     * @returns the step.
     */
    const openHunter = (state: WerewolfState, hunter: Seat, afterShot: "dawn" | "verdict", facts: ScopedFact[]): Step<WerewolfState> => ({
        state: { ...state, phase: "hunter", hunterId: hunter.playerId, afterShot },
        facts: [...facts, publicFact("hunter", `${hunter.name} was the hunter, and takes one last shot.`)],
        nextPhaseId: "hunter",
        ...paced(state, "hunter", "hunter"),
    });

    /**
     * Resolves the hunter's shot, or the lack of one.
     * @param state the hunter phase.
     * @param targetId who was shot, or null when time ran out.
     * @returns the step.
     */
    const resolveShot = (state: WerewolfState, targetId: string | null): Step<WerewolfState> => {
        const hunterName: string = nameOf(state, state.hunterId ?? "");
        const target: Seat | undefined = targetId === null ? undefined : seatOf(state, targetId);
        const cleared: WerewolfState = { ...state, hunterId: null };
        if (target === undefined || target.alive === false) {
            const facts: ScopedFact[] = [publicFact("shot", `${hunterName} kept the last shot.`)];
            return cleared.afterShot === "dawn" ? openDawn(cleared, facts) : openVerdict(cleared, facts);
        }
        const roleText: string = state.variants.revealOnDeath === true ? `${target.name} was ${withArticle(target.role)}.` : "";
        const next: WerewolfState = {
            ...cleared,
            seats: state.seats.map((seat) => (seat.playerId === target.playerId ? { ...seat, alive: false } : seat)),
            moment: { kind: "shot", heading: `${hunterName} shot ${target.name}`, ...(roleText !== "" ? { detail: roleText } : {}) },
        };
        const facts: ScopedFact[] = [publicFact("shot", `${hunterName} shot ${target.name}. ${roleText}`.trim())];
        return next.afterShot === "dawn" ? openDawn(next, facts) : openVerdict(next, facts);
    };

    /**
     * Resolves the night with whatever has been chosen.
     * @param state state at the end of the night.
     * @returns the next step.
     */
    const resolveNight = (state: WerewolfState): Step<WerewolfState> => {
        const tallies: Record<string, number> = {};
        for (const target of Object.values(state.nightChoices)) {
            tallies[target] = (tallies[target] ?? 0) + 1;
        }
        const most: number = Math.max(0, ...Object.values(tallies));
        const leaders: string[] = Object.keys(tallies).filter((target: string) => tallies[target] === most);
        const chosenId: string | undefined = leaders[Math.floor(random() * leaders.length)];
        const victimId: string | null = chosenId === undefined || chosenId === state.doctorTarget ? null : chosenId;
        const seats: Seat[] = state.seats.map((seat) => (seat.playerId === victimId ? { ...seat, alive: false } : seat));
        const victim: Seat | undefined = seats.find((seat) => seat.playerId === victimId);
        const facts: ScopedFact[] = [];
        const roleText: string = victim !== undefined && state.variants.revealOnDeath === true ? ` ${victim.name} was ${withArticle(victim.role)}.` : "";
        if (victim !== undefined) {
            facts.push(publicFact("dawn", `${victim.name} did not survive the night.${roleText}`));
        }
        if (victim === undefined) {
            facts.push(publicFact("dawn", "Everyone survived the night."));
        }
        if (state.seerTarget !== null) {
            const seer: Seat | undefined = alive(state).find((seat) => seat.role === "seer");
            const target: Seat | undefined = seatOf(state, state.seerTarget);
            if (seer !== undefined && target !== undefined) {
                const verdict: string = target.role === "werewolf" ? "is a werewolf" : "is not a werewolf";
                facts.push({ scope: { kind: "player", playerId: seer.playerId }, kind: "seer-result", text: `${target.name} ${verdict}.` });
            }
        }
        const moment: PublicMoment = victim === undefined
            ? { kind: "calm", heading: "Everyone survived the night" }
            : { kind: "dawn", heading: `${victim.name} did not survive the night`, ...(roleText !== "" ? { detail: roleText.trim() } : {}) };
        const dawn: WerewolfState = { ...state, seats, nightChoices: {}, seerTarget: null, lastProtected: state.doctorTarget, doctorTarget: null, nightSettled: false, dayVotes: {}, lastVictim: victim?.name ?? null, moment };
        if (victim?.role === "hunter") {
            return openHunter(dawn, victim, "dawn", facts);
        }
        return openDawn(dawn, facts);
    };

    /**
     * Resolves the day vote with whatever is in. A first tie goes to one runoff; a second means nobody.
     * @param state state at the end of the vote.
     * @returns the next step.
     */
    const resolveVote = (state: WerewolfState): Step<WerewolfState> => {
        const tallies: Record<string, number> = {};
        for (const target of Object.values(state.dayVotes)) {
            tallies[target] = (tallies[target] ?? 0) + 1;
        }
        const most: number = Math.max(0, ...Object.values(tallies));
        const leaders: string[] = Object.keys(tallies).filter((target: string) => tallies[target] === most);
        const candidates: Seat[] = state.runoff === null ? alive(state) : alive(state).filter((seat) => state.runoff?.includes(seat.playerId) === true);
        const rows: TallyRow[] = candidates.map((seat) => ({ label: seat.name, count: tallies[seat.playerId] ?? 0, highlight: leaders.length === 1 && leaders[0] === seat.playerId }));
        if (leaders.length > 1 && state.runoff === null) {
            const names: string = leaders.map((playerId: string) => nameOf(state, playerId)).join(" and ");
            return {
                state: { ...state, dayVotes: {}, runoff: leaders, lastTally: rows },
                facts: [publicFact("vote-tied", `The vote is tied between ${names}. One more vote, just between them.`)],
                nextPhaseId: "vote",
                ...paced(state, "runoff", "vote"),
            };
        }
        const lynchedId: string | undefined = leaders.length === 1 ? leaders[0] : undefined;
        if (lynchedId === undefined) {
            const heading: string = leaders.length > 1 ? "Still tied, so nobody is out" : "Nobody voted, so nobody is out";
            const next: WerewolfState = { ...state, dayVotes: {}, runoff: null, lastLynched: null, lastTally: rows, moment: { kind: "calm", heading } };
            return openVerdict(next, [publicFact("vote-result", `${heading}.`)]);
        }
        const seats: Seat[] = state.seats.map((seat) => (seat.playerId === lynchedId ? { ...seat, alive: false } : seat));
        const lynched: Seat | undefined = seats.find((seat) => seat.playerId === lynchedId);
        const name: string = lynched?.name ?? "Someone";
        const roleText: string = lynched !== undefined && state.variants.revealOnDeath === true ? ` ${name} was ${withArticle(lynched.role)}.` : "";
        const next: WerewolfState = { ...state, seats, dayVotes: {}, runoff: null, lastLynched: name, lastTally: rows, moment: { kind: "out", heading: `${name} is out`, ...(roleText !== "" ? { detail: roleText.trim() } : {}) } };
        const facts: ScopedFact[] = [publicFact("vote-result", `The village has spoken. ${name} is out.${roleText}`)];
        if (lynched?.role === "hunter") {
            return openHunter(next, lynched, "verdict", facts);
        }
        return openVerdict(next, facts);
    };

    /**
     * Whether every night actor has chosen.
     * @param state the night state.
     * @returns true when the night can close.
     */
    const nightComplete = (state: WerewolfState): boolean => {
        const wolvesDone: boolean = aliveWerewolves(state).every((wolf) => state.nightChoices[wolf.playerId] !== undefined);
        const seerDone: boolean = alive(state).some((seat) => seat.role === "seer") === false || state.seerTarget !== null;
        const doctorDone: boolean = alive(state).some((seat) => seat.role === "doctor") === false || state.doctorTarget !== null;
        return wolvesDone === true && seerDone === true && doctorDone === true;
    };

    /**
     * After a night choice, starts the short hold if that was the last one still to come.
     * @param state the state with the choice in.
     * @returns the step.
     */
    const afterNightChoice = (state: WerewolfState): Step<WerewolfState> => {
        if (state.nightSettled === true || nightComplete(state) === false) {
            return { state, facts: [] };
        }
        return { state: { ...state, nightSettled: true }, facts: [], timers: { night: NIGHT_SETTLE_SECONDS } };
    };

    /**
     * Whether everyone still alive has voted.
     * @param state the vote state.
     * @returns true when the vote can resolve.
     */
    const voteComplete = (state: WerewolfState): boolean => alive(state).every((seat) => state.dayVotes[seat.playerId] !== undefined);

    /**
     * Moves to the next phase on a host request or timer, where the rules allow it.
     * @param state the current state.
     * @returns the step.
     */
    const advance = (state: WerewolfState): Step<WerewolfState> => {
        if (state.phase === "intro") {
            // Only now, or a wolf's phone would look different from everyone else's during the rules.
            const wolves: Seat[] = state.seats.filter((seat) => seat.role === "werewolf");
            const packText: string = wolves.length === 1 ? "You hunt alone." : `The pack: ${wolves.map((seat) => seat.name).join(" and ")}.`;
            const facts: ScopedFact[] = [{ scope: { kind: "group", groupId: WEREWOLF_GROUP }, kind: "pack", text: packText }, publicFact("roles", "Everyone now has a secret role on their phone.")];
            return { state: { ...state, phase: "roles", tappedThrough: [] }, facts, nextPhaseId: "roles", ...paced(state, "roles", "roles") };
        }
        if (state.phase === "roles") {
            return startNight(state, state.round, []);
        }
        if (state.phase === "dawn") {
            return { state: { ...state, phase: "discussion" }, facts: [publicFact("discussion", "The village may now discuss.")], nextPhaseId: "discussion", ...paced(state, "discussion", "discussion") };
        }
        if (state.phase === "discussion") {
            return { state: { ...state, phase: "vote", dayVotes: {}, runoff: null }, facts: [publicFact("vote", "Time to vote on your phones.")], nextPhaseId: "vote", ...paced(state, "vote", "vote") };
        }
        if (state.phase === "verdict") {
            return startNight(state, state.round + 1, []);
        }
        return { state, facts: [] };
    };

    /**
     * After someone taps through the rules or their role, moves on once everyone has.
     * @param state the state with the tap in.
     * @returns the step.
     */
    const afterTapThrough = (state: WerewolfState): Step<WerewolfState> => {
        const everyoneIn: boolean = alive(state).every((seat) => state.tappedThrough.includes(seat.playerId));
        return everyoneIn === true ? advance(state) : { state, facts: [] };
    };

    /**
     * Takes a departed player out of the game, so nobody waits on them, and checks for a winner.
     * @param state the current state.
     * @param playerId who left.
     * @returns the step.
     */
    const onPlayerLeft = (state: WerewolfState, playerId: string): Step<WerewolfState> => {
        const leaver: Seat | undefined = seatOf(state, playerId);
        if (state.phase === "hunter" && state.hunterId === playerId) {
            return resolveShot(state, null);
        }
        if (leaver === undefined || leaver.alive === false || state.phase === "end") {
            return { state, facts: [] };
        }
        const facts: ScopedFact[] = [publicFact("left", `${leaver.name} left the game.`)];
        const seats: Seat[] = state.seats.map((seat) => (seat.playerId === playerId ? { ...seat, alive: false, left: true } : seat));
        const kept = (choices: Record<string, string>): Record<string, string> => {
            return Object.fromEntries(Object.entries(choices).filter(([voter, target]) => voter !== playerId && target !== playerId));
        };
        const next: WerewolfState = {
            ...state,
            seats,
            nightChoices: kept(state.nightChoices),
            dayVotes: kept(state.dayVotes),
            seerTarget: state.seerTarget === playerId ? null : state.seerTarget,
            doctorTarget: state.doctorTarget === playerId ? null : state.doctorTarget,
            runoff: state.runoff === null ? null : state.runoff.filter((candidate: string) => candidate !== playerId),
            tappedThrough: state.tappedThrough.filter((voter: string) => voter !== playerId),
        };
        // The hunter's shot can still change who wins, and resolving it checks for a winner.
        if (state.phase === "hunter") {
            return { state: next, facts };
        }
        const over: Step<WerewolfState> | null = finishIfOver(next, facts);
        if (over !== null) {
            return over;
        }
        if (state.phase === "night" && next.nightSettled === true && nightComplete(next) === false) {
            return { state: { ...next, nightSettled: false }, facts, timers: { night: NIGHT_RECHOOSE_SECONDS } };
        }
        if (state.phase === "night") {
            const settled: Step<WerewolfState> = afterNightChoice(next);
            return { ...settled, facts: [...facts, ...settled.facts] };
        }
        if (state.phase === "vote" && (voteComplete(next) === true || (next.runoff !== null && next.runoff.length < 2))) {
            const resolved: Step<WerewolfState> = resolveVote(next.runoff !== null && next.runoff.length < 2 ? { ...next, dayVotes: {} } : next);
            return { ...resolved, facts: [...facts, ...resolved.facts] };
        }
        if (state.phase === "intro" || state.phase === "roles") {
            const moved: Step<WerewolfState> = afterTapThrough(next);
            return { ...moved, facts: [...facts, ...moved.facts] };
        }
        return { state: next, facts };
    };

    /**
     * Adds the phase's picture behind a scene, once it's been drawn.
     * @param state the state.
     * @param scene the scene.
     * @returns the scene with its backdrop.
     */
    const withBackdrop = (state: WerewolfState, scene: Scene): Scene => {
        const artId: string = state.phase === "end" ? state.winner ?? "" : state.phase === "dawn" ? "dawn" : ["intro", "roles", "night"].includes(state.phase) === true ? "night" : "day";
        const backdrop: string | undefined = state.art[artId];
        return backdrop === undefined ? scene : { ...scene, backdrop };
    };

    /**
     * The block that shows the last public moment, if any.
     * @param state the state.
     * @returns the blocks.
     */
    const momentBlocks = (state: WerewolfState): SceneBlock[] => {
        if (state.moment === null) {
            return [];
        }
        return [{ type: "moment", kind: state.moment.kind, heading: state.moment.heading, ...(state.moment.detail !== undefined ? { detail: state.moment.detail } : {}) }];
    };

    /**
     * The countdown for a moment, if the table chose a clock.
     * @param state the state.
     * @param moment which moment.
     * @param label what it counts down to.
     * @returns the blocks.
     */
    const clockBlocks = (state: WerewolfState, moment: keyof Pace, label: string): SceneBlock[] => (state.pace === null ? [] : [{ type: "timer", seconds: state.pace[moment], label, running: true }]);

    /**
     * What the holder of the controller can do now, so a table with no clock can always move on.
     * @param state the state.
     * @returns the controls.
     */
    const holderControls = (state: WerewolfState): Control[] => {
        const option = (label: string, style: "primary" | "quiet"): Control[] => [{ type: "buttons", options: [{ id: `${HOLDER_ACTION}${state.phase}`, label, holderOnly: true, style }] }];
        if (state.phase === "intro") {
            return option("Move on", "quiet");
        }
        if (state.phase === "roles") {
            return option("Start now", "quiet");
        }
        if (state.phase === "discussion") {
            return option("Start the vote", "primary");
        }
        if (state.phase === "vote" && Object.keys(state.dayVotes).length > 0) {
            return option("Reveal now", "quiet");
        }
        return state.phase === "hunter" ? option("Move on", "quiet") : [];
    };

    /**
     * Makes the holder's call, if it's for the moment the game is in; a stale tap does nothing.
     * @param state the state.
     * @param actionId the call, which names the phase it was offered in.
     * @returns the step.
     */
    const holderCall = (state: WerewolfState, actionId: string): Step<WerewolfState> => {
        if (actionId !== `${HOLDER_ACTION}${state.phase}`) {
            return { state, facts: [] };
        }
        if (state.phase === "vote") {
            return Object.keys(state.dayVotes).length === 0 ? { state, facts: [] } : resolveVote(state);
        }
        return state.phase === "hunter" ? resolveShot(state, null) : advance(state);
    };

    /**
     * The scene for the current phase, before any picture.
     * @param state the state.
     * @returns the scene.
     */
    const baseScene = (state: WerewolfState): Scene => {
        if (state.phase === "intro") {
            const roles: Role[] = state.seats.map((seat) => seat.role);
            return {
                mood: "neutral",
                transition: "fade",
                blocks: [
                    { type: "title", text: "How it works", kicker: describeRoles(roles) },
                    ...rulesLines(roles).map((text: string): SceneBlock => ({ type: "text", text })),
                    ...clockBlocks(state, "intro", "or tap Got it"),
                ],
            };
        }
        if (state.phase === "roles") {
            return {
                mood: "neutral",
                transition: "fade",
                blocks: [
                    { type: "title", text: "Check your phone", kicker: "Your role is secret" },
                    { type: "text", text: "Read it, keep it to yourself, and tap it to hide it.", emphasis: "large" },
                    ...clockBlocks(state, "roles", "until nightfall"),
                ],
            };
        }
        if (state.phase === "night") {
            return {
                mood: "night",
                transition: "dim",
                blocks: [
                    { type: "moment", kind: "night", heading: "The werewolves wake", detail: "Everyone else, eyes closed and phones down." },
                    { type: "title", text: "Night falls", kicker: `Night ${state.round}` },
                    { type: "drain", seconds: NIGHT_SECONDS, key: nightClock(state) },
                ],
            };
        }
        if (state.phase === "dawn") {
            return { mood: "dawn", transition: "fade", blocks: [{ type: "title", text: "Dawn", kicker: `Day ${state.round}` }, ...momentBlocks(state)] };
        }
        if (state.phase === "discussion") {
            const blocks: SceneBlock[] = [
                { type: "title", text: "Who is the werewolf?", kicker: `Day ${state.round}` },
                { type: "text", text: "Argue it out loud. Whoever has the controller starts the vote.", emphasis: "large" },
                ...clockBlocks(state, "discussion", "to decide"),
            ];
            return { mood: "tense", transition: "fade", blocks };
        }
        if (state.phase === "vote") {
            const candidates: Seat[] = state.runoff === null ? alive(state) : alive(state).filter((seat) => state.runoff?.includes(seat.playerId) === true);
            const rows: TallyRow[] = candidates.map((seat) => ({ label: seat.name, count: Object.values(state.dayVotes).filter((vote) => vote === seat.playerId).length }));
            const blocks: SceneBlock[] = [{ type: "title", text: state.runoff === null ? "The vote" : "The final vote", kicker: `Day ${state.round}` }, { type: "tally", title: "Votes so far", rows }, ...clockBlocks(state, state.runoff === null ? "vote" : "runoff", "to vote")];
            return { mood: "tense", transition: "fade", blocks };
        }
        if (state.phase === "verdict") {
            return { mood: "tense", transition: "fade", blocks: [{ type: "title", text: "The verdict", kicker: `Day ${state.round}` }, ...momentBlocks(state), { type: "tally", title: "The count", rows: state.lastTally }] };
        }
        if (state.phase === "hunter") {
            const name: string = nameOf(state, state.hunterId ?? "");
            return { mood: "tense", transition: "fade", blocks: [{ type: "title", text: "One last shot", kicker: `Day ${state.round}` }, { type: "moment", kind: "shot", heading: `${name} was the hunter`, detail: `${name} chooses who goes with them.` }, ...clockBlocks(state, "hunter", "to shoot")] };
        }
        const revealed = state.seats.map((seat) => ({ playerId: seat.playerId, name: seat.name, speaking: false, muted: false, badge: seat.role }));
        const ghostsRight: string[] = Object.entries(state.ghostGuesses).filter(([, guess]) => seatOf(state, guess)?.role === "werewolf").map(([ghost]) => nameOf(state, ghost));
        const blocks: SceneBlock[] = [{ type: "title", text: state.winner === "villagers" ? "The village wins" : "The werewolves win", kicker: `After ${state.round} ${state.round === 1 ? "day" : "days"}` }, { type: "roster", players: revealed }];
        blocks.splice(1, 0, { type: "text", text: wolvesLine(state), emphasis: "large" });
        if (ghostsRight.length > 0) {
            blocks.push({ type: "text", text: `The dead who called it: ${ghostsRight.join(", ")}.` });
        }
        return { mood: state.winner === "villagers" ? "victory" : "defeat", transition: "fade", blocks };
    };

    /**
     * Names the wolves once the game is over.
     * @param state the finished game.
     * @returns the line.
     */
    const wolvesLine = (state: WerewolfState): string => {
        const wolves: string[] = state.seats.filter((seat) => seat.role === "werewolf").map((seat) => seat.name);
        const named: string = wolves.length > 1 ? `${wolves.slice(0, -1).join(", ")} and ${wolves.at(-1) ?? ""}` : wolves[0] ?? "nobody";
        return wolves.length === 1 ? `The wolf was ${named}.` : `The wolves were ${named}.`;
    };

    return {
        manifest: WEREWOLF_MANIFEST,

        init(players: CartridgePlayer[], variants: Record<string, boolean>): Step<WerewolfState> {
            if (players.length < WEREWOLF_MANIFEST.minPlayers || players.length > WEREWOLF_MANIFEST.maxPlayers) {
                throw new Error(`Werewolf needs ${WEREWOLF_MANIFEST.minPlayers} to ${WEREWOLF_MANIFEST.maxPlayers} players, got ${players.length}.`);
            }
            const roles: Role[] = rolesFor(players.length, setupFor(players.length, chosenVillage));
            const shuffled: Role[] = shuffle(roles, random);
            const seats: Seat[] = players.map((player, index) => ({ playerId: player.playerId, name: player.name, role: shuffled[index] ?? "villager", alive: true }));
            const state: WerewolfState = {
                phase: "intro", round: 1, seats, variants, pace: PACES[chosenClock] ?? null, tappedThrough: [], nightChoices: {}, seerTarget: null, doctorTarget: null, lastProtected: null,
                nightSettled: false, dayVotes: {}, runoff: null, hunterId: null, afterShot: "dawn", moment: null, lastTally: [], ghostGuesses: {}, lastVictim: null, lastLynched: null, winner: null, art: {},
            };
            const facts: ScopedFact[] = [publicFact("setup", `${seats.length} players: ${describeRoles(roles)}.`)];
            return { state, facts, nextPhaseId: "intro", ...paced(state, "intro", "intro"), draws: ART_PROMPTS };
        },

        phaseOf(state: WerewolfState): string {
            return state.phase;
        },

        roleOf(state: WerewolfState, playerId: string): string {
            const seat: Seat | undefined = seatOf(state, playerId);
            if (seat === undefined || seat.alive === false) {
                return "spectator";
            }
            return seat.role;
        },

        groupsOf(state: WerewolfState, playerId: string): ReadonlySet<string> {
            const seat: Seat | undefined = seatOf(state, playerId);
            if (seat?.role === "werewolf") {
                return new Set([WEREWOLF_GROUP]);
            }
            return new Set();
        },

        legalActions(state: WerewolfState, playerId: string): LegalAction[] {
            const seat: Seat | undefined = seatOf(state, playerId);
            if (seat === undefined) {
                return [];
            }
            const others: Seat[] = alive(state).filter((candidate) => candidate.playerId !== playerId);
            if (state.phase === "hunter") {
                return state.hunterId === playerId ? others.map((candidate) => ({ actionId: `shoot:${candidate.playerId}`, label: candidate.name })) : [];
            }
            if (seat.alive === false) {
                return state.phase === "end" || seat.role === "werewolf" ? [] : others.map((candidate) => ({ actionId: `ghost:${candidate.playerId}`, label: candidate.name }));
            }
            if (state.phase === "intro" || state.phase === "roles") {
                return state.tappedThrough.includes(playerId) === true ? [] : [{ actionId: "gotIt", label: state.phase === "intro" ? "Got it" : "I've seen it" }];
            }
            if (state.phase === "night" && seat.role === "werewolf") {
                return others.filter((candidate) => candidate.role !== "werewolf").map((candidate) => ({ actionId: `kill:${candidate.playerId}`, label: candidate.name }));
            }
            if (state.phase === "night" && seat.role === "seer") {
                return others.map((candidate) => ({ actionId: `see:${candidate.playerId}`, label: candidate.name }));
            }
            if (state.phase === "night" && seat.role === "doctor") {
                return alive(state).filter((candidate) => candidate.playerId !== state.lastProtected).map((candidate) => ({ actionId: `heal:${candidate.playerId}`, label: candidate.playerId === playerId ? "Yourself" : candidate.name }));
            }
            if (state.phase === "vote") {
                const candidates: Seat[] = state.runoff === null ? others : others.filter((candidate) => state.runoff?.includes(candidate.playerId) === true);
                return candidates.map((candidate) => ({ actionId: `vote:${candidate.playerId}`, label: candidate.name }));
            }
            return [];
        },

        apply(state: WerewolfState, playerId: string, actionId: string): Step<WerewolfState> {
            // The room lets only the controller's holder make these.
            if (actionId.startsWith(HOLDER_ACTION) === true) {
                return holderCall(state, actionId);
            }
            const legal: boolean = this.legalActions(state, playerId).some((action) => action.actionId === actionId);
            if (legal === false) {
                return { state, facts: [] };
            }
            if (actionId === "gotIt") {
                return afterTapThrough({ ...state, tappedThrough: [...state.tappedThrough, playerId] });
            }
            const separator: number = actionId.indexOf(":");
            const verb: string = actionId.slice(0, separator);
            const targetId: string = actionId.slice(separator + 1);
            if (verb === "kill") {
                return afterNightChoice({ ...state, nightChoices: { ...state.nightChoices, [playerId]: targetId } });
            }
            if (verb === "see") {
                return afterNightChoice({ ...state, seerTarget: targetId });
            }
            if (verb === "heal") {
                return afterNightChoice({ ...state, doctorTarget: targetId });
            }
            if (verb === "shoot") {
                return resolveShot(state, targetId);
            }
            if (verb === "ghost") {
                return { state: { ...state, ghostGuesses: { ...state.ghostGuesses, [playerId]: targetId } }, facts: [] };
            }
            const voted: WerewolfState = { ...state, dayVotes: { ...state.dayVotes, [playerId]: targetId } };
            const fact: ScopedFact = publicFact("vote-cast", `${nameOf(state, playerId)} votes for ${nameOf(state, targetId)}.`, true);
            if (voteComplete(voted) === true) {
                const resolved: Step<WerewolfState> = resolveVote(voted);
                return { ...resolved, facts: [fact, ...resolved.facts] };
            }
            return { state: voted, facts: [fact] };
        },

        onEvent(state: WerewolfState, event: RoomEvent): Step<WerewolfState> {
            if (event.type === "drawingReady") {
                return { state: { ...state, art: { ...state.art, [event.id]: event.src } }, facts: [] };
            }
            if (event.type === "phaseChanged" && event.phaseId === "advance") {
                return advance(state);
            }
            if (event.type === "hostRuled" && event.ruling === "vote" && state.phase === "discussion") {
                return advance(state);
            }
            if (event.type === "timerFired" && event.timerId === state.phase && ["intro", "roles", "dawn", "discussion", "verdict"].includes(state.phase) === true) {
                return advance(state);
            }
            if (event.type === "timerFired" && event.timerId === "night" && state.phase === "night") {
                return resolveNight(state);
            }
            if (event.type === "timerFired" && event.timerId === "vote" && state.phase === "vote") {
                return resolveVote(state);
            }
            if (event.type === "timerFired" && event.timerId === "hunter" && state.phase === "hunter") {
                return resolveShot(state, null);
            }
            if (event.type === "playerLeft") {
                return onPlayerLeft(state, event.playerId);
            }
            return { state, facts: [] };
        },

        publicScene(state: WerewolfState): Scene {
            return withBackdrop(state, baseScene(state));
        },

        privateControls(state: WerewolfState, playerId: string): Control[] {
            const held: Control[] = holderControls(state);
            // The same bar on every phone at night, whatever its role, so the clock gives nothing away.
            const bar: Control[] = state.phase === "night" ? [{ type: "drain", seconds: NIGHT_SECONDS, key: nightClock(state) }] : [];
            const seat: Seat | undefined = seatOf(state, playerId);
            if (seat === undefined) {
                return [{ type: "waiting", text: "You are watching this round." }, ...bar, ...held];
            }
            const actions: LegalAction[] = this.legalActions(state, playerId);
            const asOptions = (): ControlOption[] => actions.map((action) => ({ id: action.actionId, label: action.label }));
            const bigAction = (): Control[] => (actions.length === 0 ? [] : [{ type: "buttons", options: actions.map((action) => ({ id: action.actionId, label: action.label, style: "primary" })) }]);
            if (state.phase === "intro") {
                const rules: string[] = rulesLines(state.seats.map((candidate) => candidate.role));
                return [{ type: "roleCard", title: "How it works", body: "", secret: false, lines: rules, numbered: true }, ...bigAction(), ...held];
            }
            if (state.phase === "end") {
                return endControls(state);
            }
            const card: Control = { type: "roleCard", title: `You are ${withArticle(seat.role)}`, body: roleBlurb(seat.role), secret: true, startHidden: state.phase !== "roles" };
            if (state.phase === "hunter" && state.hunterId === playerId) {
                return [card, { type: "choice", prompt: "You were the hunter. Who do you take with you?", options: asOptions(), multiple: false }, ...held];
            }
            if (seat.alive === false) {
                return [card, ...bar, ...ghostControls(state, seat, actions), ...held];
            }
            if (state.phase === "roles") {
                return [card, ...bigAction(), ...held];
            }
            if (state.phase === "night") {
                return [card, ...bar, ...nightControls(state, seat, actions)];
            }
            if (state.phase === "dawn" || state.phase === "verdict") {
                return [card, { type: "waiting", text: state.moment?.heading ?? "Watch the TV" }];
            }
            if (state.phase === "discussion") {
                return [card, { type: "roleCard", title: "Who is the werewolf?", body: "Argue it out loud. Whoever has the controller starts the vote.", secret: false }, ...held];
            }
            if (state.phase === "vote") {
                const votedFor: string | undefined = state.dayVotes[playerId];
                const question: string = state.runoff === null ? "Who do you vote out?" : "Final vote. Who do you vote out?";
                const prompt: string = votedFor === undefined ? question : `You voted for ${nameOf(state, votedFor)}. Tap another to change it.`;
                return [card, { type: "choice", prompt, options: actions.map((action) => ({ id: action.actionId, label: action.label, selected: action.actionId === `vote:${votedFor ?? ""}` })), multiple: false }, ...held];
            }
            return [card, { type: "waiting", text: "The hunter is aiming" }, ...held];
        },

        outOf(state: WerewolfState): string[] {
            return state.seats.filter((seat) => seat.alive === false).map((seat) => seat.playerId);
        },

        turn(state: WerewolfState): Turn | null {
            if (state.phase === "intro" || state.phase === "roles") {
                return { kind: "everyone", playerIds: alive(state).map((seat) => seat.playerId), doneIds: state.tappedThrough, label: state.phase === "intro" ? "Everyone taps Got it" : "Everyone checks their phone", phoneLine: "" };
            }
            if (state.phase === "night") {
                return { kind: "secret", label: "Waiting on the night" };
            }
            if (state.phase === "discussion") {
                return { kind: "anyone", label: "Anyone can talk", phoneLine: "" };
            }
            if (state.phase === "vote") {
                const voters: string[] = alive(state).map((seat) => seat.playerId);
                return { kind: "everyone", playerIds: voters, doneIds: Object.keys(state.dayVotes), label: stillVoting(state), phoneLine: "Your vote" };
            }
            if (state.phase === "hunter" && state.hunterId !== null) {
                return { kind: "one", playerId: state.hunterId, label: "The hunter aims" };
            }
            return null;
        },

        hostFacts(state: WerewolfState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "public" && scope.kind !== "host") {
                return [];
            }
            const lines: ScopedFact[] = [
                publicFact("recap", `Day ${state.round}. Still in, ${alive(state).length} players: ${alive(state).map((seat) => seat.name).join(", ")}.`),
                publicFact("recap", `This game has ${describeRoles(state.seats.map((seat) => seat.role))}.`),
            ];
            if (state.lastVictim !== null) {
                lines.push(publicFact("recap", `${state.lastVictim} was lost at dawn.`));
            }
            if (state.lastLynched !== null) {
                lines.push(publicFact("recap", `${state.lastLynched} was voted out.`));
            }
            return lines;
        },

        outcome(state: WerewolfState): string | null {
            if (state.winner === null) {
                return null;
            }
            return state.winner === "villagers" ? "The village wins." : "The werewolves win.";
        },
    };

    /**
     * The end of the game on a phone: who won, and everyone's role now that it can't matter.
     * @param state the state.
     * @returns the controls.
     */
    function endControls(state: WerewolfState): Control[] {
        const title: string = state.winner === "villagers" ? "The village wins" : "The werewolves win";
        return [{ type: "roleCard", title, body: "", secret: false, lines: state.seats.map((seat) => `${seat.name}: ${seat.role}`) }];
    }

    /**
     * What the TV says while a vote is open: who's still to vote, once anyone has.
     * @param state the vote.
     * @returns the line.
     */
    function stillVoting(state: WerewolfState): string {
        const left: string[] = alive(state).filter((seat) => state.dayVotes[seat.playerId] === undefined).map((seat) => seat.name);
        if (Object.keys(state.dayVotes).length === 0) {
            return state.runoff === null ? "Everyone votes" : "Everyone votes again";
        }
        return `Still voting: ${left.join(", ")}`;
    }

    /**
     * What an eliminated player's phone shows: only what's already public, and their ghost guess.
     * @param state the state.
     * @param seat the player.
     * @param actions their ghost guesses.
     * @returns the controls.
     */
    function ghostControls(state: WerewolfState, seat: Seat, actions: LegalAction[]): Control[] {
        const stillIn: string = alive(state).map((candidate) => candidate.name).join(", ");
        const outNames: Seat[] = state.seats.filter((candidate) => candidate.alive === false && candidate.left !== true && candidate.playerId !== seat.playerId);
        const known: string[] = state.variants.revealOnDeath === true ? outNames.map((candidate) => `${candidate.name} was ${withArticle(candidate.role)}.`) : [];
        const controls: Control[] = [{ type: "roleCard", title: "You're out", body: "No clues for the living.", secret: false, lines: [`Still in: ${stillIn}.`, ...known] }];
        if (actions.length === 0) {
            return controls;
        }
        const guess: string | undefined = state.ghostGuesses[seat.playerId];
        const prompt: string = guess === undefined ? "Who do you think the werewolf is? It shows at the end." : `You think it's ${nameOf(state, guess)}. Tap another to change it.`;
        return [...controls, { type: "choice", prompt, options: actions.map((action) => ({ id: action.actionId, label: action.label, selected: action.actionId === `ghost:${guess ?? ""}` })), multiple: false }];
    }

    /**
     * What a living player's phone shows at night.
     * @param state the state.
     * @param seat the player.
     * @param actions their night actions.
     * @returns the controls, or a request to wait.
     */
    function nightControls(state: WerewolfState, seat: Seat, actions: LegalAction[]): Control[] {
        if (actions.length === 0) {
            return [{ type: "waiting", text: "Eyes closed. Keep your phone face down." }];
        }
        const chosenId: string | null = seat.role === "werewolf" ? state.nightChoices[seat.playerId] ?? null : seat.role === "seer" ? state.seerTarget : state.doctorTarget;
        const verb: string = seat.role === "werewolf" ? "kill" : seat.role === "seer" ? "see" : "heal";
        const options: ControlOption[] = actions.map((action) => ({ id: action.actionId, label: action.label, selected: action.actionId === `${verb}:${chosenId ?? ""}` }));
        const question: string = seat.role === "werewolf" ? "Who do you choose tonight?" : seat.role === "seer" ? "Who do you want to check?" : "Who do you want to protect?";
        const prompt: string = chosenId === null ? question : `You chose ${nameOf(state, chosenId)}. Tap another to change it.`;
        const pack: Control[] = seat.role !== "werewolf" ? [] : aliveWerewolves(state)
            .filter((wolf) => wolf.playerId !== seat.playerId && state.nightChoices[wolf.playerId] !== undefined)
            .map((wolf) => ({ type: "notice", text: `${wolf.name} wants ${nameOf(state, state.nightChoices[wolf.playerId] ?? "")}.`, tone: "info" }));
        return [...pack, { type: "choice", prompt, options, multiple: false }];
    }
}
