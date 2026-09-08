import { describe, expect, it } from "vitest";
import type {
  AiExtraction,
  ExtractionFailure,
  ExtractorImprovementProposal,
} from "../../drizzle/schema";
import { aggregateExtractionLearningMetrics } from "./extraction-learning-metrics.service";

function attempt(
  sourceUrl: string,
  confidence: number,
  rawResponse: Record<string, unknown>
): AiExtraction {
  return {
    sourceUrl,
    confidence,
    rawResponse,
  } as AiExtraction;
}

describe("extraction learning metrics", () => {
  it("groups measured extraction outcomes by domain, platform, and version", () => {
    const attempts = [
      attempt("https://shop.example/a", 0.95, {
        domain: "shop.example",
        platform: "shopify",
        extractorVersion: "1.0.0",
        extractionSource: "json-ld",
        deterministic: true,
        resolution: { state: "confident" },
      }),
      attempt("https://shop.example/b", 0.6, {
        domain: "shop.example",
        platform: "shopify",
        extractorVersion: "1.0.0",
        extractionSource: "deterministic-pending-ai",
        needsAi: true,
        deterministicResolution: { state: "ambiguous" },
        variantAmbiguous: true,
        priceConflict: true,
        contentCharsBefore: 20_000,
        contentCharsAfter: 4_000,
      }),
    ];
    const metrics = aggregateExtractionLearningMetrics({
      attempts,
      failures: [],
      proposals: [],
    });
    expect(metrics.overall.totalPages).toBe(2);
    expect(metrics.overall.deterministicSuccessRate).toBe(0.5);
    expect(metrics.overall.aiFallbackRate).toBe(0.5);
    expect(metrics.overall.llmFailureRate).toBe(1);
    expect(metrics.overall.variantAmbiguityRate).toBe(0.5);
    expect(metrics.overall.averageContentCharsAfter).toBe(4_000);
    expect(metrics.byDomainPlatformVersion[0]).toMatchObject({
      domain: "shop.example",
      platform: "shopify",
      extractorVersion: "1.0.0",
      totalPages: 2,
    });
  });

  it("counts repeated failure reasons and reports false positives only from replay", () => {
    const failures = [
      {
        failureReasons: ["variant_ambiguity", "low_confidence"],
        occurrenceCount: 4,
      },
    ] as ExtractionFailure[];
    const proposals = [
      {
        evaluation: {
          candidate: { totalFixtures: 10, falsePositives: 1 },
        },
      },
    ] as ExtractorImprovementProposal[];
    const metrics = aggregateExtractionLearningMetrics({
      attempts: [],
      failures,
      proposals,
    });
    expect(metrics.failureReasons).toEqual({
      variant_ambiguity: 4,
      low_confidence: 4,
    });
    expect(metrics.replay).toEqual({
      evaluatedFixtures: 10,
      falsePositives: 1,
      falsePositiveRate: 0.1,
    });
  });

  it("does not fabricate a false-positive rate without labeled fixtures", () => {
    const metrics = aggregateExtractionLearningMetrics({
      attempts: [],
      failures: [],
      proposals: [],
    });
    expect(metrics.replay.falsePositiveRate).toBeNull();
  });
});
