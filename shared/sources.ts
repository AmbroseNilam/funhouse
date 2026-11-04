// Turns a page address a model cited into the short site name a game may show. The model's word
// isn't enough: a site only counts if the search really returned it, and only its name is shown, so
// a made-up source or an odd page title can't reach the TV.

/**
 * Finds a site's name in an address.
 * @param address the address.
 * @returns the name without www, or an empty string when it isn't a web address.
 */
function siteOf(address: string): string {
    if (URL.canParse(address) === false) {
        return "";
    }
    const url: URL = new URL(address);
    return url.protocol === "https:" || url.protocol === "http:" ? url.hostname.toLowerCase().replace(/^www\./, "") : "";
}

/**
 * The site name to show for a cited address.
 * @param cited the address the model gave.
 * @param found the addresses the search really returned.
 * @returns the site's name, or an empty string when the search didn't return that site.
 */
export function sourceName(cited: string, found: string[]): string {
    const site: string = siteOf(cited.trim());
    return site !== "" && found.some((address: string) => siteOf(address) === site) === true ? site : "";
}
