// Keeps a phone on the current build. A phone left in the background can resume an old page, so it
// checks the server's version when it comes back and now and then while open. The version only
// changes when the server restarts for a release, which closes every room, so a reload can't
// interrupt a game.

import type { BuildInfo } from "../../shared/build-info.ts";

/** How often an open phone checks, in milliseconds. */
const CHECK_MILLISECONDS: number = 60000;

/**
 * Asks the server which build is current.
 * @returns the version, or an empty string if the server can't say right now.
 */
async function readVersion(): Promise<string> {
    try {
        const response: Response = await fetch("/phone-version", { cache: "no-store" });
        return response.ok === true ? await response.text() : "";
    } catch {
        return "";
    }
}

/** Starts watching for a new build, and reloads the page when one appears. */
export function reloadWhenUpdated(): void {
    let known: string = "";
    const check = async (): Promise<void> => {
        const latest: string = await readVersion();
        if (latest === "") {
            return;
        }
        if (known !== "" && latest !== known) {
            location.reload();
            return;
        }
        known = latest;
    };
    void check();
    setInterval(() => { void check(); }, CHECK_MILLISECONDS);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            void check();
        }
    });
}

/**
 * Asks the server which build it is.
 * @returns the build, or null if the server can't say right now.
 */
export async function readServerBuild(): Promise<BuildInfo | null> {
    try {
        const response: Response = await fetch("/version", { cache: "no-store" });
        return response.ok === true ? await response.json() as BuildInfo : null;
    } catch {
        return null;
    }
}
