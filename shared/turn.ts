// Whose turn it is, said one way for every game. A game names the kind of turn and the room, TV,
// phones and host all follow from it. Everything here is public, so a turn that would give away a
// role says so with "secret" and names nobody.

/**
 * Whose turn it is right now. A phoneLine replaces what a phone with something to do says, such as
 * "Your vote" in place of "Your turn"; an empty one says nothing, for a screen that speaks for itself.
 */
export type Turn =
    /** Nobody has to go first. The label is what the TV says, such as "Anyone can ask"; empty when the scene already says it. */
    | { kind: "anyone"; label: string; phoneLine?: string }
    /** Each of these people goes once. */
    | { kind: "everyone"; playerIds: string[]; doneIds: string[]; label: string; phoneLine?: string }
    /** One person is up. */
    | { kind: "one"; playerId: string; label: string }
    /** Someone is acting but saying who, or how many, could give away a role. */
    | { kind: "secret"; label: string };

/** What the turn means for one phone. */
export interface PhoneTurn {
    /** True when this phone is the one being waited for. */
    yours: boolean;
    /** True when anyone may go, so nobody is being waited for. */
    open: boolean;
    /** What to show, such as "Your turn" or "Waiting for Priya". */
    line: string;
}
