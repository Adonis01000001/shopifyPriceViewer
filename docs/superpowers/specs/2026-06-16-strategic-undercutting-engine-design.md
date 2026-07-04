# Strategic Undercutting Engine — Design Doc

**Date:** 2026-06-16
**Status:** Implemented

## Business Goal

> "A merchant should never unknowingly be undercut by competitors."

Active optimization: **"Help merchants strategically undercut competitors while protecting profit margins."**

## Algorithm Specification

### Rule 1: Market Average

```
valid_prices = filter(competitor_prices, p > 0 AND p != null AND !isNaN(p))
avg_price = sum(valid_prices) / count(valid_prices)
```

### Rule 2: Strategic Undercut (5% Rule)

```
recommended_price = avg_competitor_price × 0.95
```

### Rule 3: Margin Protection Floor

```
minimum_allowed_price = cost_price × 1.10
if recommended_price < minimum_allowed_price:
    recommended_price = minimum_allowed_price
    margin_protection_applied = true
```

### Rule 4: Final Logic

```
if (avg × 0.95) >= (cost × 1.10):
    recommendation = avg × 0.95
else:
    recommendation = cost × 1.10
    margin_protection_applied = true
```

## Market Position Classification

| Status            | Condition                  | Color | Meaning                                     |
| ----------------- | -------------------------- | ----- | ------------------------------------------- |
| LEADING           | merchant < avg × 0.97      | Green | You are currently leading the market.       |
| COMPETITIVE       | within ±3% of avg          | Blue  | You are competitively priced.               |
| OVERPRICED        | merchant > avg × 1.03      | Red   | You are likely losing sales to competitors. |
| INSUFFICIENT_DATA | no valid competitor prices | Gray  | Not enough competitor pricing data.         |

## Architecture

```
pricing-engine.service.ts    → Pure computation (no DB, no HTTP)
  ↓ used by
recommendation.service.ts    → Persists recommendations to DB
  ↓ exposed via
pricing-engine.router.ts     → tRPC endpoints (5 total)
  ↓ consumed by
PricingRecommendationWidget  → Dashboard widget (Market Snapshot,
                               Recommendation Card, Position Indicator,
                               Margin Protection Warning)
PricingDashboardSummary      → Aggregate stats on Overview page
MarketPositionBadge          → Per-product position on Products page
```

## Edge Cases

| Scenario                       | Behavior                               |
| ------------------------------ | -------------------------------------- |
| No competitor data             | INSUFFICIENT_DATA, null recommendation |
| Invalid prices (≤0, null, NaN) | Filtered before calculation            |
| Single competitor              | Calculates normally                    |
| Cost > competitor avg          | Margin protection kicks in             |
| No cost price                  | Pure 5% undercut, no floor             |

## Database Changes

- Added `margin_protection_applied` BOOLEAN NOT NULL DEFAULT FALSE to `recommendations` table

## Testing

33 unit tests: averages, undercut, margin floor, position classification, full analysis, edge cases.
All 34 tests pass (33 pricing-engine + 1 auth).
