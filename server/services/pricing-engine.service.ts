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
  /** The merchant's own rules. Omitted, the defaults apply. */
  rules?: PricingRules;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const UNDERCUT_FACTOR = 0.95; // 5% below average
export const MARGIN_FACTOR = 1.1; // 10% minimum margin above cost

/** The two rules a merchant can change, as factors rather than percentages. */
export interface PricingRules {
  undercutFactor: number;
  marginFactor: number;
}

export const DEFAULT_PRICING_RULES: PricingRules = {
  undercutFactor: UNDERCUT_FACTOR,
  marginFactor: MARGIN_FACTOR,
};

/** Percentages are what a merchant sets; factors are what the maths wants. */
export function rulesFromPercents(input: {
  undercutPercent?: string | number | null;
  minMarginPercent?: string | number | null;
}): PricingRules {
  const undercut = Number(input.undercutPercent);
  const margin = Number(input.minMarginPercent);
  return {
    undercutFactor:
      Number.isFinite(undercut) && undercut >= 0 && undercut < 100
        ? 1 - undercut / 100
        : UNDERCUT_FACTOR,
    marginFactor:
      Number.isFinite(margin) && margin >= 0 && margin < 100
        ? 1 / (1 - margin / 100)
        : MARGIN_FACTOR,
  };
}
export const COMPETITIVE_THRESHOLD = 0.03; // ±3% band

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filterValidPrices(prices: number[]): number[] {
  return prices.filter(
    p => p != null && typeof p === "number" && p > 0 && !isNaN(p)
  );
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

// Integer-cents helpers: keep money math on whole numbers to avoid the
// `Math.round(dollars * 100)` float trap (e.g. 1.005 → 1.00).
function dollarsToCents(value: number): number {
  return Math.round(value * 100);
}

function centsToDollars(cents: number): number {
  return cents / 100;
}

// ─── Core Calculations ───────────────────────────────────────────────────────

export function calculateAverageCompetitorPrice(
  prices: number[]
): number | null {
  const valid = filterValidPrices(prices);
  if (valid.length === 0) return null;
  const totalCents = valid.reduce((a, p) => a + dollarsToCents(p), 0);
  return centsToDollars(Math.round(totalCents / valid.length));
}

export function calculateRecommendedPrice(
  avgCompetitorPrice: number,
  costPrice: number | null,
  rules: PricingRules = DEFAULT_PRICING_RULES
): PricingRecommendation {
  const undercutPercent = Math.round((1 - rules.undercutFactor) * 100);
  const undercutPrice = roundToTwoDecimals(
    avgCompetitorPrice * rules.undercutFactor
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
      )} — ${undercutPercent}% below competitor market average of $${avgCompetitorPrice.toFixed(
        2
      )}.`,
    };
  }

  const minimumAllowedPrice = roundToTwoDecimals(costPrice * rules.marginFactor);

  if (undercutPrice >= minimumAllowedPrice) {
    return {
      recommendedPrice: undercutPrice,
      avgCompetitorPrice,
      minimumAllowedPrice,
      marginProtectionApplied: false,
      explanation: `$${undercutPrice.toFixed(
        2
      )} — ${undercutPercent}% below competitor market average of $${avgCompetitorPrice.toFixed(
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

  const merchCents = dollarsToCents(merchantPrice);
  const avgCents = dollarsToCents(avgCompetitorPrice);
  const diffCents = merchCents - avgCents;
  const diffPercent = (diffCents / avgCents) * 100;
  const absDiffCents = Math.abs(diffCents);
  const thresholdCents = Math.round(avgCents * COMPETITIVE_THRESHOLD);

  if (absDiffCents <= thresholdCents) {
    return {
      status: "COMPETITIVE",
      color: "blue",
      label: "Competitive",
      meaning: "You are competitively priced.",
      priceDiff: centsToDollars(diffCents),
      priceDiffPercent: roundToTwoDecimals(diffPercent),
    };
  }

  if (merchCents < avgCents) {
    return {
      status: "LEADING",
      color: "green",
      label: "Leading Market",
      meaning: "You are currently leading the market.",
      priceDiff: centsToDollars(diffCents),
      priceDiffPercent: roundToTwoDecimals(diffPercent),
    };
  }

  return {
    status: "OVERPRICED",
    color: "red",
    label: "Overpriced",
    meaning: "You are likely losing sales to competitors.",
    priceDiff: centsToDollars(diffCents),
    priceDiffPercent: roundToTwoDecimals(diffPercent),
  };
}

// ─── Main Analysis Function ──────────────────────────────────────────────────

export function analyzeProduct(input: AnalyzeProductInput): ProductAnalysis {
  const { merchantPrice, costPrice, competitorPrices } = input;
  const rules = input.rules ?? DEFAULT_PRICING_RULES;

  const validPrices = filterValidPrices(competitorPrices);
  const avgPrice = calculateAverageCompetitorPrice(validPrices);
  const lowestPrice = validPrices.length > 0 ? Math.min(...validPrices) : null;
  const highestPrice = validPrices.length > 0 ? Math.max(...validPrices) : null;

  const marketSnapshot: MarketSnapshot = {
    merchantPrice,
    avgCompetitorPrice: avgPrice,
    lowestCompetitorPrice: lowestPrice,
    highestCompetitorPrice: highestPrice,
    competitorCount: validPrices.length,
  };

  let recommendation: PricingRecommendation | null = null;

  if (avgPrice !== null) {
    recommendation = calculateRecommendedPrice(avgPrice, costPrice, rules);
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
  rulesFromPercents,
  DEFAULT_PRICING_RULES,
  UNDERCUT_FACTOR,
  MARGIN_FACTOR,
  COMPETITIVE_THRESHOLD,
};
