/** Parses a partner's own historical deal export into frozen, dated past-founder cases. */

import { createHash } from "node:crypto";
import { companyIdentityDomain, normalizeCompanyName, type PastCase, type PastEvidence } from "@agentswarm/shared";

interface CsvRow {
  cells: string[];
  line: number;
  error?: string;
}

export interface DealImportResult {
  cases: PastCase[];
  imported: number;
  updated: number;
  leftOutNoOutcome: number;
  refused: Array<{ line: number; reason: string }>;
}

interface ParsedDate {
  day: string;
  asOf: string;
  cohort: string;
}

function parseCsv(text: string): CsvRow[] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let rowLine = 1;
  let line = 1;
  let error: string | undefined;

  const finishRow = () => {
    cells.push(field);
    if (cells.some((cell) => cell.trim() !== "") || error) {
      rows.push({ cells, line: rowLine, ...(error ? { error } : {}) });
    }
    cells = [];
    field = "";
    afterQuote = false;
    error = undefined;
    rowLine = line;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] ?? "";
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += char;
        if (char === "\n") line += 1;
        else if (char === "\r" && input[i + 1] !== "\n") line += 1;
      }
      continue;
    }

    if (afterQuote) {
      if (char === ",") {
        cells.push(field);
        field = "";
        afterQuote = false;
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && input[i + 1] === "\n") i += 1;
        line += 1;
        finishRow();
      } else if (char === " " || char === "\t") {
        // Whitespace after a quoted field is outside its value.
      } else {
        error ??= "malformed CSV quoting.";
        field += char;
        afterQuote = false;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === '"') {
      error ??= "malformed CSV quoting.";
      field += char;
    } else if (char === ",") {
      cells.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      line += 1;
      finishRow();
    } else {
      field += char;
    }
  }

  if (quoted) error ??= "unterminated quoted field.";
  if (field.length > 0 || cells.length > 0 || error || afterQuote) finishRow();
  return rows;
}

function normalizedHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

function parseSeenDate(value: string): ParsedDate | null {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(value);
  if (!dayMatch && !monthMatch) return null;
  const year = Number(dayMatch?.[1] ?? monthMatch?.[1]);
  const month = Number(dayMatch?.[2] ?? monthMatch?.[2]);
  const day = Number(dayMatch?.[3] ?? 1);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const dateDay = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    day: dateDay,
    asOf: `${dateDay}T00:00:00.000Z`,
    cohort: `${year}-Q${Math.floor((month - 1) / 3) + 1}`,
  };
}

function cell(row: CsvRow, index: number | undefined): string {
  return index === undefined ? "" : (row.cells[index] ?? "").trim();
}

function dealId(company: string, date: string): string {
  const normalized = normalizeCompanyName(company) || company.normalize("NFKC").trim().toLocaleLowerCase();
  const digest = createHash("sha256").update(`${normalized}\0${date}`).digest("hex");
  return `past_deal_${digest}`;
}

function outcomeSource(importedDay: string, bar: string | undefined): string {
  return `Fund's own deal history, imported on ${importedDay}${bar ? `; success bar: ${bar}` : ""}`;
}

function keepImportDate(existing: PastCase, next: PastCase, bar: string | undefined): string {
  const prior = /^Fund's own deal history, imported on (\d{4}-\d{2}-\d{2})(?:; success bar: ([\s\S]*))?$/.exec(existing.outcomeSource);
  if (!prior || (prior[2] ?? "") !== (bar ?? "")) return next.outcomeSource;
  const existingContent = { ...existing, outcomeSource: "" };
  const nextContent = { ...next, outcomeSource: "" };
  return JSON.stringify(existingContent) === JSON.stringify(nextContent)
    ? outcomeSource(prior[1] ?? "", bar)
    : next.outcomeSource;
}

