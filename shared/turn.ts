// Whose turn it is, said one way for every game. A game names the kind of turn and the room, TV,
// phones and host all follow from it. Everything here is public, so a turn that would give away a
// role says so with "secret" and names nobody.

/** Whose turn it is right now. */
export type Turn =
    /** Nobody has to go first. The label is what the TV says, such as "Anyone can ask". */
    | { kind: "anyone"; label: string }
    /** Each of these people goes once. */
    | { kind: "everyone"; playerIds: string[]; doneIds: string[]; label: string }
    /** One person is up. */
    | { kind: "one"; playerId: string; label: string }
    /** Someone is acting but saying who, or how many, could give away a role. */
    | { kind: "secret"; label: string };

/** What the turn means for one phone. */
export interface PhoneTurn {
    /** True when this phone is the one being waited for. */
    yours: boolean;
    /** What to show, such as "Your turn" or "Waiting for Priya". */
    line: string;
}
