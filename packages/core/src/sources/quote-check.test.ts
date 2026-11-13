import { describe, expect, it } from "vitest";
import { createQuoteChecker } from "./quote-check";
import type { FetchFn } from "./http";

const publicResolver = async () => ["93.184.216.34"];

function page(body: string, status = 200, contentType = "text/html"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

function checker(fetchFn: FetchFn, options: { resolveHost?: (hostname: string) => Promise<string[]>; maxBytes?: number } = {}) {
  return createQuoteChecker({ fetchFn, resolveHost: options.resolveHost ?? publicResolver, maxBytes: options.maxBytes });
}

function longText(extra = ""): string {
  return `<main>${extra} ${"ordinary public page information ".repeat(90)}</main>`;
}

describe("createQuoteChecker", () => {
  it("finds an exact quote", async () => {
    const quote = "The company launched its first product in March 2024.";
    const result = await checker(async () => page(`<p>${quote}</p>`)).check("https://example.test/story", quote);
    expect(result.status).toBe("found");
  });

  it("requires every separated fragment to appear", async () => {
    const quote = "The company launched its first product ... The founders expanded into Europe.";
    const found = await checker(async () => page("<p>The company launched its first product.</p><p>The founders expanded into Europe.</p>")).check(
      "https://example.test/story",
      quote,
    );
    expect(found.status).toBe("found");

    const missing = await checker(async () => page(longText("The company launched its first product."))).check(
      "https://example.test/story",
      quote,
    );
    expect(missing).toMatchObject({ status: "not_found", detail: "1 of 2 quoted fragments were not found on the page." });
  });

  it("normalizes curly quotes, dashes, line breaks, and inline markup", async () => {
    const result = await checker(async () => page("<p>She said <em>“we’re ready”</em> — after a long<br>delay.</p>")).check(
      "https://example.test/story",
      "She said \"we're ready\" - after a long\ndelay.",
    );
    expect(result.status).toBe("found");
  });

  it("uses five-word shingles to tolerate one changed word", async () => {
    const sentence = "Founders often build useful tools for small teams before expanding into larger markets with careful hiring and steady customer feedback from early adopters across several regions over many years while measuring product use and listening closely to customers who share practical needs and advice";
    const changed = sentence.replace("useful", "invented");
    const result = await checker(async () => page(longText(sentence))).check("https://example.test/story", changed);
    expect(result.status).toBe("found");

    const invented = await checker(async () => page(longText(sentence))).check(
      "https://example.test/story",
      "This entirely invented sentence describes a different company and unrelated events that never happened.",
    );
    expect(invented.status).toBe("not_found");
  });

  it("does not count text inside script blocks", async () => {
    const quote = "A secret claim appears only inside this script block.";
    const result = await checker(async () => page(`<script>${quote}</script>${longText()}`)).check("https://example.test/story", quote);
    expect(result.status).toBe("not_found");
  });

  it("marks HTTP errors, non-text content, and tiny pages unreachable", async () => {
    await expect(checker(async () => page("blocked", 403)).check("https://example.test/story", "This quote has several words to check"))
      .resolves.toMatchObject({ status: "unreachable" });
    await expect(
      checker(async () => page("%PDF-1.7", 200, "application/pdf")).check("https://example.test/story", "This quote has several words to check"),
    ).resolves.toMatchObject({ status: "unreachable" });
    await expect(
      checker(async () => page("A tiny page.")).check("https://example.test/story", "This quote has several words to check"),
    ).resolves.toMatchObject({ status: "unreachable", detail: "The page has too little readable text to check a quote against." });
  });

  it("reads Hacker News item text from Algolia, including nested comment HTML", async () => {
    const fetched: string[] = [];
    const quote = "The founder didn't stop building after the first launch.";
    const result = await checker(async (url) => {
      fetched.push(url);
      return page(
        JSON.stringify({ children: [{ text: "<p>The founder didn&#x27;t stop building after the first launch.</p>" }] }),
        200,
        "application/json",
      );
    }).check("https://news.ycombinator.com/item?id=12345678", quote);

    expect(fetched).toEqual(["https://hn.algolia.com/api/v1/items/12345678"]);
    expect(result.status).toBe("found");
  });

  it("reads GitHub blob quotes from the raw file address", async () => {
    const fetched: string[] = [];
    const quote = "const founderCount = team.members.length;";
    const result = await checker(async (url) => {
      fetched.push(url);
      return page(`${quote}\n`, 200, "text/plain");
    }).check("https://github.com/octocat/venture/blob/main/src/team.ts", quote);

    expect(fetched).toEqual(["https://raw.githubusercontent.com/octocat/venture/main/src/team.ts"]);
    expect(result.status).toBe("found");
  });

  it("reads arXiv PDF addresses from the versioned abstract page", async () => {
    const fetched: string[] = [];
    const result = await checker(async (url) => {
      fetched.push(url);
      return page("<p>This abstract describes a public research paper.</p>");
    }).check("https://arxiv.org/pdf/2401.01234v2.pdf", "The paper presents an extensive result in applied research.");

    expect(fetched).toEqual(["https://arxiv.org/abs/2401.01234v2"]);
    expect(result.status).toBe("unreachable");
  });

  it("does not join JSON string fields into a quote across field boundaries", async () => {
    const body = JSON.stringify({
      first: "The company raised capital from",
      second: "several patient investors in 2024.",
      body: "ordinary public page information ".repeat(100),
    });
    const result = await checker(async () => page(body, 200, "application/json")).check(
      "https://example.test/story",
      "The company raised capital from several patient investors in 2024.",
    );

    expect(result.status).toBe("not_found");
  });

  it("blocks denied and private addresses before fetching them", async () => {
    const blocked = [
      "https://www.linkedin.com/in/person",
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://10.0.0.5/",
      "https://example.test:8443/story",
    ];
    for (const url of blocked) {
      const fetched: string[] = [];
      const result = await checker(async (requested) => {
        fetched.push(requested);
        return page("should not be requested");
      }).check(url, "This quote has enough words to check");
      expect(result.status, url).toBe("unreachable");
      expect(fetched, url).toEqual([]);
    }

    let fetched = false;
    const resolvedPrivate = checker(
      async () => {
        fetched = true;
        return page("should not be requested");
      },
      { resolveHost: async () => ["192.168.1.10"] },
    );
    expect((await resolvedPrivate.check("https://example.test/story", "This quote has enough words to check")).status).toBe("unreachable");
    expect(fetched).toBe(false);
  });

  it("validates a redirect destination before fetching it", async () => {
    const fetched: string[] = [];
    const result = await checker(async (url) => {
      fetched.push(url);
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    }).check("https://example.test/story", "This quote has enough words to check");
    expect(result.status).toBe("unreachable");
    expect(fetched).toEqual(["https://example.test/story"]);
  });

  it("refuses to follow a fourth redirect", async () => {
    const fetched: string[] = [];
    const result = await checker(async (url) => {
      fetched.push(url);
      const index = Number(new URL(url).pathname.slice(1));
      return new Response(null, { status: 302, headers: { location: `/${index + 1}` } });
    }).check("https://example.test/0", "This quote has enough words to check");
    expect(result).toMatchObject({ status: "unreachable", detail: "The page redirects too many times." });
    expect(fetched).toEqual([
      "https://example.test/0",
      "https://example.test/1",
      "https://example.test/2",
      "https://example.test/3",
    ]);
  });

  it("cuts off an oversized response and can still find an early quote", async () => {
    const quote = "The quote appears before the body limit is reached.";
    const result = await checker(async () => page(`<p>${quote}</p>${"extra readable words ".repeat(500)}`), { maxBytes: 1_700 }).check(
      "https://example.test/story",
      quote,
    );
    expect(result.status).toBe("found");
  });

  it("rethrows a caller abort", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled this check");
    const pending = checker(async () => page("unused")).check(
      "https://example.test/story",
      "This quote has enough words to check",
      controller.signal,
    );
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
