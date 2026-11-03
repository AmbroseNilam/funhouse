// Werewolf's rules core: an immutable state and pure transitions. The host never touches
// this; it narrates the facts these functions emit, each carrying a visibility scope. The
// room drives phases by applying player actions and events through the Cartridge interface.

import type { Turn } from "../../shared/turn.ts";
import type { Cartridge, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { Scene } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { WEREWOLF_MANIFEST } from "./manifest.ts";

/** Roles a player can hold. */
export type Role = "werewolf" | "villager" | "seer";

/** Game phases, in play order; "lobby" is before init and "end" is terminal. */
export type Phase = "roles" | "night" | "dawn" | "discussion" | "vote" | "end";

/** Everything about one seat. */
export interface Seat {
    playerId: string;
    name: string;
    role: Role;
    alive: boolean;
}

/** The whole game, immutable between steps. */
export interface WerewolfState {
    phase: Phase;
    round: number;
    seats: Seat[];
    variants: Record<string, boolean>;
    /** Werewolf votes for tonight's victim, keyed by werewolf player id. */
    nightChoices: Record<string, string>;
    /** The seer's chosen target tonight, if any. */
    seerTarget: string | null;
    /** Day votes, keyed by voter player id. */
    dayVotes: Record<string, string>;
    /** Who died at the last dawn, for narration. */
    lastVictim: string | null;
    /** Who was voted out last, for narration. */
    lastLynched: string | null;
    winner: "werewolves" | "villagers" | null;
    /** Pictures drawn for this game, by id; the game plays fine without them. */
    art: Record<string, string>;
}

/** Group id shared by the werewolves, for group-scoped facts and controls. */
export const WEREWOLF_GROUP: string = "werewolves";

/** Seconds of discussion when the day timer variant is on. */
export const DISCUSSION_SECONDS: number = 180;

/** Seconds players get to read their roles before night falls. */
export const ROLES_SECONDS: number = 15;

/** Seconds the night waits for choices before going on with what it has. */
export const NIGHT_SECONDS: number = 45;

/** Seconds for the dawn announcement before discussion opens. */
export const DAWN_SECONDS: number = 12;

/** Seconds the vote stays open before counting what's in. */
export const VOTE_SECONDS: number = 45;

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
 * Number of werewolves for a table size: one for up to six players, two for up to ten.
 * @param playerCount seats at the table.
 * @returns werewolf count.
 */
export function werewolfCount(playerCount: number): number {
    if (playerCount <= 6) {
        return 1;
    }
    return 2;
}

/**
 * Builds the Werewolf cartridge with an injectable random source.
 * @param random a function returning [0, 1); defaults to Math.random.
 * @returns the cartridge.
 */
export function createWerewolf(random: () => number = Math.random): Cartridge<WerewolfState> {
    const seatOf = (state: WerewolfState, playerId: string): Seat | undefined => state.seats.find((seat) => seat.playerId === playerId);
    const alive = (state: WerewolfState): Seat[] => state.seats.filter((seat) => seat.alive === true);
    const aliveWerewolves = (state: WerewolfState): Seat[] => alive(state).filter((seat) => seat.role === "werewolf");
    const publicFact = (kind: string, text: string, quiet: boolean = false): ScopedFact => ({ scope: { kind: "public" }, kind, text, quiet });

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
            return { state: won, facts: [...facts, publicFact("game-over", "The werewolves outnumber the village. The werewolves win.")], nextPhaseId: "end" };
        }
        return null;
    };

    /**
     * Resolves the night once every actor has chosen.
     * @param state state with all night choices in.
     * @returns the dawn step.
     */
    const resolveNight = (state: WerewolfState): Step<WerewolfState> => {
        const tallies: Record<string, number> = {};
        for (const target of Object.values(state.nightChoices)) {
            tallies[target] = (tallies[target] ?? 0) + 1;
        }
        const ranked: string[] = Object.keys(tallies).sort((left, right) => (tallies[right] ?? 0) - (tallies[left] ?? 0));
        const victimId: string | null = ranked[0] ?? null;
        const seats: Seat[] = state.seats.map((seat) => (seat.playerId === victimId ? { ...seat, alive: false } : seat));
        const victim: Seat | undefined = seats.find((seat) => seat.playerId === victimId);
        const facts: ScopedFact[] = [];
        if (victim !== undefined) {
            const roleText: string = state.variants.revealOnDeath === true ? ` They were a ${victim.role}.` : "";
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
        const dawn: WerewolfState = { ...state, seats, phase: "dawn", nightChoices: {}, seerTarget: null, dayVotes: {}, lastVictim: victim?.name ?? null };
        const over: Step<WerewolfState> | null = finishIfOver(dawn, facts);
        if (over !== null) {
            return over;
        }
        return { state: dawn, facts, nextPhaseId: "dawn", timers: { dawn: DAWN_SECONDS } };
    };

    /**
     * Resolves the day vote once everyone alive has voted.
     * @param state state with all votes in.
     * @returns the next night step, or the end.
     */
    const resolveVote = (state: WerewolfState): Step<WerewolfState> => {
        const tallies: Record<string, number> = {};
        for (const target of Object.values(state.dayVotes)) {
            tallies[target] = (tallies[target] ?? 0) + 1;
        }
        const ranked: string[] = Object.keys(tallies).sort((left, right) => (tallies[right] ?? 0) - (tallies[left] ?? 0));
        const top: string | undefined = ranked[0];
        const runnerUp: string | undefined = ranked[1];
        const tied: boolean = top !== undefined && runnerUp !== undefined && tallies[top] === tallies[runnerUp];
        const facts: ScopedFact[] = [];
        let seats: Seat[] = state.seats;
        let lynchedName: string | null = null;
        if (top !== undefined && tied === false) {
            seats = state.seats.map((seat) => (seat.playerId === top ? { ...seat, alive: false } : seat));
            const lynched: Seat | undefined = seats.find((seat) => seat.playerId === top);
            lynchedName = lynched?.name ?? null;
            const roleText: string = state.variants.revealOnDeath === true && lynched !== undefined ? ` ${lynched.name} was a ${lynched.role}.` : "";
            facts.push(publicFact("vote-result", `The village has spoken. ${lynchedName ?? "Nobody"} is out.${roleText}`));
        }
        if (tied === true) {
            facts.push(publicFact("vote-result", "The vote is tied. Nobody is out tonight."));
        }
        if (top === undefined) {
            facts.push(publicFact("vote-result", "Nobody voted. Nobody is out tonight."));
        }
        const next: WerewolfState = { ...state, seats, phase: "night", round: state.round + 1, dayVotes: {}, lastLynched: lynchedName };
        const over: Step<WerewolfState> | null = finishIfOver(next, facts);
        if (over !== null) {
            return over;
        }
        return { state: next, facts: [...facts, publicFact("night", "Night falls on the village.")], nextPhaseId: "night", timers: { night: NIGHT_SECONDS } };
    };

    return {
        manifest: WEREWOLF_MANIFEST,

        init(players: CartridgePlayer[], variants: Record<string, boolean>): Step<WerewolfState> {
            if (players.length < WEREWOLF_MANIFEST.minPlayers || players.length > WEREWOLF_MANIFEST.maxPlayers) {
                throw new Error(`Werewolf needs ${WEREWOLF_MANIFEST.minPlayers} to ${WEREWOLF_MANIFEST.maxPlayers} players, got ${players.length}.`);
            }
            const roles: Role[] = [];
            for (let index = 0; index < werewolfCount(players.length); index += 1) {
                roles.push("werewolf");
            }
            if (variants.seer === true) {
                roles.push("seer");
            }
            while (roles.length < players.length) {
                roles.push("villager");
            }
            const dealt: Role[] = shuffle(roles, random);
            const seats: Seat[] = players.map((player, index) => ({ playerId: player.playerId, name: player.name, role: dealt[index] ?? "villager", alive: true }));
            const facts: ScopedFact[] = seats.map((seat) => ({ scope: { kind: "player", playerId: seat.playerId }, kind: "role-assigned", text: `You are a ${seat.role}.` }));
            facts.push({ scope: { kind: "group", groupId: WEREWOLF_GROUP }, kind: "pack", text: `The werewolves are ${seats.filter((seat) => seat.role === "werewolf").map((seat) => seat.name).join(" and ")}.` });
            facts.push(publicFact("setup", `${players.length} players. ${werewolfCount(players.length)} werewolf${werewolfCount(players.length) > 1 ? "s" : ""} among them.`));
            const state: WerewolfState = { phase: "roles", round: 1, seats, variants, nightChoices: {}, seerTarget: null, dayVotes: {}, lastVictim: null, lastLynched: null, winner: null, art: {} };
            return { state, facts, nextPhaseId: "roles", timers: { roles: ROLES_SECONDS }, draws: ART_PROMPTS };
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
            if (seat === undefined || seat.alive === false) {
                return [];
            }
            const others: Seat[] = alive(state).filter((candidate) => candidate.playerId !== playerId);
            if (state.phase === "night" && seat.role === "werewolf") {
                return others.filter((candidate) => candidate.role !== "werewolf").map((candidate) => ({ actionId: `kill:${candidate.playerId}`, label: candidate.name }));
            }
            if (state.phase === "night" && seat.role === "seer" && state.seerTarget === null) {
                return others.map((candidate) => ({ actionId: `see:${candidate.playerId}`, label: candidate.name }));
            }
            if (state.phase === "vote") {
                return others.map((candidate) => ({ actionId: `vote:${candidate.playerId}`, label: candidate.name }));
            }
            return [];
        },

        apply(state: WerewolfState, playerId: string, actionId: string): Step<WerewolfState> {
            const legal: boolean = this.legalActions(state, playerId).some((action) => action.actionId === actionId);
            if (legal === false) {
                return { state, facts: [] };
            }
            const separator: number = actionId.indexOf(":");
            const verb: string = actionId.slice(0, separator);
            const targetId: string = actionId.slice(separator + 1);
            if (verb === "kill") {
                const next: WerewolfState = { ...state, nightChoices: { ...state.nightChoices, [playerId]: targetId } };
                return nightComplete(next) === true ? resolveNight(next) : { state: next, facts: [] };
            }
            if (verb === "see") {
                const next: WerewolfState = { ...state, seerTarget: targetId };
                return nightComplete(next) === true ? resolveNight(next) : { state: next, facts: [] };
            }
            const voted: WerewolfState = { ...state, dayVotes: { ...state.dayVotes, [playerId]: targetId } };
            const voterName: string = seatOf(state, playerId)?.name ?? playerId;
            const targetName: string = seatOf(state, targetId)?.name ?? targetId;
            const fact: ScopedFact = publicFact("vote-cast", `${voterName} votes for ${targetName}.`, true);
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
            if (event.type === "timerFired" && event.timerId === state.phase && ["roles", "dawn", "discussion"].includes(state.phase) === true) {
                return advance(state);
            }
            if (event.type === "timerFired" && event.timerId === "night" && state.phase === "night") {
                return resolveNight(state);
            }
            if (event.type === "timerFired" && event.timerId === "vote" && state.phase === "vote") {
                return resolveVote(state);
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
            const seat: Seat | undefined = seatOf(state, playerId);
            if (seat === undefined) {
                return [{ type: "waiting", text: "You are watching this round." }];
            }
            if (seat.alive === false) {
                return [{ type: "notice", text: "You are out. Enjoy the show, and keep your role to yourself.", tone: "info" }];
            }
            const actions: LegalAction[] = this.legalActions(state, playerId);
            if (state.phase === "roles") {
                return [{ type: "roleCard", title: `You are a ${seat.role}`, body: roleBlurb(seat.role), secret: true }];
            }
            if (actions.length > 0 && state.phase === "night") {
                const prompt: string = seat.role === "werewolf" ? "Choose tonight's victim." : "Who do you want to investigate?";
                const picked: string | undefined = state.nightChoices[playerId];
                const pickedName: string | undefined = picked === undefined ? undefined : seatOf(state, picked)?.name;
                const options: Control = { type: "choice", prompt, options: actions.map((action) => ({ id: action.actionId, label: action.label })), multiple: false };
                return pickedName === undefined ? [options] : [{ type: "notice", text: `You chose ${pickedName}. You can still change it.`, tone: "secret" }, options];
            }
            if (actions.length > 0 && state.phase === "vote") {
                const voted: string | undefined = state.dayVotes[playerId];
                const votedName: string | undefined = voted === undefined ? undefined : seatOf(state, voted)?.name;
                const options: Control = { type: "choice", prompt: "Who is the werewolf?", options: actions.map((action) => ({ id: action.actionId, label: action.label })), multiple: false };
                return votedName === undefined ? [options] : [{ type: "notice", text: `You voted for ${votedName}. You can still change it.`, tone: "info" }, options];
            }
            if (state.phase === "night") {
                return [{ type: "waiting", text: "Eyes closed. Keep your phone face down." }];
            }
            if (state.phase === "dawn") {
                return [{ type: "waiting", text: "Listen for what happened" }];
            }
            if (state.phase === "end") {
                return [{ type: "waiting", text: "That's the game" }];
            }
            return state.phase === "discussion" ? [{ type: "waiting", text: "Talk it out" }] : [];
        },

        outOf(state: WerewolfState): string[] {
            return state.seats.filter((seat) => seat.alive === false).map((seat) => seat.playerId);
        },

        turn(state: WerewolfState): Turn | null {
            if (state.phase === "night") {
                return { kind: "secret", label: "Waiting on the night" };
            }
            if (state.phase === "discussion") {
                return { kind: "anyone", label: "Anyone can talk" };
            }
            if (state.phase === "vote") {
                return { kind: "everyone", playerIds: alive(state).map((seat) => seat.playerId), doneIds: Object.keys(state.dayVotes), label: "Everyone votes" };
            }
            return null;
        },

        hostFacts(state: WerewolfState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "public" && scope.kind !== "host") {
                return [];
            }
            const lines: ScopedFact[] = [publicFact("recap", `Day ${state.round}. Still in: ${alive(state).map((seat) => seat.name).join(", ")}.`)];
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
     * The scene for the current phase, before any picture.
     * @param state the state.
     * @returns the scene.
     */
    function baseScene(state: WerewolfState): Scene {
        if (state.phase === "night") {
            return { mood: "night", transition: "dim", blocks: [{ type: "title", text: "Night falls", kicker: `Round ${state.round}` }, { type: "text", text: "Everyone, eyes closed.", emphasis: "whisper" }] };
        }
        if (state.phase === "discussion") {
            const blocks: Scene["blocks"] = [{ type: "title", text: "Who is the werewolf?", kicker: `Day ${state.round}` }];
            if (state.variants.dayTimer === true) {
                blocks.push({ type: "timer", seconds: DISCUSSION_SECONDS, label: "to decide", running: true });
            }
            return { mood: "tense", transition: "fade", blocks };
        }
        if (state.phase === "vote") {
            const rows = alive(state).map((seat) => ({ label: seat.name, count: Object.values(state.dayVotes).filter((vote) => vote === seat.playerId).length }));
            return { mood: "tense", transition: "fade", blocks: [{ type: "title", text: "The vote", kicker: `Day ${state.round}` }, { type: "tally", title: "Votes so far", rows }, { type: "timer", seconds: VOTE_SECONDS, label: "to vote", running: true }] };
        }
        if (state.phase === "end") {
            const revealed = state.seats.map((seat) => ({ playerId: seat.playerId, name: seat.name, speaking: false, muted: false, badge: seat.role }));
            return { mood: state.winner === "villagers" ? "victory" : "defeat", transition: "fade", blocks: [{ type: "title", text: state.winner === "villagers" ? "The village wins" : "The werewolves win" }, { type: "roster", players: revealed }] };
        }
        return { mood: state.phase === "dawn" ? "dawn" : "neutral", transition: "fade", blocks: [{ type: "title", text: state.phase === "dawn" ? "Dawn" : "Look at your phone", kicker: `Round ${state.round}` }] };
    }

    /**
     * Adds the phase's picture behind a scene, once it's been drawn.
     * @param state the state.
     * @param scene the scene.
     * @returns the scene with its backdrop.
     */
    function withBackdrop(state: WerewolfState, scene: Scene): Scene {
        const artId: string = state.phase === "end" ? state.winner ?? "" : state.phase === "dawn" ? "dawn" : state.phase === "night" || state.phase === "roles" ? "night" : "day";
        const backdrop: string | undefined = state.art[artId];
        return backdrop === undefined ? scene : { ...scene, backdrop };
    }

    /**
     * Whether every night actor has chosen.
     * @param state the night state.
     * @returns true when the night can resolve.
     */
    function nightComplete(state: WerewolfState): boolean {
        const wolves: Seat[] = aliveWerewolves(state);
        const wolvesDone: boolean = wolves.every((wolf) => state.nightChoices[wolf.playerId] !== undefined);
        const seerAlive: boolean = alive(state).some((seat) => seat.role === "seer");
        const seerDone: boolean = seerAlive === false || state.seerTarget !== null;
        return wolvesDone === true && seerDone === true;
    }

    /**
     * Whether everyone still alive has voted.
     * @param state the vote state.
     * @returns true when the vote can resolve.
     */
    function voteComplete(state: WerewolfState): boolean {
        return alive(state).every((seat) => state.dayVotes[seat.playerId] !== undefined);
    }

    /**
     * Takes a departed player out of the game, so nobody waits on them, and checks for a winner.
     * @param state the current state.
     * @param playerId who left.
     * @returns the step.
     */
    function onPlayerLeft(state: WerewolfState, playerId: string): Step<WerewolfState> {
        const leaver: Seat | undefined = seatOf(state, playerId);
        if (leaver === undefined || leaver.alive === false || state.phase === "end") {
            return { state, facts: [] };
        }
        const seats: Seat[] = state.seats.map((seat) => (seat.playerId === playerId ? { ...seat, alive: false } : seat));
        const kept = (choices: Record<string, string>): Record<string, string> => {
            return Object.fromEntries(Object.entries(choices).filter(([voter, target]) => voter !== playerId && target !== playerId));
        };
        const next: WerewolfState = {
            ...state,
            seats,
            nightChoices: kept(state.nightChoices),
            dayVotes: kept(state.dayVotes),
            seerTarget: state.seerTarget === playerId ? null : state.seerTarget,
        };
        const facts: ScopedFact[] = [publicFact("left", `${leaver.name} left the game.`)];
        const over: Step<WerewolfState> | null = finishIfOver(next, facts);
        if (over !== null) {
            return over;
        }
        if (state.phase === "night" && nightComplete(next) === true) {
            const resolved: Step<WerewolfState> = resolveNight(next);
            return { ...resolved, facts: [...facts, ...resolved.facts] };
        }
        if (state.phase === "vote" && voteComplete(next) === true) {
            const resolved: Step<WerewolfState> = resolveVote(next);
            return { ...resolved, facts: [...facts, ...resolved.facts] };
        }
        return { state: next, facts };
    }

    /**
     * Moves to the next phase on a host request or timer, where the rules allow it.
     * @param state the current state.
     * @returns the step.
     */
    function advance(state: WerewolfState): Step<WerewolfState> {
        if (state.phase === "roles") {
            return { state: { ...state, phase: "night" }, facts: [publicFact("night", "Night falls on the village.")], nextPhaseId: "night", timers: { night: NIGHT_SECONDS } };
        }
        if (state.phase === "dawn") {
            const timers: Record<string, number> | undefined = state.variants.dayTimer === true ? { discussion: DISCUSSION_SECONDS } : undefined;
            return { state: { ...state, phase: "discussion" }, facts: [publicFact("discussion", "The village may now discuss.")], nextPhaseId: "discussion", ...(timers !== undefined ? { timers } : {}) };
        }
        if (state.phase === "discussion") {
            return { state: { ...state, phase: "vote" }, facts: [publicFact("vote", "Time to vote on your phones.")], nextPhaseId: "vote", timers: { vote: VOTE_SECONDS } };
        }
        return { state, facts: [] };
    }
}

/**
 * One-line role explanation for the role card.
 * @param role the role.
 * @returns the blurb.
 */
function roleBlurb(role: Role): string {
    if (role === "werewolf") {
        return "Each night, choose a victim with your pack. By day, blend in.";
    }
    if (role === "seer") {
        return "Each night, learn whether one player is a werewolf. Be careful who you tell.";
    }
    return "Find the werewolves before they find you. Vote by day.";
}
