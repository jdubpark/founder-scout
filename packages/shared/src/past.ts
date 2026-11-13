/**
 * Past founders: an eval made from companies whose later outcome is known.
 *
 * The question it asks is narrow: shown only what was public on a past date, does the swarm
 * rank the companies that later did well above their contemporaries that did not?
 *
 * The danger is knowing the answer. A model has read about the winners, and today's web is
 * full of their later success. So every case is built to hold that out:
 *
 *   1. Cut-off.     Evidence carries the date it was published. Code drops anything dated
 *                   after the case's as-of date, and anything with no date.
 *   2. No research. A case is a frozen pack of evidence. Nothing is looked up when it runs.
 *   3. Masking.     Names of the company, its people, its sites and handles, and calendar
 *                   years are replaced before a model sees the pack.
 *   4. Recognition. The same model is asked to name the company from the masked pack. Cases
 *                   it names correctly are scored apart and left out of the headline.
 *   5. Cohorts.     Cases are compared only with others from the same period.
 *   6. Order.       Tuning happens on earlier cohorts and the headline is the later ones,
 *                   never the reverse.
 *
 * What this cannot remove: a model's sense of which kinds of company did well in which
 * years. The recognised and unrecognised scores are reported side by side so the size of
 * what memory adds can be seen instead of assumed.
 */

import type { EvidenceKind } from "./domain";
import type { SourceId } from "./registry";

export interface PastEvidence {
  kind: EvidenceKind;
  source: SourceId;
  title: string;
  text: string;
  /** ISO date the text was published. null means unknown, and an undated item is never used. */
  date: string | null;
}

/** Who a case is about. Hidden from every model; used to mask the pack and to judge recognition. */
export interface PastSubject {
  company: string;
  /** Other spellings of the company or product name. */
  aliases: string[];
  people: string[];
  domains: string[];
  /** Account names that would identify the company or its founders. */
  handles: string[];
}

export interface PastCase {
  id: string;
  /** Cases are compared only within a cohort, for example "2018-Q1". Cohorts sort by this text. */
  cohort: string;
  /** Nothing dated after this is shown to a model. */
  asOf: string;
  /**
   * The programme intake the company named when it launched, for example "W18". Used only to
   * match an outcome label to the right company when two share a name. Hidden from every model.
   */
  batch?: string;
  subject: PastSubject;
  evidence: PastEvidence[];
  /** 1 when the company later met the success bar, 0 when it did not. Hidden from every model. */
  outcome: 0 | 1;
  /** Where the outcome label came from, for example a list and the day it was read. */
  outcomeSource: string;
}

/** What the leak controls did, shown next to the scores of a flow built on past cases. */
export interface ContaminationReport {
  cases: number;
  /** Cases the judging model named correctly from the masked pack. */
  recognised: number;
  /** Evidence items dropped for being dated after the as-of date, or undated. */
  itemsCutOff: number;
  /** The headline metric on cases the model did not recognise. */
  cleanScore: number | null;
  /** The same metric on the cases it did recognise. The gap is what memory adds. */
  recognisedScore: number | null;
  /**
   * What shuffled outcomes give on the same later-period cases: the average, the value 95% of
   * shuffles fall below, and the share of shuffles that did at least as well as the real
   * outcomes. A headline that does not clear `p95` cannot be told from chance.
   */
  placebo?: { mean: number; p95: number; atLeastObserved: number | null } | null;
  /**
   * Cases where the judging model named the year the text was written, give or take one, out
   * of `eraProbed`. A model that can date a masked launch can bring what it knows of that era.
   */
  eraNamed?: number | null;
  eraProbed?: number | null;
  /**
   * How many of the same cases one fixed year would date under the same rule: what a model
   * scores by always answering the middle of the period. `eraNamed` says something only above
   * this, and in a dataset that spans three years it never can.
   */
  eraFixed?: number | null;
}

/** The pseudonym that replaces a company name in a masked pack. */
export const MASKED_COMPANY = "the company";

/**
 * The evidence of a case as of its cut-off: dated items on or before `asOf`, oldest first.
 * Also returns how many items were dropped, for the contamination report.
 */
