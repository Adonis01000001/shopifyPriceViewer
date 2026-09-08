import { describe, expect, it } from "vitest";
import {
  compareExtractors,
  evaluateExtractor,
  type ExtractionReplayFixture,
  type RegisteredExtractor,
} from "./extractor-evaluation.service";
import {
  EXTRACTOR_VERSION,
  extractDeterministicProduct,
  type DeterministicProductData,
} from "./product-content-extraction";

function resolved(title: string, price: number): DeterministicProductData {
  return {
    title,
    description: null,
    features: [],
    price,
    currency: "USD",
    salePrice: null,
    originalPrice: null,
    availability: null,
    sku: null,
    barcode: null,
    vendor: null,
    source: "embedded-json",
    structured: true,
    productIdentity: {
      title,
      canonicalUrl: null,
      productId: null,
      variantId: null,
      handle: null,
      sku: null,
      barcode: null,
      mpn: null,
      vendor: null,
      brand: null,
    },
    candidates: [],
    priceCandidates: [],
    priceConflict: false,
    variantAmbiguous: false,
    evidenceScore: 0.95,
    independentPriceSources: 2,
    evidence: ["test evidence"],
    productEvidence: [],
    variantEvidence: [],
    priceEvidence: [],
    resolution: {
      state: "confident",
      confidence: 0.95,
      score: 95,
      breakdown: [],
      failureReasons: [],
    },
    extractorVersion: EXTRACTOR_VERSION,
  };
}

const fixtures: ExtractionReplayFixture[] = [
  {
    id: "known-good",
    domain: "known.example",
    platform: "custom",
    content: "known",
    expected: {
      shouldResolve: true,
      title: "Known Product",
      price: 10,
      currency: "USD",
    },
    knownGood: true,
  },
  {
    id: "missed-pattern",
    domain: "custom.example",
    platform: "custom",
    content: "missed",
    expected: {
      shouldResolve: true,
      title: "Missed Product",
      price: 20,
      currency: "USD",
    },
  },
];

const baseline: RegisteredExtractor = content =>
  content === "known" ? resolved("Known Product", 10) : null;

describe("extractor replay evaluation", () => {
  it("evaluates the real deterministic extractor against a fixture", () => {
    const jsonLd = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Fixture Product",
      sku: "FIX-1",
      offers: { price: "39.99", priceCurrency: "USD" },
    })}</script>`;
    const evaluation = evaluateExtractor(
      [
        {
          id: "json-ld",
          domain: "fixture.example",
          platform: "custom",
          content: jsonLd,
          expected: {
            shouldResolve: true,
            title: "Fixture Product",
            price: 39.99,
            currency: "USD",
          },
        },
      ],
      extractDeterministicProduct
    );
    expect(evaluation.correctResults).toBe(1);
    expect(evaluation.falsePositives).toBe(0);
  });

  it("approves only a registered candidate that improves without regressions", () => {
    const candidate: RegisteredExtractor = content => {
      if (content === "known") return resolved("Known Product", 10);
      if (content === "missed") return resolved("Missed Product", 20);
      return null;
    };
    const report = compareExtractors(fixtures, baseline, candidate);
    expect(report.recommendation).toBe("APPROVE");
    expect(report.improvedFixtures).toBe(1);
    expect(report.regressedFixtures).toBe(0);
    expect(report.humanReport).toContain("Recommendation: APPROVE");
  });

  it("rejects candidates that introduce false positives or regressions", () => {
    const negativeFixture: ExtractionReplayFixture = {
      id: "subscription-only",
      domain: "custom.example",
      platform: "custom",
      content: "do-not-resolve",
      expected: { shouldResolve: false },
      knownGood: true,
    };
    const unsafeCandidate: RegisteredExtractor = content => {
      if (content === "missed") return resolved("Missed Product", 20);
      if (content === "do-not-resolve") return resolved("Subscription", 5);
      return baseline(content);
    };
    const report = compareExtractors(
      [...fixtures, negativeFixture],
      baseline,
      unsafeCandidate
    );
    expect(report.recommendation).toBe("REJECT");
    expect(report.candidate.falsePositives).toBe(1);
    expect(report.rejectionReasons).toContain("false positives increased");
    expect(report.rejectionReasons).toContain("a known-good fixture regressed");
  });
});
