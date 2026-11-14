/**
 * Reads the professional network through the Octo Browser: one profile per account, a
 * real Chromium window with its own fingerprint and sticky proxy, driven the way a person
 * reads — one tab, a page at a time, a dwell between pages and scrolling that moves as
 * a reader does. The rhythm is the account pool's, shared with the fetch reader, so a
 * day's reading spends the account the same whichever path read it, and a resting
 * account is held back before the profile is even asked for. Closing the connection
 * only disconnects the automation; the profile keeps running in Octo.
 */

import { cleanUrl, isProfessionalNetworkUrl } from "@agentswarm/shared";
import type { PageRead, WebReader } from "../contracts";
import { createOctoLocalClient, OctoProfileAlreadyStarted, type OctoLocalClient } from "./octo";
import { linkedInSessionPoolFor, type LinkedInAccount } from "./sessions";
import { cleanPlain, htmlToText } from "./util";
import { extractLinks, extractTitle, stripUnsafeBlocks } from "./web";

/** What the reader needs of a page. Narrow on purpose, so a test can fake all of it. */
export interface BrowserPage {
  goto(url: string, options: { timeout: number; waitUntil: "domcontentloaded" }): Promise<void>;
  url(): string;
  content(): Promise<string>;
  /** One wheel step down the page, on whatever container the app scrolls. */
  scrollBy(pixel: number): Promise<void>;
  measure(): Promise<{ textLength: number }>;
}

/** What the reader needs of a started profile. */
export interface BrowserConnection {
  newPage(): Promise<BrowserPage>;
  seedCookies(cookies: ReadonlyArray<{ name: string; value: string; domain: string; path: string; secure: boolean }>): Promise<void>;
  close(): Promise<void>;
}

/** Connects automation to a running Octo profile through its CDP endpoint. */
export type ConnectBrowser = (wsEndpoint: string) => Promise<BrowserConnection>;

export interface BrowserLinkedInReaderOptions {
  accounts: readonly LinkedInAccount[];
  /** The Octo profile UUID for each account, aligned by index. */
  profileUuids: readonly string[];
  client?: OctoLocalClient;
  connect?: ConnectBrowser;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
}

/** A page read through the browser, with room for the quote checker to ask for more text. */
export interface BrowserReadOptions {
  simDay?: number | null;
  signal?: AbortSignal;
  maxTextChars?: number;
  html?: boolean;
}

/** The browser reader: a web reader that also takes a per-read text ceiling. */
export interface BrowserLinkedInReader extends WebReader {
  read(url: string, options?: BrowserReadOptions): Promise<PageRead>;
}

const MIN_TEXT_CHARS = 80;
/** How far a scroll step moves, and how long a reader pauses over what it just read. */
const SCROLL_STEP_PX: readonly [number, number] = [300, 700];
const SCROLL_PAUSE_MS: readonly [number, number] = [400, 1500];
/** A person scrolls a page before deciding it is read, and stops at the end of it. */
const MIN_SCROLL_STEPS = 3;
const MAX_SCROLL_STEPS = 14;

function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

/** The account's session cookies, as browser cookies on the network's own domain. */
function cookiesFromHeader(header: string): Array<{ name: string; value: string; domain: string; path: string; secure: boolean }> {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .flatMap((part) => {
      const equals = part.indexOf("=");
      const name = equals === -1 ? part : part.slice(0, equals);
      if (!name) return [];
      return [{ name, value: equals === -1 ? "" : part.slice(equals + 1), domain: ".linkedin.com", path: "/", secure: true }];
    });
}

