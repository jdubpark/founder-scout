/**
 * Builds a frozen, dated evaluation set from old Launch HN posts. The collector only reads
 * the historical post and its thread: anything read today can carry what happened later.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { companyIdentityDomain, normalizeCompanyName, type PastCase, type PastEvidence } from "@agentswarm/shared";
import { assertSuccessful, defaultFetch, httpGet, parseJson, type FetchFn } from "./http";
import { asRecord, cleanPlain, cleanText } from "./util";

const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date";
const HN_ITEM_URL = "https://hn.algolia.com/api/v1/items/";
const WIKIPEDIA_URL = "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_unicorn_startup_companies&prop=wikitext&format=json&formatversion=2";

export interface CollectLaunchesOptions {
  from: string;
  to: string;
  fetchFn?: FetchFn;
  pauseMs?: number;
  replyWindowHours?: number;
  maxReplies?: number;
}

interface LaunchHit {
  id: string;
  title: string;
  author: string;
  createdAt: string;
  createdAtSeconds: number;
  text: string;
  url: string;
}

interface LaunchTitle {
  /** The title with its whitespace tidied. The search index sometimes holds doubled spaces. */
  title: string;
  company: string;
  tagline: string;
  /** For example "W18". */
  batch: string;
}

interface ThreadReply {
  author: string;
  date: string;
  seconds: number;
  text: string;
  children: unknown[];
}

function dateSeconds(value: string, name: string): number {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) throw new Error(`--${name} must be a valid date.`);
  return Math.floor(at / 1000);
}

function launchTitle(rawTitle: string): LaunchTitle | null {
  const title = rawTitle.replace(/\s+/g, " ").trim();
  // Also "(YC.S18)" and "(YC W18 Nonprofit)", both of which real posts use.
  const match = /^Launch HN:\s*(.+?)\s*\(YC[\s.]*([WSFX]\d{2})(?:\s[^)]*)?\)(.*)$/i.exec(title);
  if (!match) return null;
  const company = (match[1] ?? "").trim();
  if (!company) return null;
  return {
    title,
    company,
    tagline: (match[3] ?? "").replace(/^\s*[-–—]\s*/, "").trim(),
    batch: (match[2] ?? "").toUpperCase(),
  };
}

function searchUrl(from: string, to: string, page: number): string {
  const url = new URL(HN_SEARCH_URL);
  url.search = new URLSearchParams({
    query: '"Launch HN"',
    tags: "story",
    numericFilters: `created_at_i>=${from},created_at_i<${to}`,
    hitsPerPage: "100",
    page: String(page),
  }).toString();
  return url.toString();
}

function parseSearch(body: string): { hits: LaunchHit[]; pages: number } {
  const data = asRecord(parseJson("Hacker News", body));
  if (!data || !Array.isArray(data.hits) || typeof data.nbPages !== "number") {
    throw new Error("Hacker News returned an unexpected search response.");
  }
  const hits: LaunchHit[] = [];
  for (const raw of data.hits) {
    const hit = asRecord(raw);
    if (!hit || typeof hit.objectID !== "string" || typeof hit.created_at_i !== "number") continue;
    hits.push({
      id: hit.objectID,
      title: typeof hit.title === "string" ? hit.title : "",
      author: typeof hit.author === "string" ? hit.author : "",
      createdAt: typeof hit.created_at === "string" ? hit.created_at : new Date(hit.created_at_i * 1000).toISOString(),
      createdAtSeconds: hit.created_at_i,
      text: typeof hit.story_text === "string" ? hit.story_text : "",
      url: typeof hit.url === "string" ? hit.url : "",
    });
  }
  return { hits, pages: Math.max(0, Math.ceil(data.nbPages)) };
}

function parseThreadReply(value: unknown): ThreadReply | null {
  const item = asRecord(value);
  if (!item || typeof item.author !== "string") return null;
  const seconds = typeof item.created_at_i === "number"
    ? item.created_at_i
    : typeof item.created_at === "string" ? Math.floor(Date.parse(item.created_at) / 1000) : Number.NaN;
  if (!Number.isFinite(seconds)) return null;
  const children = Array.isArray(item.children) ? item.children : [];
  return {
    author: item.author,
    date: typeof item.created_at === "string" ? item.created_at : new Date(seconds * 1000).toISOString(),
    seconds,
    text: typeof item.text === "string" ? item.text : "",
    children,
  };
}

