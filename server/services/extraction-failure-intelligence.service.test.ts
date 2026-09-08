import { describe, expect, it } from "vitest";
import type { ExtractionFailure } from "../../drizzle/schema";
import {
  clusterExtractionFailures,
  fingerprintStorefront,
  prepareFailureRecord,
  prepareReplayFixture,
  sanitizeExtractionContent,
  sanitizeStructuredValue,
} from "./extraction-failure-intelligence.service";
import {
  EXTRACTOR_VERSION,
  assessProductMatch,
  contentHash,
  extractDeterministicProduct,
} from "./product-content-extraction";

function storedFailure(
  overrides: Partial<ExtractionFailure> = {}
): ExtractionFailure {
  const now = new Date("2026-08-31T10:00:00.000Z");
  return {
    id: "00000000-0000-4000-8000-000000000001",
    failureKey: "a".repeat(64),
    productId: null,
    competitorId: null,
    domain: "example.com",
    sourceUrl: "https://example.com/products/item",
    contentHash: "b".repeat(64),
    extractorVersion: EXTRACTOR_VERSION,
    resolutionState: "ambiguous",
    failureReasons: ["variant_ambiguity"],
    platform: "custom",
    markerFingerprint: "c".repeat(64),
    markers: ["state.selectedVariant"],
    productEvidence: [],
    variantEvidence: [],
    priceEvidence: [],
    candidateCount: 1,
    confidence: 0.5,
    scoreBreakdown: [],
    reducedContent: "sanitized fixture",
    deterministicDecision: {},
    aiDecision: null,
    expectedResult: null,
    occurrenceCount: 1,
    status: "pending",
    firstObservedAt: now,
    lastObservedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("extraction failure intelligence", () => {
  it("redacts credentials and personal identifiers before persistence", () => {
    const sanitized = sanitizeExtractionContent(
      'Authorization: Bearer top-secret\nCookie: sid=abc\n{"access_token":"token-value"}\nuser@example.com'
    );
    expect(sanitized).not.toContain("top-secret");
    expect(sanitized).not.toContain("sid=abc");
    expect(sanitized).not.toContain("token-value");
    expect(sanitized).not.toContain("user@example.com");
    expect(sanitized).toContain("[REDACTED]");

    expect(
      sanitizeStructuredValue({
        title: "Safe product",
        apiKey: "secret-key",
        nested: { password: "secret-password" },
      })
    ).toEqual({
      title: "Safe product",
      apiKey: "[REDACTED]",
      nested: { password: "[REDACTED]" },
    });
  });

  it("fingerprints platforms from content evidence instead of domain names", () => {
    expect(
      fingerprintStorefront(
        '<div class="shopify-section"></div><script>Shopify.theme={}</script>'
      ).platform
    ).toBe("shopify");
    expect(fingerprintStorefront("plain page").platform).toBe("unknown");
    expect(
      fingerprintStorefront(
        '<script type="text/x-magento-init">{}</script><div data-role="priceBox"></div>'
      ).platform
    ).toBe("magento");
  });

  it("prepares versioned, explainable, sanitized replay records", () => {
    const page = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Camera Pro",
      sku: "CAM-1",
      offers: {
        "@type": "Offer",
        price: "499.00",
        priceCurrency: "USD",
      },
    })}</script>`;
    const deterministic = extractDeterministicProduct(page, {
      pageUrl: "https://example.com/products/camera?token=private",
    });
    expect(deterministic).not.toBeNull();
    const matchAssessment = assessProductMatch(
      { title: "Camera Pro", sku: "CAM-1" },
      deterministic!
    );
    const record = prepareFailureRecord({
      productId: "00000000-0000-4000-8000-000000000010",
      competitorId: "00000000-0000-4000-8000-000000000020",
      domain: "www.example.com",
      sourceUrl: "https://example.com/products/camera?token=private#details",
      contentHash: contentHash(page),
      reducedContent: `${page}\nAuthorization: Bearer private-token`,
      pageContentForFingerprint: page,
      deterministic,
      matchAssessment,
      aiDecision: { access_token: "private-ai-token", resolved: false },
    });
    expect(record.extractorVersion).toBe(EXTRACTOR_VERSION);
    expect(record.domain).toBe("example.com");
    expect(record.sourceUrl).toBe("https://example.com/products/camera");
    expect(record.productEvidence.length).toBeGreaterThan(0);
    expect(record.priceEvidence.length).toBeGreaterThan(0);
    expect(record.scoreBreakdown.length).toBeGreaterThan(0);
    expect(JSON.stringify(record)).not.toContain("private-token");
    expect(JSON.stringify(record)).not.toContain("private-ai-token");
  });

  it("clusters repeated failures only after the configured evidence threshold", () => {
    const oneRepeatedFailure = storedFailure({ occurrenceCount: 5 });
    const clusters = clusterExtractionFailures([oneRepeatedFailure], 5);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].affectedFailureCount).toBe(5);
    expect(clusters[0].failureReason).toBe("variant_ambiguity");
    expect(clusterExtractionFailures([oneRepeatedFailure], 6)).toHaveLength(0);
  });

  it("selects at most three representative examples from a cluster", () => {
    const records = Array.from({ length: 6 }, (_, index) =>
      storedFailure({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        failureKey: String(index).padStart(64, "0"),
        confidence: index / 10,
      })
    );
    const [cluster] = clusterExtractionFailures(records, 3);
    expect(cluster.affectedFailureCount).toBe(6);
    expect(cluster.representativeFailures).toHaveLength(3);
    expect(cluster.representativeFailures.map(item => item.confidence)).toEqual(
      [0, 0.1, 0.2]
    );
  });

  it("loads only human-labeled sanitized failures as replay fixtures", () => {
    expect(prepareReplayFixture(storedFailure())).toBeNull();
    const fixture = prepareReplayFixture(
      storedFailure({
        reducedContent: "<main>Sanitized product fixture</main>",
        expectedResult: {
          shouldResolve: true,
          title: "Expected Product",
          price: 25,
          currency: "USD",
        },
      })
    );
    expect(fixture).toMatchObject({
      content: "<main>Sanitized product fixture</main>",
      knownGood: true,
      expected: {
        title: "Expected Product",
        price: 25,
        currency: "USD",
      },
    });
  });
});
