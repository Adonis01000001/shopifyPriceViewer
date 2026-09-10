/**
 * Everything a merchant needs to judge a suggested price, worked out in one
 * place so the Overview table and the product page cannot disagree.
 *
 * The pricing rules live on the server (average x 0.95, floored at cost x 1.1).
 * Nothing here re-decides a price; it only describes one that already exists.
 */

/** Below this many confirmed competitor prices, a suggestion is thin. */
export const THIN_EVIDENCE_BELOW = 2;

/** A rise this large is worth a second look before it reaches a storefront. */
export const LARGE_RISE_PERCENT = 25;

export type PriceDirection = "cut" | "rise" | "hold";
export type Evidence = "thin" | "fair" | "solid";

export interface RecommendationFacts {
  direction: PriceDirection;
  /** Always positive; read it with `direction`. */
  changeAmount: number;
  changePercent: number;
  sources: number;
  evidence: Evidence;
  /** A rise big enough that following it blindly could cost sales. */
  needsACloserLook: boolean;
  avgCompetitorPrice: number | null;
  /** Margin the suggested price leaves, as a percentage of the new price. */
  marginPercent: number | null;
  /** True when cost, not the market, set the price. */
  heldAtFloor: boolean;
  /** The lowest price the margin rule allows: cost, marked up. */
  floorPrice: number | null;
  costPrice: number | null;
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function recommendationFacts(input: {
  currentPrice: unknown;
  recommendedPrice: unknown;
  costPrice?: unknown;
  marginProtectionApplied?: boolean | null;
  factors?: unknown;
}): RecommendationFacts {
  const current = toNumber(input.currentPrice) ?? 0;
  const recommended = toNumber(input.recommendedPrice) ?? 0;
  const cost = toNumber(input.costPrice);

  const factors = (input.factors ?? {}) as Record<string, unknown>;
  const prices = Array.isArray(factors.competitorPrices)
    ? (factors.competitorPrices as unknown[])
    : [];
  // Pipeline-generated recommendations keep the price list. Older/manual
  // recommendation records only kept the count, so use that persisted count
  // rather than incorrectly showing "no shops confirmed" for them.
  const persistedCount = toNumber(factors.competitorCount);
  const sources = Array.isArray(factors.competitorPrices)
    ? prices.length
    : persistedCount != null && persistedCount >= 0
      ? Math.floor(persistedCount)
      : 0;
  const avg = toNumber(factors.avgCompetitorPrice);

  const delta = recommended - current;
  const direction: PriceDirection =
    Math.abs(delta) < 0.01 ? "hold" : delta > 0 ? "rise" : "cut";
  const changePercent = current > 0 ? Math.abs(delta / current) * 100 : 0;

  const evidence: Evidence =
    sources >= 3 ? "solid" : sources >= THIN_EVIDENCE_BELOW ? "fair" : "thin";

  return {
    direction,
    changeAmount: Math.abs(delta),
    changePercent,
    sources,
    evidence,
    // A big rise is only alarming when little supports it. A large cut is
    // bounded by the margin floor already, so it does not need this.
    needsACloserLook:
      direction === "rise" &&
      changePercent >= LARGE_RISE_PERCENT &&
      evidence !== "solid",
    avgCompetitorPrice: avg,
    marginPercent:
      cost != null && cost > 0 && recommended > 0
        ? ((recommended - cost) / recommended) * 100
        : null,
    heldAtFloor: input.marginProtectionApplied === true,
    floorPrice: toNumber(factors.minimumAllowedPrice),
    costPrice: cost,
  };
}
