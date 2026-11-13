/**
 * Small, seeded statistics used wherever a number is shown with how sure it is.
 *
 * Everything here is deterministic for a given seed, so a figure on a page does not change
 * when the page is opened twice.
 */

/** A seeded generator of numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit seed from text. */
export function textSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export interface SeparationRow {
  /** Rows are compared only with others in the same group, for example one period. */
  group: string;
  /** 1 for the kind that should score higher (a winner, a Yes), 0 for the other. */
  outcome: 0 | 1;
  score: number;
}

/**
 * How often a 1 scores above a 0 inside the same group: the share of such pairs the right way
 * round, a tie counting half, pooled over groups. 0.5 is what chance gives. null when no group
 * holds both kinds.
 */
export function separation(rows: readonly SeparationRow[]): number | null {
  const groups = new Map<string, SeparationRow[]>();
  for (const row of rows) {
    const list = groups.get(row.group) ?? [];
    list.push(row);
    groups.set(row.group, list);
  }
  let pairs = 0;
  let right = 0;
  for (const list of groups.values()) {
    const ones = list.filter((row) => row.outcome === 1);
    const zeros = list.filter((row) => row.outcome === 0);
    for (const one of ones) {
      for (const zero of zeros) {
        pairs += 1;
        if (one.score > zero.score) right += 1;
        else if (one.score === zero.score) right += 0.5;
      }
    }
  }
  return pairs === 0 ? null : right / pairs;
}

export interface SeparationStat {
  /**
   * Rows that could be compared: those in a group that holds both kinds. A group of winners
   * only, or of others only, forms no pair and tells nothing, so its rows are not counted.
   */
  n: number;
  /** How many of those were the kind that should score higher. */
  positives: number;
  /** See `separation`. null when it cannot be computed. */
  value: number | null;
  /** 95% interval from resampling rows within each group. null with too little to resample. */
  low: number | null;
  high: number | null;
}

/**
 * `separation` with a 95% interval. Rows are resampled with replacement inside each group, so
 * every resample keeps the groups' sizes. A resample with no usable pair is skipped; with fewer
 * than 100 usable resamples there is no interval, because one would only pretend to be known.
 */
export function separationStat(rows: readonly SeparationRow[], seedText: string, resamples = 600): SeparationStat {
  const value = separation(rows);
  const groups = [...new Set(rows.map((row) => row.group))].sort()
    .map((group) => rows.filter((row) => row.group === group))
    .filter((group) => group.some((row) => row.outcome === 1) && group.some((row) => row.outcome === 0));
  const comparable = groups.flat();
  const stat: SeparationStat = { n: comparable.length, positives: comparable.filter((row) => row.outcome === 1).length, value, low: null, high: null };
  if (value === null) return stat;
  const random = seededRandom(textSeed(seedText));
  const samples: number[] = [];
  for (let index = 0; index < resamples; index += 1) {
    const sample = groups.flatMap((group) => Array.from({ length: group.length }, () => group[Math.floor(random() * group.length)] as SeparationRow));
    const sampled = separation(sample);
    if (sampled !== null) samples.push(sampled);
  }
  if (samples.length < 100) return stat;
  samples.sort((a, b) => a - b);
  const at = (share: number) => {
    const position = (samples.length - 1) * share;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return (samples[lower] as number) * (1 - (position - lower)) + (samples[upper] as number) * (position - lower);
  };
  return { ...stat, low: at(0.025), high: at(0.975) };
}

/**
 * What shuffled labels give. The outcomes are shuffled inside each group, so the mix of kinds
 * in every group is unchanged and only the link between score and outcome is broken. Returns
 * the mean of the shuffled values, the value 95% of them fall below, and the share of shuffles
 * that scored at least as high as `observed`. A real effect should sit above `p95`; a
 * shuffled mean far from 0.5 means the scoring is broken.
 */
export function shuffledBaseline(
  rows: readonly SeparationRow[],
  observed: number | null,
  seedText: string,
  shuffles = 1000,
): { mean: number; p95: number; atLeastObserved: number | null } | null {
  const groups = [...new Set(rows.map((row) => row.group))].sort().map((group) => rows.filter((row) => row.group === group));
  const random = seededRandom(textSeed(seedText));
  const values: number[] = [];
  for (let index = 0; index < shuffles; index += 1) {
    const shuffled = groups.flatMap((group) => {
      const outcomes = group.map((row) => row.outcome);
      for (let position = outcomes.length - 1; position > 0; position -= 1) {
        const swap = Math.floor(random() * (position + 1));
        [outcomes[position], outcomes[swap]] = [outcomes[swap] as 0 | 1, outcomes[position] as 0 | 1];
      }
      return group.map((row, position) => ({ ...row, outcome: outcomes[position] as 0 | 1 }));
    });
    const value = separation(shuffled);
    if (value !== null) values.push(value);
  }
  if (values.length < 100) return null;
  values.sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const p95 = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] as number;
  return {
    mean,
    p95,
    atLeastObserved: observed === null ? null : values.filter((value) => value >= observed).length / values.length,
  };
}

export interface PairedRow {
  group: string;
  outcome: 0 | 1;
  /** Two scores for the same case. */
  a: number;
  b: number;
}

/**
 * How much better score `a` separates the two kinds than score `b` does, on the same cases:
 * the difference of the two separations, with a 95% interval. The same resampled cases are
 * used for both scores in every resample, so what is shared between them (which cases happened
 * to be drawn) cancels and only the difference between the scores is left. Comparing the two
 * separate intervals instead would call almost every difference uncertain.
 */
export function separationDifference(
  rows: readonly PairedRow[],
  seedText: string,
  resamples = 600,
): { value: number | null; low: number | null; high: number | null } {
  const of = (list: readonly PairedRow[], pick: (row: PairedRow) => number) =>
    separation(list.map((row) => ({ group: row.group, outcome: row.outcome, score: pick(row) })));
  const first = of(rows, (row) => row.a);
  const second = of(rows, (row) => row.b);
  if (first === null || second === null) return { value: null, low: null, high: null };
  const groups = [...new Set(rows.map((row) => row.group))].sort()
    .map((group) => rows.filter((row) => row.group === group))
    .filter((group) => group.some((row) => row.outcome === 1) && group.some((row) => row.outcome === 0));
  const random = seededRandom(textSeed(seedText));
  const samples: number[] = [];
  for (let index = 0; index < resamples; index += 1) {
    const sample = groups.flatMap((group) => Array.from({ length: group.length }, () => group[Math.floor(random() * group.length)] as PairedRow));
    const sampledFirst = of(sample, (row) => row.a);
    const sampledSecond = of(sample, (row) => row.b);
    if (sampledFirst !== null && sampledSecond !== null) samples.push(sampledFirst - sampledSecond);
  }
  if (samples.length < 100) return { value: first - second, low: null, high: null };
  samples.sort((x, y) => x - y);
  const at = (share: number) => {
    const position = (samples.length - 1) * share;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return (samples[lower] as number) * (1 - (position - lower)) + (samples[upper] as number) * (position - lower);
  };
  return { value: first - second, low: at(0.025), high: at(0.975) };
}
