import { describe, expect, it } from "vitest";
import {
  buildScoopSummary,
  dedupeAndRankScoopProducts,
  type ScoopProduct,
} from "../scoop.service";

function product(
  url: string,
  price: string | null,
  confidenceScore: number,
  currency = "USD"
): ScoopProduct {
  return {
    productName: "Scoop Product",
    brand: null,
    model: null,
    price,
    currency: price ? currency : null,
    availability: null,
    seller: "Store",
    condition: null,
    shipping: null,
    productUrl: url,
    imageUrl: null,
    retrievedAt: "2026-07-27T00:00:00.000Z",
    publishedDate: null,
    confidenceScore,
    extractionMethod: "test",
    discoveredBy: ["Test"],
  };
}

describe("Scoop result processing", () => {
  it("deduplicates canonical URLs and keeps strongest result", () => {
    const results = dedupeAndRankScoopProducts(
      [
        product("https://store.example/product/1?utm_source=ad", "20.00", 0.5),
        product("https://store.example/product/1", "19.00", 0.9),
      ],
      "relevance"
    );

    expect(results).toHaveLength(1);
    expect(results[0].price).toBe("19.00");
    expect(results[0].confidenceScore).toBe(0.9);
  });

  it("ranks lowest prices first and missing prices last", () => {
    const results = dedupeAndRankScoopProducts(
      [
        product("https://a.example/p/1", null, 0.9),
        product("https://b.example/p/2", "30.00", 0.8),
        product("https://c.example/p/3", "10.00", 0.7),
      ],
      "lowest_price"
    );

    expect(results.map(row => row.price)).toEqual([
      "10.00",
      "30.00",
      null,
    ]);
  });

  it("summarizes sources and per-currency price ranges", () => {
    const summary = buildScoopSummary([
      product("https://a.example/p/1", "10.00", 0.8),
      product("https://b.example/p/2", "30.00", 0.8),
      product("https://c.example/p/3", "25.00", 0.8, "EUR"),
    ]);

    expect(summary).toContain("3 product listings");
    expect(summary).toContain("3 sources");
    expect(summary).toContain("USD 10.00–30.00");
    expect(summary).toContain("EUR 25.00");
  });
});
