import { describe, expect, it, vi } from "vitest";
import {
  assessProductMatch,
  contentHash,
  deduplicateExtraction,
  extractDeterministicProduct,
  reduceProductContent,
} from "./product-content-extraction";

const structuredPage = `
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Philips Hue White and Color Ambiance Starter Kit",
        "sku": "HUE-STARTER-01",
        "brand": { "@type": "Brand", "name": "Philips Hue" },
        "description": "Smart lighting starter kit",
        "offers": {
          "@type": "Offer",
          "price": "149.99",
          "priceCurrency": "USD",
          "availability": "https://schema.org/InStock"
        }
      }
    </script>
  </head>
  <body><nav>${"Menu ".repeat(2000)}</nav></body>
</html>`;

describe("product content processing", () => {
  it("extracts complete Schema.org Product data with high match confidence", () => {
    const extracted = extractDeterministicProduct(structuredPage);
    expect(extracted).toMatchObject({
      source: "json-ld",
      title: "Philips Hue White and Color Ambiance Starter Kit",
      price: 149.99,
      currency: "USD",
      sku: "HUE-STARTER-01",
      extractorVersion: "1.4.0",
      resolution: { state: "confident" },
    });
    expect(extracted!.productEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "jsonld", field: "title" }),
        expect.objectContaining({ source: "jsonld", field: "sku" }),
      ])
    );
    expect(extracted!.priceEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "jsonld", field: "price" }),
        expect.objectContaining({ source: "jsonld", field: "currency" }),
      ])
    );
    const match = assessProductMatch(
      {
        title: "Philips Hue White and Color Ambiance Starter Kit",
        sku: "HUE-STARTER-01",
        vendor: "Philips Hue",
      },
      extracted!
    );
    expect(match.highConfidence).toBe(true);
    expect(match.isMatch).toBe(true);
  });

  it("keeps incomplete text extraction low-confidence for LLM fallback", () => {
    const extracted = extractDeterministicProduct(
      "# Similar-looking accessory\nSale price $19.99\nOther products below"
    );
    const match = assessProductMatch(
      { title: "Philips Hue White and Color Ambiance Starter Kit" },
      extracted!
    );
    expect(extracted?.structured).toBe(false);
    expect(match.highConfidence).toBe(false);
    expect(match.resolution.state).not.toBe("confident");
    expect(match.resolution.failureReasons).toContain("low_confidence");
  });

  it("confirms an exact model and brand from sparse retailer text without AI", () => {
    const extracted = extractDeterministicProduct(
      "# Sony WH-1000XM5 Wireless Industry Leading Noise Canceling Headphones\n$398.00 USD"
    );
    const match = assessProductMatch(
      {
        title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
        vendor: "Sony",
        price: "204.25",
      },
      extracted!
    );

    expect(match).toMatchObject({
      isMatch: true,
      modelExact: true,
      deterministicMatch: true,
    });
    // This page is not structured/high-confidence, but the exact identity
    // and literal price evidence are sufficient to avoid a quota-dependent AI
    // decision.
    expect(match.highConfidence).toBe(false);
  });

  it("does not accept an exact model when the page brand conflicts", () => {
    const extracted = extractDeterministicProduct(
      "# Bose WH-1000XM5 Wireless Headphones\n$398.00 USD"
    );
    const match = assessProductMatch(
      {
        title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
        vendor: "Sony",
      },
      extracted!
    );

    expect(match.modelExact).toBe(true);
    expect(match.isMatch).toBe(false);
    expect(match.deterministicMatch).toBe(false);
  });

  it("keeps an identifier-anchored product price ahead of related visible prices", () => {
    const extracted = extractDeterministicProduct(
      `
        <h1>Keychron K2 Wireless Mechanical Keyboard</h1>
        <p>SKU: K2-B1</p>
        <p>Sale price $59.99 Regular price $84.99</p>
        <p>Keychron Silicone Palm Rest $12.99</p>
        <p>Mechanical Switch Set $24.99</p>
      `,
      {
        pageUrl:
          "https://www.keychron.com/products/keychron-k2-wireless-mechanical-keyboard",
      }
    );

    expect(extracted).toMatchObject({
      price: 59.99,
      originalPrice: 84.99,
      priceConflict: false,
    });
    expect(extracted?.priceCandidates.map(item => item.value)).toEqual([
      59.99, 84.99,
    ]);

    const match = assessProductMatch(
      {
        title: "Keychron K2 Wireless Mechanical Keyboard",
        vendor: "Keychron",
      },
      extracted!
    );
    expect(match.deterministicMatch).toBe(true);
  });

  it("uses the product URL and title to focus a product price cluster", () => {
    const extracted = extractDeterministicProduct(
      `
        <h1>GoPro HERO12 Black Action Camera</h1>
        <p>HERO12 Black $369.99</p>
        <p>Join subscribers for $0.00 today</p>
        <p>Recommended mount $49.99</p>
      `,
      {
        pageUrl:
          "https://gopro.com/en/us/shop/cameras/hero12-black/CHDHX-121-master.html",
      }
    );

    expect(extracted).toMatchObject({
      price: 369.99,
      priceConflict: false,
    });
    expect(extracted?.priceCandidates.map(item => item.kind)).toEqual(
      expect.arrayContaining(["current", "related"])
    );
    expect(extracted?.priceCandidates).toHaveLength(2);
  });

  it("reduces menus and scripts while retaining structured product and price context", () => {
    const reduced = reduceProductContent(structuredPage, 2000);
    expect(reduced.length).toBeLessThanOrEqual(2000);
    expect(reduced).toContain("application/ld+json");
    expect(reduced).toContain("149.99");
    expect(reduced.length).toBeLessThan(structuredPage.length);
  });

  it("hashes normalized equivalent content identically", () => {
    expect(contentHash("Product\r\nPrice:   $10")).toBe(
      contentHash("Product\nPrice: $10")
    );
  });

  it("deduplicates identical in-flight extraction work", async () => {
    const work = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { price: 149.99 };
    });
    const [first, second] = await Promise.all([
      deduplicateExtraction("same-product-hash", work),
      deduplicateExtraction("same-product-hash", work),
    ]);
    expect(first).toEqual(second);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("supports JSON-LD products inside an @graph", () => {
    const content = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "BreadcrumbList", name: "breadcrumb" },
        {
          "@type": "Product",
          "@id": "https://example.com/product/1#product",
          name: "Graph Product",
          offers: { price: "119.99", priceCurrency: "EUR" },
        },
      ],
    })}</script>`;
    const result = extractDeterministicProduct(content);
    expect(result).toMatchObject({
      title: "Graph Product",
      price: 119.99,
      currency: "EUR",
    });
  });

  it("extracts a selected Shopify variant and compare-at sale price", () => {
    const content = `<script type="application/json">${JSON.stringify({
      product: {
        id: 123,
        handle: "graph-product",
        title: "Graph Product",
        vendor: "Acme",
        currency: "USD",
        variants: [
          {
            id: 101,
            title: "Red /  Small",
            price: "119.99",
            compare_at_price: "149.99",
            sku: "RED-S",
          },
          { id: 102, title: "Blue / Large", price: "129.99", sku: "BLUE-L" },
        ],
      },
    })}</script>`;
    const result = extractDeterministicProduct(content, {
      pageUrl: "https://example.com/products/graph-product?variant=101",
    });
    expect(result).toMatchObject({
      title: "Graph Product",
      price: 119.99,
      salePrice: 119.99,
      originalPrice: 149.99,
      currency: "USD",
      sku: "RED-S",
    });
    expect(result?.productIdentity).toMatchObject({
      productId: "123",
      variantId: "101",
    });
    expect(result?.variantAmbiguous).toBe(false);
  });

  it("does not guess when multiple Shopify variant prices have no selected variant", () => {
    const content = `<script type="application/json">${JSON.stringify({
      product: {
        title: "Variant Product",
        currency: "USD",
        variants: [
          { id: 201, title: "Small", price: "10.00" },
          { id: 202, title: "Large", price: "20.00" },
        ],
      },
    })}</script>`;
    const result = extractDeterministicProduct(content);
    expect(result?.variantAmbiguous).toBe(true);
    expect(result?.price).toBeNull();
  });

  it("excludes shipping, subscription, installment, unit, and related prices", () => {
    const content = `
      # Main Product
      Now $119.99
      Was $149.99
      Shipping $9.99
      Subscribe monthly $99.99
      Pay in 4 installments of $30.00
      Unit price $12.00 / kg
      Related products Widget $19.99
    `;
    const result = extractDeterministicProduct(content);
    const kinds = result?.priceCandidates.reduce<Record<string, number>>(
      (all, item) => {
        all[item.kind] = (all[item.kind] ?? 0) + 1;
        return all;
      },
      {}
    );
    expect(result?.price).toBe(119.99);
    expect(result?.originalPrice).toBe(149.99);
    expect(kinds).toMatchObject({
      shipping: 1,
      subscription: 1,
      installment: 1,
      unit: 1,
      related: 1,
    });
  });

  it("reconciles conflicting Shopify and JSON-LD prices using source authority", () => {
    const jsonLd = {
      "@type": "Product",
      name: "Conflict Product",
      offers: { price: "129.99", priceCurrency: "USD" },
    };
    const shopify = {
      product: {
        title: "Conflict Product",
        currency: "USD",
        variants: [{ id: 301, price: "119.99" }],
      },
    };
    const content = `<h1>Conflict Product</h1><script type="application/ld+json">${JSON.stringify(jsonLd)}</script><script type="application/json">${JSON.stringify(shopify)}</script>`;
    const result = extractDeterministicProduct(content);
    expect(result?.price).toBe(119.99);
    expect(result?.priceConflict).toBe(true);
    expect(result?.evidence.join(" ")).toContain("source authority");
  });

  it("selects the main product and keeps a related product separate", () => {
    const content = `<h1>Main Product</h1><script type="application/ld+json">${JSON.stringify(
      [
        {
          "@type": "Product",
          name: "Main Product",
          offers: { price: "99.99", priceCurrency: "CAD" },
        },
        {
          "@type": "Product",
          name: "Recommended Accessory",
          offers: { price: "9.99", priceCurrency: "CAD" },
        },
      ]
    )}</script>`;
    const result = extractDeterministicProduct(content);
    expect(result?.title).toBe("Main Product");
    expect(result?.price).toBe(99.99);
    expect(result?.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts semantic HTML product data", () => {
    const content = `<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Semantic Product</h1><span itemprop="priceCurrency" content="GBP"></span><span itemprop="price" content="44.50"></span><meta itemprop="sku" content="SEM-1"></div>`;
    const result = extractDeterministicProduct(content);
    expect(result).toMatchObject({
      title: "Semantic Product",
      price: 44.5,
      currency: "GBP",
      sku: "SEM-1",
    });
  });

  it.each([
    ["USD", "$12.50"],
    ["EUR", "€12.50"],
    ["GBP", "£12.50"],
    ["CAD", "12.50 CAD"],
    ["AUD", "12.50 AUD"],
    ["MAD", "12.50 MAD"],
  ])("normalizes %s currency", (currency, price) => {
    const content = `<meta property="og:title" content="Currency Product"><meta property="product:price:amount" content="${price}"><meta property="product:price:currency" content="${currency}">`;
    const result = extractDeterministicProduct(content);
    expect(result?.currency).toBe(currency);
    expect(result?.price).toBe(12.5);
  });

  it("extracts product data from embedded application state", () => {
    const content = `<script type="application/json">${JSON.stringify({
      state: {
        product: { name: "Embedded Product", price: "79.99", currency: "AUD" },
      },
    })}</script>`;
    const result = extractDeterministicProduct(content);
    expect(result).toMatchObject({
      title: "Embedded Product",
      price: 79.99,
      currency: "AUD",
      source: "embedded-json",
    });
  });

  it("parses JSON assignments in scripts without executing JavaScript", () => {
    const content = `<script>window.__PRODUCT_STATE__ = ${JSON.stringify({ product: { name: "Assigned Product", price: "39.99", currency: "GBP" } })};</script>`;
    const result = extractDeterministicProduct(content);
    expect(result).toMatchObject({
      title: "Assigned Product",
      price: 39.99,
      currency: "GBP",
    });
  });
});