export function createBrowserLinkedInReader(options: BrowserLinkedInReaderOptions): BrowserLinkedInReader {
  if (options.profileUuids.length !== options.accounts.length) {
    throw new Error("Every account needs its own Octo profile UUID in OCTO_PROFILE_UUIDS, aligned to LINKEDIN_COOKIES.");
  }
  const pool = linkedInSessionPoolFor(options.accounts, options.now);
  const client = options.client ?? createOctoLocalClient();
  const connect = options.connect ?? ((wsEndpoint: string) => defaultConnect(wsEndpoint, timeoutMs));
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 45_000;

  interface AccountBrowser {
    connection: BrowserConnection | null;
    page: BrowserPage | null;
    tail: Promise<void>;
  }
  const browsers: AccountBrowser[] = options.accounts.map(() => ({ connection: null, page: null, tail: Promise.resolve() }));

  /** Drops the account's tab and connection; closing only disconnects, the profile keeps running. */
  async function closeAccountBrowser(index: number): Promise<void> {
    const state = browsers[index]!;
    const connection = state.connection;
    state.page = null;
    state.connection = null;
    await connection?.close().catch(() => undefined);
  }

  /** A page for the account, starting its profile once and seeding the session cookie. */
  async function ensureBrowser(index: number): Promise<BrowserPage> {
    const state = browsers[index]!;
    if (state.page) return state.page;
    // A connection that outlived its tab gets a fresh tab; only without one is the
    // profile started, and starting is what the partner's Octo plan is charged for.
    if (state.connection) {
      state.page = await state.connection.newPage();
      return state.page;
    }
    const uuid = options.profileUuids[index]!;
    let wsEndpoint: string;
    try {
      wsEndpoint = (await client.startProfile(uuid)).wsEndpoint;
    } catch (error) {
      if (!(error instanceof OctoProfileAlreadyStarted)) throw error;
      // Only the start call says where a running profile's endpoint is, so one left over
      // from an earlier process is stopped and started again. Its cookies persist.
      await client.stopProfile(uuid);
      wsEndpoint = (await client.startProfile(uuid)).wsEndpoint;
    }
    const connection = await connect(wsEndpoint);
    try {
      await connection.seedCookies(cookiesFromHeader(options.accounts[index]!.cookie));
      state.page = await connection.newPage();
    } catch (error) {
      // A connection that never became a page is not kept.
      await connection.close().catch(() => undefined);
      throw error;
    }
    state.connection = connection;
    return state.page;
  }

  /** The tab is one person's: reads for an account happen one after another. */
  function withAccount<T>(index: number, run: () => Promise<T>): Promise<T> {
    const state = browsers[index]!;
    const previous = state.tail;
    let release!: () => void;
    const own = new Promise<void>((resolve) => { release = resolve; });
    state.tail = previous.then(() => own);
    return (async () => {
      await previous;
      try {
        return await run();
      } finally {
        release();
      }
    })();
  }

  async function readLikeAPerson(page: BrowserPage, targetText: number): Promise<void> {
    let lastText = -1;
    let still = 0;
    for (let step = 0; step < MAX_SCROLL_STEPS; step += 1) {
      const before = await page.measure();
      if (step >= MIN_SCROLL_STEPS) {
        // Enough is enough, and a page that gave nothing new twice has reached its end.
        if (before.textLength >= targetText) return;
        if (before.textLength === lastText) {
          still += 1;
          if (still >= 2) return;
        } else {
          still = 0;
        }
      }
      lastText = before.textLength;
      await page.scrollBy(between(random, SCROLL_STEP_PX[0], SCROLL_STEP_PX[1]));
      await sleep(between(random, SCROLL_PAUSE_MS[0], SCROLL_PAUSE_MS[1]));
    }
  }

  return {
    async read(rawUrl, readOptions?: BrowserReadOptions): Promise<PageRead> {
      const input = cleanUrl(rawUrl);
      const baseUrl = input ?? rawUrl;
      if (!input) return pageResult("blocked", "This address is not a readable public web address.", baseUrl);
      if (!isProfessionalNetworkUrl(input)) return pageResult("unreachable", "The browser reads only the professional network.", baseUrl);
      if (readOptions?.signal?.aborted) return pageResult("unreachable", "The page request was cancelled.", baseUrl);
      const account = pool.pick();
      if (!account) {
        return pageResult("blocked", pool.restingDetail() ?? "Every account asked for a pause.", baseUrl);
      }
      return withAccount(account.index, async () => {
        // A person waits between pages; the dwell holds this tab until the wait is over.
        await sleep(pool.dwellMs());
        let page: BrowserPage;
        try {
          page = await ensureBrowser(account.index);
        } catch (error) {
          // The app or the profile not being reachable is a pause, not a dead page.
          const detail = error instanceof Error ? error.message : "The browser app could not be reached.";
          return pageResult("blocked", `The read asked for a pause: ${detail}`, baseUrl);
        }
        try {
          await page.goto(input, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
        } catch {
          // The page did not open. The tab is dropped; the profile and its connection
          // stay, so the next read opens a fresh tab instead of restarting the browser.
          browsers[account.index]!.page = null;
          return pageResult("unreachable", "The page could not be read in the browser.", baseUrl);
        }
        let finalUrl: string;
        let html: string;
        try {
          await readLikeAPerson(page, readOptions?.maxTextChars ?? 12_000);
          finalUrl = cleanUrl(page.url()) ?? input;
          // The network parks a session it is unsure of on a wall or a checkpoint; both
          // mean the account was refused, not that the page is unreadable.
          if (/\/authwall|\/checkpoint\//iu.test(finalUrl)) {
            pool.cool(account.index);
            return pageResult("blocked", /\/authwall/iu.test(finalUrl) ? "The page is behind a login wall." : "The account was asked to check in, so it rests until its next workday.", baseUrl);
          }
          html = await page.content();
        } catch {
          // The connection itself failed: the next read starts the profile again.
          await closeAccountBrowser(account.index);
          return pageResult("unreachable", "The page could not be read in the browser.", baseUrl);
        }
        const safeHtml = stripUnsafeBlocks(html);
        const raw = htmlToText(safeHtml);
        const maxTextChars = readOptions?.maxTextChars ?? 12_000;
        // Truncation is judged before the text is tidied, which can only shrink it: a cut
        // page whose tidied text happens to fall short is still reported as cut.
        const truncated = raw.length > maxTextChars;
        const text = cleanPlain(raw, maxTextChars);
        if (text.length < MIN_TEXT_CHARS) return pageResult("unreachable", "Too little text to read.", finalUrl);
        pool.noteRead(account.index);
        return {
          status: "ok",
          detail: "Page read.",
          url: finalUrl,
          title: extractTitle(safeHtml),
          text,
          links: extractLinks(safeHtml, finalUrl, input),
          truncated,
          html: null,
        };
      });
    },
  };
}

/**
 * Routes reads of the professional network to the browser and every other read to the
 * supplied reader, so only one path ever carries an account.
 */
export function createRoutingWebReader(browser: WebReader, fallback: WebReader): WebReader {
  return {
    async read(url, options) {
      const cleaned = cleanUrl(url);
      return cleaned && isProfessionalNetworkUrl(cleaned) ? browser.read(url, options) : fallback.read(url, options);
    },
  };
}

/** Connects to an Octo profile with Playwright over CDP. Closing only disconnects. */
async function defaultConnect(wsEndpoint: string, timeoutMs: number): Promise<BrowserConnection> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(wsEndpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error("The Octo profile opened without a browsing context.");
  // An answer that never comes must not hold the reader forever: page work that Playwright
  // does not time out on its own is raced against the read timeout.
  const raced = <T>(work: Promise<T>): Promise<T> =>
    Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        setTimeout(() => reject(new Error("The browser page did not answer in time.")), timeoutMs);
      }),
    ]);
  return {
    async newPage(): Promise<BrowserPage> {
      const existing = context.pages();
      const playwrightPage = existing[0] ?? (await context.newPage());
      // The wheel goes to the middle of the window, over the page's own content rather
      // than a fixed header; the point is found once per page.
      let wheelAt: { x: number; y: number } | null = null;
      return {
        async goto(url: string, gotoOptions: { timeout: number; waitUntil: "domcontentloaded" }) {
          await playwrightPage.goto(url, gotoOptions);
        },
        url: () => playwrightPage.url(),
        content: () => raced(playwrightPage.content()),
        async scrollBy(pixel: number) {
          wheelAt ??= await raced(playwrightPage.evaluate(() => {
            const window_ = globalThis as unknown as { innerWidth: number; innerHeight: number };
            return { x: Math.floor(window_.innerWidth / 2), y: Math.floor(window_.innerHeight / 2) };
          }));
          await raced(playwrightPage.mouse.move(wheelAt.x, wheelAt.y));
          await raced(playwrightPage.mouse.wheel(0, pixel));
        },
        measure: () => raced(playwrightPage.evaluate(() => {
          const document_ = (globalThis as unknown as { document: { body: { innerText: string | null } | null } }).document;
          return { textLength: document_.body?.innerText?.length ?? 0 };
        })),
      };
    },
    async seedCookies(cookies) {
      await context.addCookies(cookies.map((cookie) => ({ ...cookie })));
    },
    async close() {
      await browser.close();
    },
  };
}

function pageResult(status: PageRead["status"], detail: string, url: string): PageRead {
  return { status, detail, url, title: "", text: "", links: [] };
}