function collectReplies(root: unknown, author: string, start: number, end: number, max: number): ThreadReply[] {
  if (!author || max === 0) return [];
  const item = asRecord(root);
  const children = Array.isArray(item?.children) ? item.children : [];
  const pending: ThreadReply[] = [];
  const visit = (values: unknown[]) => {
    for (const value of values) {
      const reply = parseThreadReply(value);
      if (!reply) continue;
      if (reply.author === author && reply.seconds >= start && reply.seconds <= end && cleanText(reply.text)) pending.push(reply);
      visit(reply.children);
    }
  };
  visit(children);
  return pending.sort((a, b) => a.seconds - b.seconds).slice(0, max);
}

function normalizedHost(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
    return /^[a-z0-9.-]+$/.test(host) && host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

function hostsInText(text: string): string[] {
  const hosts: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    // A link at the end of a sentence carries the sentence's full stop or comma with it.
    const host = normalizedHost(match[0].replace(/[.,;:!?]+$/, ""));
    if (host) hosts.push(host);
  }
  return hosts;
}

const FALSE_PEOPLE = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "hi", "hey", "hn", "yc", "hacker", "news", "hacker news", "show", "launch",
  // Words that start a sentence before "here" ("So here is the thing"), and roles, are not people.
  "so", "and", "but", "now", "well", "also", "right", "just", "still", "yes", "no", "ok", "okay", "sure", "thanks", "hello",
  "we", "it", "this", "that", "there", "here", "you", "they", "our", "my", "the", "an", "everyone", "anyone", "someone",
  "happy", "glad", "excited", "example", "founder", "founders", "cofounder", "co-founder", "ceo", "cto", "team", "i'm", "i’m", "i am",
]);
// A capital, then letters, ending in a small letter: "McKenzie", "Chen-Chen" and "O'Brien" are
// names; "YC" and "CEO" are not, and neither is a word cut off at a hyphen.
const NAME_WORD = String.raw`\p{Lu}(?!\p{Lu})[\p{L}\p{M}'’-]*\p{Ll}`;
const NAME = String.raw`(?:${NAME_WORD}(?:\s+${NAME_WORD})?)`;

