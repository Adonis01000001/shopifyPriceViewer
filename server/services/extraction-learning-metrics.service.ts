import { desc, gte, isNotNull } from "drizzle-orm";
import {
  aiExtractions,
  extractionFailures,
  extractorImprovementProposals,
  type AiExtraction,
  type ExtractionFailure,
  type ExtractorImprovementProposal as StoredProposal,
} from "../../drizzle/schema";
import { requireDb } from "../_core/db-assert";

interface MutableMetrics {
  totalPages: number;
  deterministicSuccesses: number;
  aiFallbacks: number;
  unresolved: number;
  variantAmbiguities: number;
  priceConflicts: number;
  llmFailures: number;
  confidenceTotal: number;
  contentCharsBefore: number;
  contentCharsAfter: number;
  reducedSamples: number;
}

export interface ExtractionMetricSummary {
  totalPages: number;
  deterministicSuccessRate: number;
  aiFallbackRate: number;
  unresolvedRate: number;
  variantAmbiguityRate: number;
  priceConflictRate: number;
  llmFailureRate: number;
  averageConfidence: number;
  averageContentCharsBefore: number;
  averageContentCharsAfter: number;
}

export interface ExtractionMetricDimension extends ExtractionMetricSummary {
  domain: string;
  platform: string;
  extractorVersion: string;
}

interface ExtractionMetadata {
  domain?: unknown;
  platform?: unknown;
  extractorVersion?: unknown;
  extractionSource?: unknown;
  deterministic?: unknown;
  needsAi?: unknown;
  variantAmbiguous?: unknown;
  priceConflict?: unknown;
  contentCharsBefore?: unknown;
  contentCharsAfter?: unknown;
  resolution?: { state?: unknown };
  deterministicResolution?: { state?: unknown };
}

