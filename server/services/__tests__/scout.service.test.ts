import { describe, expect, it } from "vitest";
import { mergeExaSearchResults } from "../scout.service";

describe("Exa Scout persistence", () => {
  it("keeps structured products when raw Exa search is empty", () => {
    const results = mergeExaSearchResults(
      [
        {
          title: "Example Headphones",
          price: "$99.00",
          currency: "USD",
          sourceUrl: "https://store.example/products/headphones",
          sourceName: "Example Store",
        },
      ],
      []
    );

    expect(results).toEqual([
      {
        url: "https://store.example/products/headphones",
        title: "Example Headphones",
        snippet: "Example Store · $99.00",
        position: 1,
      },
    ]);
  });

  it("deduplicates raw results that share a structured product URL", () => {
    const results = mergeExaSearchResults(
      [
        {
          title: "Example Headphones",
          price: "$99.00",
          currency: "USD",
          sourceUrl: "https://store.example/products/headphones",
          sourceName: "Example Store",
        },
      ],
      [
        {
          url: "https://store.example/products/headphones",
          title: "Raw title",
          snippet: "Raw snippet",
        },
        {
          url: "https://other.example/products/headphones",
          title: "Other listing",
          snippet: "Other snippet",
        },
      ]
    );

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Example Headphones");
    expect(results[1].url).toBe("https://other.example/products/headphones");
  });
});
