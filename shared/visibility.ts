// Visibility scopes: the one mechanism behind secret roles, private phones, and a host that
// cannot leak. Every fact a cartridge produces carries a scope, and the room generates each
// stage's view and each host briefing from scopes alone.

/** Who may know a fact. */
export type Scope =
    | { kind: "public" }
    | { kind: "player"; playerId: string }
    | { kind: "group"; groupId: string }
    | { kind: "host" }
    | { kind: "system" };

/** A fact with its scope, as produced by a cartridge and stored on the timeline. */
export interface ScopedFact {
    scope: Scope;
    /** Short machine-readable kind, such as "role-assigned" or "vote-cast". */
    kind: string;
    /** Human-readable text the host may narrate when the scope allows it. */
    text: string;
}

/** The scope every stage and the host can always see. */
export const PUBLIC_SCOPE: Scope = { kind: "public" };

/**
 * Decides whether a viewer may see a fact.
 * @param scope the fact's scope.
 * @param viewerPlayerId the viewing player, or null for the public screen.
 * @param viewerGroups groups the viewer belongs to.
 * @returns true when the viewer is inside the scope.
 */
export function canSee(scope: Scope, viewerPlayerId: string | null, viewerGroups: ReadonlySet<string>): boolean {
    if (scope.kind === "public") {
        return true;
    }
    if (scope.kind === "player") {
        return viewerPlayerId !== null && scope.playerId === viewerPlayerId;
    }
    if (scope.kind === "group") {
        return viewerGroups.has(scope.groupId);
    }
    return false;
}

/**
 * Decides whether the host may be briefed on a fact. The host sees public and host-only
 * facts, plus player and group facts only when it is explicitly briefing that scope.
 * @param scope the fact's scope.
 * @param briefingScope the scope the host is currently speaking into.
 * @returns true when the fact belongs in the briefing.
 */
export function hostMaySee(scope: Scope, briefingScope: Scope): boolean {
    if (scope.kind === "public" || scope.kind === "host") {
        return true;
    }
    if (scope.kind === "system") {
        return false;
    }
    if (scope.kind === "player" && briefingScope.kind === "player") {
        return scope.playerId === briefingScope.playerId;
    }
    if (scope.kind === "group" && briefingScope.kind === "group") {
        return scope.groupId === briefingScope.groupId;
    }
    return false;
}
