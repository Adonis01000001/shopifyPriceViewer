# Strategic Undercutting Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a complete Strategic Undercutting Engine that analyzes competitor pricing, generates intelligent pricing recommendations using the 5% undercut rule with margin protection, classifies market position, and presents results in a merchant dashboard widget.

**Architecture:** The engine is a pure computation layer in `server/services/pricing-engine.service.ts` that takes competitor prices + cost data and outputs recommendations. It plugs into the existing `recommendationService` for persistence, adds new tRPC endpoints via a `pricingEngine` router, and new React components (`PricingRecommendationWidget`, `PricingDashboardSummary`) on the Overview and Products pages. The existing `recommendations` table stores results. We add a `marginProtectionApplied` column via migration.

**Tech Stack:** TypeScript, Drizzle ORM, tRPC, React 19, Recharts, shadcn/ui, Zod

---

## File Map

| File                                                                        | Action     | Responsibility                                                                                                  |
| --------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `server/services/pricing-engine.service.ts`                                 | **Create** | Core algorithm: avg price, 5% undercut, margin floor, position classification                                   |
| `server/services/recommendation.service.ts`                                 | **Modify** | Replace simple 2% logic with call to pricing engine; add `marginProtectionApplied` field                        |
| `server/routers/pricing-engine.router.ts`                                   | **Create** | tRPC router: `analyze`, `analyzeAll`, `getMarketPosition`, `generateRecommendation`, `dashboardStats` endpoints |
| `server/routers.ts`                                                         | **Modify** | Register `pricingEngine` router                                                                                 |
| `drizzle/schema.ts`                                                         | **Modify** | Add `marginProtectionApplied` column to `recommendations` table                                                 |
| `drizzle/migrations/0004_add_margin_protection.sql`                         | **Create** | Migration SQL                                                                                                   |
| `server/services/__tests__/pricing-engine.test.ts`                          | **Create** | Unit tests for the pricing engine                                                                               |
| `client/src/components/dashboard/PricingRecommendationWidget.tsx`           | **Create** | Dashboard widget: Market Snapshot, Recommendation Card, Position Indicator, Margin Warning                      |
| `client/src/pages/dashboard/Overview.tsx`                                   | **Modify** | Integrate `<PricingDashboardSummary />` into the dashboard                                                      |
| `client/src/pages/dashboard/Products.tsx`                                   | **Modify** | Add per-product market position badges                                                                          |
| `docs/superpowers/specs/2026-06-16-strategic-undercutting-engine-design.md` | **Create** | Design doc                                                                                                      |

---

## Task 1: Database Migration — Add `marginProtectionApplied` Column

**Files:**

- Modify: `drizzle/schema.ts:425` (after `potentialSavings` column in recommendations table)
- Create: `drizzle/migrations/0004_add_margin_protection.sql`

- [ ] **Step 1: Add column to schema**

In `drizzle/schema.ts`, in the `recommendations` table definition, add after the `potentialSavings` line (line ~425):

```typescript
marginProtectionApplied: boolean("margin_protection_applied").default(false).notNull(),
```

- [ ] **Step 2: Create migration SQL file**

Create `drizzle/migrations/0004_add_margin_protection.sql`:

```sql
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS margin_protection_applied BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 3: Run migration**

```bash
cd "D:\PV\shopify price viwer" && pnpm db:push
```

- [ ] **Step 4: Commit**

```bash
git add drizzle/schema.ts drizzle/migrations/0004_add_margin_protection.sql
git commit -m "feat(db): add margin_protection_applied column to recommendations"
```

---

## Task 2: Pricing Engine Service — Core Algorithm

**Files:**

- Create: `server/services/pricing-engine.service.ts`
- Create: `server/services/__tests__/pricing-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/services/__tests__/pricing-engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { pricingEngine } from "../pricing-engine.service";

