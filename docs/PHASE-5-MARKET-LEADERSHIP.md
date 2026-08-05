# Phase 5 — Market Leadership Product Brief

Status: implemented increment, 2026-08-05

## Merchant perspective

### Why a merchant installs

The install promise is operational, not abstract: a merchant wants to know which
competitor price movements require action without maintaining spreadsheets or
checking every product page manually.

### Why they keep paying after 90 days

Retention depends on a recurring decision loop:

1. Their catalog and competitor watchlist stay current.
2. The dashboard highlights a small set of decisions worth attention.
3. Alerts and reports prevent expensive surprises.
4. Historical evidence lets the merchant explain and repeat good pricing moves.

The product currently supports the first three pieces unevenly. The moat is the
fourth: merchant-specific price history, recommendation explanations, and the
outcomes of approved or dismissed decisions. That feedback loop should become a
first-class product asset.

### Nice-to-have versus moat

| Category | Current surface | Product decision |
| --- | --- | --- |
| Nice-to-have | Static infrastructure health cards | Removed because the values were synthetic and damaged trust |
| Nice-to-have | Category mix visualization | Keep as secondary context; it is not an activation driver |
| Useful | Scheduled competitor monitoring, alerts, reports | Make these the recurring habit |
| Moat candidate | Explainable recommendations tied to merchant history | Invest in evidence quality and decision outcomes |
| Moat candidate | Cross-merchant benchmark data | Consider only after privacy-safe aggregation and sufficient scale |

### Referral blockers

- The value is not quantified early enough for a merchant to share it.
- The app must clearly state that recommendations are suggestions and do not
  silently change Shopify prices.
- App Store screenshots need to show a concrete workflow: connect, detect,
  decide, act.
- Data freshness and scan cadence must be stated accurately; “real-time” is not
  used unless the configured monitoring cadence supports it.

## Three highest-impact improvements implemented

1. **Next-best-action dashboard** — the Overview now leads with the highest-value
   pending recommendation, alert, or competitor movement, with one primary CTA.
2. **Resumable activation checklist** — onboarding completion is derived from live
   store/product/competitor state, and the merchant can resume instead of losing
   progress after a redirect or partial setup.
3. **Value-based conversion instrumentation** — first-party events cover signup,
   trial start, onboarding, first value, feature prompts, plan selection, checkout
   start/completion, and cancellation. Upgrade prompts explain the merchant value
   of the capability they are about to unlock.

## Product analytics contract

Events are allow-listed in `shared/analytics.ts`, stored in the tenant-scoped
`analytics_events` table, and mirrored to an optional provider-neutral
`dataLayer`. Properties are bounded and must not contain credentials, product
catalog contents, or free-form personal data.

Primary activation metric: `first_value_reached`, defined as the first actionable
recommendation, unresolved alert, or competitor movement visible to the merchant.

Retention signal: `dashboard_viewed`, segmented by merchant tenure, plan, and
whether the merchant had a pending action. This distinguishes a recurring
decision habit from passive account existence.

Primary conversion metrics:

- `signup_completed` → `trial_started`
- `onboarding_step_completed` → `first_value_reached`
- `feature_upgrade_prompt_viewed` → `plan_selected`
- `checkout_started` → `checkout_completed`
- `subscription_cancelled` by plan and tenure

## Removed or de-prioritized

The Overview’s synthetic “Inventory Sync Status” panel was removed. It showed
hardcoded latencies and health states that were not backed by service telemetry.
The navigation remains broad for compatibility, but Price Scout, Path of Wisdom,
and Price Radar should be evaluated against activation and retention data before
receiving further surface area.

## Remaining product decisions

- Confirm the primary target segment (small DTC brands, agencies, or larger
  catalogs) before finalizing plans and App Store positioning.
- Define the measurable merchant outcome for pricing recommendations, such as
  time saved per weekly review or gross-margin opportunities identified.
- Add merchant-facing recommendation outcome capture: approved, ignored,
  reverted, and measured result.
