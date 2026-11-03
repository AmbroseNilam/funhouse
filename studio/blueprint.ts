// A blueprint is a game as data: the structures it is made of and the decisions on each. Studio
// edits blueprints; the interpreter in interpreter.ts turns one into a cartridge the room can run.
// Phase 0 covers the guessing family: a secret the host holds, a judge that rules on what players
// say, and a count that runs out. Every decision has an id, so a rehearsal can say which one
// caused what. Nothing here is code a creator sees.

/** A thing the secret can be, with a secret to use when the model can't supply one. */
export interface SecretCategory {
    name: string;
    fallback: string;
}

/** The secret structure: what the host chooses and keeps. */
export interface SecretStructure {
    /** Categories the game draws from; one is picked per game. */
    categories: SecretCategory[];
    /** What to ask the model for, with {category} standing for the drawn category's name. */
    request: string;
    /** Longest answer accepted from the model; anything longer isn't one thing. */
    maxLength: number;
    /** What to paint for the reveal, with {secret} standing for the secret; empty paints nothing. */
    drawing: string;
}

/** What a ruling does to the game. */
export type RulingEffect =
    | { kind: "spend"; label: string }
    | { kind: "free" }
    | { kind: "win" }
    | { kind: "lose" };

/** One ruling the host may make in the asking phase. */
export interface Ruling {
    /** When the host should make it, in the host's brief. */
    when: string;
    effect: RulingEffect;
}

/** The judge structure: the host judges speech into named rulings; the rules decide what follows. */
export interface JudgeStructure {
    rulings: Record<string, Ruling>;
}

/** The count structure: a budget that spending uses up, and the game is lost when it runs out. */
export interface CountStructure {
    /** Label on the screen, such as "Doors opened". */
    label: string;
    budget: number;
    marks: "door" | "card";
    /** Budget left at which the host is told to warn them. */
    warnAt: number[];
    unit: { singular: string; plural: string };
}

/** The way the group may give up without saying so: a row on the pause menu, or none. */
export interface GiveUpStructure {
    actionId: string;
    label: string;
}

/** What the host is told, per game and per phase. */
export interface HostText {
    game: string;
    choosing: string;
    asking: string;
    end: string;
}

/** A complete game as data. */
export interface Blueprint {
    /** The game's id on the shelf and in the host's lobby brief. */
    id: string;
    name: string;
    pitch: string;
    howToPlay: string[];
    /** Browsing remarks, eight words or fewer each. */
    remarks: string[];
    art: string;
    minPlayers: number;
    maxPlayers: number;
    keywords: string[];
    host: HostText;
    secret: SecretStructure;
    judge: JudgeStructure;
    count: CountStructure;
    giveUp: GiveUpStructure | null;
}

/** Decision ids a rehearsal names when it explains a moment. */
export const DECISIONS: Record<string, string> = {
    categories: "secret.categories",
    request: "secret.request",
    drawing: "secret.drawing",
    budget: "count.budget",
    warnAt: "count.warnAt",
    giveUp: "giveUp",
};

/**
 * The decision id of one ruling.
 * @param name the ruling's name.
 * @returns its id.
 */
export function rulingDecision(name: string): string {
    return `judge.rulings.${name}`;
}

/**
 * Checks a blueprint is one the interpreter can run. Studio never offers a value that fails
 * this, so a creator cannot make an unrunnable game; the check guards hand-written and stored
 * blueprints.
 * @param blueprint the blueprint.
 * @returns the problems found, in plain words; empty when it is runnable.
 */
export function blueprintProblems(blueprint: Blueprint): string[] {
    const problems: string[] = [];
    if (blueprint.id.trim() === "" || blueprint.name.trim() === "") {
        problems.push("The game needs an id and a name.");
    }
    if (blueprint.minPlayers < 1 || blueprint.maxPlayers < blueprint.minPlayers) {
        problems.push("The player range is empty.");
    }
    if (blueprint.secret.categories.length === 0) {
        problems.push("The secret needs at least one category.");
    }
    if (blueprint.secret.categories.some((category: SecretCategory) => category.fallback.trim() === "") === true) {
        problems.push("Every category needs a fallback secret.");
    }
    if (blueprint.count.budget < 1) {
        problems.push("The count needs a budget of at least one.");
    }
    if (blueprint.count.warnAt.some((left: number) => left < 1 || left >= blueprint.count.budget) === true) {
        problems.push("Warnings must fall inside the budget.");
    }
    const effects: RulingEffect[] = Object.values(blueprint.judge.rulings).map((ruling: Ruling) => ruling.effect);
    if (effects.some((effect: RulingEffect) => effect.kind === "win") === false) {
        problems.push("No ruling wins the game.");
    }
    if (effects.some((effect: RulingEffect) => effect.kind === "spend") === false) {
        problems.push("No ruling spends the count, so the game can only end by winning or giving up.");
    }
    if (Object.keys(blueprint.judge.rulings).some((name: string) => /^[a-zA-Z]+$/.test(name) === false) === true) {
        problems.push("Ruling names must be letters only, so the host can write them.");
    }
    return problems;
}
