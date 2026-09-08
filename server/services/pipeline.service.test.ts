import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import { ENV } from "../_core/env";
import {
  discoverCandidates,
  LOCALES,
  summarizePipelineResults,
  buildProductSearchQueries,
  classifyProductPage,
  isNonProductSearchUrl,
  pageLooksLikeProductPage,
  type PipelineProductResult,
} from "./pipeline.service";
import { activityService } from "./activity.service";
import { pipelineService } from "./pipeline.service";
import { resetSerpApiRuntimeStateForTests } from "./serpapi.service";

const original = {
  serpApiKey: ENV.serpApiKey,
  serperApiKey: ENV.serperApiKey,
  serpApiMaxRetries: ENV.serpApiMaxRetries,
  serpApiBaseBackoffMs: ENV.serpApiBaseBackoffMs,
  serpApiMaxBackoffMs: ENV.serpApiMaxBackoffMs,
  serpApiCacheTtlMs: ENV.serpApiCacheTtlMs,
};

function searchResponse(links: string[], titles?: string[]) {
  return new Response(
    JSON.stringify({
      organic_results: links.map((link, index) => ({
        link,
        title: titles?.[index] ?? `Product result ${index + 1}`,
      })),
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

const product = {
  title: "Anker 737 Power Bank 24000mAh",
  vendor: "Anker",
  sku: null,
  barcode: null,
};

function productResult(
  searchFailure?: PipelineProductResult["searchFailure"]
): PipelineProductResult {
  return {
    productId: "product-1",
    title: product.title,
    discovered: 0,
    scraped: 0,
    matched: 0,
    competitorPrices: [],
    recommendedPrice: null,
    marginProtectionApplied: false,
    searchFailure,
    diagnostics: {
      candidateUrls: [],
      matchedUrls: [],
      rejected: [],
      priceCandidates: 0,
      searchQueries: 0,
      searchCacheHits: 0,
      searchDeduplicated: 0,
    },
  };
}

describe("pipeline search orchestration", () => {
  beforeEach(() => {
    resetSerpApiRuntimeStateForTests();
    ENV.serpApiKey = "test-serp-key";
    ENV.serperApiKey = "";
    ENV.serpApiMaxRetries = 0;
    ENV.serpApiBaseBackoffMs = 0;
    ENV.serpApiMaxBackoffMs = 0;
    ENV.serpApiCacheTtlMs = 60_000;
    vi.restoreAllMocks();
  });

  afterAll(() => {
    Object.assign(ENV, original);
    vi.unstubAllGlobals();
  });

  it("avoids the second query when the primary search supplies enough domains", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        searchResponse([
          "https://one.example/product",
          "https://two.example/product",
          "https://three.example/product",
          "https://four.example/product",
        ], [
          "Anker 737 Power Bank 24000mAh",
          "Anker 737 Power Bank 24000mAh",
          "Anker 737 Power Bank 24000mAh",
          "Anker 737 Power Bank 24000mAh",
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverCandidates(product, null, LOCALES.US);

    expect(result.candidates).toHaveLength(4);
    expect(result.queriesAttempted).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows a strongly identified product page without a detectable price to reach AI", () => {
    expect(
      pageLooksLikeProductPage(
        '<h1>JBL Flip 6</h1><button>Add to cart</button>',
        "https://shop.example/products/jbl-flip-6"
      )
    ).toBe(true);
    expect(pageLooksLikeProductPage("<nav>Welcome to our site</nav>")).toBe(
      false
    );
  });

  it("keeps full product identity in the focused query", () => {
    expect(buildProductSearchQueries(product)).toEqual([
      "Anker 737 Power Bank 24000mAh buy",
      "Anker 737 Power Bank 24000mAh price",
    ]);
  });

  it("rejects known listing and support URLs before scraping", () => {
    expect(isNonProductSearchUrl("https://www.amazon.com/clp/B09VYBTVCL")).toBe(true);
    expect(isNonProductSearchUrl("https://www.homedepot.com/b/Electrical/Ring/N-1")).toBe(true);
    expect(isNonProductSearchUrl("https://support.bose.com/s/product/quietcomfort")).toBe(true);
    expect(isNonProductSearchUrl("https://www.walmart.com/ip/GoPro-HERO12/3048456636")).toBe(false);
  });

  it("does not admit excluded-domain subdomains", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      searchResponse(["https://en.wikipedia.org/wiki/Ring_(company)"])
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await discoverCandidates(product, null, LOCALES.US);
    expect(result.candidates).toEqual([]);
  });

  it("classifies multi-product pages as non-product while allowing a product detail page", () => {
    expect(
      classifyProductPage(
        '<script type="application/ld+json">{"@type":"Product"}</script>',
        "https://example.com/search?q=phone"
      )
    ).toBe("non_product");
    expect(
      classifyProductPage(
        '<h1>JBL Flip 6</h1><button>Add to cart</button><span>$129.99</span>',
        "https://shop.example/products/jbl-flip-6"
      )
    ).toBe("probable_product");
    expect(
      classifyProductPage(
        "Sony WH-1000XM5 Wireless Headphones $299.99",
        "https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-b"
      )
    ).toBe("probable_product");
    expect(
      classifyProductPage(
        "GoPro HERO12 Black Camera $319.98",
        "https://www.walmart.com/ip/GoPro-HERO12-Black-Camera/3048456636"
      )
    ).toBe("probable_product");
  });

  it("uses the focused second query only when the primary search is insufficient", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(searchResponse(["https://one.example/product"]))
      .mockResolvedValueOnce(searchResponse(["https://two.example/product"]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverCandidates(product, null, LOCALES.US);

    expect(result.candidates).toHaveLength(2);
    expect(result.queriesAttempted).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns rate-limited products in totals instead of hiding them as success", () => {
    const totals = summarizePipelineResults(
      [{ id: "product-1" }, { id: "product-2" }],
      [productResult("rate_limited"), productResult()]
    );

    expect(totals).toMatchObject({
      products: 2,
      rate_limited: 1,
      failed: 1,
    });
  });

  it("surfaces a SerpApi provider error as a product diagnostic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "SerpApi response unavailable" }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverCandidates(product, null, LOCALES.US);

    expect(result.candidates).toEqual([]);
    expect(result.failureCategory).toBe("provider_error");
    expect(result.failureDiagnostic).toMatchObject({
      provider: "serpapi",
      category: "provider_error",
      status: 200,
      attempts: 1,
      message: expect.stringContaining("SerpApi response unavailable"),
    });
  });

  it("counts provider failures while retaining successful products in the batch", () => {
    const totals = summarizePipelineResults(
      [{ id: "product-1" }, { id: "product-2" }],
      [productResult("provider_error"), productResult()]
    );

    expect(totals).toMatchObject({
      products: 2,
      failed: 1,
      provider_error: 1,
    });
  });

  it("continues the batch when one product fails", async () => {
    const rows = [
      { id: "product-1", title: "Product one" },
      { id: "product-2", title: "Product two" },
    ];
    const chain: Record<string, any> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(async () => rows);
    vi.spyOn(db, "getDb").mockResolvedValue({
      select: vi.fn(() => chain),
    } as any);
    vi.spyOn(activityService, "log").mockResolvedValue(undefined);
    const runForProduct = vi.spyOn(pipelineService, "runForProduct");
    runForProduct
      .mockRejectedValueOnce(new Error("one product failed"))
      .mockResolvedValueOnce(productResult());

    const result = await pipelineService.runForUser("user-1", 2);

    expect(runForProduct).toHaveBeenCalledTimes(2);
    expect(result.products).toHaveLength(1);
    expect(result.totals).toMatchObject({ products: 2, failed: 1 });
  });

  it("coalesces overlapping runs for the same account and store", async () => {
    const rows = [{ id: "product-1", title: "Product one" }];
    const chain: Record<string, any> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(async () => rows);
    vi.spyOn(db, "getDb").mockResolvedValue({
      select: vi.fn(() => chain),
    } as any);
    vi.spyOn(activityService, "log").mockResolvedValue(undefined);
    const runForProduct = vi
      .spyOn(pipelineService, "runForProduct")
      .mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return productResult();
      });

    const [first, second] = await Promise.all([
      pipelineService.runForUser("user-1", 2, undefined, "store-1"),
      pipelineService.runForUser("user-1", 2, undefined, "store-1"),
    ]);

    expect(runForProduct).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});
