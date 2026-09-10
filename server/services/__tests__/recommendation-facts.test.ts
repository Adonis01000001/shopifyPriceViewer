import { describe, expect, it } from "vitest";
import { recommendationFacts } from "../../../client/src/lib/recommendation-facts";

describe("recommendationFacts", () => {
  it("uses the persisted competitor count for older recommendation records", () => {
    const facts = recommendationFacts({
      currentPrice: "100.00",
      recommendedPrice: "95.00",
      factors: {
        competitorCount: 2,
        avgCompetitorPrice: 100,
      },
    });

    expect(facts.sources).toBe(2);
    expect(facts.evidence).toBe("fair");
  });

  it("prefers the stored price list when it is present", () => {
    const facts = recommendationFacts({
      currentPrice: 100,
      recommendedPrice: 95,
      factors: {
        competitorCount: 99,
        competitorPrices: [100, 110, 90],
      },
    });

    expect(facts.sources).toBe(3);
    expect(facts.evidence).toBe("solid");
  });
});