function peopleFromText(text: string, company: string): string[] {
  const names: string[] = [];
  const add = (raw: string) => {
    const name = raw.trim().replace(/[.,;:!?]+$/, "").replace(/['’]s$/, "").replace(/\s+/g, " ");
    if (!name || FALSE_PEOPLE.has(name.toLocaleLowerCase()) || normalizeCompanyName(name) === normalizeCompanyName(company)) return;
    if (!names.some((existing) => existing.toLocaleLowerCase() === name.toLocaleLowerCase())) names.push(name);
  };
  const patterns = [
    new RegExp(String.raw`\b(?:I['’]m|I am|[Mm]y name is)\s+(${NAME})`, "gu"),
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) add(match[1] ?? "");
  }
  // "Dan here" and "James, Tim and Aaron here": every name in the list, not only the last.
  const herePattern = new RegExp(String.raw`(?<![\p{L}\p{N}])(${NAME}(?:\s*,\s*${NAME})*(?:\s*,?\s+(?:and|&)\s+${NAME})?)\s+here\b`, "gu");
  for (const match of text.matchAll(herePattern)) {
    for (const person of (match[1] ?? "").split(/\s*,\s*(?:(?:and|&)\s+)?|\s+(?:and|&)\s+/).filter(Boolean)) add(person);
  }
  const wePattern = new RegExp(String.raw`\b(?:[Ww]e['’]re|[Ww]e are)\s+(${NAME}(?:\s*,\s*${NAME})*(?:\s*,?\s+and\s+${NAME})?)`, "gu");
  for (const match of text.matchAll(wePattern)) {
    const list = (match[1] ?? "").split(/\s*,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean);
    // One capitalised word after "we are" is as often a nationality or the company as a person.
    if (list.length < 2) continue;
    for (const person of list) add(person);
  }
  return names;
}

/**
 * The part of each site's address that names the company: the label that carries the company's
 * name when one does, otherwise the one before the ending. "app" in "app.acme.com" is not a name.
 */
function domainLabels(domains: readonly string[], companyNeedle: string): string[] {
  const out: string[] = [];
  for (const domain of domains) {
    const labels = domain.split(".");
    const named = companyNeedle.length >= 3
      ? labels.find((label) => label.replace(/[^a-z0-9]+/g, "").includes(companyNeedle))
      : undefined;
    const label = named ?? labels.at(-2);
    if (label && label.length >= 3) out.push(label);
  }
  return out;
}

/** Words a company adds to its name that its own post usually leaves off. */
const NAME_TAIL = new Set([
  "inc", "llc", "ltd", "limited", "corp", "corporation", "gmbh", "co", "company",
  "labs", "lab", "app", "apps", "ai", "hq", "io", "tech", "technologies", "systems", "software", "health",
]);

/**
 * Shorter spellings a post is likely to use for the company: without a leading "The", and
 * without trailing words such as "Inc." or "Labs". The launch of "Fintual Inc." says "Fintual"
 * throughout, and a name left in the text tells a model which company it is reading about.
 */
function shorterNames(company: string): string[] {
  const out: string[] = [];
  let words = company.replace(/\s+/g, " ").trim().split(" ");
  if (words.length > 1 && words[0]?.toLowerCase() === "the") {
    words = words.slice(1);
    out.push(words.join(" "));
  }
  while (words.length > 1 && NAME_TAIL.has((words.at(-1) ?? "").toLowerCase().replace(/[^a-z]/g, ""))) {
    words = words.slice(0, -1);
    out.push(words.join(" "));
  }
  return out.filter((name) => name.length >= 3);
}

function makeCase(hit: LaunchHit, title: LaunchTitle, replies: ThreadReply[], replyWindowHours: number): PastCase | null {
  const postText = cleanText(hit.text);
  const evidence: PastEvidence[] = [{
    kind: "launch",
    source: "hackernews",
    title: title.title,
    text: postText,
    date: hit.createdAt,
  }];
  for (const reply of replies) {
    evidence.push({
      kind: "post",
      source: "hackernews",
      title: "Reply from the company",
      text: cleanText(reply.text).slice(0, 2000),
      date: reply.date,
    });
  }
  if (!postText && replies.length === 0) return null;

  // A host many companies share (a code host, a video site) does not identify this one. Counting
  // it would mask that host's name everywhere and could match the case to that host's own company.
  const postHost = hit.url ? companyIdentityDomain(hit.url) : null;
  const companyNeedle = title.company.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const linkedHosts = companyNeedle.length >= 3
    ? hostsInText(postText).filter((host) => companyIdentityDomain(host) !== null && host.replace(/[^a-z0-9]+/g, "").includes(companyNeedle))
    : [];
  const domains = [...new Set([...(postHost ? [postHost] : []), ...linkedHosts])];
  const aliases = [...new Set([
    ...(title.company.replace(/\s+/g, "") !== title.company ? [title.company.replace(/\s+/g, "")] : []),
    ...shorterNames(title.company),
    ...domainLabels(domains, companyNeedle),
  ])].filter((alias) => alias.toLowerCase() !== title.company.toLowerCase());
  const postAt = Date.parse(hit.createdAt);
  const asOf = new Date(postAt + replyWindowHours * 60 * 60 * 1000).toISOString();
  const at = new Date(postAt);
  const cohort = `${at.getUTCFullYear()}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
  return {
    id: `past_hn_${hit.id}`,
    cohort,
    asOf,
    batch: title.batch,
    subject: {
      company: title.company,
      aliases,
      // A founder who is not named in the post may sign a reply, and the replies are shown too.
      people: peopleFromText([postText, ...replies.map((reply) => cleanText(reply.text).slice(0, 2000))].join("\n\n"), title.company),
      domains,
      handles: hit.author ? [hit.author] : [],
    },
    evidence,
    outcome: 0,
    outcomeSource: "unlabelled",
  };
}

export async function collectLaunchPosts(options: CollectLaunchesOptions): Promise<PastCase[]> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const from = dateSeconds(options.from, "from");
  const to = dateSeconds(options.to, "to");
  if (from >= to) throw new Error("--from must be earlier than --to.");
  const pauseMs = options.pauseMs ?? 250;
  const replyWindowHours = options.replyWindowHours ?? 72;
  const maxReplies = options.maxReplies ?? 8;
  if (!Number.isFinite(pauseMs) || pauseMs < 0) throw new Error("pauseMs must be a non-negative number.");
  if (!Number.isFinite(replyWindowHours) || replyWindowHours < 0) throw new Error("replyWindowHours must be a non-negative number.");
  if (!Number.isSafeInteger(maxReplies) || maxReplies < 0) throw new Error("maxReplies must be a non-negative whole number.");

  let requests = 0;
  const get = async (url: string) => {
    if (requests > 0 && pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    requests += 1;
    const result = await httpGet(fetchFn, "Hacker News", url);
    assertSuccessful("Hacker News", result, Date.now());
    return result.body;
  };

  const hits: LaunchHit[] = [];
  let pages = 1;
  for (let page = 0; page < pages; page += 1) {
    const result = parseSearch(await get(searchUrl(String(from), String(to), page)));
    if (page === 0) pages = result.pages;
    hits.push(...result.hits);
  }

  const cases: PastCase[] = [];
  for (const hit of hits) {
    const title = launchTitle(hit.title);
    if (!title) continue;
    const thread = asRecord(parseJson("Hacker News", await get(`${HN_ITEM_URL}${encodeURIComponent(hit.id)}`)));
    if (!thread) throw new Error("Hacker News returned an unexpected thread response.");
    const end = hit.createdAtSeconds + replyWindowHours * 3600;
    const replies = collectReplies(thread, hit.author, hit.createdAtSeconds, end, maxReplies);
    const pastCase = makeCase(hit, title, replies, replyWindowHours);
    if (pastCase) cases.push(pastCase);
  }
  return firstLaunchEach(cases);
}

/**
 * One case for each company. Some companies launch twice, and both posts have the same outcome:
 * kept twice, one company would count double and could sit on both sides of the tuning split.
 * The earlier post is kept, because it is the one written knowing least.
 */
export function firstLaunchEach(cases: readonly PastCase[]): PastCase[] {
  const earliest = new Map<string, PastCase>();
  for (const pastCase of cases) {
    const key = `${normalizeCompanyName(pastCase.subject.company)}|${pastCase.batch ?? ""}`;
    const seen = earliest.get(key);
    if (!seen || Date.parse(pastCase.asOf) < Date.parse(seen.asOf)) earliest.set(key, pastCase);
  }
  const kept = new Set(earliest.values());
  return cases.filter((pastCase) => kept.has(pastCase));
}

export interface OutcomeLabel {
  company: string;
  outcome: 0 | 1;
  source: string;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function parseLabelsCsv(text: string): OutcomeLabel[] {
  const rows = parseCsvRows(text);
  const header = (rows.shift() ?? []).map((cell) => cell.replace(/^\uFEFF/, "").trim().toLowerCase());
  const columns = { company: header.indexOf("company"), outcome: header.indexOf("outcome"), source: header.indexOf("source") };
  if (columns.company < 0 || columns.outcome < 0 || columns.source < 0) {
    throw new Error("Labels CSV must include the expected columns: company, outcome, source.");
  }
  const labels: OutcomeLabel[] = [];
  for (const row of rows) {
    const company = (row[columns.company] ?? "").trim();
    const rawOutcome = (row[columns.outcome] ?? "").trim();
    if (!company || (rawOutcome !== "0" && rawOutcome !== "1")) continue;
    labels.push({ company, outcome: Number(rawOutcome) as 0 | 1, source: (row[columns.source] ?? "").trim() });
  }
  return labels;
}

function stripWikiMarkup(input: string): string {
  let value = input.replace(/<ref\b[^>]*\/>/gi, "").replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, "");
  for (let i = 0; i < 8 && /\{\{[\s\S]*?\}\}/.test(value); i += 1) value = value.replace(/\{\{[\s\S]*?\}\}/g, "");
  value = value.replace(/\[\[([^\]]+)\]\]/g, (_whole, link: string) => (link.split("|").at(-1) ?? link).split("#")[0] ?? "");
  value = value.replace(/\[https?:\/\/[^\s\]]+(?:\s+([^\]]+))?\]/gi, "$1");
  value = value.replace(/<[^>]*>/g, "").replace(/'''?([^']+)'''?/g, "$1").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");
  return cleanPlain(value.replace(/'''|''/g, "")).replace(/_/g, " ").trim();
}

function tableRows(table: string): string[][] {
  const rows: string[][] = [];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length === 0) return;
    const cells: string[] = [];
    for (const line of lines) {
      if (!/^\s*\|/.test(line) || /^\s*\|[-}]/.test(line)) continue;
      const content = line.replace(/^\s*\|/, "");
      cells.push(...content.split(/\|\|/));
    }
    if (cells.length) rows.push(cells);
    lines = [];
  };
  for (const line of table.split(/\r?\n/)) {
    if (/^\s*\|-/.test(line)) { flush(); continue; }
    if (/^\s*\|\}/.test(line)) { flush(); continue; }
    if (/^\s*\|/.test(line)) lines.push(line);
  }
  flush();
  return rows;
}

function headerCells(table: string): string[] {
  const headerLines = table.split(/\r?\n/).filter((line) => /^\s*!/.test(line));
  return headerLines.flatMap((line) => line.replace(/^\s*!/, "").split(/!!/).map((cell) => {
    const separator = cell.indexOf("|");
    return stripWikiMarkup(separator >= 0 ? cell.slice(separator + 1) : cell).toLocaleLowerCase();
  }));
}

export function parseUnicornWikitext(wikitext: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const tableMatch of wikitext.matchAll(/\{\|[\s\S]*?\|\}/g)) {
    const table = tableMatch[0] ?? "";
    const companyIndex = headerCells(table).findIndex((cell) => cell === "company");
    if (companyIndex < 0) continue;
    const rows = tableRows(table);
    for (const row of rows) {
      const cell = row[companyIndex];
      if (cell === undefined) continue;
      const name = stripWikiMarkup(cell);
      const key = normalizeCompanyName(name);
      if (!name || key === "company" || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

export async function fetchUnicornNames(options: { fetchFn?: FetchFn } = {}): Promise<{ names: string[]; source: string }> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const result = await httpGet(fetchFn, "Wikipedia", WIKIPEDIA_URL);
  assertSuccessful("Wikipedia", result, Date.now());
  const data = asRecord(parseJson("Wikipedia", result.body));
  const parse = asRecord(data?.parse);
  if (!parse || typeof parse.wikitext !== "string") throw new Error("Wikipedia returned an unexpected wikitext response.");
  return {
    names: parseUnicornWikitext(parse.wikitext),
    source: `Wikipedia, List of unicorn startup companies, read ${new Date().toISOString().slice(0, 10)}`,
  };
}

const YC_DIRECTORY_URL = "https://yc-oss.github.io/api/companies/all.json";

/** One company in a programme's public directory, reduced to what an outcome label needs. */
export interface DirectoryEntry {
  name: string;
  formerNames: string[];
  /** The intake as a launch title writes it, for example "W18". */
  batch: string;
  /** "Active", "Inactive", "Acquired" or "Public". */
  status: string;
  topCompany: boolean;
  teamSize: number | null;
  domain: string | null;
}

const SEASON_LETTER: Record<string, string> = { winter: "W", summer: "S", fall: "F", spring: "X" };

function batchTag(batch: unknown): string | null {
  if (typeof batch !== "string") return null;
  const match = /^(Winter|Summer|Fall|Spring)\s+\d{2}(\d{2})$/i.exec(batch.trim());
  if (!match) return null;
  return `${SEASON_LETTER[(match[1] ?? "").toLowerCase()] ?? ""}${match[2] ?? ""}`;
}

export function parseYcDirectory(data: unknown): DirectoryEntry[] {
  if (!Array.isArray(data)) throw new Error("The company directory returned an unexpected response.");
  const entries: DirectoryEntry[] = [];
  for (const raw of data) {
    const item = asRecord(raw);
    const batch = batchTag(item?.batch);
    if (!item || typeof item.name !== "string" || !item.name.trim() || !batch) continue;
    entries.push({
      name: item.name.trim(),
      formerNames: Array.isArray(item.former_names)
        ? item.former_names.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        : [],
      batch,
      status: typeof item.status === "string" ? item.status : "",
      topCompany: item.top_company === true,
      teamSize: typeof item.team_size === "number" && Number.isFinite(item.team_size) ? item.team_size : null,
      domain: typeof item.website === "string" ? companyIdentityDomain(item.website) : null,
    });
  }
  return entries;
}

/**
 * Y Combinator's public company directory, read through an open mirror of it. Every launch in
 * this dataset is one of its companies, so the directory can say how each one turned out, and
 * the intake settles which company a name means.
 */
export async function fetchYcDirectory(options: { fetchFn?: FetchFn } = {}): Promise<{ entries: DirectoryEntry[]; source: string }> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const result = await httpGet(fetchFn, "Company directory", YC_DIRECTORY_URL);
  assertSuccessful("Company directory", result, Date.now());
  return {
    entries: parseYcDirectory(parseJson("Company directory", result.body)),
    source: `Y Combinator company directory (open mirror, yc-oss.github.io), read ${new Date().toISOString().slice(0, 10)}`,
  };
}

/**
 * How a directory entry turned out, against a stated bar: listed on a stock exchange, on the
 * programme's own list of top companies, or still operating with at least `minTeam` people.
 * Headcount is a stand-in for scale; it is the one figure the directory publishes for everyone.
 *
 * null means the directory cannot say. An acquisition is the usual case: the price is rarely
 * public, and a rescue and a billion-dollar sale look the same here. Such a case is left out
 * of the dataset; guessing would put noise in the labels.
 */
export function directoryOutcome(entry: DirectoryEntry, minTeam: number): { outcome: 0 | 1 | null; reason: string } {
  if (entry.status === "Public") return { outcome: 1, reason: "publicly listed" };
  if (entry.topCompany) return { outcome: 1, reason: "on the programme's list of top companies" };
  if (entry.status === "Inactive") return { outcome: 0, reason: "no longer operating" };
  if (entry.status === "Active") {
    if (entry.teamSize === null) return { outcome: null, reason: "operating, headcount not published" };
    return entry.teamSize >= minTeam
      ? { outcome: 1, reason: `operating with ${entry.teamSize} people` }
      : { outcome: 0, reason: `operating with ${entry.teamSize} people, under the bar of ${minTeam}` };
  }
  return { outcome: null, reason: entry.status ? `${entry.status.toLowerCase()}, terms not public` : "status not published" };
}

export interface LabelSources {
  /** A person's own labels. The first match wins, and these win over everything else. */
  reviewed?: readonly OutcomeLabel[];
  directory?: { entries: readonly DirectoryEntry[]; source: string; minTeam: number };
  /** A public list of successes, matched by name. */
  listed?: readonly OutcomeLabel[];
}

export interface LabelResult {
  cases: PastCase[];
  positives: number;
  /** Cases left out because no source could say how they turned out, with the reason. */
  unknown: Array<{ company: string; reason: string }>;
  /** Successes in the reviewed labels that matched no case. */
  reviewedMisses: string[];
}

/**
 * Attach an outcome to each case.
 *
 * A label matches on the company's own name, never on a name or a site taken from a link alone:
 * a post that links to a well-known site must not inherit that site's outcome. A directory
 * entry must also be from the same intake or have the company's own site, because unrelated
 * companies share names.
 *
 * Order: a reviewed label, then the directory, then a public list of successes. A case nobody
 * can speak for is left out, never counted as a failure. With a directory, the list can only
 * raise a company the directory shows still operating. Without one, only a reviewed label can
 * say a company did not meet the bar, so a dataset needs the directory or reviewed negatives.
 */
export function labelPastCases(cases: readonly PastCase[], sources: LabelSources): LabelResult {
  const reviewed = sources.reviewed ?? [];
  const listed = sources.listed ?? [];
  const matchedReviewed = new Set<OutcomeLabel>();
  const unknown: Array<{ company: string; reason: string }> = [];
  const labelled: PastCase[] = [];

  for (const pastCase of cases) {
    const company = pastCase.subject.company;
    const names = new Set([company, company.replace(/\s+/g, "")].map(normalizeCompanyName).filter(Boolean));
    const named = (label: OutcomeLabel) => names.has(normalizeCompanyName(label.company));

    const own = reviewed.find(named);
    if (own) {
      matchedReviewed.add(own);
      labelled.push({ ...pastCase, outcome: own.outcome, outcomeSource: own.source });
      continue;
    }

    const onList = listed.find((label) => label.outcome === 1 && named(label));
    if (!sources.directory) {
      // A list of successes says nothing about a company that is not on it: it may have been
      // bought, or simply be missing. Only a person's own label can say a company did not make it.
      if (onList) labelled.push({ ...pastCase, outcome: 1, outcomeSource: onList.source });
      else unknown.push({ company, reason: "no label names it" });
      continue;
    }

    const { entries, source, minTeam } = sources.directory;
    const sameIntake = entries.filter((entry) => !pastCase.batch || entry.batch === pastCase.batch);
    const sameName = (candidate: DirectoryEntry) =>
      [candidate.name, ...candidate.formerNames].some((name) => names.has(normalizeCompanyName(name)));
    const sameSite = (candidate: DirectoryEntry) =>
      candidate.domain !== null && pastCase.subject.domains.includes(candidate.domain);
    // The name is always required: a link in a post can point at another company's site. With
    // the name, either the intake or the company's own site settles which company it is; the
    // directory sometimes files a company under another intake than its launch names.
    const entry = sameIntake.find(sameName)
      ?? entries.find((candidate) => sameName(candidate) && sameSite(candidate));
    const verdict = entry ? directoryOutcome(entry, minTeam) : null;

    if (verdict?.outcome === 1) {
      labelled.push({ ...pastCase, outcome: 1, outcomeSource: `${source}: ${verdict.reason}` });
    } else if (entry?.status === "Active" && onList) {
      // The list knows a company only by name, and unrelated companies share names. It is
      // believed only for a company the directory shows still operating: one that shut down or
      // was bought under that name is more likely a namesake of the listed one.
      labelled.push({ ...pastCase, outcome: 1, outcomeSource: onList.source });
    } else if (verdict?.outcome === 0) {
      labelled.push({ ...pastCase, outcome: 0, outcomeSource: `${source}: ${verdict.reason}` });
    } else {
      unknown.push({ company, reason: verdict ? verdict.reason : "not found in the directory" });
    }
  }

  return {
    cases: labelled,
    positives: labelled.filter((pastCase) => pastCase.outcome === 1).length,
    unknown,
    reviewedMisses: reviewed.filter((label) => label.outcome === 1 && !matchedReviewed.has(label)).map((label) => label.company),
  };
}

export function pastCasesFile(datasetsDir: string): string {
  return join(datasetsDir, "past-founders", "cases.jsonl");
}

export async function writePastCases(datasetsDir: string, cases: readonly PastCase[]): Promise<string> {
  const path = pastCasesFile(datasetsDir);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const contents = cases.map((pastCase) => JSON.stringify(pastCase)).join("\n");
  try {
    await writeFile(temporary, contents ? `${contents}\n` : "", { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return path;
}

export async function readPastCases(datasetsDir: string): Promise<PastCase[]> {
  try {
    const text = await readFile(pastCasesFile(datasetsDir), "utf8");
    return text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as PastCase);
  } catch (error) {
    if (asRecord(error)?.code === "ENOENT") return [];
    throw error;
  }
}

export function summarisePastCases(cases: readonly PastCase[]): {
  cases: number;
  positives: number;
  cohorts: Array<{ cohort: string; cases: number; positives: number }>;
} {
  const byCohort = new Map<string, { cases: number; positives: number }>();
  for (const pastCase of cases) {
    const summary = byCohort.get(pastCase.cohort) ?? { cases: 0, positives: 0 };
    summary.cases += 1;
    summary.positives += pastCase.outcome === 1 ? 1 : 0;
    byCohort.set(pastCase.cohort, summary);
  }
  return {
    cases: cases.length,
    positives: cases.filter((pastCase) => pastCase.outcome === 1).length,
    cohorts: [...byCohort.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([cohort, summary]) => ({ cohort, ...summary })),
  };
}
