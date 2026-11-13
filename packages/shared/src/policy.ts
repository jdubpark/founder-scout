/**
 * Addresses the system never requests, whoever asks.
 *
 * The professional network's terms forbid automated access, and every company that built a
 * business on it was shut down by court order. So nothing here fetches those hosts: not a
 * source adapter, not the quote check, not a research agent's page-fetch tool. A link to one
 * may be stored as a pointer for a person to open in their own browser.
 *
 * Profile data comes from a data vendor under contract, from a partner's own exported
 * contact list, or from what a search engine shows. See the design, section "People data".
 */

export const NEVER_FETCH_HOSTS = ["linkedin.com", "licdn.com", "lnkd.in"] as const;

/** true for a never-fetch host or any subdomain of one. Case and a trailing dot are ignored. */
export function isNeverFetchHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return NEVER_FETCH_HOSTS.some((denied) => host === denied || host.endsWith(`.${denied}`));
}

/** true when the text is a web address on a never-fetch host. Text that is not an address is not one. */
export function isNeverFetchUrl(url: string): boolean {
  try {
    return isNeverFetchHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Deny rules for a headless Claude research call, one pair per host. Verified by running it
 * (2026-11-13): a rule for "example.com" alone does not cover "www.example.com", so each host
 * needs the bare rule and the wildcard rule.
 */
export function claudeFetchDenyRules(): string[] {
  return NEVER_FETCH_HOSTS.flatMap((host) => [`WebFetch(domain:${host})`, `WebFetch(domain:*.${host})`]);
}
