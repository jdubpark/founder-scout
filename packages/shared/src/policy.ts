/**
 * Addresses the system treats specially, whoever asks.
 *
 * LinkedIn (the professional network) is read anonymously by default, like any other public
 * page, or through logged-in sessions the partner supplies: each account keeps a human rhythm,
 * with reads outside it held back rather than sent, and a refusal rests the account until its
 * next workday. Its robots.txt bars every agent but its own, so it is the one host read
 * despite robots.txt — a decision the partner made on 2026-11-13, accepting that its terms
 * bar automated access. Every other host is read only as far as its robots.txt allows, always
 * anonymously.
 *
 * Profile data also comes from a data vendor under contract or from a partner's own exported
 * contact list. See the design, section "People data".
 */

export const PROFESSIONAL_NETWORK_HOSTS = ["linkedin.com", "licdn.com", "lnkd.in"] as const;

/** true for a professional-network host or any subdomain of one. Case and a trailing dot are ignored. */
export function isProfessionalNetworkHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return PROFESSIONAL_NETWORK_HOSTS.some((network) => host === network || host.endsWith(`.${network}`));
}

/** true when the text is a web address on the professional network. Text that is not an address is not one. */
export function isProfessionalNetworkUrl(url: string): boolean {
  try {
    return isProfessionalNetworkHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Hosts read although their robots.txt does not allow it, each with the recorded decision.
 * Everything else is read only as far as its robots.txt allows.
 */
export const ROBOTS_EXCEPTION_HOSTS: ReadonlyArray<{ host: string; why: string }> = [
  {
    host: "linkedin.com",
    why: "Its robots.txt bars every agent but its own. The partner decided on 2026-11-13 to read it anyway: anonymously, or through logged-in sessions the partner supplies, each keeping a human rhythm with reads outside it held back, and a refusal resting the account until its next workday.",
  },
];

const sameOrUnder = (host: string, parent: string) => host === parent || host.endsWith(`.${parent}`);

/** The robots.txt exception that covers this host, or null. Case and a trailing dot are ignored. */
export function robotsExceptionHost(hostname: string): { host: string; why: string } | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  for (const entry of ROBOTS_EXCEPTION_HOSTS) {
    if (sameOrUnder(host, entry.host)) return entry;
  }
  return null;
}
