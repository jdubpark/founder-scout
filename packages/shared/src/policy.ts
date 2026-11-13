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

/**
 * Sites the hunt does not read, because their own rules say automated readers may not, even
 * where robots.txt would allow it. robots.txt is not the whole contract. Each entry gives the
 * rule in a line; the sentences themselves and where they were read are in
 * docs/research/open-web-hunting-grounds.md (2026-11-13). A link to one of these is not
 * followed by a runner. It may still be stored as a pointer for a person to open.
 *
 * This list is a floor. A site missing from it is still read only as far as its robots.txt
 * allows, and a refusal is never worked around.
 */
export const TERMS_BARRED_HOSTS: ReadonlyArray<{ host: string; except?: readonly string[]; why: string }> = [
  { host: "devpost.com", why: "Its terms bar automated means of accessing, scraping, crawling or spidering the site." },
  {
    host: "ycombinator.com",
    // Hacker News has a public API, and that is how it is read.
    except: ["news.ycombinator.com"],
    why: "Its terms bar data mining, robots and scraping on the site.",
  },
  { host: "substack.com", why: "Its terms bar any process that crawls, scrapes or spiders any page." },
  { host: "reddit.com", why: "Its robots.txt disallows every page for every agent." },
  { host: "indiehackers.com", why: "Its robots.txt disallows AI agents by name." },
  { host: "producthunt.com", why: "Its API may not be used for a business without permission." },
  { host: "x.com", why: "Reading at scale is through a paid API with limits on what may be collected." },
  { host: "twitter.com", why: "Reading at scale is through a paid API with limits on what may be collected." },
  { host: "youtube.com", why: "Its terms prohibit automated access except for public search engines following robots.txt or with prior written permission." },
  { host: "youtu.be", why: "Its terms prohibit automated access except for public search engines following robots.txt or with prior written permission." },
  { host: "vimeo.com", why: "Its terms prohibit automated access except through its API, a public search engine following robots.txt, or prior written permission." },
  { host: "spotify.com", why: "Its guidelines prohibit automated crawling, scraping, or other collection of service and content information." },
];

const sameOrUnder = (host: string, parent: string) => host === parent || host.endsWith(`.${parent}`);

/** The entry that bars this host, or null. Case and a trailing dot are ignored. */
export function termsBar(hostname: string): { host: string; why: string } | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  for (const entry of TERMS_BARRED_HOSTS) {
    if (!sameOrUnder(host, entry.host)) continue;
    if (entry.except?.some((allowed) => sameOrUnder(host, allowed))) continue;
    return { host: entry.host, why: entry.why };
  }
  return null;
}

/** true when the hunt may not read this host: the never-fetch list, or a site whose terms bar it. */
export function isOffLimitsHost(hostname: string): boolean {
  return isNeverFetchHost(hostname) || termsBar(hostname) !== null;
}
