// Who may use the site, by where Cloudflare says a request came from. Meta's Geographic Use Policy
// (https://dev.meta.ai/legal/geographic-use-policy) bars access from certain territories, and Muse
// Image can't be offered in India. Off unless GEO_RULES=1, so someone running their own copy isn't
// affected. An unknown or missing location is let in; Cloudflare's headers are all there is to go on.

import type { IncomingHttpHeaders } from "node:http";

/** Restricted countries, as ISO codes. Check against the policy when it changes. */
const REFUSED_COUNTRIES: ReadonlySet<string> = new Set([
    "AF", "BY", "KH", "CN", "HK", "MO", "CU", "ER", "ET", "HT", "IR", "IQ", "LY", "MM", "NI", "KP", "PK", "RU", "SO", "SY", "VE", "EH",
]);

/** Restricted regions of Ukraine, as ISO 3166-2 codes: Crimea, Sevastopol, Donetsk, Luhansk. */
const REFUSED_UKRAINE_REGIONS: ReadonlySet<string> = new Set(["43", "40", "14", "09"]);

/** Where paintings can't be offered. */
const NO_PAINTINGS_COUNTRIES: ReadonlySet<string> = new Set(["IN"]);

/** What a location means here. */
export type RegionRule = "open" | "refused" | "noPaintings";

/** The short page shown instead of the site. */
export const REFUSED_PAGE: string = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Funhouse</title><h1>Marlowe can't come to your region.</h1><p>Funhouse isn't available where you are. Sorry about that.</p></html>";

/**
 * Whether a connection came through the tunnel, which runs beside the server and is the only route
 * that can set Cloudflare's headers. From anywhere else those headers are just what a client typed.
 * @param remoteAddress the socket's address.
 * @returns true for this machine.
 */
export function cameThroughTunnel(remoteAddress: string | undefined): boolean {
    return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

/**
 * Reads the rule for a request.
 * @param headers the request's headers.
 * @param remoteAddress the socket's address.
 * @returns the rule and the country, empty when not known.
 */
export function regionRule(headers: IncomingHttpHeaders, remoteAddress: string | undefined): { rule: RegionRule; country: string } {
    if (process.env.GEO_RULES !== "1" || cameThroughTunnel(remoteAddress) === false) {
        return { rule: "open", country: "" };
    }
    const countryHeader: string | string[] | undefined = headers["cf-ipcountry"];
    const regionHeader: string | string[] | undefined = headers["cf-region-code"];
    const country: string = typeof countryHeader === "string" ? countryHeader.toUpperCase() : "";
    if (REFUSED_COUNTRIES.has(country) === true) {
        return { rule: "refused", country };
    }
    if (country === "UA" && typeof regionHeader === "string" && REFUSED_UKRAINE_REGIONS.has(regionHeader.toUpperCase().replace(/^UA-/, "")) === true) {
        return { rule: "refused", country };
    }
    return { rule: NO_PAINTINGS_COUNTRIES.has(country) === true ? "noPaintings" : "open", country };
}
