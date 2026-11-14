/**
 * Addresses on X, read here only as text, to tell which post or account an item points at and
 * whether xAI's API returned that post itself. Posts are read through that API, not by opening
 * the page.
 */

const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"]);

/** What is left of a stored item once X no longer shows the post it quoted. */
export const X_POST_REMOVED = {
  title: "Post on X, removed",
  excerpt: "[Removed: this post is no longer on X.]",
  claim: "[Removed with the post.]",
  note: "The post is no longer on X, so its words were removed.",
} as const;

/** Path words on X that are not accounts. */
const NOT_A_HANDLE = new Set(["i", "home", "search", "explore", "hashtag", "intent", "share", "settings", "messages", "notifications", "compose", "login", "signup"]);

function xPath(url: string | null | undefined): string[] | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!X_HOSTS.has(parsed.hostname.toLowerCase().replace(/^www\./, ""))) return null;
    return parsed.pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
}

/** A handle without the @, lower-cased, or null when the text is not one. */
export function cleanXHandle(value: string | null | undefined): string | null {
  const handle = (value ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) && !NOT_A_HANDLE.has(handle.toLowerCase()) ? handle.toLowerCase() : null;
}

/** The id of the post an address names: `/<handle>/status/<id>` or `/i/status/<id>`. */
export function xPostId(url: string | null | undefined): string | null {
  const parts = xPath(url);
  if (!parts) return null;
  const at = parts.findIndex((part) => part === "status" || part === "statuses");
  const id = at >= 1 ? parts[at + 1] : undefined;
  return id && /^\d{5,25}$/.test(id) ? id : null;
}

/** The account an address on X belongs to, or null: `/i/status/<id>` names none. */
export function xHandleOf(url: string | null | undefined): string | null {
  const parts = xPath(url);
  return parts?.length ? cleanXHandle(parts[0]) : null;
}

/** One spelling for a post's address, so the same post is the same evidence however it was written. */
export function xPostUrl(id: string, handle: string | null): string {
  return `https://x.com/${handle ?? "i"}/status/${id}`;
}

/**
 * For each post in a list of addresses, the account its address names. `/i/status/<id>` names
 * none and is left out, so a missing entry means "not stated", never "anyone".
 */
export function xPostAuthors(urls: readonly string[]): Map<string, string> {
  const authors = new Map<string, string>();
  for (const url of urls) {
    const id = xPostId(url);
    const handle = xHandleOf(url);
    if (id && handle) authors.set(id, handle);
  }
  return authors;
}

/** The ids of the posts in a list of addresses, such as the ones xAI's API says its search returned. */
export function xPostIds(urls: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const url of urls) {
    const id = xPostId(url);
    if (id) ids.add(id);
  }
  return ids;
}
