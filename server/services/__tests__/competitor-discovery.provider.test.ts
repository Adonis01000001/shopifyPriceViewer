import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_core/env", () => ({
  ENV: {
    exaApiKey: "test-exa-key",
    firecrawlApiKey: "",
    serpApiKey: "",
  },
}));

vi.mock("../exa-search.service", () => ({
  exaSearchService: {
    searchProductsDetailed: vi.fn(),
  },
}));

import { exaSearchService } from "../exa-search.service";
import { searchWithExa } from "../competitor-discovery.service";

describe("Price Radar Exa provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("surfaces provider failures instead of returning a false empty success", async () => {
    vi.mocked(exaSearchService.searchProductsDetailed).mockResolvedValue({
      results: [],
      error: "HTTP 429",
    });
    const result = await searchWithExa("test product price", 5);
    expect(result).toEqual({ candidates: [], error: "HTTP 429" });
  });

  it("maps real Exa URLs into deduplicable discovery candidates", async () => {
    vi.mocked(exaSearchService.searchProductsDetailed).mockResolvedValue({
      results: [
        {
          url: "https://shop.example/products/a",
          title: "Example product",
          snippet: "Example product price",
          highlights: [],
          publishedDate: null,
        },
      ],
    });
    const result = await searchWithExa("example product price", 5);
    expect(result).toMatchObject({
      candidates: [
        {
          url: "https://shop.example/products/a",
          domain: "shop.example",
          title: "Example product",
        },
      ],
    });
    expect(result.candidates[0].confidence).toBeGreaterThan(0);
  });
});
