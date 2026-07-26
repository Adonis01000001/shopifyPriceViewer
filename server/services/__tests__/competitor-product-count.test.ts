import { describe, expect, it } from "vitest";
import {
  countMergedCompetitorProducts,
  getVisibleRadarProducts,
} from "../competitor-product-count";

const amazon = { id: "amazon-id", domain: "amazon.com" };
const matched = [
  { competitorProductUrl: "https://www.amazon.com/dp/MATCHED1" },
  { competitorProductUrl: "https://www.amazon.com/dp/MATCHED2" },
];

function radarProduct(
  index: number,
  overrides: Partial<{
    name: string;
    productUrl: string;
    sourceCompetitorId: string | null;
    sourceDomain: string;
    structuredMetadata: unknown;
  }> = {}
) {
  return {
    name: `Product ${index}`,
    productUrl: `https://www.amazon.com/dp/RADAR${index}`,
    sourceCompetitorId: amazon.id,
    sourceDomain: "www.amazon.com",
    structuredMetadata: null,
    ...overrides,
  };
}

describe("competitor product counts", () => {
  it("matches feed total across stored and Price Radar products", () => {
    const radar = Array.from({ length: 20 }, (_, index) =>
      radarProduct(index)
    );

    expect(countMergedCompetitorProducts(amazon, matched, radar)).toBe(22);
  });

  it("uses same duplicate and generic Amazon filters as feed", () => {
    const radar = [
      ...Array.from({ length: 20 }, (_, index) => radarProduct(index)),
      radarProduct(21, {
        productUrl: "https://www.amazon.com/dp/MATCHED1",
      }),
      radarProduct(22, {
        name: "Amazon",
        productUrl: "https://www.amazon.com/",
      }),
    ];

    expect(getVisibleRadarProducts(amazon, matched, radar)).toHaveLength(20);
    expect(countMergedCompetitorProducts(amazon, matched, radar)).toBe(22);
  });

  it("matches normalized source domains and excludes unrelated domains", () => {
    const radar = [
      radarProduct(1, { sourceCompetitorId: null }),
      radarProduct(2, {
        sourceCompetitorId: null,
        sourceDomain: "ebay.com",
      }),
    ];

    expect(getVisibleRadarProducts(amazon, [], radar)).toHaveLength(1);
  });
});
