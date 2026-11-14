/**
 * Addresses the system treats specially, whoever asks.
 *
 * LinkedIn (the professional network) is read anonymously by default, like any other public
 * page, or through logged-in sessions the partner supplies: each account keeps a human rhythm,
 * with reads outside it held back rather than sent, and a refusal rests the account until its
 * next workday. The partner decided on 2026-11-13 that robots.txt is not obeyed, for this host
 * or any other. A site's prose terms do not bar a host. Reads stay anonymous except for the
 * sessions the partner supplies on this network.
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
