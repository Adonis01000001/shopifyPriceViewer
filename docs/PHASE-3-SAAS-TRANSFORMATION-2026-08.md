# Phase 3 — SaaS Transformation

> **Historical record, 2026-08-05.** Kept as written. Since then the three
> parallel discovery systems it names — Price Radar, Scoop and Path of Wisdom —
> have been removed in favour of a single pipeline, so the "existing
> ingredients" list no longer describes the codebase. The product thesis in
> the executive section is still the one being built to.

Date: 2026-08-05  
Product: Shopify Price Intelligence / PriceVision

## Executive thesis

The product should be sold as a merchant decision system, not as a scraper dashboard. The recurring promise is:

> Every morning, show me which products need a pricing decision, explain why, and let me act with confidence in under five minutes.

The existing platform already contains the raw ingredients: Shopify catalog sync, competitor tracking, historical prices, alerts, AI extraction, recommendations, Price Radar, Scoop, and Path of Wisdom. Phase 3 connects these ingredients into a clearer daily workflow and introduces the commercial primitives needed to convert that workflow into a subscription.

## Product intelligence audit

### Current user journey

1. Merchant authenticates and reaches a dashboard shell.
2. Onboarding asks the merchant to connect Shopify, sync products, and add a competitor.
3. Overview shows catalog KPIs, pending recommendations, alerts, and competitor movement.
4. Products and Competitors provide operational detail.
5. Analytics and Path of Wisdom provide deeper analysis.
6. Merchant can implement or dismiss recommendations, but the product does not yet measure business impact or provide a durable “what changed since my last visit” workflow.

### Verified strengths

- Clear target user: Shopify merchants and small commerce teams.
- Strong functional breadth for an early product: monitoring, alerts, AI extraction, recommendations, Price Radar, and discovery.
- Existing confidence and reasoning fields support trustworthy AI positioning.
- In-app notifications and persistent alert history create a return loop.
- Price history and competitor changes create proprietary longitudinal data if retention and data quality are maintained.

### Main pain points

- The merchant must interpret several screens instead of receiving a prioritized action list.
- Email alert delivery is not wired despite notification preferences existing.
- Competitor movement previously used per-competitor feed requests on Overview; Phase 3 consolidates this into Action Center.
- Onboarding previously represented OAuth/navigation steps as complete before success; this is corrected.
- Billing, usage, team access, and upgrade paths were absent.
- There is no closed-loop measurement of whether a recommendation improved price position, margin, or revenue.

### Subscription value

Merchants pay for three outcomes:

- time saved from manual competitor checks;
- margin and conversion opportunities found earlier than competitors;
- confidence that pricing decisions are based on fresh, explainable market data.

The strongest retention trigger is not a chart. It is a high-signal daily answer: “These three products need attention, this competitor moved, and this recommendation protects your margin.”

### Competitive moat hypothesis

The defensible advantage should be a feedback loop rather than a single AI feature:

1. collect merchant-specific competitor and price history;
2. normalize and score data quality/confidence;
3. recommend an action with margin protection and market context;
4. record whether the merchant implemented, dismissed, or overrode it;
5. learn which recommendations create useful outcomes for each category and merchant.

Potential future moat layers are inventory-aware pricing, promotion detection, category benchmarks, multi-market intelligence, and explainable outcome reporting. Generic scraping and generic LLM summaries are not durable moats by themselves.

## Phase 3 features implemented

### Action Center

Added `intelligence.actionCenter`, a tenant-scoped application service that returns:

- top pending pricing recommendations;
- unread unresolved alerts;
- recent competitor price changes;
- counts for pending recommendations, unread alerts, and changes in the last 24 hours.

Overview now consumes this single workflow query instead of issuing one competitor-feed query per competitor. This improves load behavior and makes the daily action loop explicit.

### Alert preferences

Added protected notification preference APIs and enabled Settings controls for:

- email notification opt-in;
- in-app notification opt-in;
- realtime/hourly/daily/weekly frequency.

