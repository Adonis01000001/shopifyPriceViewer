import { describe, expect, it } from "vitest";
import {
  buildDiscoveryQueries,
  decideDiscoveryMatch,
  normalizeIdentifier,
} from "../competitor-discovery.matcher";

const baseOffer = {
  productUrl: "https://shop.example.com/products/lg-tv",
  price: "249.99",
  currency: "USD",
  availability: "in_stock",
};

describe("competitor discovery matching", () => {
  it("matches an exact model/SKU even when the titles differ", () => {
    const result = decideDiscoveryMatch(
      { title: "LG 80 cm (32 inches) HD Ready Smart LED TV", brand: "LG", sku: "32LM630B" },
      { ...baseOffer, title: "LG 32-inch Smart LED Television", brand: "LG", sku: "32-LM630B" }
    );
    expect(result).toMatchObject({ accepted: true, matchType: "exact", method: "exact-sku" });
    expect(result.score).toBeGreaterThanOrEqual(0.99);
  });

  it("normalizes punctuation and case in identifiers", () => {
    expect(normalizeIdentifier("lg-32lm630b")).toBe("LG32LM630B");
    const result = decideDiscoveryMatch(
      { title: "LG 32LM630B", brand: "LG", sku: "32LM630B" },
      { ...baseOffer, title: "32LM630B HD Ready TV", brand: "lg" }
    );
    expect(result.accepted).toBe(true);
  });

  it("rejects conflicting model identifiers", () => {
    const result = decideDiscoveryMatch(
      { title: "LG 32LM630B TV", brand: "LG", sku: "32LM630B" },
      { ...baseOffer, title: "LG 32LM631B TV", brand: "LG", sku: "32LM631B" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-identifier-mismatch" });
  });

  it("rejects offers without a verified price or currency", () => {
    expect(
      decideDiscoveryMatch(
        { title: "Sony WH-1000XM5", brand: "Sony", sku: "WH1000XM5" },
        { ...baseOffer, title: "Sony WH-1000XM5", brand: "Sony", price: null }
      ).accepted
    ).toBe(false);
    expect(
      decideDiscoveryMatch(
        { title: "Sony WH-1000XM5", brand: "Sony", sku: "WH1000XM5" },
        { ...baseOffer, title: "Sony WH-1000XM5", brand: "Sony", currency: null }
      ).accepted
    ).toBe(false);
  });

  it("does not auto-match generic same-size titles", () => {
    const result = decideDiscoveryMatch(
      { title: "LG 32 inch Smart LED TV", brand: "LG" },
      { ...baseOffer, title: "LG 32-inch Smart LED TV", brand: "LG" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-low-confidence" });
  });

  it("builds identifier-first shopping queries", () => {
    const queries = buildDiscoveryQueries({
      title: "LG 80 cm (32 inches) HD Ready Smart LED TV",
      brand: "LG",
      sku: "32LM630B",
    });
    expect(queries).toContain('"32LM630B" price');
    expect(queries).toContain('"LG" "32LM630B"');
    expect(queries.some(query => query.includes("buy"))).toBe(true);
  });

  it("promotes model numbers embedded in titles to identifier queries", () => {
    const queries = buildDiscoveryQueries({
      title: "LG 80 cm (32 inches) HD Ready Smart LED TV 32LM563BPTC",
      brand: "LG",
    });

    expect(queries).toContain('"32LM563BPTC" price');
    expect(queries).toContain('"LG" "32LM563BPTC"');
  });

  it("matches a model embedded in both titles when no explicit SKU is present", () => {
    const result = decideDiscoveryMatch(
      { title: "Sony WH-1000XM5 Wireless Headphones", brand: "Sony" },
      { ...baseOffer, title: "Sony WH1000XM5 noise cancelling headphones", brand: "Sony" }
    );
    expect(result).toMatchObject({ accepted: true, matchType: "exact", method: "exact-model-in-title" });
  });

  it("accepts an explainable equivalent with brand, category, and multiple product signals", () => {
    const result = decideDiscoveryMatch(
      { title: "Sony noise cancelling headphones", brand: "Sony", category: "Headphones" },
      { ...baseOffer, title: "Sony wireless noise cancelling headphones", brand: "Sony", category: "Headphones" }
    );
    expect(result).toMatchObject({ accepted: true, matchType: "equivalent", method: "brand-title-specification" });
    expect(result.score).toBeGreaterThanOrEqual(0.85);
  });

  it("rejects accessories and replacement parts", () => {
    const result = decideDiscoveryMatch(
      { title: "Apple iPhone 15 128GB", brand: "Apple", sku: "IPH15-128" },
      { ...baseOffer, title: "Apple iPhone 15 protective case", brand: "Apple", sku: "CASE-IPH15" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-accessory" });
  });

  it("rejects used or refurbished offers for a new product", () => {
    const result = decideDiscoveryMatch(
      { title: "Sony WH-1000XM5", brand: "Sony", sku: "WH1000XM5" },
      { ...baseOffer, title: "Sony WH-1000XM5 refurbished", brand: "Sony", sku: "WH1000XM5", condition: "refurbished" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-condition" });
  });

  it("rejects a different package quantity", () => {
    const result = decideDiscoveryMatch(
      { title: "USB-C cable pack", brand: "Anker", sku: "CABLE-2", quantity: 2, unit: "pieces" },
      { ...baseOffer, title: "Anker USB-C cable pack", brand: "Anker", sku: "CABLE-2", quantity: 5, unit: "pieces" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-quantity" });
  });

  it("rejects a bundle when the merchant sells a single product", () => {
    const result = decideDiscoveryMatch(
      { title: "Sony WH-1000XM5 headphones", brand: "Sony", sku: "WH1000XM5" },
      { ...baseOffer, title: "Sony WH-1000XM5 headphones bundle", brand: "Sony", sku: "WH1000XM5-BUNDLE" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-bundle" });
  });

  it("rejects a different storage capacity even when the model family matches", () => {
    const result = decideDiscoveryMatch(
      { title: "Apple iPhone 15 128GB", brand: "Apple", modelNumber: "A3090" },
      { ...baseOffer, title: "Apple iPhone 15 256GB", brand: "Apple", modelNumber: "A3090" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-storage-gb" });
  });

  it("rejects a different colour variant", () => {
    const result = decideDiscoveryMatch(
      { title: "Samsung Galaxy S24 Black", brand: "Samsung", modelNumber: "SM-S921B" },
      { ...baseOffer, title: "Samsung Galaxy S24 White", brand: "Samsung", modelNumber: "SM-S921B" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-color" });
  });

  it("rejects a different screen size when inch notation differs", () => {
    const result = decideDiscoveryMatch(
      { title: "LG 32\" Smart LED TV", brand: "LG", modelNumber: "32LM630B" },
      { ...baseOffer, title: "LG 43\" Smart LED TV", brand: "LG", modelNumber: "32LM630B" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-screen" });
  });

  it("rejects a different model when only title evidence is available", () => {
    const result = decideDiscoveryMatch(
      { title: "LG 32LM630B Smart TV", brand: "LG" },
      { ...baseOffer, title: "LG 32LM631B Smart TV", brand: "LG" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-model-mismatch" });
  });

  it("rejects an identity-free listing instead of guessing from generic words", () => {
    const result = decideDiscoveryMatch(
      { title: "Premium headphones", brand: "Sony" },
      { ...baseOffer, title: "Premium headphones", brand: "Sony" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-low-confidence" });
  });

  it("rejects replacement parts even when the base model is present", () => {
    const result = decideDiscoveryMatch(
      { title: "Apple iPhone 15 128GB", brand: "Apple", sku: "IPH15-128" },
      { ...baseOffer, title: "Apple iPhone 15 replacement screen", brand: "Apple", sku: "SCREEN-IPH15" }
    );
    expect(result).toMatchObject({ accepted: false, method: "rejected-accessory" });
  });
});
