import { describe, expect, it } from "vitest";
import {
  buildScoopCatalogPlan,
  buildScoopSummary,
  dedupeAndRankScoopProducts,
  toScoopSearchResultRows,
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
  rating: null,
  reviewCount: null,
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

  it("maps every product to a tenant-scoped persisted result row", () => {
    const rows = toScoopSearchResultRows({
      searchId: "search-1",
      userId: "user-1",
      products: [
        product("https://a.example/p/1", "10.00", 0.8),
        product("https://b.example/p/2", null, 0.6),
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      searchId: "search-1",
      userId: "user-1",
      productUrl: "https://a.example/p/1",
      price: "10.00",
      position: 1,
    });
    expect(rows[1]).toMatchObject({
      searchId: "search-1",
      userId: "user-1",
      productUrl: "https://b.example/p/2",
      price: null,
      position: 2,
    });
  });

  it("keeps canonical URL history rows linked to their competitor", () => {
    const rows = toScoopSearchResultRows({
      searchId: "search-2",
      userId: "user-2",
      products: [
        product(
          "https://store.example/product/2?utm_source=scoop",
          "20.00",
          0.8
        ),
      ],
      competitorIds: new Map([
        ["https://store.example/product/2", "competitor-2"],
      ]),
    });

    expect(rows[0].competitorId).toBe("competitor-2");
  });

  it("groups repeated brand spellings and deduplicates product URLs", () => {
    const sonyProduct = product(
      "https://store.example/sony-headphones?utm_source=scoop",
      "99.00",
      0.7
    );
    const strongerSonyProduct = {
      ...sonyProduct,
      brand: " sony ",
      price: "89.00",
      confidenceScore: 0.95,
    };
    const samsungProduct = {
      ...product("https://store.example/samsung-phone", "499.00", 0.8),
      brand: "Samsung",
    };

    const plans = buildScoopCatalogPlan([
      { ...sonyProduct, brand: "Sony" },
      strongerSonyProduct,
      samsungProduct,
    ]);

    expect(plans).toHaveLength(2);
    const sony = plans.find(plan => plan.normalizedBrandName === "sony");
    expect(sony?.products).toHaveLength(1);
    expect(sony?.products[0].price).toBe("89.00");
    expect(plans.find(plan => plan.normalizedBrandName === "samsung")?.products)
      .toHaveLength(1);
  });

  it("keeps one competitor plan across repeated searches for a brand", () => {
    const firstSearch = buildScoopCatalogPlan([
      { ...product("https://store.example/sony-1", "99.00", 0.7), brand: "SONY" },
    ]);
    const secondSearch = buildScoopCatalogPlan([
      { ...product("https://store.example/sony-2", "89.00", 0.8), brand: " sony " },
    ]);

    expect(firstSearch[0].normalizedBrandName).toBe("sony");
    expect(secondSearch[0].normalizedBrandName).toBe("sony");
    expect(firstSearch).toHaveLength(1);
    expect(secondSearch).toHaveLength(1);
  });
});
