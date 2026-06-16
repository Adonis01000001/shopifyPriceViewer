# Phase 1-3 Roadmap — Merchant Pricing Intelligence Platform

**Date:** 2026-06-16
**Stack:** React/Vite + Express/tRPC + Drizzle/PostgreSQL + Firecrawl + OpenRouter
**Mission:** "Never unknowingly undercut by competitors."

## 1. Executive Summary

| Phase | Goal | Timeline | Deliverables |
|-------|------|----------|--------------|
| Phase 1 | Validate scraping + AI pipeline | Weeks 1-4 | Accuracy metrics, validation workflow, data quality dashboard |
| Phase 2 | Full automation + production | Weeks 5-10 | CSV pipeline, monitoring, real merchant by September |
| Phase 3 | Multi-platform SaaS expansion | Weeks 11-16 | Shopify app, WooCommerce/Amazon/eBay adapters, billing |

Current State: Working Express/tRPC/Drizzle/PostgreSQL app with 10 seeded electronics products, competitor discovery, AI extraction, price monitoring, cron scheduler, and Strategic Undercutting Engine (33 tests passing).

## 2. System Architecture

React/Vite Frontend → tRPC → Express Server → Drizzle ORM → PostgreSQL
                              ↓
                         Firecrawl (scraper)
                         OpenRouter (Owl Alpha primary)
                         Cron Scheduler → BullMQ (future)
                         Redis (future)

## 3. Database Schema (Key Tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| users | Authentication | id, email, password_hash, role |
| refresh_tokens | Session management | id, user_id, token_hash, expires_at |
| shopify_stores | Shopify connections | id, user_id, shop_domain, access_token |
| products | Merchant products | id, user_id, title, price, cost_price, status |
| competitors | Competitor stores | id, user_id, name, domain, status |
| competitor_products | Matched products | id, competitor_id, product_id, price, match_score |
| price_snapshots | Time-series | id, competitor_product_id, price, scraped_at |
| price_changes | Events | id, change_type, previous_price, new_price, detected_at |
| alerts | Notifications | id, user_id, product_id, alert_type, severity |
| recommendations | Suggestions | id, recommended_price, margin_protection_applied |
| ai_extractions | AI results | id, product_id, competitor_id, confidence, is_match |
| competitor_discoveries | Search results | id, product_id, candidate_domain, confidence |
| cron_runs | Job tracking | id, job_type, status, started_at |
| scrape_logs | Per-URL logs | id, url, status, response_time_ms |
| activity_logs | Timeline | id, user_id, action, entity_type, created_at |

## 4. Domain Models (TypeScript)

interface AnalyzeProductInput {
  merchantPrice: number; costPrice: number | null; competitorPrices: number[];
}
interface ProductAnalysis {
  marketSnapshot: MarketSnapshot;
  recommendation: PricingRecommendation | null;
  position: MarketPosition;
}
interface PlatformAdapter {
  readonly platform: string;
  syncProducts(storeId: string): Promise<Product[]>;
  updatePrice(productId: string, price: number): Promise<void>;
  validateConnection(storeId: string): Promise<boolean>;
}

## 5. API Specifications (60+ tRPC Endpoints)

Auth (5): login, register, logout, me, refresh
Products (8): list, getById, create, update, delete, search, stats, bulkUpsert
Competitors (8): list, getById, create, update, delete, feed, search, stats
Prices (3): history, snapshots, changes
Alerts (6): list, markRead, markAllRead, resolve, getById, stats
Recommendations (7): list, getByProduct, getById, generate, implement, dismiss, stats
Intelligence (16): discoverCompetitors, discoverAllProducts, getDiscoveries, approveDiscovery, rejectDiscovery, importDiscovery, discoveryStats, extractFromUrl, getExtractions, runMonitoring, getPriceChanges, getTimeline, getCronRuns, getCronStatus, getSnapshotHistory, scrapeAndExtract
Pricing Engine (5): analyze, analyzeAll, getMarketPosition, generateRecommendation, dashboardStats
Shopify (4): listStores, connect, disconnect, syncProducts

## 6. Queue Architecture (BullMQ + Redis)

