import { brotliCompressSync, gzipSync } from "node:zlib";
import { createServer, type Server } from "node:http";
import { connect as netConnect } from "node:net";
import { describe, expect, it } from "vitest";
import { createPinnedLookup, createQuoteChecker, pinnedFetch } from "./quote-check";
import type { FetchFn } from "./http";
import { personaFor, type LinkedInAccount } from "./sessions";
import type { PageRead } from "../contracts";

const publicResolver = async () => ["93.184.216.34"];

function page(body: string, status = 200, contentType = "text/html"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

/** 2026-11-10 is a Tuesday, 09:00 local. */
const AT_WORK = new Date(2026, 10, 10, 9, 0).getTime();

/** A cookie whose persona is at work at 09:00 that Tuesday, so account checks are eligible. */
function networkCookie(label: string): string {
  for (let index = 0; index < 500; index += 1) {
    const cookie = `li_at=${label}-${index}`;
    const persona = personaFor(cookie);
    if (persona.workdayStartMinute <= 9 * 60 && persona.workdayStartMinute + persona.workdayMinutes > 9 * 60 + 30) return cookie;
  }
  throw new Error(`No cookie for ${label} is at work at the test time.`);
}

function checker(
  fetchFn: FetchFn,
  options: { resolveHost?: (hostname: string) => Promise<string[]>; maxBytes?: number; accounts?: readonly LinkedInAccount[]; now?: () => number; networkReader?: { read(url: string, options?: { simDay?: number | null; signal?: AbortSignal; maxTextChars?: number }): Promise<PageRead> } } = {},
) {
  return createQuoteChecker({
    fetchFn,
    resolveHost: options.resolveHost ?? publicResolver,
    maxBytes: options.maxBytes,
    accounts: options.accounts,
    now: options.now ?? (() => AT_WORK),
    sleep: async () => undefined,
    ...(options.networkReader ? { networkReader: options.networkReader } : {}),
  });
}

function longText(extra = ""): string {
  return `<main>${extra} ${"ordinary public page information ".repeat(90)}</main>`;
}

describe("createQuoteChecker", () => {
  it("finds normalized exact quotes, requires every fragment, and rejects changed words", async () => {
    const quote = "The company launched its first product in March 2024.";
    await expect(checker(async () => page(`<p>${quote}</p>`)).check("https://example.test/story", quote))
      .resolves.toMatchObject({ status: "found" });

    const normalized = await checker(async () => page("<p>She said <em>“we’re ready”</em> — after a long<br>delay.</p>"))
      .check("https://example.test/story", "She said \"we're ready\" - after a long\ndelay.");
    expect(normalized.status).toBe("found");
  });

  it("sends a supplied session cookie when checking the professional network", async () => {
    const quote = "The founder built the first version of the product alone.";
    const cookie = networkCookie("quote-session");
    const sent: Array<{ url: string; cookie: string | null }> = [];
    const result = await checker(async (url, init) => {
      sent.push({ url, cookie: new Headers(init?.headers).get("cookie") });
      return page(`<p>${quote}</p>`);
    }, { accounts: [{ cookie, proxyUrl: null, userAgent: null }] }).check("https://www.linkedin.com/in/founder", quote);

    expect(sent).toEqual([{ url: "https://www.linkedin.com/in/founder", cookie }]);
    expect(result.status).toBe("found");
  });

  it("does not judge a quote while every account rests, and asks the host nothing", async () => {
    const quote = "The founder built the first version of the product alone.";
    let requested = 0;
    const beforeWork = new Date(2026, 10, 10, 6, 30).getTime();
    const result = await checker(async () => {
      requested += 1;
      return page(`<p>${quote}</p>`);
    }, { accounts: [{ cookie: networkCookie("quote-resting"), proxyUrl: null, userAgent: null }], now: () => beforeWork })
      .check("https://www.linkedin.com/in/founder", quote);

    expect(result.status).toBe("unreachable");
    expect(result.detail).toMatch(/pause until \d{2}:\d{2}/);
    expect(requested).toBe(0);
  });

  it("checks a professional-network quote through the browser reader, without the fetch path", async () => {
    const quote = "The founder built the first version of the product alone.";
    const reads: string[] = [];
    let fetched = 0;
    const result = await checker(async () => {
      fetched += 1;
      return page(`<p>${quote}</p>`);
    }, {
      networkReader: {
        async read(url, options) {
          reads.push(`${url} ${options?.maxTextChars ?? 0}`);
          return { status: "ok", detail: "Page read.", url, title: "", text: `Lead-in words. ${quote} More words follow the quote.`, links: [] };
        },
      },
    }).check("https://www.linkedin.com/in/founder", quote);

    expect(result.status).toBe("found");
    expect(reads).toEqual(["https://www.linkedin.com/in/founder 300000"]);
    expect(fetched).toBe(0);
  });

  it("leaves a quote on the browser path unjudged when the account rests", async () => {
    const quote = "The founder built the first version of the product alone.";
    const result = await checker(async () => page(`<p>${quote}</p>`), {
      networkReader: {
        async read(url) {
          return { status: "blocked", detail: "The account asked for a pause until 13:47.", url, title: "", text: "", links: [] };
        },
      },
    }).check("https://www.linkedin.com/in/founder", quote);

    expect(result.status).toBe("unreachable");
    expect(result.detail).toMatch(/pause until \d{2}:\d{2}/);
  });

  it("leaves a quote on a cut browser page unjudged rather than called wrong", async () => {
    const quote = "The founder built the first version of the product alone.";
    const missing = "These words appear nowhere on the cut page at all, not even once.";
    const excerpt = `${quote} ... ${missing}`;
    const result = await checker(async () => page(`<p>${quote}</p>`), {
      networkReader: {
        async read(url) {
          return { status: "ok", detail: "Page read.", url, title: "", text: "x".repeat(300_000), links: [], truncated: true };
        },
      },
    }).check("https://www.linkedin.com/in/founder", excerpt);

    expect(result).toMatchObject({ status: "unreachable", detail: "The page is too long to check in full." });
  });

  it("checks a quote on any other host through the fetch path when a browser reader is supplied", async () => {
    const quote = "The company launched its first product in March 2024.";
    let browserReads = 0;
    const result = await checker(async () => page(`<p>${quote}</p>`), {
      networkReader: {
        async read(url) {
          browserReads += 1;
          return { status: "ok", detail: "Page read.", url, title: "", text: quote, links: [] };
        },
      },
    }).check("https://example.test/story", quote);

    expect(result.status).toBe("found");
    expect(browserReads).toBe(0);
  });

  it("requires every separated fragment to appear", async () => {
    const quote = "The company launched its first product ... The founders expanded into Europe.";
    const found = await checker(async () => page("<p>The company launched its first product.</p><p>The founders expanded into Europe.</p>")).check(
      "https://example.test/story",
      quote,
    );
    expect(found.status).toBe("found");
  });

  it("requires every separated fragment and rejects a changed word", async () => {
    const fragments = await checker(async () => page("<p>The company launched its first product.</p><p>The founders expanded into Europe.</p>"))
      .check("https://example.test/story", "The company launched its first product ... The founders expanded into Europe.");
    expect(fragments.status).toBe("found");
    const missing = await checker(async () => page(longText("The company launched its first product.")))
      .check("https://example.test/story", "The company launched its first product ... The founders expanded into Europe.");
    expect(missing).toMatchObject({ status: "not_found", detail: "1 of 2 quoted fragments were not found on the page." });

    const exactWords = "Founders often build useful tools for small teams before expanding into larger markets with careful hiring and steady customer feedback from early adopters across several regions over many years while measuring product use and listening closely to customers who share practical needs and advice";
    const changed = exactWords.replace("useful", "invented");
    await expect(checker(async () => page(longText(exactWords))).check("https://example.test/story", changed))
      .resolves.toMatchObject({ status: "not_found" });
    await expect(checker(async () => page(longText("The company served 12 customers across several regions and continued growing steadily for many years.")))
      .check("https://example.test/story", "The company served 40 customers across several regions and continued growing steadily for many years."))
      .resolves.toMatchObject({ status: "not_found" });
  });

  it("counts only visible text and does not join separate JSON fields into a quote", async () => {
    const quote = "A secret claim appears only inside this script block.";
    await expect(checker(async () => page(`<script>${quote}</script>${longText()}`)).check("https://example.test/story", quote))
      .resolves.toMatchObject({ status: "not_found" });

    const body = JSON.stringify({
      first: "The company raised capital from",
      second: "several patient investors in 2024.",
      body: "ordinary public page information ".repeat(100),
    });
    await expect(checker(async () => page(body, 200, "application/json")).check(
      "https://example.test/story",
      "The company raised capital from several patient investors in 2024.",
    )).resolves.toMatchObject({ status: "not_found" });

    const hn = JSON.stringify({ text: "ordinary public discussion text ".repeat(100) });
    await expect(checker(async () => page(hn, 200, "application/json")).check(
      "https://news.ycombinator.com/item?id=12345678",
      "A specific claim that does not appear anywhere in this discussion.",
    )).resolves.toMatchObject({ status: "not_found" });
  });

  it("treats errors, non-text content and too little page text as unreachable", async () => {
    await expect(checker(async () => page("blocked", 403)).check("https://example.test/story", "This quote has several words to check"))
      .resolves.toMatchObject({ status: "unreachable" });
    await expect(checker(async () => page("%PDF-1.7", 200, "application/pdf"))
      .check("https://example.test/story", "This quote has several words to check"))
      .resolves.toMatchObject({ status: "unreachable" });
    await expect(checker(async () => page("A tiny page."))
      .check("https://example.test/story", "This quote has several words to check"))
      .resolves.toMatchObject({ status: "unreachable", detail: "The page has too little readable text to check a quote against." });
  });

  it("uses complete or partial source stand-ins for Hacker News, GitHub and arXiv", async () => {
    const hnFetched: string[] = [];
    const hnQuote = "The founder didn't stop building after the first launch.";
    const hn = await checker(async (url) => {
      hnFetched.push(url);
      return page(JSON.stringify({ children: [{ text: "<p>The founder didn&#x27;t stop building after the first launch.</p>" }] }), 200, "application/json");
    }).check("https://news.ycombinator.com/item?id=12345678", hnQuote);
    expect(hnFetched).toEqual(["https://hn.algolia.com/api/v1/items/12345678"]);
    expect(hn.status).toBe("found");

    const githubFetched: string[] = [];
    const githubQuote = "const founderCount = team.members.length;";
    const github = await checker(async (url) => {
      githubFetched.push(url);
      return page(`${githubQuote}\n`, 200, "text/plain");
    }).check("https://github.com/octocat/venture/blob/main/src/team.ts", githubQuote);
    expect(githubFetched).toEqual(["https://raw.githubusercontent.com/octocat/venture/main/src/team.ts"]);
    expect(github.status).toBe("found");

    const arxivFetched: string[] = [];
    const arxivQuote = "This abstract describes a public research paper with detailed methods and important results.";
    const arxiv = await checker(async (url) => {
      arxivFetched.push(url);
      return page(`<p>${"ordinary public research information ".repeat(80)}</p>`);
    }).check("https://arxiv.org/pdf/2401.01234v2.pdf", arxivQuote);
    expect(arxivFetched).toEqual(["https://arxiv.org/abs/2401.01234v2"]);
    expect(arxiv).toMatchObject({ status: "unreachable", detail: "Only the abstract of this paper could be read." });
    await expect(checker(async () => page(`<p>${arxivQuote}</p>`))
      .check("https://arxiv.org/pdf/2401.01234v2.pdf", arxivQuote)).resolves.toMatchObject({ status: "found" });
  });

  it("blocks private and non-default-port addresses before fetching them", async () => {
    const blocked = [
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://10.0.0.5/",
      "http://localhost/",
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

    let fetchedPrivateDns = false;
    const resolvedPrivate = checker(async () => {
      fetchedPrivateDns = true;
      return page("should not be requested");
    }, { resolveHost: async () => ["192.168.1.10"] });
    expect((await resolvedPrivate.check("https://example.test/story", "This quote has enough words to check")).status).toBe("unreachable");
    expect(fetchedPrivateDns).toBe(false);

    const redirected: string[] = [];
    const redirect = await checker(async (url) => {
      redirected.push(url);
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    }).check("https://example.test/story", "This quote has enough words to check");
    expect(redirect.status).toBe("unreachable");
    expect(redirected).toEqual(["https://example.test/story"]);
  });

  it("refuses a fourth redirect and reports pages cut off at its byte limit", async () => {
    const fetched: string[] = [];
    const redirect = await checker(async (url) => {
      fetched.push(url);
      const index = Number(new URL(url).pathname.slice(1));
      return new Response(null, { status: 302, headers: { location: `/${index + 1}` } });
    }).check("https://example.test/0", "This quote has enough words to check");
    expect(redirect).toMatchObject({ status: "unreachable", detail: "The page redirects too many times." });
    expect(fetched).toEqual([
      "https://example.test/0", "https://example.test/1", "https://example.test/2", "https://example.test/3",
    ]);

    const quote = "The quote appears before the body limit is reached.";
    await expect(checker(async () => page(`<p>${quote}</p>${"extra readable words ".repeat(500)}`), { maxBytes: 1_700 })
      .check("https://example.test/story", quote)).resolves.toMatchObject({ status: "found" });
    const beyondLimit = "This genuine quote begins only after the source was cut off by the byte limit.";
    await expect(checker(async () => page(`<p>${"ordinary public page information ".repeat(100)}</p><p>${beyondLimit}</p>`), { maxBytes: 1_700 })
      .check("https://example.test/story", beyondLimit))
      .resolves.toMatchObject({ status: "unreachable", detail: "The page is too long to check in full." });
  });

  it("connects only to the validated address while retaining the requested host name", async (context) => {
    let hostHeader = "";
    const server = createServer((_request, response) => {
      hostHeader = _request.headers.host ?? "";
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("served through the pinned address");
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      context.skip();
      return;
    }
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("The local server did not bind to a TCP port.");
      const response = await pinnedFetch(
        `http://public-name.test:${address.port}/`,
        { method: "GET" },
        ["127.0.0.1"],
      );
      expect(await response.text()).toBe("served through the pinned address");
      expect(response.status).toBe(200);
      expect(hostHeader).toBe(`public-name.test:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns only prevalidated addresses from both Node lookup callback forms", async () => {
    const lookup = createPinnedLookup(["93.184.216.34", "1.1.1.1"]);
    const single = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup("public-name.test", { all: false }, (error, address, family) => {
        if (error) reject(error);
        else if (typeof address === "string") resolve({ address, family: family ?? 0 });
        else reject(new Error("Expected a single lookup result."));
      });
    });
    const all = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      lookup("public-name.test", { all: true }, (error, addresses) => {
        if (error) reject(error);
        else if (Array.isArray(addresses)) resolve(addresses);
        else reject(new Error("Expected all lookup results."));
      });
    });
    expect(single).toEqual({ address: "93.184.216.34", family: 4 });
    expect(all).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "1.1.1.1", family: 4 },
    ]);
  });

  it("tunnels an http request through a CONNECT proxy with basic proxy authorization", async (context) => {
    const target = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("served through the tunnel");
    });
    const tunnels: Array<{ target: string; authorization: string | null }> = [];
    const proxy = createServer();
    proxy.on("connect", (request, clientSocket, head) => {
      const authorization = request.headers["proxy-authorization"];
      tunnels.push({
        target: request.url ?? "",
        authorization: typeof authorization === "string" ? authorization : null,
      });
      const [host, port] = (request.url ?? "").split(":");
      const upstream = netConnect(Number(port), host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      });
      upstream.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => upstream.destroy());
    });
    try {
      await listen(target);
      await listen(proxy);
    } catch (error) {
      await close(target);
      await close(proxy);
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      context.skip();
      return;
    }
    try {
      const proxyAddress = proxy.address();
      const targetAddress = target.address();
      if (!proxyAddress || typeof proxyAddress === "string" || !targetAddress || typeof targetAddress === "string") {
        throw new Error("A local server did not bind to a TCP port.");
      }
      const response = await pinnedFetch(
        `http://127.0.0.1:${targetAddress.port}/x`,
        undefined,
        ["127.0.0.1"],
        `http://user:pass@127.0.0.1:${proxyAddress.port}`,
      );
      expect(await response.text()).toBe("served through the tunnel");
      expect(tunnels).toEqual([{ target: `127.0.0.1:${targetAddress.port}`, authorization: "Basic dXNlcjpwYXNz" }]);
    } finally {
      await close(target);
      await close(proxy);
    }
  });

  it("decodes gzip and Brotli responses and rejects an unsupported compression", async (context) => {
    const text = "A sentence that only makes sense once the compression is undone. ".repeat(20);
    const server = createServer((request, response) => {
      if (request.url === "/gzip") {
        response.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        response.end(gzipSync(text));
      } else if (request.url === "/brotli") {
        response.writeHead(200, { "content-type": "text/plain", "content-encoding": "br" });
        response.end(brotliCompressSync(text));
      } else {
        response.writeHead(200, { "content-type": "text/plain", "content-encoding": "zstd" });
        response.end("opaque bytes");
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      context.skip();
      return;
    }
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("The local server did not bind to a TCP port.");
      const get = (path: string) => pinnedFetch(`http://public-name.test:${address.port}${path}`, { method: "GET" }, ["127.0.0.1"]);
      expect(await (await get("/gzip")).text()).toBe(text);
      expect(await (await get("/brotli")).text()).toBe(text);
      await expect(get("/zstd")).rejects.toThrow(/compressed in a form/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
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

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