export function cutOff(pastCase: Pick<PastCase, "asOf" | "evidence">): { evidence: PastEvidence[]; dropped: number } {
  const limit = Date.parse(pastCase.asOf);
  const kept = pastCase.evidence.filter((item) => {
    if (!item.date) return false;
    const at = Date.parse(item.date);
    return Number.isFinite(at) && Number.isFinite(limit) && at <= limit;
  });
  kept.sort((a, b) => Date.parse(a.date as string) - Date.parse(b.date as string));
  return { evidence: kept, dropped: pastCase.evidence.length - kept.length };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace everything that names the subject, and every calendar year, in one piece of text.
 * Longer names are replaced first so "Acme Labs" does not leave "Labs" behind.
 */
export function maskText(text: string, subject: PastSubject): string {
  let out = text;
  // Links first: a web address often carries the company name.
  out = out.replace(/\bhttps?:\/\/[^\s<>"')\]]+/gi, "[link]");
  const replaceAll = (names: readonly string[], replacement: (index: number) => string) => {
    const ordered = names
      .map((name, index) => ({ name: name.trim(), index }))
      .filter((entry) => entry.name.length >= 2)
      .sort((a, b) => b.name.length - a.name.length);
    for (const { name, index } of ordered) {
      // Word boundaries on both sides, case-insensitive, and tolerant of spaces written as none.
      const pattern = escapeRegex(name).replace(/\s+/g, "\\s*");
      out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"), replacement(index));
    }
  };
  replaceAll(subject.domains, () => "[link]");
  replaceAll([subject.company, ...subject.aliases], () => MASKED_COMPANY);
  // A person is masked by full name and by each part of it, so "Jane" alone does not survive.
  const people = subject.people.map((name) => name.trim()).filter(Boolean);
  replaceAll(people, (index) => `Founder ${String.fromCharCode(65 + (index % 26))}`);
  for (const [index, person] of people.entries()) {
    const parts = person.split(/\s+/).filter((part) => part.length >= 3);
    replaceAll(parts, () => `Founder ${String.fromCharCode(65 + (index % 26))}`);
  }
  replaceAll(subject.handles, () => "[account]");
  // Calendar years tell a model which era it is in, and with that, what happened next.
  out = out.replace(/(?<![\p{L}\p{N}])(19[89]\d|20\d\d)(?![\p{L}\p{N}])/gu, "[year]");
  // A programme's batch tag (for example "W18") is a year by another name.
  out = out.replace(/(?<![\p{L}\p{N}])([WSFX])(\d\d)(?![\p{L}\p{N}])/gu, "[batch]");
  return out;
}

function comparable(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Whether a model's guess names the subject. Code decides this from the guess; the model is
 * never asked "did you recognise it". A guess counts when it contains the company name, an
 * alias, or the full name of one of the people.
 */
export function recognises(guess: { company: string | null; people: readonly string[] }, subject: PastSubject): boolean {
  const said = comparable([guess.company ?? "", ...guess.people].join(" | "));
  if (!said) return false;
  const padded = ` ${said} `;
  const names = [subject.company, ...subject.aliases, ...subject.people]
    .map(comparable)
    .filter((name) => name.length >= 3);
  return names.some((name) => padded.includes(` ${name} `));
}

/**
 * Split cohorts in time order: the earlier ones for tuning, the later ones for the headline.
 * With fewer than two cohorts there is nothing to hold out, and both lists are empty.
 */
export function walkForwardSplit(cohorts: readonly string[], trainShare = 0.5): { train: string[]; test: string[] } {
  const ordered = [...new Set(cohorts)].sort();
  if (ordered.length < 2) return { train: [], test: [] };
  const cut = Math.min(ordered.length - 1, Math.max(1, Math.round(ordered.length * trainShare)));
  return { train: ordered.slice(0, cut), test: ordered.slice(cut) };
}

/**
 * How often a case that later did well is scored above a contemporary that did not: the
 * share of such pairs ranked the right way round, with a tie counting half. Pairs are formed
 * only inside a cohort and pooled. null when no cohort holds both outcomes.
 */
export function cohortAuc(rows: ReadonlyArray<{ cohort: string; outcome: 0 | 1; score: number }>): number | null {
  const byCohort = new Map<string, Array<{ outcome: 0 | 1; score: number }>>();
  for (const row of rows) {
    const list = byCohort.get(row.cohort) ?? [];
    list.push(row);
    byCohort.set(row.cohort, list);
  }
  let pairs = 0;
  let right = 0;
  for (const list of byCohort.values()) {
    const winners = list.filter((row) => row.outcome === 1);
    const others = list.filter((row) => row.outcome === 0);
    for (const winner of winners) {
      for (const other of others) {
        pairs += 1;
        if (winner.score > other.score) right += 1;
        else if (winner.score === other.score) right += 0.5;
      }
    }
  }
  return pairs === 0 ? null : right / pairs;
}
