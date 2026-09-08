import type {
  DeterministicExtractionOptions,
  DeterministicProductData,
  ExtractionFailureReason,
} from "./product-content-extraction";

export interface ReplayExpectedResult {
  shouldResolve: boolean;
  title?: string | null;
  productId?: string | null;
  variantId?: string | null;
  price?: number | null;
  currency?: string | null;
}

export interface ExtractionReplayFixture {
  id: string;
  domain: string;
  platform: string;
  content: string;
  pageUrl?: string;
  expected: ReplayExpectedResult;
  knownGood?: boolean;
  failureReasons?: ExtractionFailureReason[];
}

export type RegisteredExtractor = (
  content: string,
  options?: DeterministicExtractionOptions
) => DeterministicProductData | null;

export interface FixtureEvaluation {
  fixtureId: string;
  resolved: boolean;
  correct: boolean;
  falsePositive: boolean;
  reasons: string[];
  actual: {
    state: string;
    title: string | null;
    productId: string | null;
    variantId: string | null;
    price: number | null;
    currency: string | null;
  };
}

export interface ExtractorEvaluation {
  totalFixtures: number;
  deterministicSuccesses: number;
  correctResults: number;
  unresolved: number;
  falsePositives: number;
  knownGoodRegressions: number;
  results: FixtureEvaluation[];
}

export interface ExtractorComparisonReport {
  baseline: ExtractorEvaluation;
  candidate: ExtractorEvaluation;
  improvedFixtures: number;
  regressedFixtures: number;
  unchangedFixtures: number;
  recommendation: "APPROVE" | "REJECT";
  rejectionReasons: string[];
  humanReport: string;
}

function normalized(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameText(
  expected: string | null | undefined,
  actual: string | null | undefined
): boolean {
  if (expected == null) return true;
  return normalized(expected) === normalized(actual);
}

function samePrice(
  expected: number | null | undefined,
  actual: number | null | undefined
): boolean {
  if (expected == null) return true;
  if (actual == null) return false;
  return Math.abs(expected - actual) <= 0.005;
}

function evaluateFixture(
  fixture: ExtractionReplayFixture,
  extractor: RegisteredExtractor
): FixtureEvaluation {
  const output = extractor(fixture.content, { pageUrl: fixture.pageUrl });
  const resolved = output?.resolution.state === "confident";
  const actual = {
    state: output?.resolution.state ?? "unresolved",
    title: output?.title ?? null,
    productId: output?.productIdentity.productId ?? null,
    variantId: output?.productIdentity.variantId ?? null,
    price: output?.price ?? null,
    currency: output?.currency ?? null,
  };
  const falsePositive = !fixture.expected.shouldResolve && resolved;
  const reasons: string[] = [];
  if (fixture.expected.shouldResolve && !resolved)
    reasons.push("expected a confident deterministic result");
  if (!sameText(fixture.expected.title, actual.title))
    reasons.push("product title differs");
  if (!sameText(fixture.expected.productId, actual.productId))
    reasons.push("product identity differs");
  if (!sameText(fixture.expected.variantId, actual.variantId))
    reasons.push("variant identity differs");
  if (!samePrice(fixture.expected.price, actual.price))
    reasons.push("price differs");
  if (!sameText(fixture.expected.currency, actual.currency))
    reasons.push("currency differs");
  if (falsePositive) reasons.push("unexpected confident extraction");
  const correct = fixture.expected.shouldResolve
    ? resolved && reasons.length === 0
    : !resolved;
  return {
    fixtureId: fixture.id,
    resolved,
    correct,
    falsePositive,
    reasons,
    actual,
  };
}

export function evaluateExtractor(
  fixtures: ExtractionReplayFixture[],
  extractor: RegisteredExtractor
): ExtractorEvaluation {
  const results = fixtures.map(fixture => evaluateFixture(fixture, extractor));
  const knownGood = new Set(
    fixtures.filter(fixture => fixture.knownGood).map(fixture => fixture.id)
  );
  return {
    totalFixtures: fixtures.length,
    deterministicSuccesses: results.filter(result => result.resolved).length,
    correctResults: results.filter(result => result.correct).length,
    unresolved: results.filter(result => !result.resolved).length,
    falsePositives: results.filter(result => result.falsePositive).length,
    knownGoodRegressions: results.filter(
      result => knownGood.has(result.fixtureId) && !result.correct
    ).length,
    results,
  };
}

export function compareExtractors(
  fixtures: ExtractionReplayFixture[],
  baselineExtractor: RegisteredExtractor,
  candidateExtractor: RegisteredExtractor
): ExtractorComparisonReport {
  const baseline = evaluateExtractor(fixtures, baselineExtractor);
  const candidate = evaluateExtractor(fixtures, candidateExtractor);
  const baselineById = new Map(
    baseline.results.map(result => [result.fixtureId, result])
  );
  const improvedFixtures = candidate.results.filter(
    result => result.correct && !baselineById.get(result.fixtureId)?.correct
  ).length;
  const regressedFixtures = candidate.results.filter(
    result => !result.correct && baselineById.get(result.fixtureId)?.correct
  ).length;
  const unchangedFixtures =
    fixtures.length - improvedFixtures - regressedFixtures;
  const rejectionReasons: string[] = [];
  if (candidate.correctResults <= baseline.correctResults)
    rejectionReasons.push("correct deterministic results did not increase");
  if (candidate.falsePositives > baseline.falsePositives)
    rejectionReasons.push("false positives increased");
  if (candidate.knownGoodRegressions > 0)
    rejectionReasons.push("a known-good fixture regressed");
  if (regressedFixtures > 0)
    rejectionReasons.push("one or more previously correct fixtures regressed");
  const recommendation = rejectionReasons.length === 0 ? "APPROVE" : "REJECT";
  const humanReport = [
    "SCRAPER IMPROVEMENT REPORT",
    "",
    `Fixtures: ${fixtures.length}`,
    `Baseline correct: ${baseline.correctResults}`,
    `Candidate correct: ${candidate.correctResults}`,
    `Improved: ${improvedFixtures}`,
    `Unchanged: ${unchangedFixtures}`,
    `Regressed: ${regressedFixtures}`,
    `False positives: ${baseline.falsePositives} -> ${candidate.falsePositives}`,
    `Known-good regressions: ${candidate.knownGoodRegressions}`,
    "",
    `Recommendation: ${recommendation}`,
    ...(rejectionReasons.length > 0
      ? rejectionReasons.map(reason => `- ${reason}`)
      : []),
  ].join("\n");
  return {
    baseline,
    candidate,
    improvedFixtures,
    regressedFixtures,
    unchangedFixtures,
    recommendation,
    rejectionReasons,
    humanReport,
  };
}
