import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  classifyUrl,
  extractInternalLinks,
  extractSitemapUrls,
  isAllowedByRobots,
  normalizeCompetitorDomain,
  parseRobotsTxt,
  shouldCrawlUrl,
} from "../url-policy";
import { extractProductData, shouldRenderWithBrowser } from "../extraction";

describe("Price Radar URL policy", () => {
  it("normalizes competitor domains for source assignment", () => {
    expect(normalizeCompetitorDomain("www.Amazon.com")).toBe("amazon.com");
    expect(normalizeCompetitorDomain("EBAY.com.")).toBe("ebay.com");
  });

  it("canonicalizes tracking parameters and fragments", () => {
    expect(
      canonicalizeUrl(
        "HTTPS://Shop.Example.com/products/phone/?utm_source=x&b=2&a=1#reviews"
      )
    ).toBe("https://shop.example.com/products/phone?a=1&b=2");
  });

  it("keeps relevant internal pages and rejects assets and account paths", () => {
    const root = "https://shop.example.com";
    expect(shouldCrawlUrl("/products/phone", root)).toBe(true);
    expect(shouldCrawlUrl("/collections/phones?page=2", root)).toBe(true);
    expect(shouldCrawlUrl("/assets/phone.jpg", root)).toBe(false);
    expect(shouldCrawlUrl("/checkout", root)).toBe(false);
    expect(shouldCrawlUrl("https://evil.example/products/phone", root)).toBe(false);
  });

  it("deduplicates canonical links and classifies page hints", () => {
    const links = extractInternalLinks(
      `<a href="/products/phone?utm_source=a">A</a>
       <a href="https://shop.example.com/products/phone">B</a>
       <a href="/collections/phones?page=2">Next</a>`,
      "https://shop.example.com/collections/phones"
    );
    expect(links).toEqual([
      "https://shop.example.com/products/phone",
      "https://shop.example.com/collections/phones?page=2",
    ]);
    expect(classifyUrl(links[0])).toBe("product");
    expect(classifyUrl(links[1])).toBe("pagination");
  });

  it("parses robots directives and sitemap URLs", () => {
    const robots = parseRobotsTxt(`
      User-agent: *
      Disallow: /account
      Crawl-delay: 2
      Sitemap: https://shop.example.com/sitemap-products.xml
    `);
    expect(robots.disallow).toEqual(["/account"]);
    expect(robots.crawlDelayMs).toBe(2_000);
    expect(isAllowedByRobots("https://shop.example.com/account/orders", robots.disallow)).toBe(false);
    expect(
      extractSitemapUrls(
        `<urlset><url><loc>https://shop.example.com/products/a&amp;x=1</loc></url></urlset>`,
        "https://shop.example.com"
      )
    ).toEqual(["https://shop.example.com/products/a&x=1"]);
  });
});

describe("Price Radar extraction", () => {
  it("uses the configured Amazon.com XPath as the authoritative price", () => {
    const segments = [
      ["div", 1],
      ["div", 1],
      ["div", 1],
      ["div", 5],
      ["div", 1],
      ["div", 7],
      ["div", 1],
      ["div", 1],
      ["div", 1],
      ["div", 1],
      ["div", 1],
      ["form", 1],
      ["div", 1],
      ["div", 1],
      ["div", 1],
      ["div", 1],
      ["div", 3],
      ["div", 1],
      ["div", 1],
      ["div", 1],
      ["div", 1],
      ["div", 1],
      ["span", 1],
      ["span", 1],
    ] as const;
    let body = "MAD249.95";
    for (const [tagName, index] of Array.from(segments).reverse()) {
      const precedingSiblings = Array.from(
        { length: index - 1 },
        () => `<${tagName}></${tagName}>`
      ).join("");
      body = `${precedingSiblings}<${tagName}>${body}</${tagName}>`;
    }
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Amazon Radar Product",
              "offers": {"price": "1.00", "priceCurrency": "USD"}
            }
          </script>
        </head>
        <body>${body}</body>
      </html>`;

    const result = extractProductData(
      html,
      "https://www.amazon.com/dp/B000RADAR1"
    );

    expect(result.product?.price).toBe("249.95");
    expect(result.product?.currency).toBe("MAD");
    expect(result.product?.extractionMethod).toContain("amazon-price");
  });

  it("uses Amazon description for generic titles and requests browser pricing", () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Amazon">
          <meta name="description" content="Amazon.com : Amazon Basics USB-C Cable, 6 ft : Electronics">
        </head>
        <body>${"content ".repeat(300)}</body>
      </html>`;

    const result = extractProductData(
      html,
      "https://www.amazon.com/dp/B000RADAR2"
    );

    expect(result.product?.name).toBe("Amazon Basics USB-C Cable, 6 ft");
    expect(result.product?.price).toBeNull();
    expect(shouldRenderWithBrowser(html, result)).toBe(true);
  });

  it("extracts and normalizes Schema.org Product data", () => {
    const html = `
      <html><head>
        <meta property="og:url" content="https://shop.example.com/products/radar-pro">
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "  Radar Pro Headphones  ",
          "brand": {"@type":"Brand","name":"Acme"},
          "sku": "RP-100",
          "gtin13": "1234567890123",
          "image": ["/images/radar.jpg"],
          "category": "Audio",
          "additionalProperty": [{"name":"Color","value":"Black"}],
          "aggregateRating": {"ratingValue":4.6,"reviewCount":"128 reviews"},
          "offers": {
            "@type":"Offer",
            "price":"1.299,90",
            "highPrice":"1.499,90",
            "priceCurrency":"EUR",
            "availability":"https://schema.org/InStock",
            "seller":{"name":"Example Seller"}
          }
        }
        </script>
      </head><body><a href="/collections/audio?page=2">More</a></body></html>`;
    const result = extractProductData(
      html,
      "https://shop.example.com/products/radar-pro"
    );
    expect(result.pageKind).toBe("product");
    expect(result.product).toMatchObject({
      name: "Radar Pro Headphones",
      brand: "Acme",
      price: "1299.90",
      previousPrice: "1499.90",
      discountPercent: "13.33",
      currency: "EUR",
      availability: "in_stock",
      sku: "RP-100",
      gtin: "1234567890123",
      rating: 4.6,
      reviewCount: 128,
      seller: "Example Seller",
      attributes: { Color: "Black" },
    });
    expect(result.product?.images).toEqual([
      "https://shop.example.com/images/radar.jpg",
    ]);
    expect(result.product?.extractionConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it("uses OpenGraph and HTML fallbacks without inventing missing fields", () => {
    const html = `
      <meta property="og:title" content="Simple Product">
      <meta property="product:price:amount" content="49.99">
      <meta property="product:price:currency" content="USD">
      <meta property="og:image" content="/simple.png">
      <button>Add to cart</button>`;
    const result = extractProductData(html, "https://shop.example.com/p/simple");
    expect(result.product?.name).toBe("Simple Product");
    expect(result.product?.price).toBe("49.99");
    expect(result.product?.brand).toBeNull();
    expect(result.product?.reviewCount).toBeNull();
  });

  it("requests browser rendering for empty JavaScript shells", () => {
    const html = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;
    const result = extractProductData(html, "https://shop.example.com/products/a");
    expect(shouldRenderWithBrowser(html, result)).toBe(true);
  });
});
