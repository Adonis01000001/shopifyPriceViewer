import { describe, it, expect } from "vitest";
import {
  calculateAverageCompetitorPrice,
  calculateRecommendedPrice,
  classifyMarketPosition,
  analyzeProduct,
} from "../pricing-engine.service";

describe("PricingEngine", () => {
  describe("calculateAverageCompetitorPrice", () => {
    it("calculates average of valid competitor prices", () => {
      const result = calculateAverageCompetitorPrice([100, 110, 90]);
      expect(result).toBe(100);
    });

    it("filters out invalid prices (zero, negative, null)", () => {
      const result = calculateAverageCompetitorPrice([
        100,
        0,
        -10,
        null as any,
        110,
        90,
      ]);
      expect(result).toBe(100);
    });

    it("returns null for empty array", () => {
      const result = calculateAverageCompetitorPrice([]);
      expect(result).toBeNull();
    });

    it("handles single competitor", () => {
      const result = calculateAverageCompetitorPrice([100]);
      expect(result).toBe(100);
    });

    it("handles all invalid prices", () => {
      const result = calculateAverageCompetitorPrice([0, -5, null as any]);
      expect(result).toBeNull();
    });

    it("rounds to two decimal places", () => {
      const result = calculateAverageCompetitorPrice([100, 110, 91]);
      expect(result).toBeCloseTo(100.33, 2);
    });
  });

  describe("calculateRecommendedPrice", () => {
    it("applies 5% undercut to average competitor price", () => {
      const result = calculateRecommendedPrice(100, 50);
      expect(result.recommendedPrice).toBe(95);
      expect(result.marginProtectionApplied).toBe(false);
    });

    it("enforces margin protection floor when undercut goes below minimum", () => {
      const result = calculateRecommendedPrice(90, 100);
      expect(result.recommendedPrice).toBe(110);
      expect(result.marginProtectionApplied).toBe(true);
    });

    it("returns undercut price when cost is zero", () => {
      const result = calculateRecommendedPrice(100, 0);
      expect(result.recommendedPrice).toBe(95);
      expect(result.marginProtectionApplied).toBe(false);
    });

    it("returns undercut price when cost is null", () => {
      const result = calculateRecommendedPrice(100, null);
      expect(result.recommendedPrice).toBe(95);
      expect(result.marginProtectionApplied).toBe(false);
    });

    it("exact boundary: undercut equals floor", () => {
      const result = calculateRecommendedPrice(100, 86.36);
      expect(result.recommendedPrice).toBe(95);
      expect(result.marginProtectionApplied).toBe(false);
    });

    it("just below boundary: margin protection applies", () => {
      const result = calculateRecommendedPrice(100, 86.4);
      expect(result.recommendedPrice).toBe(95.04);
      expect(result.marginProtectionApplied).toBe(true);
    });

    it("includes explanation mentioning 5%", () => {
      const result = calculateRecommendedPrice(100, 50);
      expect(result.explanation).toContain("5%");
      expect(result.explanation).toContain("95.00");
    });

    it("margin protection explanation mentions cost", () => {
      const result = calculateRecommendedPrice(90, 100);
      expect(result.explanation).toContain("100.00");
      expect(result.explanation).toContain("margin protection");
    });
  });

  describe("classifyMarketPosition", () => {
    it("LEADING: merchant is cheaper than avg", () => {
      const result = classifyMarketPosition(90, 100);
      expect(result.status).toBe("LEADING");
      expect(result.color).toBe("green");
      expect(result.label).toBe("Leading Market");
      expect(result.meaning).toBe("You are currently leading the market.");
    });

    it("COMPETITIVE: merchant is within +3% of avg", () => {
      const result = classifyMarketPosition(102, 100);
      expect(result.status).toBe("COMPETITIVE");
      expect(result.color).toBe("blue");
    });

    it("COMPETITIVE: exactly 3% above avg", () => {
      const result = classifyMarketPosition(103, 100);
      expect(result.status).toBe("COMPETITIVE");
    });

    it("COMPETITIVE: exactly 3% below avg", () => {
      const result = classifyMarketPosition(97, 100);
      expect(result.status).toBe("COMPETITIVE");
    });

    it("OVERPRICED: more than 3% above avg", () => {
      const result = classifyMarketPosition(104, 100);
      expect(result.status).toBe("OVERPRICED");
      expect(result.color).toBe("red");
    });

    it("LEADING: more than 3% below avg", () => {
      const result = classifyMarketPosition(96, 100);
      expect(result.status).toBe("LEADING");
    });

    it("INSUFFICIENT_DATA: avg is null", () => {
      const result = classifyMarketPosition(100, null);
      expect(result.status).toBe("INSUFFICIENT_DATA");
      expect(result.color).toBe("gray");
    });

    it("computes priceDiff and priceDiffPercent", () => {
      const result = classifyMarketPosition(105, 100);
      expect(result.priceDiff).toBe(5);
      expect(result.priceDiffPercent).toBe(5);
    });

    it("computes negative priceDiff", () => {
      const result = classifyMarketPosition(90, 100);
      expect(result.priceDiff).toBe(-10);
      expect(result.priceDiffPercent).toBe(-10);
    });
  });

  describe("analyzeProduct (full integration)", () => {
    it("returns complete analysis for normal case", () => {
      const result = analyzeProduct({
        merchantPrice: 105,
        costPrice: 80,
        competitorPrices: [100, 110, 90],
      });
      expect(result.marketSnapshot.merchantPrice).toBe(105);
      expect(result.marketSnapshot.avgCompetitorPrice).toBe(100);
      expect(result.marketSnapshot.lowestCompetitorPrice).toBe(90);
      expect(result.marketSnapshot.highestCompetitorPrice).toBe(110);
      expect(result.marketSnapshot.competitorCount).toBe(3);
      expect(result.recommendation!.recommendedPrice).toBe(95);
      expect(result.recommendation!.marginProtectionApplied).toBe(false);
      expect(result.position.status).toBe("OVERPRICED");
    });

    it("handles no competitor data", () => {
      const result = analyzeProduct({
        merchantPrice: 100,
        costPrice: 80,
        competitorPrices: [],
      });
      expect(result.marketSnapshot.avgCompetitorPrice).toBeNull();
      expect(result.marketSnapshot.competitorCount).toBe(0);
      expect(result.recommendation).toBeNull();
      expect(result.position.status).toBe("INSUFFICIENT_DATA");
    });

    it("extreme undercutting: cost > competitor avg", () => {
      const result = analyzeProduct({
        merchantPrice: 95,
        costPrice: 100,
        competitorPrices: [90],
      });
      expect(result.recommendation!.recommendedPrice).toBe(110);
      expect(result.recommendation!.marginProtectionApplied).toBe(true);
    });

    it("filters invalid prices", () => {
      const result = analyzeProduct({
        merchantPrice: 100,
        costPrice: 50,
        competitorPrices: [100, 0, -10, null as any, 110, 90],
      });
      expect(result.marketSnapshot.competitorCount).toBe(3);
      expect(result.marketSnapshot.avgCompetitorPrice).toBe(100);
    });

    it("handles null cost price", () => {
      const result = analyzeProduct({
        merchantPrice: 100,
        costPrice: null,
        competitorPrices: [100, 110],
      });
      expect(result.recommendation!.recommendedPrice).toBeCloseTo(99.75, 2);
      expect(result.recommendation!.marginProtectionApplied).toBe(false);
    });

    it("classifies LEADING correctly", () => {
      const result = analyzeProduct({
        merchantPrice: 85,
        costPrice: 50,
        competitorPrices: [100, 110, 90],
      });
      expect(result.position.status).toBe("LEADING");
    });

    it("classifies COMPETITIVE correctly", () => {
      const result = analyzeProduct({
        merchantPrice: 101,
        costPrice: 50,
        competitorPrices: [100, 110, 90],
      });
      expect(result.position.status).toBe("COMPETITIVE");
    });
  });

  describe("edge cases", () => {
    it("handles very large prices", () => {
      const result = analyzeProduct({
        merchantPrice: 99999.99,
        costPrice: 50000,
        competitorPrices: [100000, 95000, 105000],
      });
      expect(result.marketSnapshot.avgCompetitorPrice).toBe(100000);
      expect(result.recommendation!.recommendedPrice).toBe(95000);
    });

    it("handles very small prices", () => {
      const result = analyzeProduct({
        merchantPrice: 1.5,
        costPrice: 0.5,
        competitorPrices: [1.0, 1.1, 0.9],
      });
      expect(result.recommendation).not.toBeNull();
    });

    it("merchant price of zero → LEADING", () => {
      const result = analyzeProduct({
        merchantPrice: 0,
        costPrice: 50,
        competitorPrices: [100, 110],
      });
      expect(result.position.status).toBe("LEADING");
    });
  });
});