function asCase(
  values: { company: string; summary: string; date: ParsedDate; url: string; sector: string; stage: string; founders: string; decision: string },
  outcome: 0 | 1,
  importedDay: string,
  bar: string | undefined,
  redact: (text: string) => string,
): PastCase {
  const extra = [
    values.sector ? `Sector at the time: ${values.sector}.` : "",
    values.stage ? `Stage at the time: ${values.stage}.` : "",
  ].filter(Boolean);
  const evidenceText = [values.summary, ...extra].join("\n");
  const evidence: PastEvidence[] = [{
    kind: "other",
    source: "manual",
    title: "Fund notes",
    text: redact(evidenceText),
    date: values.date.asOf,
  }];
  const decision = values.decision.toLocaleLowerCase();
  const domains = values.url ? [companyIdentityDomain(values.url)].filter((domain): domain is string => domain !== null) : [];
  return {
    id: dealId(values.company, values.date.day),
    cohort: values.date.cohort,
    asOf: values.date.asOf,
    ...(decision === "invested" || decision === "passed" ? { decision } : {}),
    subject: {
      company: values.company,
      aliases: [],
      people: values.founders.split(";").map((name) => name.trim()).filter(Boolean),
      domains,
      handles: [],
    },
    evidence,
    outcome,
    outcomeSource: outcomeSource(importedDay, bar),
  };
}

/**
 * Import a deal-history CSV, merging by its stable company-and-seen-date id. Rows without a
 * stated outcome are counted and skipped; malformed rows never reveal company names in errors.
 */
export function importDealsCsv(
  text: string,
  options: { redact: (text: string) => string; existing?: readonly PastCase[]; now?: Date; bar?: string },
): DealImportResult {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header || header.error) {
    throw new Error("Deals CSV has no usable header. Include company, seen, summary, and outcome columns.");
  }
  const columns = new Map<string, number>();
  header.cells.forEach((name, index) => {
    const key = normalizedHeader(name);
    if (key && !columns.has(key)) columns.set(key, index);
  });
  const required = ["company", "seen", "summary", "outcome"];
  if (required.some((name) => !columns.has(name))) {
    throw new Error("Deals CSV has no usable header. Include company, seen, summary, and outcome columns.");
  }

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Import date is invalid.");
  const importedDay = now.toISOString().slice(0, 10);
  const result: DealImportResult = {
    cases: [...(options.existing ?? [])],
    imported: 0,
    updated: 0,
    leftOutNoOutcome: 0,
    refused: [],
  };
  const merged = new Map(result.cases.map((pastCase) => [pastCase.id, pastCase]));
  const before = new Set(merged.keys());
  const index = (name: string) => columns.get(name);

  for (const row of rows.slice(1)) {
    if (row.error) {
      result.refused.push({ line: row.line, reason: row.error });
      continue;
    }
    const company = cell(row, index("company"));
    const seen = cell(row, index("seen"));
    const summary = cell(row, index("summary"));
    if (!company) { result.refused.push({ line: row.line, reason: "missing required field: company." }); continue; }
    if (!seen) { result.refused.push({ line: row.line, reason: "missing required field: seen." }); continue; }
    if (!summary) { result.refused.push({ line: row.line, reason: "missing required field: summary." }); continue; }
    const date = parseSeenDate(seen);
    if (!date) {
      result.refused.push({ line: row.line, reason: "invalid seen column; expected date in YYYY-MM-DD or YYYY-MM form." });
      continue;
    }
    if (date.day > importedDay) {
      result.refused.push({ line: row.line, reason: "seen date is in the future." });
      continue;
    }

    const rawOutcome = cell(row, index("outcome")).toLocaleLowerCase();
    const outcome = rawOutcome === "1" || rawOutcome === "yes" || rawOutcome === "win"
      ? 1
      : rawOutcome === "0" || rawOutcome === "no" || rawOutcome === "miss" ? 0 : null;
    if (outcome === null) {
      result.leftOutNoOutcome += 1;
      continue;
    }

    const pastCase = asCase({
      company,
      summary,
      date,
      url: cell(row, index("url")),
      sector: cell(row, index("sector")),
      stage: cell(row, index("stage")),
      founders: cell(row, index("founders")),
      decision: cell(row, index("decision")),
    }, outcome, importedDay, options.bar?.trim() || undefined, options.redact);
    const previous = merged.get(pastCase.id);
    if (previous) pastCase.outcomeSource = keepImportDate(previous, pastCase, options.bar?.trim() || undefined);
    if (before.has(pastCase.id) || merged.has(pastCase.id)) result.updated += 1;
    else result.imported += 1;
    merged.set(pastCase.id, pastCase);
  }
  result.cases = [...merged.values()];
  return result;
}