The UI accurately states that SMTP-backed email delivery is staged for the notification worker; it does not claim delivery is already active.

### SaaS subscription foundation

Added a provider-neutral `subscriptions` table and shared plan catalog with provisional Free, Starter, Pro, and Scale tiers. The account API exposes plan and usage data without exposing billing-provider identifiers.

Usage currently measures active products, active competitors, active Price Radar sources, competitor matches, and price changes in the last 30 days. A 14-day Pro trial is created on first account-usage access and safely resolves to Free after expiry. Pricing and hard quota policy remain intentionally configurable business decisions.

### Activation improvements

- Shopify OAuth now stays in the current tab and is not marked complete before authorization succeeds.
- Product sync invalidates the relevant cache after success.
- Adding a competitor no longer claims completion before the merchant performs the action.
- Dashboard stores are passed into onboarding instead of being fetched again.

### Tenant-boundary fixes discovered during the audit

- `prices.trend` now verifies product ownership.
- `prices.record` now verifies product ownership before inserting history.
- Price snapshot history now verifies the competitor belongs to the requesting merchant.
- Global cron-run inspection is admin-only.

## Commercial roadmap

### P0 — activation and retention

1. Ship Action Center as the default daily landing experience.
2. Add real email delivery through a worker with idempotency and delivery logs.
3. Add “implemented / dismissed / overridden” outcome tracking and recommendation quality metrics.
4. Add category-aware and inventory-aware recommendation context.

### P1 — conversion

1. Add hosted billing checkout and webhook-driven subscription state.
2. Enforce plan limits only after subscription state and grandfathering rules are finalized.
3. Add upgrade prompts at meaningful usage thresholds, not arbitrary modal interruptions.
4. Add a trial progress card and a clear plan comparison page.

### P1 — team value

1. Introduce workspaces and membership roles separate from the current user role.
2. Add owner, analyst, and operator permissions.
3. Add audit history for recommendation decisions and Shopify write-back actions.

### P2 — moat

1. Price anomaly detection against merchant/category baselines.
2. Promotion and stock-state detection.
3. Competitive assortment and positioning reports.
4. A/B pricing experiments with guardrails and rollback.
5. Aggregated category benchmarks with strict privacy thresholds.

## Scale architecture

### 1,000 users

- one API deployment with PostgreSQL connection budgeting;
- durable queue for scraping, AI extraction, email, and monitoring;
- Redis-backed rate limiting and notification fanout;
- object storage for raw crawl artifacts;
- basic metrics: queue depth, job latency, scrape success, AI cost, p95 API latency.

### 10,000 users

- separate API and worker autoscaling;
- partition or archive high-volume price history and crawl tables;
- read replicas for analytics and dashboard queries;
- per-tenant concurrency budgets and usage metering;
- webhook-driven Shopify synchronization instead of catalog polling alone.

### 100,000 users

- managed queue/event backbone with regional workers;
- workload isolation by tenant plan and data freshness SLA;
- columnar/warehouse pipeline for historical analytics;
- strict retention policies and tiered storage;
- SLOs, incident response, capacity planning, and automated cost controls.

## Product metrics

Track these before optimizing vanity metrics:

- time to first connected store;
- time to first competitor match;
- percentage of activated merchants with at least one monitored product;
- weekly active monitored products;
- alerts opened and acted on;
- recommendation implementation and dismissal rates;
- trial-to-paid conversion;
- retained revenue opportunity per merchant;
- scrape freshness and data-confidence rate;
- gross margin saved or pricing opportunities accepted.

## Decision log

- Plan limits are provisional product policy, not a final price sheet.
- Hard quota enforcement is deferred until billing state, grandfathering, and upgrade UX exist.
- Redis/BullMQ is not introduced in this slice because a durable worker lease, retry policy, and operational ownership must be designed together; the current in-process runner remains a known scale boundary.
- Email preference controls are implemented before email delivery to avoid silently claiming a non-existent channel.
