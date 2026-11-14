/**
 * Whether an item's quoted words are in a text that code itself has read: a web page, or a
 * post. One rule for both, so a quote from X is held to what a quote from a page is held to.
 */

export interface QuoteMatch {
  /** `too_short`: no stretch of the quote is four words long, so there is nothing to look for. */
  status: "found" | "not_found" | "too_short";
  /** Stretches of the quote that were looked for, and how many of them are in none of the texts. */
  fragments: number;
  missing: number;
}

/** A text as it is compared: case, punctuation and spacing do not count. */
export function quoteForm(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** A link as X writes one in a post's text: always an address with its scheme. */
const POST_LINK = /https?:\/\/\S+/giu;
/** A word that may be a link as a copy of a post wrote it: an address, or a name with a dot inside it. */
const LINK_SHAPED = /^https?:\/\/|[\p{L}\p{N}]\.\p{L}{2}/iu;
/**
 * The work is bounded by these. A post on X is at most 25,000 characters and a stored quote
 * about 1,200, so neither is reached by a real one.
 */
const MAX_POST_CHARS = 30_000;
const MAX_QUOTE_CHARS = 4_000;

interface QuoteToken {
  words: string[];
  link: boolean;
}

const wordsOf = (text: string): string[] => quoteForm(text).split(" ").filter(Boolean);

/** A quote may skip passages with "...", so it is looked for one stretch at a time. */
const stretchesOf = (excerpt: string): string[] => excerpt.split(/\.\.\.|…|\[\.\.\.\]/u);

/**
 * Whether one stretch of a quote is in a post, word for word and in order. `null` in `post`
 * marks a link. A link may be left out of the quote, or stand for one link-shaped word of it.
 */
function stretchInPost(post: readonly (string | null)[], tokens: readonly QuoteToken[]): boolean {
  const width = post.length + 1;
  const triedAtLink = new Set<number>();
  const open: Array<[token: number, at: number]> = [];
  for (let start = post.length - 1; start >= 0; start -= 1) open.push([0, start]);
  while (open.length > 0) {
    const [token, at] = open.pop()!;
    if (token === tokens.length) return true;
    if (at >= post.length) continue;
    const next = tokens[token]!;
    if (post[at] === null) {
      // The only place the search branches, so the only place worth remembering.
      const key = token * width + at;
      if (triedAtLink.has(key)) continue;
      triedAtLink.add(key);
      if (token > 0) open.push([token, at + 1]);
      if (next.link) open.push([token + 1, at + 1]);
      continue;
    }
    if (next.words.every((word, index) => post[at + index] === word)) open.push([token + 1, at + next.words.length]);
  }
  return false;
}

/**
 * Whether quoted words are in a post. X shortens every link in a post's text, and whoever copied
 * the post may have written the address the link leads to, the short one, or none. So a link in
 * the post may be skipped, or matched by one link-shaped word of the quote. Anywhere else a
 * link-shaped word is compared as the words it is, and every other word has to match in order.
 * Only words that are not link-shaped count towards the four a stretch needs.
 */
export function quoteInPost(postText: string, excerpt: string): QuoteMatch {
  // A quote too long to look for is not cut to fit: the words cut off would go unlooked for.
  if (excerpt.length > MAX_QUOTE_CHARS) return { status: "not_found", fragments: 1, missing: 1 };
  // A longer post is cut at the end of a word, so the cut never makes a word that is not there.
  const text = postText.length > MAX_POST_CHARS
    ? postText.slice(0, postText.slice(0, MAX_POST_CHARS).search(/\s\S*$/u) + 1)
    : postText;
  const post: Array<string | null> = [];
  let at = 0;
  for (const link of text.matchAll(POST_LINK)) {
    post.push(...wordsOf(text.slice(at, link.index)), null);
    at = link.index + link[0].length;
  }
  post.push(...wordsOf(text.slice(at)));

  // Only a link-shaped word is kept whole. Every other word stands alone, so the quote may
  // join with a dash two words the post has a link between.
  const stretches = stretchesOf(excerpt)
    .map((stretch) => stretch.replace(/https?:\/\//giu, " $&").split(/[\s\u2013\u2014]+/u)
      .flatMap((token): QuoteToken[] => LINK_SHAPED.test(token)
        ? [{ words: wordsOf(token), link: true }]
        : wordsOf(token).map((word) => ({ words: [word], link: false })))
      .filter((token) => token.words.length > 0))
    .filter((tokens) => tokens.reduce((count, token) => count + (token.link ? 0 : token.words.length), 0) >= 4);
  if (stretches.length === 0) return { status: "too_short", fragments: 0, missing: 0 };
  const missing = stretches.filter((tokens) => !stretchInPost(post, tokens)).length;
  return { status: missing === 0 ? "found" : "not_found", fragments: stretches.length, missing };
}

/**
 * A quote may skip passages with "...", so each stretch of four words or more is looked for on
 * its own, and every one of them must be in one of the texts.
 */
export function quoteInText(texts: readonly string[], excerpt: string): QuoteMatch {
  const pages = texts.map(quoteForm);
  const fragments = stretchesOf(excerpt)
    .map(quoteForm)
    .filter((fragment) => fragment.split(" ").filter(Boolean).length >= 4);
  if (fragments.length === 0) return { status: "too_short", fragments: 0, missing: 0 };
  const missing = fragments.filter((fragment) => !pages.some((page) => page.includes(fragment))).length;
  return { status: missing === 0 ? "found" : "not_found", fragments: fragments.length, missing };
}
