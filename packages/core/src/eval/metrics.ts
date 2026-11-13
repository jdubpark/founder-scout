const CUTOFF = 5;

type Outcome = 0 | 1;

function averageRanks(values: readonly number[]): number[] {
  const ordered = values.map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = Array<number>(values.length).fill(0);
  let start = 0;
  while (start < ordered.length) {
    let end = start + 1;
    while (end < ordered.length && ordered[end]!.value === ordered[start]!.value) end += 1;
    const averageRank = ((start + 1) + end) / 2;
    for (let index = start; index < end; index += 1) ranks[ordered[index]!.index] = averageRank;
    start = end;
  }
  return ranks;
}

/** Spearman rank correlation; ties receive average ranks and a constant side scores zero. */
export function rankMatch(scores: readonly number[], qualities: readonly number[]): number {
  if (scores.length !== qualities.length) throw new RangeError("scores and qualities must have equal lengths");
  if (scores.length < 2) return 0;
  const scoreRanks = averageRanks(scores);
  const qualityRanks = averageRanks(qualities);
  return pearsonCorrelation(scoreRanks, qualityRanks);
}

/** Share of the five strongest founders that appear in the score ranking's top five. */
export function top5Match(scores: readonly number[], qualities: readonly number[]): number {
  if (scores.length !== qualities.length) throw new RangeError("scores and qualities must have equal lengths");
  const cutoff = Math.min(CUTOFF, scores.length);
  if (cutoff === 0) return 0;
  const strongest = new Set(qualities.map((_, index) => index)
    .sort((left, right) => qualities[right]! - qualities[left]! || left - right)
    .slice(0, cutoff));
  const ranked = scores.map((_, index) => index)
    .sort((left, right) => scores[right]! - scores[left]! || left - right)
    .slice(0, cutoff);
  return ranked.filter((index) => strongest.has(index)).length / cutoff;
}

/** Discounted cumulative gain normalized by the best possible top-five order. */
export function ndcg5(outcomes: readonly Outcome[]): number {
  const relevantCount = outcomes.reduce<number>((count, outcome) => count + outcome, 0);
  if (relevantCount === 0) return 0;

  let dcg = 0;
  for (let rank = 0; rank < Math.min(CUTOFF, outcomes.length); rank += 1) {
    dcg += (2 ** outcomes[rank]! - 1) / Math.log2(rank + 2);
  }

  let idealDcg = 0;
  for (let rank = 0; rank < Math.min(CUTOFF, relevantCount); rank += 1) {
    idealDcg += 1 / Math.log2(rank + 2);
  }

  return dcg / idealDcg;
}

/** Fraction of the fixed top-five cutoff that contains a positive outcome. */
export function precision5(outcomes: readonly Outcome[]): number {
  const relevantInTopFive = outcomes
    .slice(0, CUTOFF)
    .reduce<number>((count, outcome) => count + outcome, 0);
  return relevantInTopFive / CUTOFF;
}

/** Fraction of all positive outcomes that appear in the top five. */
export function recall5(outcomes: readonly Outcome[]): number {
  const relevantCount = outcomes.reduce<number>((count, outcome) => count + outcome, 0);
  if (relevantCount === 0) return 0;
  const relevantInTopFive = outcomes
    .slice(0, CUTOFF)
    .reduce<number>((count, outcome) => count + outcome, 0);
  return relevantInTopFive / relevantCount;
}

/**
 * Absolute Pearson correlation between raw pedigree and score residuals after
 * an OLS regression of score on quality (including an intercept).
 */
export function pedigreeLeak(
  scores: readonly number[],
  qualities: readonly number[],
  pedigrees: readonly number[],
): number {
  if (scores.length !== qualities.length || scores.length !== pedigrees.length) {
    throw new RangeError("scores, qualities, and pedigrees must have equal lengths");
  }
  if (scores.length === 0) return 0;

  const scoreMean = mean(scores);
  const qualityMean = mean(qualities);
  const centeredScores = scores.map((score) => score - scoreMean);
  const centeredQualities = qualities.map((quality) => quality - qualityMean);
  const qualityVariance = centeredQualities.reduce((sum, quality) => sum + quality ** 2, 0);
  const scoreQualityCovariance = centeredScores.reduce(
    (sum, score, index) => sum + score * centeredQualities[index]!,
    0,
  );
  const slope = qualityVariance === 0 ? 0 : scoreQualityCovariance / qualityVariance;
  const residuals = centeredScores.map(
    (score, index) => score - slope * centeredQualities[index]!,
  );
  return Math.abs(pearsonCorrelation(residuals, pedigrees));
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pearsonCorrelation(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }

  if (leftVariance === 0 || rightVariance === 0) return 0;
  return covariance / Math.sqrt(leftVariance * rightVariance);
}
