// =============================================================================
// Strategic Undercutting Engine
// =============================================================================
// Core pricing algorithm: 5% undercut rule with margin protection floor.
// All monetary values are handled as numbers (dollars).
//
// This is a PURE COMPUTATION module — no DB access, no HTTP, no side effects.
// All inputs are passed in; all outputs are returned.
// =============================================================================

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MarketSnapshot {
  merchantPrice: number;
  avgCompetitorPrice: number | null;
  lowestCompetitorPrice: number | null;
  highestCompetitorPrice: number | null;
  competitorCount: number;
}

export interface PricingRecommendation {
  recommendedPrice: number;
  avgCompetitorPrice: number;
  minimumAllowedPrice: number;
  marginProtectionApplied: boolean;
  explanation: string;
}

export type MarketPositionStatus =
  | "LEADING"
  | "COMPETITIVE"
  | "OVERPRICED"
  | "INSUFFICIENT_DATA";

export interface MarketPosition {
  status: MarketPositionStatus;
  color: "green" | "blue" | "red" | "gray";
  label: string;
  meaning: string;
  priceDiff: number | null;
  priceDiffPercent: number | null;
}

export interface ProductAnalysis {
  marketSnapshot: MarketSnapshot;
  recommendation: PricingRecommendation | null;
  position: MarketPosition;
}

export interface AnalyzeProductInput {
  merchantPrice: number;
  costPrice: number | null;
  competitorPrices: number[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const UNDERCUT_FACTOR = 0.95; // 5% below average
export const MARGIN_FACTOR = 1.1; // 10% minimum margin above cost
export const COMPETITIVE_THRESHOLD = 0.03; // ±3% band

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filterValidPrices(prices: number[]): number[] {
  return prices.filter(
    (p) => p != null && typeof p === "number" && p > 0 && !isNaN(p)
  );
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Core Calculations ───────────────────────────────────────────────────────

export function calculateAverageCompetitorPrice(
  prices: number[]
): number | null {
  const valid = filterValidPrices(prices);
  if (valid.length === 0) return null;
  const sum = valid.reduce((a, b) => a + b, 0);
  return roundToTwoDecimals(sum / valid.length);
}

export function calculateRecommendedPrice(
  avgCompetitorPrice: number,
  costPrice: number | null
): PricingRecommendation {
  const undercutPrice = roundToTwoDecimals(
    avgCompetitorPrice * UNDERCUT_FACTOR
  );

  // If no cost data, no margin floor
  if (costPrice == null || costPrice <= 0) {
    return {
      recommendedPrice: undercutPrice,
      avgCompetitorPrice,
      minimumAllowedPrice: 0,
      marginProtectionApplied: false,
      explanation: `$${undercutPrice.toFixed(
        2
      )} — 5% below competitor market average of $${avgCompetitorPrice.toFixed(
        2
      )}.`,
    };
  }

  const minimumAllowedPrice = roundToTwoDecimals(costPrice * MARGIN_FACTOR);

  if (undercutPrice >= minimumAllowedPrice) {
    return {
      recommendedPrice: undercutPrice,
      avgCompetitorPrice,
      minimumAllowedPrice,
      marginProtectionApplied: false,
      explanation: `$${undercutPrice.toFixed(
        2
      )} — 5% below competitor market average of $${avgCompetitorPrice.toFixed(
        2
      )} while maintaining margin protection.`,
    };
  }

  // Margin protection kicks in
  return {
    recommendedPrice: minimumAllowedPrice,
    avgCompetitorPrice,
    minimumAllowedPrice,
    marginProtectionApplied: true,
    explanation: `$${minimumAllowedPrice.toFixed(
      2
    )} — Recommendation limited by minimum profit margin protection (cost $${costPrice.toFixed(
      2
    )} + 10%). 5% undercut price would be $${undercutPrice.toFixed(
      2
    )} which is below floor.`,
  };
}

export function classifyMarketPosition(
  merchantPrice: number,
  avgCompetitorPrice: number | null
): MarketPosition {
  if (avgCompetitorPrice == null || avgCompetitorPrice <= 0) {
    return {
      status: "INSUFFICIENT_DATA",
      color: "gray",
      label: "No Data",
      meaning: "Not enough competitor pricing data.",
      priceDiff: null,
      priceDiffPercent: null,
    };
  }

  const diff = merchantPrice - avgCompetitorPrice;
  const diffPercent = roundToTwoDecimals(
    (diff / avgCompetitorPrice) * 100
  );
  const absDiff = Math.abs(diff);
  const threshold = avgCompetitorPrice * COMPETITIVE_THRESHOLD;

  if (absDiff <= threshold) {
    return {
      status: "COMPETITIVE",
      color: "blue",
      label: "Competitive",
      meaning: "You are competitively priced.",
      priceDiff: roundToTwoDecimals(diff),
      priceDiffPercent: diffPercent,
    };
  }

  if (merchantPrice < avgCompetitorPrice) {
    return {
      status: "LEADING",
      color: "green",
      label: "Leading Market",
      meaning: "You are currently leading the market.",
      priceDiff: roundToTwoDecimals(diff),
      priceDiffPercent: diffPercent,
    };
  }

  return {
    status: "OVERPRICED",
    color: "red",
    label: "Overpriced",
    meaning: "You are likely losing sales to competitors.",
    priceDiff: roundToTwoDecimals(diff),
    priceDiffPercent: diffPercent,
  };
}

// ─── Main Analysis Function ──────────────────────────────────────────────────

export function analyzeProduct(
  input: AnalyzeProductInput
): ProductAnalysis {
  const { merchantPrice, costPrice, competitorPrices } = input;

  const validPrices = filterValidPrices(competitorPrices);
  const avgPrice = calculateAverageCompetitorPrice(validPrices);
  const lowestPrice =
    validPrices.length > 0 ? Math.min(...validPrices) : null;
  const highestPrice =
    validPrices.length > 0 ? Math.max(...validPrices) : null;

  const marketSnapshot: MarketSnapshot = {
    merchantPrice,
    avgCompetitorPrice: avgPrice,
    lowestCompetitorPrice: lowestPrice,
    highestCompetitorPrice: highestPrice,
    competitorCount: validPrices.length,
  };

  let recommendation: PricingRecommendation | null = null;

  if (avgPrice !== null) {
    recommendation = calculateRecommendedPrice(avgPrice, costPrice);
  }

  const position = classifyMarketPosition(merchantPrice, avgPrice);

  return { marketSnapshot, recommendation, position };
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const pricingEngine = {
  calculateAverageCompetitorPrice,
  calculateRecommendedPrice,
  classifyMarketPosition,
  analyzeProduct,
  UNDERCUT_FACTOR,
  MARGIN_FACTOR,
  COMPETITIVE_THRESHOLD,
};
