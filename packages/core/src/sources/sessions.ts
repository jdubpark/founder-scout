/**
 * Logged-in accounts for the professional network, supplied by the partner for pages the
 * anonymous read cannot reach. Each account may carry its own sticky proxy and user agent, so
 * one account never shares an exit address or fingerprint with another. One pool per account
 * list is shared by everything that reads those pages, so an account the network refuses rests
 * for all of them at once. Every other host is read anonymously, with no cookie.
 *
 * Each account keeps a human rhythm, seeded from its own cookie so it is the same every day
 * and after a restart: a workday with a fixed start and length, a lunch break, bursts of
 * reading with pauses between them, a daily cap on reads, and lighter weekends — some
 * accounts are off on them. The schedule is the machine's local one, so the server is
 * expected to run in the partner's timezone. The rhythm answers when an account may be read;
 * it is the caller that holds a read back until then, so an account never looks busier than
 * a person. A refusal from the network rests the account until its next workday, and a
 * second refusal within a week rests it for three days.
 */

export interface LinkedInAccount {
  cookie: string;
  proxyUrl: string | null;
  userAgent: string | null;
}

export interface LinkedInSessionPool {
  /** The next account whose rhythm allows a read now, round-robin, or null when none does. */
  pick(): { index: number; account: LinkedInAccount } | null;
  /** Records that the network refused the account: it rests until its next workday, three days on a repeat within a week. */
  cool(index: number): void;
  /** Records one successful page read by the account, against its daily cap and its current burst. */
  noteRead(index: number): void;
  /** A sentence for a held-back read when every account rests, naming when the first is back; null when an account may be read now. */
  restingDetail(): string | null;
  /** The gap to leave before the next professional-network read: human dwell, never outside 20–75 seconds. */
  dwellMs(): number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** A repeated refusal rests the account for three days. */
const REPEAT_REFUSAL_REST_MS = 72 * HOUR;
/** How long a break between bursts lasts. */
const BREAK_MINUTES: readonly [number, number] = [3, 15];
/** The dwell left between reads. */
const DWELL_MS: readonly [number, number] = [20 * SECOND, 75 * SECOND];

/** A day of local time as a comparable key, so a new local day is a new read budget. */
function localDayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function midnightOf(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function msOfDay(at: number): number {
  return at - midnightOf(at);
}

function isWeekendDay(at: number): boolean {
  const day = new Date(at).getDay();
  return day === 0 || day === 6;
}

/** FNV-1a over the cookie: the same account always draws the same persona. */
function hashCookie(cookie: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < cookie.length; index += 1) {
    hash ^= cookie.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a small deterministic generator, so every jitter is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

/**
 * The account's stable schedule, drawn from its cookie. Every field is a starting point the
 * partner can ask to change, not a finding: recruiter-like numbers chosen so an account never
 * looks busier than a person.
 */
export interface AccountPersona {
  /** 08:00–10:00 local. */
  workdayStartMinute: number;
  /** 8–10 hours. */
  workdayMinutes: number;
  /** 11:45–13:30 local. */
  lunchStartMinute: number;
  /** 30–60 minutes. */
  lunchMinutes: number;
  /** 0, 0.15 or 0.3 of the weekday cap; 0 means the account is off on weekends. */
  weekendFactor: number;
  /** 60–100 reads a weekday. */
  weekdayReadCap: number;
  /** 8–25 reads before a break. */
  burstReads: number;
  /** 10–30 minutes before a break. */
  burstMinutes: number;
}

function personaFrom(random: () => number): AccountPersona {
  return {
    workdayStartMinute: between(random, 480, 600),
    workdayMinutes: between(random, 480, 600),
    lunchStartMinute: between(random, 705, 810),
    lunchMinutes: between(random, 30, 60),
    weekendFactor: [0, 0.15, 0.3][Math.floor(random() * 3)] as number,
    weekdayReadCap: between(random, 60, 100),
    burstReads: between(random, 8, 25),
    burstMinutes: between(random, 10, 30),
  };
}

/** The persona an account keeps, the same every day and after a restart. */
export function personaFor(cookie: string): AccountPersona {
  return personaFrom(seededRandom(hashCookie(cookie)));
}

interface AccountRhythm {
  day: string;
  reads: number;
  burstStartedAt: number | null;
  burstReads: number;
  breakUntil: number;
  restUntil: number;
  refusals: number[];
}

export function createLinkedInSessionPool(accounts: readonly LinkedInAccount[], now?: () => number): LinkedInSessionPool {
  const clock = now ?? Date.now;
  const personas = accounts.map((account) => personaFor(account.cookie));
  const breakRandoms = accounts.map((account) => seededRandom(hashCookie(account.cookie)));
  // The persona draws came first from each account's generator, so its breaks continue it.
  for (const random of breakRandoms) personaFrom(random);
  const dwellRandom = seededRandom(accounts.reduce((seed, account) => Math.imul(seed ^ hashCookie(account.cookie), 0x01000193) >>> 0, 0x811c9dc5));
  const rhythms: AccountRhythm[] = accounts.map(() => ({ day: "", reads: 0, burstStartedAt: null, burstReads: 0, breakUntil: 0, restUntil: 0, refusals: [] }));
  let cursor = 0;

  /** The account's state as of now, with a new local day starting a new read budget. */
  function rhythmAt(index: number, at: number): AccountRhythm {
    const rhythm = rhythms[index]!;
    const key = localDayKey(at);
    if (rhythm.day !== key) {
      rhythm.day = key;
      rhythm.reads = 0;
      rhythm.burstStartedAt = null;
      rhythm.burstReads = 0;
    }
    return rhythm;
  }

  function readCap(persona: AccountPersona, at: number): number {
    return isWeekendDay(at) ? Math.floor(persona.weekdayReadCap * persona.weekendFactor) : persona.weekdayReadCap;
  }

  /** The start of the account's next workday after `after`, skipping weekend days it is off. */
  function nextWorkdayStart(persona: AccountPersona, after: number): number {
    for (let offset = 0; offset <= 8; offset += 1) {
      const midnight = midnightOf(after + offset * DAY);
      if (isWeekendDay(midnight) && persona.weekendFactor === 0) continue;
      const start = midnight + persona.workdayStartMinute * MINUTE;
      if (start > after) return start;
    }
    return after + DAY;
  }

  function eligible(index: number, at: number): boolean {
    const persona = personas[index]!;
    const rhythm = rhythmAt(index, at);
    if (rhythm.restUntil > at) return false;
    const cap = readCap(persona, at);
    if (cap === 0 || rhythm.reads >= cap) return false;
    const start = persona.workdayStartMinute * MINUTE;
    const end = start + persona.workdayMinutes * MINUTE;
    const ms = msOfDay(at);
    if (ms < start || ms >= end) return false;
    const lunchStart = persona.lunchStartMinute * MINUTE;
    if (ms >= lunchStart && ms < lunchStart + persona.lunchMinutes * MINUTE) return false;
    return rhythm.breakUntil <= at;
  }

  /** When the account may next be read, walking rest, cap, workday, lunch and break in order. */
  function nextEligibleAt(index: number, from: number): number {
    const persona = personas[index]!;
    const rhythm = rhythms[index]!;
    const base = Math.max(from, rhythm.restUntil);
    for (let offset = 0; offset <= 8; offset += 1) {
      const midnight = midnightOf(base + offset * DAY);
      if (isWeekendDay(midnight) && persona.weekendFactor === 0) continue;
      // Reads are counted only for the day the rhythm already holds; a later day starts at zero.
      const reads = localDayKey(midnight) === rhythm.day ? rhythm.reads : 0;
      if (reads >= readCap(persona, midnight)) continue;
      const start = midnight + persona.workdayStartMinute * MINUTE;
      const end = start + persona.workdayMinutes * MINUTE;
      let candidate = Math.max(base, start);
      if (candidate >= end) continue;
      const lunchStart = midnight + persona.lunchStartMinute * MINUTE;
      const lunchEnd = lunchStart + persona.lunchMinutes * MINUTE;
      // A break can land inside lunch, so lunch is re-checked after it.
      if (rhythm.breakUntil > candidate) candidate = rhythm.breakUntil;
      if (candidate >= lunchStart && candidate < lunchEnd) candidate = lunchEnd;
      if (candidate >= end) continue;
      return candidate;
    }
    return base + DAY;
  }

  function formatLocal(at: number, from: number): string {
    const time = new Date(at);
    const hours = String(time.getHours()).padStart(2, "0");
    const minutes = String(time.getMinutes()).padStart(2, "0");
    const daysAway = Math.round((midnightOf(at) - midnightOf(from)) / DAY);
    const day = daysAway <= 0 ? "" : daysAway === 1 ? " tomorrow" : ` on ${time.toLocaleDateString("en-US", { weekday: "long" })}`;
    return `${hours}:${minutes}${day}`;
  }

  return {
    pick() {
      const at = clock();
      for (let step = 0; step < accounts.length; step += 1) {
        const index = (cursor + step) % accounts.length;
        if (eligible(index, at)) {
          cursor = (index + 1) % accounts.length;
          return { index, account: accounts[index]! };
        }
      }
      return null;
    },
    cool(index: number): void {
      const at = clock();
      const rhythm = rhythmAt(index, at);
      rhythm.refusals.push(at);
      rhythm.refusals = rhythm.refusals.filter((refusedAt) => refusedAt > at - WEEK);
      rhythm.restUntil = rhythm.refusals.length >= 2 ? at + REPEAT_REFUSAL_REST_MS : nextWorkdayStart(personas[index]!, at);
    },
    noteRead(index: number): void {
      const at = clock();
      const persona = personas[index]!;
      const rhythm = rhythmAt(index, at);
      if (rhythm.burstStartedAt === null) {
        rhythm.burstStartedAt = at;
        rhythm.burstReads = 0;
      }
      rhythm.reads += 1;
      rhythm.burstReads += 1;
      if (rhythm.burstReads >= persona.burstReads || at - rhythm.burstStartedAt >= persona.burstMinutes * MINUTE) {
        rhythm.breakUntil = at + between(breakRandoms[index]!, BREAK_MINUTES[0], BREAK_MINUTES[1]) * MINUTE;
        rhythm.burstStartedAt = null;
        rhythm.burstReads = 0;
      }
    },
    restingDetail(): string | null {
      const at = clock();
      if (accounts.length === 0) return null;
      if (accounts.some((_account, index) => eligible(index, at))) return null;
      const next = Math.min(...accounts.map((_account, index) => nextEligibleAt(index, at)));
      return `The account asked for a pause until ${formatLocal(next, at)}.`;
    },
    dwellMs(): number {
      return between(dwellRandom, DWELL_MS[0], DWELL_MS[1]);
    },
  };
}

const pools = new Map<string, LinkedInSessionPool>();

/**
 * One pool per identical account list, so the reader and the quote checker share one rhythm.
 * A clock supplied by a test makes a fresh pool instead, so rhythm state never leaks between
 * tests; without one the pool reads the real time and is shared by everything.
 */
export function linkedInSessionPoolFor(accounts: readonly LinkedInAccount[], now?: () => number): LinkedInSessionPool {
  if (now) return createLinkedInSessionPool(accounts, now);
  const key = JSON.stringify(accounts);
  const existing = pools.get(key);
  if (existing) return existing;
  const pool = createLinkedInSessionPool(accounts);
  pools.set(key, pool);
  return pool;
}

function envLines(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\r\n|\n|\r/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Parses the partner's accounts from the environment. LINKEDIN_COOKIES holds one Cookie header
 * value per line; LINKEDIN_PROXIES and LINKEDIN_USER_AGENTS are aligned to it by index. A
 * missing entry is null, so an account with no proxy or user agent is read like the others but
 * without one.
 */
export function linkedinAccountsFromEnv(env: NodeJS.ProcessEnv): LinkedInAccount[] {
  const cookies = envLines(env.LINKEDIN_COOKIES);
  const proxies = envLines(env.LINKEDIN_PROXIES);
  const userAgents = envLines(env.LINKEDIN_USER_AGENTS);
  return cookies.map((cookie, index) => ({
    cookie,
    proxyUrl: proxies[index] ?? null,
    userAgent: userAgents[index] ?? null,
  }));
}

/** The one proxy the whole hunt reads through, or null when none is configured. */
export function huntProxyFromEnv(env: NodeJS.ProcessEnv): string | null {
  return env.HUNT_PROXY_URL?.trim() || null;
}