Migration: In-process cron → BullMQ + Redis → Separate worker processes
Job Types: scrape (concurrency 5), ai-extract (3), monitor (1), discover (2), recommend (3)
Retry: 3 attempts, exponential backoff (5s, 15s, 45s)
Scheduled: hourly scrape, daily discovery

## 7. AI Architecture (OpenRouter)

Model Failover: Owl Alpha → DeepSeek → Claude → GPT-4o → Gemini
Single Call: Product match + price extraction + structured JSON
Thresholds: >=0.95 auto-accept, 0.70-0.95 manual review, <0.70 reject

## 8. Firecrawl Integration

3-attempt retry with exponential backoff. Rate limiting: 10 req/min/domain.
Fallback trigger: 429, timeout, empty content, JS-heavy sites.

## 9. Playwright Fallback

5-10 headless Chrome instances, random user agents, human-like behavior.
Cloudflare challenge handling (15s wait). Proxy rotation.

## 10. Localized Competitor Discovery

Country-aware search with language/region parameters.
Query templates: "{product.title}" buy online {country}

## 11. Pricing Engine (IMPLEMENTED)

Algorithm: avg × 0.95, floor at cost × 1.10
Position: LEADING (< -3%), COMPETITIVE (±3%), OVERPRICED (> +3%), INSUFFICIENT_DATA
Files: pricing-engine.service.ts, pricing-engine.router.ts, PricingRecommendationWidget.tsx
Tests: 33 unit tests, all passing

## 12. Shopify Architecture

OAuth 2.0: Install → Authorize → Token exchange → Encrypt → Store
AES-256-CBC token encryption. Webhook handling.

## 13. Multi-Platform Architecture

Adapter pattern: ShopifyAdapter, WooCommerceAdapter, AmazonAdapter, EbayAdapter
Platform-agnostic unified product model.

## 14. Multi-Tenant SaaS

Tiers: Free (5 products, $0), Pro (100, $49/mo), Enterprise (unlimited, $199/mo)
Row-level security via user_id. Stripe billing.

## 15. Security Model

JWT (24h) in httpOnly cookies. CSRF double-submit. Rate limiting. AES-256-CBC encryption. Zod validation.

## 16. Monitoring

pino structured logging. /health endpoint. Metrics: P95 latency, error rates, scrape success, queue depth.

## 17. Testing

Unit (vitest), integration (tRPC→DB), E2E (Playwright). 80%+ coverage.

## 18. CI/CD

GitHub Actions: lint, type-check, test, build. Auto-deploy staging. Manual production.

## 19. Risk Analysis

| Risk | Mitigation |
|------|------------|
| Firecrawl rate limits | Playwright fallback, exponential backoff |
| AI accuracy < 85% | Confidence thresholds, manual review |
| Scaling bottlenecks | BullMQ migration, horizontal scaling |
| Security breach | Encryption, rate limiting, audit logging |

## 20. September Milestone

Week 1-2: Validate pipeline. Week 3-4: Optimize. Week 5-6: BullMQ. Week 7-8: UI. Week 9-10: Beta. Week 11-12: Harden. Week 13: Launch.

## 21. Weekly Roadmap

Phase 1 (W1-4): Validation. Phase 2 (W5-10): Automation. Phase 3 (W11-16): Expansion.

## 22. Engineering Backlog

P0: [x] Undercutting Engine, [ ] DB migration, [ ] Rate limits
P1: [ ] BullMQ, [ ] CSV pipeline, [ ] Sanitization
P2: [ ] Real-time UI, [ ] Settings, [ ] Shopify service
P3: [ ] WooCommerce, [ ] Amazon, [ ] Stripe

## 23-25. Code Examples, Schema, Deployment

See existing codebase for complete implementations:
- Pricing engine: server/services/pricing-engine.service.ts
- AI extraction: server/services/ai-extraction.service.ts
- Price monitoring: server/services/price-monitoring.service.ts
- Intelligence router: server/routers/intelligence.router.ts
- Pricing engine router: server/routers/pricing-engine.router.ts
- Dashboard widget: client/src/components/dashboard/PricingRecommendationWidget.tsx
- Tests: server/services/__tests__/pricing-engine.test.ts
- Design doc: docs/superpowers/specs/2026-06-16-strategic-undercutting-engine-design.md

End of Roadmap.