function asMetadata(value: unknown): ExtractionMetadata {
  return value && typeof value === "object"
    ? (value as ExtractionMetadata)
    : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function domainFromUrl(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function emptyMetrics(): MutableMetrics {
  return {
    totalPages: 0,
    deterministicSuccesses: 0,
    aiFallbacks: 0,
    unresolved: 0,
    variantAmbiguities: 0,
    priceConflicts: 0,
    llmFailures: 0,
    confidenceTotal: 0,
    contentCharsBefore: 0,
    contentCharsAfter: 0,
    reducedSamples: 0,
  };
}

function addAttempt(metrics: MutableMetrics, attempt: AiExtraction) {
  const metadata = asMetadata(attempt.rawResponse);
  const source = stringValue(metadata.extractionSource, "legacy");
  const deterministic = metadata.deterministic === true;
  const fallback = source === "llm" || source === "deterministic-pending-ai";
  const state =
    metadata.resolution?.state ?? metadata.deterministicResolution?.state;
  metrics.totalPages++;
  if (deterministic) metrics.deterministicSuccesses++;
  if (fallback) metrics.aiFallbacks++;
  if (state === "unresolved" || metadata.needsAi === true) metrics.unresolved++;
  if (metadata.variantAmbiguous === true) metrics.variantAmbiguities++;
  if (metadata.priceConflict === true) metrics.priceConflicts++;
  if (source === "deterministic-pending-ai") metrics.llmFailures++;
  metrics.confidenceTotal += Number(attempt.confidence) || 0;
  const before = Number(metadata.contentCharsBefore);
  const after = Number(metadata.contentCharsAfter);
  if (Number.isFinite(before) && Number.isFinite(after)) {
    metrics.contentCharsBefore += before;
    metrics.contentCharsAfter += after;
    metrics.reducedSamples++;
  }
}

function finish(metrics: MutableMetrics): ExtractionMetricSummary {
  const attempts = Math.max(1, metrics.totalPages);
  const fallbacks = Math.max(1, metrics.aiFallbacks);
  const reduced = Math.max(1, metrics.reducedSamples);
  return {
    totalPages: metrics.totalPages,
    deterministicSuccessRate: metrics.deterministicSuccesses / attempts,
    aiFallbackRate: metrics.aiFallbacks / attempts,
    unresolvedRate: metrics.unresolved / attempts,
    variantAmbiguityRate: metrics.variantAmbiguities / attempts,
    priceConflictRate: metrics.priceConflicts / attempts,
    llmFailureRate: metrics.llmFailures / fallbacks,
    averageConfidence: metrics.confidenceTotal / attempts,
    averageContentCharsBefore: metrics.contentCharsBefore / reduced,
    averageContentCharsAfter: metrics.contentCharsAfter / reduced,
  };
}

function failureReasonCounts(failures: ExtractionFailure[]) {
  const counts: Record<string, number> = {};
  for (const failure of failures) {
    const reasons = Array.isArray(failure.failureReasons)
      ? failure.failureReasons.filter(reason => typeof reason === "string")
      : ["unknown"];
    for (const reason of reasons) {
      counts[reason] = (counts[reason] ?? 0) + failure.occurrenceCount;
    }
  }
  return counts;
}

function evaluatedFalsePositives(proposals: StoredProposal[]) {
  let totalFixtures = 0;
  let falsePositives = 0;
  for (const proposal of proposals) {
    if (!proposal.evaluation || typeof proposal.evaluation !== "object")
      continue;
    const evaluation = proposal.evaluation as {
      candidate?: { totalFixtures?: unknown; falsePositives?: unknown };
    };
    const total = Number(evaluation.candidate?.totalFixtures);
    const falsePositiveCount = Number(evaluation.candidate?.falsePositives);
    if (!Number.isFinite(total) || !Number.isFinite(falsePositiveCount))
      continue;
    totalFixtures += total;
    falsePositives += falsePositiveCount;
  }
  return {
    evaluatedFixtures: totalFixtures,
    falsePositives,
    falsePositiveRate:
      totalFixtures > 0 ? falsePositives / totalFixtures : null,
  };
}

export function aggregateExtractionLearningMetrics(options: {
  attempts: AiExtraction[];
  failures: ExtractionFailure[];
  proposals: StoredProposal[];
}) {
  const overall = emptyMetrics();
  const dimensions = new Map<string, MutableMetrics>();
  for (const attempt of options.attempts) {
    const metadata = asMetadata(attempt.rawResponse);
    const domain = stringValue(
      metadata.domain,
      domainFromUrl(attempt.sourceUrl)
    );
    const platform = stringValue(metadata.platform, "unknown");
    const extractorVersion = stringValue(metadata.extractorVersion, "legacy");
    const key = `${domain}|${platform}|${extractorVersion}`;
    const dimension = dimensions.get(key) ?? emptyMetrics();
    addAttempt(overall, attempt);
    addAttempt(dimension, attempt);
    dimensions.set(key, dimension);
  }
  const byDomainPlatformVersion: ExtractionMetricDimension[] = Array.from(
    dimensions.entries()
  ).map(([key, metrics]) => {
    const [domain, platform, extractorVersion] = key.split("|");
    return { domain, platform, extractorVersion, ...finish(metrics) };
  });
  return {
    overall: finish(overall),
    byDomainPlatformVersion,
    failureReasons: failureReasonCounts(options.failures),
    replay: evaluatedFalsePositives(options.proposals),
  };
}

export const extractionLearningMetricsService = {
  async getMetrics(days = 30) {
    const database = await requireDb();
    const since = new Date(Date.now() - Math.max(1, days) * 86_400_000);
    const [attempts, failures, proposals] = await Promise.all([
      database
        .select()
        .from(aiExtractions)
        .where(gte(aiExtractions.extractedAt, since))
        .orderBy(desc(aiExtractions.extractedAt))
        .limit(20_000),
      database
        .select()
        .from(extractionFailures)
        .where(gte(extractionFailures.lastObservedAt, since))
        .orderBy(desc(extractionFailures.lastObservedAt))
        .limit(20_000),
      database
        .select()
        .from(extractorImprovementProposals)
        .where(isNotNull(extractorImprovementProposals.evaluation))
        .orderBy(desc(extractorImprovementProposals.updatedAt))
        .limit(1_000),
    ]);
    return aggregateExtractionLearningMetrics({
      attempts,
      failures,
      proposals,
    });
  },
};
