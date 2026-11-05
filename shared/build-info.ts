// Which build is running: the commit and when it was built, stamped in by the release. Each page is
// stamped when it's built and the server when it starts, so a stale page can tell it's out of date.

/** One build. */
export interface BuildInfo {
    commit: string;
    /** When it was built, as an ISO date; empty when it wasn't stamped. */
    builtAt: string;
}

/** The commit of a build nobody stamped, such as on a developer's machine. */
const UNSTAMPED: string = "dev";

/**
 * Reads a build's stamp.
 * @param env the environment, with BUILD_COMMIT and BUILD_TIME when it was stamped.
 * @returns the build.
 */
export function buildInfoFrom(env: Record<string, string | undefined>): BuildInfo {
    const commit: string = (env.BUILD_COMMIT ?? "").trim();
    return { commit: commit === "" ? UNSTAMPED : commit, builtAt: (env.BUILD_TIME ?? "").trim() };
}

/**
 * Whether a page is behind the server. An unstamped build on either side proves nothing.
 * @param page the page's own build.
 * @param server the server's build.
 * @returns true when the page should offer a reload.
 */
export function isOutOfDate(page: BuildInfo, server: BuildInfo): boolean {
    return page.commit !== UNSTAMPED && server.commit !== UNSTAMPED && page.commit !== server.commit;
}
