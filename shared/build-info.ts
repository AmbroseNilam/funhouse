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
 * Words a build for a person, such as "v 9920b0c · Nov 4 12:34".
 * @param build the build.
 * @param timeZone the time zone to show, the reader's own unless given.
 * @returns the line.
 */
export function versionLine(build: BuildInfo, timeZone?: string): string {
    const built: Date = new Date(build.builtAt);
    if (build.builtAt === "" || Number.isNaN(built.getTime()) === true) {
        return `v ${build.commit}`;
    }
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timeZone === undefined ? {} : { timeZone }) };
    return `v ${build.commit} · ${built.toLocaleString("en-US", options).replace(",", "")}`;
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