describe("PricingEngine", () => {
  describe("calculateAverageCompetitorPrice", () => {
    it("calculates average of valid competitor prices", () => {
      const result = pricingEngine.calculateAverageCompetitorPrice([
        100, 110, 90,
      ]);
      expect(result).toBe(100);
    });

    it("filters out invalid prices (zero, negative, null)", () => {
      const result = pricingEngine.calculateAverageCompetitorPrice([
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
      const result = pricingEngine.calculateAverageCompetitorPrice([]);
      expect(result).toBeNull();
    });

    it("handles single competitor", () => {
      const result = pricingEngine.calculateAverageCompetitorPrice([100]);
      expect(result).toBe(100);
    });
  });

  describe("calculateRecommendedPrice", () => {
    it("applies 5% undercut to average competitor price", () => {
      const result = pricingEngine.calculateRecommendedPrice(100, 50);
      expect(result.recommendedPrice).toBe(95);
      expect(result.marginProtectionApplied).toBe(false);
    });

    it("enforces margin protection floor when undercut goes below minimum", () => {
      // cost=100, floor=110, 5% undercut of 90 = 85.5 < 110
      const result = pricingEngine.calculateRecommendedPrice(90, 100);
      expect(result.recommendedPrice).toBe(110);
      expect(result.marginProtectionApplied).toBe(true);
    });

    it("returns floor price when cost is zero (no margin protection)", () => {
      const result = pricingEngine.calculateRecommendedPrice(100, 0);
      expect(result.recommendedPrice).toBe(95);
      expect(result.marginProtectionApplied).toBe(false);
    });

    it("exact boundary: undercut equals floor", () => {
      // avg=100, 5% undercut=95, cost=86.36, floor=95
      const result = pricingEngine.calculateRecommendedPrice(100, 86.36);
      expect(result.recommendedPrice).toBe(95);
      expect(result.marginProtectionApplied).toBe(false);
    });
  });

  describe("classifyMarketPosition", () => {
    it("classifies as LEADING when merchant is cheaper", () => {
      const result = pricingEngine.classifyMarketPosition(90, 100);
      expect(result.status).toBe("LEADING");
    });

    it("classifies as COMPETITIVE when within 3%", () => {
      const result = pricingEngine.classifyMarketPosition(102, 100);
      expect(result.status).toBe("COMPETITIVE");
    });

    it("classifies as COMPETITIVE at exactly 3% above", () => {
      const result = pricingEngine.classifyMarketPosition(103, 100);
      expect(result.status).toBe("COMPETITIVE");
    });

    it("classifies as OVERPRICED when more than 3% above", () => {
      const result = pricingEngine.classifyMarketPosition(104, 100);
      expect(result.status).toBe("OVERPRICED");
    });

    it("classifies as COMPETITIVE at exactly 3% below", () => {
      const result = pricingEngine.classifyMarketPosition(97, 100);
      expect(result.status).toBe("COMPETITIVE");
    });

    it("classifies as LEADING when more than 3% below", () => {
      const result = pricingEngine.classifyMarketPosition(96, 100);
      expect(result.status).toBe("LEADING");
    });

    it("classifies as INSUFFICIENT_DATA when avg is null", () => {
      const result = pricingEngine.classifyMarketPosition(100, null);
      expect(result.status).toBe("INSUFFICIENT_DATA");
    });
  });

  describe("analyzeProduct", () => {
    it("returns full analysis with recommendation and position", () => {
      const result = pricingEngine.analyzeProduct({
        merchantPrice: 105,
        costPrice: 80,
        competitorPrices: [100, 110, 90],
      });
      expect(result.marketSnapshot.avgCompetitorPrice).toBe(100);
      expect(result.marketSnapshot.lowestCompetitorPrice).toBe(90);
      expect(result.marketSnapshot.highestCompetitorPrice).toBe(110);
      expect(result.marketSnapshot.competitorCount).toBe(3);
      expect(result.recommendation.recommendedPrice).toBe(95);
      expect(result.recommendation.marginProtectionApplied).toBe(false);
      expect(result.position.status).toBe("OVERPRICED");
    });

    it("handles no competitor data", () => {
      const result = pricingEngine.analyzeProduct({
        merchantPrice: 100,
        costPrice: 80,
        competitorPrices: [],
      });
      expect(result.marketSnapshot.avgCompetitorPrice).toBeNull();
      expect(result.recommendation).toBeNull();
      expect(result.position.status).toBe("INSUFFICIENT_DATA");
    });

    it("handles extreme market undercutting scenario", () => {
      // cost=100, floor=110, competitor avg=90, 5% undercut=85.5
      const result = pricingEngine.analyzeProduct({
        merchantPrice: 95,
        costPrice: 100,
        competitorPrices: [90],
      });
      expect(result.recommendation.recommendedPrice).toBe(110);
      expect(result.recommendation.marginProtectionApplied).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "D:\PV\shopify price viwer" && pnpm test server/services/__tests__/pricing-engine.test.ts
```

Expected: FAIL with "Cannot find module '../pricing-engine.service'"

- [ ] **Step 3: Implement the pricing engine service**

Create `server/services/pricing-engine.service.ts`:

```typescript
// =============================================================================
// Strategic Undercutting Engine
// =============================================================================
// Core pricing algorithm: 5% undercut rule with margin protection floor.
// All monetary values are handled as numbers (dollars).
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

const UNDERCUT_FACTOR = 0.95; // 5% below average
const MARGIN_FACTOR = 1.1; // 10% minimum margin above cost
const COMPETITIVE_THRESHOLD = 0.03; // ±3% band

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filterValidPrices(prices: number[]): number[] {
  return prices.filter(
    p => p != null && typeof p === "number" && p > 0 && !isNaN(p)
  );
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Core Calculations ───────────────────────────────────────────────────────

function calculateAverageCompetitorPrice(prices: number[]): number | null {
  const valid = filterValidPrices(prices);
  if (valid.length === 0) return null;
  const sum = valid.reduce((a, b) => a + b, 0);
  return roundToTwoDecimals(sum / valid.length);
}

function calculateRecommendedPrice(
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
      explanation: `$${undercutPrice.toFixed(2)} — 5% below competitor market average of $${avgCompetitorPrice.toFixed(2)}.`,
    };
  }

  const minimumAllowedPrice = roundToTwoDecimals(costPrice * MARGIN_FACTOR);

  if (undercutPrice >= minimumAllowedPrice) {
    return {
      recommendedPrice: undercutPrice,
      avgCompetitorPrice,
      minimumAllowedPrice,
      marginProtectionApplied: false,
      explanation: `$${undercutPrice.toFixed(2)} — 5% below competitor market average of $${avgCompetitorPrice.toFixed(2)} while maintaining margin protection.`,
    };
  }

  // Margin protection kicks in
  return {
    recommendedPrice: minimumAllowedPrice,
    avgCompetitorPrice,
    minimumAllowedPrice,
    marginProtectionApplied: true,
    explanation: `$${minimumAllowedPrice.toFixed(2)} — Recommendation limited by minimum profit margin protection (cost $${costPrice.toFixed(2)} + 10%). 5% undercut price would be $${undercutPrice.toFixed(2)} which is below floor.`,
  };
}

function classifyMarketPosition(
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
  const diffPercent = roundToTwoDecimals((diff / avgCompetitorPrice) * 100);
  const absDiff = Math.abs(diff);
  const threshold = avgCompetitorPrice * COMPETITIVE_THRESHOLD;

  if (absDiff <= threshold) {
    return {
      status: "COMPETITIVE",
      color: "blue",
      label: "Competitive",
      meaning: "You are competitively priced.",
      priceDiff: roundToTwoDecimals(diff),
      priceDiffPercent,
    };
  }

  if (merchantPrice < avgCompetitorPrice) {
    return {
      status: "LEADING",
      color: "green",
      label: "Leading Market",
      meaning: "You are currently leading the market.",
      priceDiff: roundToTwoDecimals(diff),
      priceDiffPercent,
    };
  }

  return {
    status: "OVERPRICED",
    color: "red",
    label: "Overpriced",
    meaning: "You are likely losing sales to competitors.",
    priceDiff: roundToTwoDecimals(diff),
    priceDiffPercent,
  };
}

// ─── Main Analysis Function ──────────────────────────────────────────────────

function analyzeProduct(input: AnalyzeProductInput): ProductAnalysis {
  const { merchantPrice, costPrice, competitorPrices } = input;

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
  // Export constants for use in UI
  UNDERCUT_FACTOR,
  MARGIN_FACTOR,
  COMPETITIVE_THRESHOLD,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "D:\PV\shopify price viwer" && pnpm test server/services/__tests__/pricing-engine.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/pricing-engine.service.ts server/services/__tests__/pricing-engine.test.ts
git commit -m "feat(pricing-engine): implement core undercutting algorithm with margin protection"
```

---

## Task 3: Update Recommendation Service to Use Pricing Engine

**Files:**

- Modify: `server/services/recommendation.service.ts:81-132` (the `generateForProduct` method)

- [ ] **Step 1: Add import and helper to recommendation.service.ts**

At the top of `server/services/recommendation.service.ts`, after the existing imports, add:

```typescript
import { pricingEngine } from "./pricing-engine.service";
```

After the imports, add a helper function:

```typescript
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 2: Replace the `generateForProduct` method**

Replace the body of `generateForProduct` (lines ~81-132) with:

```typescript
async generateForProduct(userId: string, productId: string): Promise<Recommendation | undefined> {
  const database = await requireDb();

  const product = await database
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .limit(1);

  if (product.length === 0) return undefined;

  const compPrices = await database
    .select({ price: competitorProducts.price })
    .from(competitorProducts)
    .where(and(eq(competitorProducts.productId, productId), eq(competitorProducts.isActive, true)));

  if (compPrices.length === 0) return undefined;

  const prices = compPrices.map((c) => Number(c.price));
  const merchantPrice = Number(product[0].price);
  const costPrice = product[0].costPrice ? Number(product[0].costPrice) : null;

  // Use the pricing engine for analysis
  const analysis = pricingEngine.analyzeProduct({
    merchantPrice,
    costPrice,
    competitorPrices: prices,
  });

  const avgCompetitorPrice = analysis.marketSnapshot.avgCompetitorPrice!;
  const recommendation = analysis.recommendation!;
  const currentPrice = merchantPrice;
  const recommendedPrice = recommendation.recommendedPrice;
  const priceChange = round(recommendedPrice - currentPrice);
  const priceChangePercent = currentPrice !== 0
    ? round((priceChange / currentPrice) * 100)
    : 0;

  // Confidence based on number of competitor data points
  const confidenceScore = Math.min(0.5 + compPrices.length * 0.1, 0.95);

  const factors = {
    competitorCount: compPrices.length,
    avgCompetitorPrice,
    minCompetitorPrice: Math.min(...prices),
    maxCompetitorPrice: Math.max(...prices),
    currentPrice,
    costPrice,
    minimumAllowedPrice: recommendation.minimumAllowedPrice,
    marketPosition: analysis.position.status,
    priceDiffFromAvg: analysis.position.priceDiff,
    priceDiffPercentFromAvg: analysis.position.priceDiffPercent,
  };

  return this.create({
    userId,
    productId,
    currentPrice: product[0].price,
    recommendedPrice: String(recommendedPrice),
    priceChange: String(priceChange),
    priceChangePercent: String(priceChangePercent),
    confidenceScore,
    reason: recommendation.explanation,
    factors,
    status: "pending",
    marginProtectionApplied: recommendation.marginProtectionApplied,
  });
}
```

- [ ] **Step 3: Run existing tests to verify nothing breaks**

```bash
cd "D:\PV\shopify price viwer" && pnpm test
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add server/services/recommendation.service.ts
git commit -m "feat(recommendation): integrate pricing engine into recommendation generation"
```

---

## Task 4: Pricing Engine tRPC Router

**Files:**

- Create: `server/routers/pricing-engine.router.ts`
- Modify: `server/routers.ts:12,24`

- [ ] **Step 1: Create the pricing engine router**

Create `server/routers/pricing-engine.router.ts`:

```typescript
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { pricingEngine } from "../services/pricing-engine.service";
import { recommendationService } from "../services/recommendation.service";
import { productService } from "../services/product.service";
import { competitorProducts, products } from "../../drizzle/schema";
import { requireDb } from "../_core/db-assert";

export const pricingEngineRouter = router({
  /**
   * Analyze a single product's pricing position and get recommendation.
   */
  analyze: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const database = await requireDb();

      const product = await productService.getById(
        ctx.user!.id,
        input.productId
      );
      if (!product) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      const compPrices = await database
        .select({ price: competitorProducts.price })
        .from(competitorProducts)
        .where(
          and(
            eq(competitorProducts.productId, input.productId),
            eq(competitorProducts.isActive, true)
          )
        );

      const prices = compPrices.map(c => Number(c.price));
      const merchantPrice = Number(product.price);
      const costPrice = product.costPrice ? Number(product.costPrice) : null;

      const analysis = pricingEngine.analyzeProduct({
        merchantPrice,
        costPrice,
        competitorPrices: prices,
      });

      return {
        productId: product.id,
        productTitle: product.title,
        ...analysis,
      };
    }),

  /**
   * Analyze all tracked products for the current user.
   */
  analyzeAll: protectedProcedure.query(async ({ ctx }) => {
    const database = await requireDb();

    const userProducts = await database.query.products.findMany({
      where: and(
        eq(products.userId, ctx.user!.id),
        eq(products.isTracked, true),
        eq(products.isActive, true)
      ),
    });

    const results = [];

    for (const product of userProducts) {
      const compPrices = await database
        .select({ price: competitorProducts.price })
        .from(competitorProducts)
        .where(
          and(
            eq(competitorProducts.productId, product.id),
            eq(competitorProducts.isActive, true)
          )
        );

      if (compPrices.length === 0) continue;

      const prices = compPrices.map(c => Number(c.price));
      const merchantPrice = Number(product.price);
      const costPrice = product.costPrice ? Number(product.costPrice) : null;

      const analysis = pricingEngine.analyzeProduct({
        merchantPrice,
        costPrice,
        competitorPrices: prices,
      });

      results.push({
        productId: product.id,
        productTitle: product.title,
        ...analysis,
      });
    }

    return results;
  }),

  /**
   * Get market position for a product (lightweight endpoint).
   */
  getMarketPosition: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const database = await requireDb();

      const product = await productService.getById(
        ctx.user!.id,
        input.productId
      );
      if (!product) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      const compPrices = await database
        .select({ price: competitorProducts.price })
        .from(competitorProducts)
        .where(
          and(
            eq(competitorProducts.productId, input.productId),
            eq(competitorProducts.isActive, true)
          )
        );

      const prices = compPrices.map(c => Number(c.price));
      const avgPrice = pricingEngine.calculateAverageCompetitorPrice(prices);
      const position = pricingEngine.classifyMarketPosition(
        Number(product.price),
        avgPrice
      );

      return {
        productId: product.id,
        productTitle: product.title,
        merchantPrice: Number(product.price),
        avgCompetitorPrice: avgPrice,
        competitorCount: prices.length,
        position,
      };
    }),

  /**
   * Generate and persist a pricing recommendation for a product.
   */
  generateRecommendation: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rec = await recommendationService.generateForProduct(
        ctx.user!.id,
        input.productId
      );
      if (!rec) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Could not generate recommendation. Ensure the product has competitor prices.",
        });
      }
      return rec;
    }),

  /**
   * Get pricing summary stats for the dashboard.
   */
  dashboardStats: protectedProcedure.query(async ({ ctx }) => {
    const database = await requireDb();

    const userProducts = await database.query.products.findMany({
      where: and(
        eq(products.userId, ctx.user!.id),
        eq(products.isTracked, true),
        eq(products.isActive, true)
      ),
    });

    let totalProducts = userProducts.length;
    let withCompetitorData = 0;
    let leadingCount = 0;
    let competitiveCount = 0;
    let overpricedCount = 0;
    let insufficientDataCount = 0;
    let marginProtectionCount = 0;

    for (const product of userProducts) {
      const compPrices = await database
        .select({ price: competitorProducts.price })
        .from(competitorProducts)
        .where(
          and(
            eq(competitorProducts.productId, product.id),
            eq(competitorProducts.isActive, true)
          )
        );

      if (compPrices.length === 0) {
        insufficientDataCount++;
        continue;
      }

      withCompetitorData++;
      const prices = compPrices.map(c => Number(c.price));
      const avgPrice = pricingEngine.calculateAverageCompetitorPrice(prices);
      const position = pricingEngine.classifyMarketPosition(
        Number(product.price),
        avgPrice
      );

      switch (position.status) {
        case "LEADING":
          leadingCount++;
          break;
        case "COMPETITIVE":
          competitiveCount++;
          break;
        case "OVERPRICED":
          overpricedCount++;
          break;
      }

      const costPrice = product.costPrice ? Number(product.costPrice) : null;
      if (costPrice && avgPrice) {
        const rec = pricingEngine.calculateRecommendedPrice(
          avgPrice,
          costPrice
        );
        if (rec.marginProtectionApplied) marginProtectionCount++;
      }
    }

    return {
      totalProducts,
      withCompetitorData,
      insufficientDataCount,
      leadingCount,
      competitiveCount,
      overpricedCount,
      marginProtectionCount,
    };
  }),
});
```

- [ ] **Step 2: Register the router in routers.ts**

In `server/routers.ts`, add after line 12:

```typescript
import { pricingEngineRouter } from "./routers/pricing-engine.router";
```

In the `appRouter` object, add after `intelligence: intelligenceRouter,`:

```typescript
pricingEngine: pricingEngineRouter,
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "D:\PV\shopify price viwer" && pnpm check
```

Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add server/routers/pricing-engine.router.ts server/routers.ts
git commit -m "feat(api): add pricing engine tRPC router with analyze, analyzeAll, dashboardStats endpoints"
```

---

## Task 5: Pricing Recommendation Widget — Frontend Component

**Files:**

- Create: `client/src/components/dashboard/PricingRecommendationWidget.tsx`

- [ ] **Step 1: Create the widget component**

Create `client/src/components/dashboard/PricingRecommendationWidget.tsx`:

```tsx
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  TrendingDown,
  TrendingUp,
  Minus,
  AlertTriangle,
  Shield,
  DollarSign,
  BarChart3,
  ArrowDown,
  ArrowUp,
  Equal,
  Info,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PricingRecommendationWidgetProps {
  productId?: string;
  compact?: boolean;
}

// ─── Position Badge Config ───────────────────────────────────────────────────

const positionConfig: Record<
  string,
  {
    label: string;
    color: string;
    icon: typeof TrendingDown;
    bgClass: string;
    borderClass: string;
    textClass: string;
  }
> = {
  LEADING: {
    label: "Leading Market",
    color: "green",
    icon: ArrowDown,
    bgClass: "bg-[#21a732]/10",
    borderClass: "border-[#21a732]/25",
    textClass: "text-[#21a732]",
  },
  COMPETITIVE: {
    label: "Competitive",
    color: "blue",
    icon: Equal,
    bgClass: "bg-blue-500/10",
    borderClass: "border-blue-500/25",
    textClass: "text-blue-400",
  },
  OVERPRICED: {
    label: "Overpriced",
    color: "red",
    icon: ArrowUp,
    bgClass: "bg-[#93000a]/15",
    borderClass: "border-[#93000a]/25",
    textClass: "text-[#ffb4ab]",
  },
  INSUFFICIENT_DATA: {
    label: "No Data",
    color: "gray",
    icon: Minus,
    bgClass: "bg-muted/50",
    borderClass: "border-border",
    textClass: "text-muted-foreground",
  },
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function MarketSnapshotCard({ analysis }: { analysis: any }) {
  const { marketSnapshot } = analysis;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-surface-container/50 rounded-lg p-3 border border-white/[0.04]">
        <p className="label-caps text-[10px] text-muted-foreground/60 mb-1">
          Your Price
        </p>
        <p className="text-lg font-bold font-mono tracking-tight">
          ${Number(marketSnapshot.merchantPrice).toFixed(2)}
        </p>
      </div>
      <div className="bg-surface-container/50 rounded-lg p-3 border border-white/[0.04]">
        <p className="label-caps text-[10px] text-muted-foreground/60 mb-1">
          Avg. Competitor
        </p>
        <p className="text-lg font-bold font-mono tracking-tight">
          {marketSnapshot.avgCompetitorPrice != null
            ? `$${Number(marketSnapshot.avgCompetitorPrice).toFixed(2)}`
            : "—"}
        </p>
      </div>
      <div className="bg-surface-container/50 rounded-lg p-3 border border-white/[0.04]">
        <p className="label-caps text-[10px] text-muted-foreground/60 mb-1">
          Lowest
        </p>
        <p className="text-sm font-mono text-[#21a732]">
          {marketSnapshot.lowestCompetitorPrice != null
            ? `$${Number(marketSnapshot.lowestCompetitorPrice).toFixed(2)}`
            : "—"}
        </p>
      </div>
      <div className="bg-surface-container/50 rounded-lg p-3 border border-white/[0.04]">
        <p className="label-caps text-[10px] text-muted-foreground/60 mb-1">
          Highest
        </p>
        <p className="text-sm font-mono text-[#ffb4ab]">
          {marketSnapshot.highestCompetitorPrice != null
            ? `$${Number(marketSnapshot.highestCompetitorPrice).toFixed(2)}`
            : "—"}
        </p>
      </div>
      <div className="col-span-2 bg-surface-container/30 rounded-lg px-3 py-2 border border-white/[0.04] flex items-center justify-between">
        <p className="label-caps text-[10px] text-muted-foreground/60">
          Competitors Analyzed
        </p>
        <p className="text-sm font-mono font-bold">
          {marketSnapshot.competitorCount}
        </p>
      </div>
    </div>
  );
}

function RecommendationCard({ analysis }: { analysis: any }) {
  const { recommendation } = analysis;

  if (!recommendation) {
    return (
      <div className="bg-surface-container/30 rounded-lg p-4 border border-white/[0.04] text-center">
        <Info className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          No recommendation available
        </p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">
          Add competitor pricing data to get recommendations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-primary/[0.08] rounded-lg p-4 border border-primary/20">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="label-caps text-[10px] text-primary font-semibold">
            RECOMMENDED PRICE
          </p>
        </div>
        <p className="text-3xl font-bold font-mono tracking-tight text-primary">
          ${Number(recommendation.recommendedPrice).toFixed(2)}
        </p>
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          {recommendation.explanation}
        </p>
      </div>

      {recommendation.marginProtectionApplied && (
        <div className="bg-[#93000a]/10 rounded-lg p-3 border border-[#93000a]/20 flex items-start gap-2.5">
          <Shield className="h-4 w-4 text-[#ffb4ab] shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-semibold text-[#ffb4ab]">
              Margin Protection Active
            </p>
            <p className="text-[10px] text-[#ffb4ab]/70 mt-0.5 leading-relaxed">
              Recommendation limited by minimum profit margin protection.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PositionIndicator({ analysis }: { analysis: any }) {
  const { position } = analysis;
  const config =
    positionConfig[position.status] || positionConfig.INSUFFICIENT_DATA;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "rounded-lg p-4 border",
        config.bgClass,
        config.borderClass
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center",
            config.bgClass
          )}
        >
          <Icon className={cn("h-5 w-5", config.textClass)} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("text-sm font-bold", config.textClass)}>
              {config.label}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {position.meaning}
          </p>
        </div>
        {position.priceDiffPercent != null && (
          <div className="text-right">
            <p className={cn("text-sm font-mono font-bold", config.textClass)}>
              {position.priceDiffPercent > 0 ? "+" : ""}
              {position.priceDiffPercent.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground">vs avg</p>
          </div>
        )}
      </div>
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-28 rounded-lg" />
      <Skeleton className="h-20 rounded-lg" />
    </div>
  );
}

// ─── Main Widget ─────────────────────────────────────────────────────────────

export function PricingRecommendationWidget({
  productId,
  compact = false,
}: PricingRecommendationWidgetProps) {
  const analyzeQuery = trpc.pricingEngine.analyze.useQuery(
    { productId: productId! },
    { enabled: !!productId }
  );

  const generateRecMutation =
    trpc.pricingEngine.generateRecommendation.useMutation({
      onSuccess: () => {
        toast.success("Recommendation generated");
        analyzeQuery.refetch();
      },
      onError: err => {
        toast.error(err.message || "Failed to generate recommendation");
      },
    });

  const analysis = analyzeQuery.data;

  if (!productId) {
    return (
      <div className="glass-panel rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-[15px] font-semibold">Pricing Intelligence</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Select a product to see pricing analysis.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-[15px] font-semibold">Pricing Intelligence</h3>
          {analysis && (
            <span className="label-caps text-[10px] bg-primary/[0.12] text-primary px-2 py-0.5 rounded border border-primary/20">
              {analysis.productTitle}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] label-caps"
          onClick={() => generateRecMutation.mutate({ productId })}
          disabled={generateRecMutation.isPending}
        >
          {generateRecMutation.isPending ? (
            <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3 w-3" />
          )}
          GENERATE
        </Button>
      </div>

      <div className="p-5">
        {analyzeQuery.isLoading ? (
          <WidgetSkeleton />
        ) : !analysis ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            No analysis data available.
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="label-caps text-[10px] text-muted-foreground/60 mb-3">
                MARKET SNAPSHOT
              </p>
              <MarketSnapshotCard analysis={analysis} />
            </div>
            <div>
              <p className="label-caps text-[10px] text-muted-foreground/60 mb-3">
                RECOMMENDATION
              </p>
              <RecommendationCard analysis={analysis} />
            </div>
            <div>
              <p className="label-caps text-[10px] text-muted-foreground/60 mb-3">
                MARKET POSITION
              </p>
              <PositionIndicator analysis={analysis} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard Aggregate Widget ──────────────────────────────────────────────

export function PricingDashboardSummary() {
  const statsQuery = trpc.pricingEngine.dashboardStats.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const stats = statsQuery.data;

  if (statsQuery.isLoading || !stats) {
    return (
      <div className="glass-card p-5 rounded-lg">
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-5 rounded-lg">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h3 className="text-[14px] font-semibold">Pricing Position Summary</h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[#21a732]/10 rounded-lg p-3 border border-[#21a732]/20 text-center">
          <p className="text-2xl font-bold font-mono text-[#21a732]">
            {stats.leadingCount}
          </p>
          <p className="label-caps text-[10px] text-[#21a732]/70">Leading</p>
        </div>
        <div className="bg-blue-500/10 rounded-lg p-3 border border-blue-500/20 text-center">
          <p className="text-2xl font-bold font-mono text-blue-400">
            {stats.competitiveCount}
          </p>
          <p className="label-caps text-[10px] text-blue-400/70">Competitive</p>
        </div>
        <div className="bg-[#93000a]/10 rounded-lg p-3 border border-[#93000a]/20 text-center">
          <p className="text-2xl font-bold font-mono text-[#ffb4ab]">
            {stats.overpricedCount}
          </p>
          <p className="label-caps text-[10px] text-[#ffb4ab]/70">Overpriced</p>
        </div>
        <div className="bg-muted/50 rounded-lg p-3 border border-border text-center">
          <p className="text-2xl font-bold font-mono text-muted-foreground">
            {stats.insufficientDataCount}
          </p>
          <p className="label-caps text-[10px] text-muted-foreground/60">
            No Data
          </p>
        </div>
      </div>
      {stats.marginProtectionCount > 0 && (
        <div className="mt-3 bg-[#93000a]/10 rounded-lg p-2.5 border border-[#93000a]/15 flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-[#ffb4ab] shrink-0" />
          <p className="text-[11px] text-[#ffb4ab]">
            <span className="font-bold">{stats.marginProtectionCount}</span>{" "}
            product(s) have margin protection limiting recommendations.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:\PV\shopify price viwer" && pnpm check
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/dashboard/PricingRecommendationWidget.tsx
git commit -m "feat(ui): add PricingRecommendationWidget and PricingDashboardSummary components"
```

---

## Task 6: Integrate Widget into Overview Dashboard

**Files:**

- Modify: `client/src/pages/dashboard/Overview.tsx`

- [ ] **Step 1: Add import and component to Overview page**

In `client/src/pages/dashboard/Overview.tsx`:

Add import at top:

```tsx
import { PricingDashboardSummary } from "@/components/dashboard/PricingRecommendationWidget";
```

Insert `<PricingDashboardSummary />` right after the KPI Row closing `</div>` and before the `{/* Main Grid */}` comment:

```tsx
{
  /* Pricing Intelligence Summary */
}
<PricingDashboardSummary />;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:\PV\shopify price viwer" && pnpm check
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/dashboard/Overview.tsx
git commit -m "feat(dashboard): integrate pricing intelligence summary into Overview page"
```

---

## Task 7: Add Market Position Badges to Products Page

**Files:**

- Modify: `client/src/pages/dashboard/Products.tsx`

- [ ] **Step 1: Add MarketPositionBadge component and position column**

In `client/src/pages/dashboard/Products.tsx`:

Add imports:

```tsx
import { ArrowDown, ArrowUp, Equal, Minus } from "lucide-react";
```

Add a "Position" column header after the "Delta" column header:

```tsx
<TableHead className="text-center label-caps text-muted-foreground font-normal">
  Position
</TableHead>
```

Add the position cell after the Delta cell in each row:

```tsx
<td className="py-3 text-center">
  <MarketPositionBadge productId={product.id} />
</td>
```

Add the `MarketPositionBadge` component before the `export default function Products()` closing brace:

```tsx
function MarketPositionBadge({ productId }: { productId: string }) {
  const positionQuery = trpc.pricingEngine.getMarketPosition.useQuery(
    { productId },
    { refetchInterval: 120000 }
  );

  if (positionQuery.isLoading) {
    return (
      <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30 animate-pulse" />
    );
  }

  const position = positionQuery.data?.position;
  if (!position) {
    return <Minus className="h-3 w-3 text-muted-foreground/40 mx-auto" />;
  }

  const config: Record<
    string,
    { bg: string; text: string; icon: typeof ArrowDown }
  > = {
    LEADING: { bg: "bg-[#21a732]/10", text: "text-[#21a732]", icon: ArrowDown },
    COMPETITIVE: { bg: "bg-blue-500/10", text: "text-blue-400", icon: Equal },
    OVERPRICED: {
      bg: "bg-[#93000a]/15",
      text: "text-[#ffb4ab]",
      icon: ArrowUp,
    },
  };

  const c = config[position.status] || config.COMPETITIVE;
  const Icon = c.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold label-caps ${c.bg} ${c.text}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {position.status === "LEADING"
        ? "LEAD"
        : position.status === "COMPETITIVE"
          ? "COMP"
          : "OVER"}
    </span>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:\PV\shopify price viwer" && pnpm check
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/dashboard/Products.tsx
git commit -m "feat(products): add market position badges to product table"
```

---

## Task 8: Write Design Doc

**Files:**

- Create: `docs/superpowers/specs/2026-06-16-strategic-undercutting-engine-design.md`

- [ ] **Step 1: Write the design document**

Create `docs/superpowers/specs/2026-06-16-strategic-undercutting-engine-design.md`:

```markdown
# Strategic Undercutting Engine — Design Doc

**Date:** 2026-06-16
**Status:** Implemented

## Business Goal

"A merchant should never unknowingly be undercut by competitors."
Active optimization: "Help merchants strategically undercut competitors while protecting profit margins."

## Algorithm

### Rule 1: Market Average

`avg_price = sum(valid_competitor_prices) / count(valid_competitor_prices)`
Valid prices: positive, non-zero, non-null numbers.

### Rule 2: Strategic Undercut (5% Rule)

`recommended_price = avg_competitor_price × 0.95`

### Rule 3: Margin Protection Floor

`minimum_allowed_price = cost_price × 1.10`
If `recommended_price < minimum_allowed_price`, then `recommended_price = minimum_allowed_price`
and `margin_protection_applied = true`.

### Rule 4: Final Recommendation
```

if (avg*competitor_price * 0.95) >= (cost*price * 1.10)
recommendation = avg*competitor_price * 0.95
else
recommendation = cost*price * 1.10

```

## Market Position Classification

| Status | Condition | Color | Meaning |
|--------|-----------|-------|---------|
| LEADING | merchant_price < avg × 0.97 | Green | You are currently leading the market. |
| COMPETITIVE | within ±3% of avg | Blue | You are competitively priced. |
| OVERPRICED | merchant_price > avg × 1.03 | Red | You are likely losing sales to competitors. |
| INSUFFICIENT_DATA | no competitor data | Gray | Not enough competitor pricing data. |

## Architecture

```

pricing-engine.service.ts → Pure computation (no DB, no HTTP)
↓ used by
recommendation.service.ts → Persists recommendations to DB
↓ exposed via
pricing-engine.router.ts → tRPC endpoints
↓ consumed by
PricingRecommendationWidget → React dashboard component
PricingDashboardSummary → Aggregate stats on Overview page
MarketPositionBadge → Per-product position on Products page

```

## Edge Cases Handled
- No competitor data → INSUFFICIENT_DATA, null recommendation
- Invalid prices (negative, zero, null) → filtered out before calculation
- Single competitor → still calculates normally
- Extreme undercutting (cost > competitor avg) → margin protection kicks in
- No cost price → no margin floor, pure 5% undercut

## Database Changes
- Added `margin_protection_applied` BOOLEAN column to `recommendations` table (default FALSE)
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-16-strategic-undercutting-engine-design.md
git commit -m "docs: add strategic undercutting engine design doc"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run full type check**

```bash
cd "D:\PV\shopify price viwer" && pnpm check
```

Expected: No type errors

- [ ] **Step 2: Run tests**

```bash
cd "D:\PV\shopify price viwer" && pnpm test
```

Expected: All tests PASS

- [ ] **Step 3: Verify dev server starts**

```bash
cd "D:\PV\shopify price viwer" && timeout 15 pnpm dev 2>&1 || true
```

Expected: Server starts without errors

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete strategic undercutting engine implementation"
```
