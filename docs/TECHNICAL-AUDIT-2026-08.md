# Shopify Price Intelligence — Technical Audit

**Audit date:** 2026-08-05  
**Repository:** shopify-price-intelligence  
**Scope:** TypeScript/React application source, database schema/migrations, deployment files, CI, tests, and authoritative documentation.

## Executive summary

Shopify Price Intelligence is a full-stack SaaS application for Shopify merchants. The core architecture is coherent: a React/Vite single-page application calls an Express/tRPC API, which delegates to service modules backed by Drizzle ORM and PostgreSQL. The product has substantial functionality—Shopify synchronization, competitor discovery, scraping, AI extraction/recommendations, alerts, price radar, and scheduled monitoring.

The repository compiles, but it is not ready for untrusted production traffic. The highest-risk issues are credential/secret exposure through API responses, missing CSRF protection on cookie-authenticated tRPC mutations, tenant-boundary gaps in store/product/competitor operations, refresh-token rotation races, and SSRF exposure in the legacy competitor scraper. CI is also inconsistent with the declared package manager.

The first implementation phase prioritizes those issues without changing the database schema or deleting user work.

## Audit method and boundaries

- Read-only source and configuration inspection was performed with bounded PowerShell/Node commands.
- Generated documents, caches, dependency folders, build outputs, and rapport-pfe were deprioritized after a recursive inventory timed out.
- pnpm run check passed before edits.
- pnpm test baseline: 59 tests passed; 15 database-backed product tests failed because DATABASE_URL is unavailable in the current environment.
- pnpm audit --audit-level high reported 148 advisories in the installed dependency graph: 3 critical, 52 high, 83 moderate, and 10 low.
- Existing user changes under rapport-pfe were preserved and are outside the implementation scope.

## Project architecture

### Runtime topology

    Browser
      └─ React 19 + Vite SPA
           └─ tRPC HTTP client with cookie credentials
                └─ Express 4
                     ├─ Helmet, CORS, rate limits, cookie parser
                     ├─ OAuth callback and SSE notification routes
                     └─ tRPC procedure router
                          ├─ Authentication middleware
                          ├─ Feature routers
                          └─ Service layer
                               └─ Drizzle ORM + node-postgres
                                    └─ PostgreSQL

External integrations: Shopify Admin API, Firecrawl, Playwright, SerpAPI, Exa, OpenAI/OpenRouter, SMTP.

### Request/data flow

1. The browser loads the Vite-built React SPA.
2. client/src/main.tsx creates a tRPC client and sends cookies with requests.
3. Express applies security middleware and mounts /api/trpc.
4. createContext() authenticates the JWT session cookie and loads the user.
5. protectedProcedure or adminProcedure enforces authentication/role.
6. Routers validate inputs with Zod and call services.
7. Services query PostgreSQL through Drizzle, generally using userId ownership predicates.
8. Background cron jobs call monitoring/discovery services in the same Node process.
9. Alerts are persisted and broadcast to connected SSE clients in the current process.

## Folder structure analysis

| Path                        | Responsibility                                                           | Assessment                                                                                          |
| --------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| client/src/                 | React SPA, Wouter routes, dashboard pages, shared UI                     | Feature-rich but several pages use any and large monolithic components                              |
| client/src/components/ui/   | Radix/shadcn-style primitives                                            | Good reuse boundary                                                                                 |
| client/src/pages/dashboard/ | Product, competitor, radar, analytics, alerts, settings UX               | High feature density; needs client tests and state/error consistency                                |
| server/\_core/              | Express bootstrap, auth, cookies, CSRF, rate limits, logging, DB helpers | Correct centralization, but auth/CSRF assumptions need tightening                                   |
| server/routers/             | tRPC input validation and feature orchestration                          | Mostly protected; some direct SQL paths bypass service ownership conventions                        |
| server/services/            | Business logic, scraping, monitoring, AI, notifications                  | Broad responsibilities; scraping and cron need worker isolation for scale                           |
| drizzle/                    | Schema, relations, migrations, seed data                                 | Rich relational model; tenant ownership is mostly application-enforced                              |
| shared/                     | Constants, validation, shared error/types                                | Small and useful; public DTOs should be centralized                                                 |
| scripts/                    | Backfills and data synchronization                                       | Operationally useful but not consistently documented or guarded                                     |
| docs/                       | Setup, architecture, deployment, improvement plans                       | Contains stale Python/SQL Server documentation that conflicts with the TypeScript/PostgreSQL system |
| rapport-pfe/                | Large generated academic reports/presentations                           | Heavy generated artifacts; excluded from source audit                                               |

The project context references frontend/ and data/, but those directories were not part of the bounded source inventory. The active frontend is client/.

## Main components

### Backend

- server/\_core/index.ts: Express lifecycle, security middleware, OAuth, SSE, tRPC, Vite/static serving, cron startup.
- server/\_core/context.ts: request authentication and development bypass.
- server/\_core/trpc.ts: public, protected, and admin procedure policies.
- server/\_core/auth/: JWT sessions, refresh tokens, HMAC, token encryption.
- server/routers.ts: router composition plus inline Shopify store operations.
- server/routers/\*.router.ts: feature-level API surfaces.
- server/services/price-monitoring.service.ts: scheduled competitor monitoring and alert generation.
- server/services/scraping.service.ts: Firecrawl primary scraper and Playwright fallback.
- server/services/price-radar/: bounded crawler with URL policy, extraction, persistence, and cancellation.
- server/services/cron-scheduler.service.ts: in-process scheduled jobs.
- server/db.ts: lazy PostgreSQL pool and Drizzle instance.

### Frontend

- client/src/App.tsx: Wouter route tree and authentication guard.
- client/src/main.tsx: React Query, tRPC client, global unauthorized handling.
- client/src/components/DashboardLayout.tsx: authenticated shell, navigation, search, notifications, sync controls.
- client/src/pages/dashboard/: product, competitor, analytics, alerts, settings, scout, wisdom, and price-radar workflows.
- client/src/components/ui/: reusable primitives and accessible Radix wrappers.

### Database model

The schema covers users, stores, products, competitors, competitor matches, price history, alerts, recommendations, activity logs, refresh tokens, scrape jobs, AI extraction/discovery, Scoop catalog data, and Price Radar crawl data. Foreign keys and indexes are present, but tenant isolation is primarily enforced in TypeScript rather than by database policies.

## Dependencies

### Runtime

- React 19, Vite 7, Wouter, TanStack Query, Recharts, Framer Motion, Radix UI, Tailwind CSS 4.
- Express 4, tRPC 11, Drizzle ORM, pg, Zod, bcrypt, jose.
- Helmet, CORS, csrf-csrf, express-rate-limit, Pino.
- Playwright and Firecrawl for scraping.
- AWS S3 packages, Exa, OpenAI-compatible providers, SMTP-related utilities.

### Tooling and operational observations

- The repository declares pnpm@10.4.1 and tracks pnpm-lock.yaml.
- GitHub Actions currently runs npm ci, but no package-lock.json is tracked. CI is therefore not reproducible as configured.
- The installed graph has security advisories affecting tRPC, Vitest, pnpm, fast-xml-parser, tar, PostCSS, express-rate-limit, and other transitive packages.
- docker-compose.yml starts Redis, but the application does not currently use a Redis client or distributed queue.

## Confirmed bugs and vulnerabilities

### Critical

1. Password hash exposure through auth.me. The procedure returns the complete database User object, including passwordHash. The frontend then writes the result to localStorage under manus-runtime-user-info. A bcrypt hash is not a plaintext password, but it is still credential material and must never cross the API boundary.
2. Encrypted Shopify token exposure. shopify.listStores and products.stores select entire shopify_stores rows. This returns accessToken ciphertext to the browser. The legacy products.upsertStore path also accepts a raw access token and persists it without encryption.
3. Store tenant overwrite risk. The inline Shopify connect path looks up an existing store by shopDomain without first requiring the authenticated user to own it. The generic store upsert uses a global domain conflict target and can overwrite the row, including ownership fields, if a domain already exists.
4. Cross-tenant product price reads. products.getCompetitorPrices filters by productId but does not verify that the product belongs to the authenticated user.
5. CSRF on cookie-authenticated tRPC mutations. Session and refresh cookies authenticate tRPC mutations, but CSRF middleware is only mounted for selected Express OAuth paths. HTTPS cookies use SameSite=None, so a cross-site request can potentially invoke state-changing procedures.
6. Competitor scraper SSRF. Competitor domains are user-controlled strings and are passed to Firecrawl/Playwright without a public-address check. An authenticated user can direct the server-side browser toward localhost, private IPs, cloud metadata, or internal services.
7. Refresh-token rotation race. Rotation selects a valid token, then revokes it in a separate statement. Concurrent requests can both observe the token as valid and receive new refresh tokens.

### High

1. Authentication write amplification. Every authenticated request calls upsertUser() and updates lastSignedIn, turning reads into database writes and increasing connection/lock pressure.
2. Browser-rendered Price Radar redirects are less protected. HTTP fetching validates every manual redirect, but Playwright navigation validates only the initial URL; redirects and page requests need the same public-network policy.
3. Competitor product linking lacks ownership validation. competitor.addProduct inserts a match without verifying that both the competitor and merchant product belong to the current user.
4. Store ownership is not validated for product creation/bulk sync. A caller can provide a UUID for another tenant’s store and create a product linked to it.
5. Environment validation is incomplete. Production validates only the JWT secret. Missing DATABASE_URL, ENCRYPTION_KEY_SALT, invalid numeric configuration, or missing Shopify credentials are allowed until a feature path fails.
6. Webhook HMAC length handling can throw. timingSafeEqual is called without first checking equal buffer lengths.
7. CI dependency installation is inconsistent. npm ci conflicts with the pnpm lockfile and package manager declaration.
8. Dependency audit is red. The current installed graph reports 3 critical and 52 high advisories. Direct dependency ranges/lockfile need controlled updates, not an unreviewed mass upgrade.

### Medium and low

- In-process cron and SSE state do not scale across multiple application instances.
- Scrape jobs run synchronously in request lifetimes in the legacy scraper and can consume browser resources.
- Several analytics and dashboard flows perform per-product queries or load broad datasets into memory.
- findAvailablePort() silently changes the production listening port if the preferred port is busy.
- There is no centralized Express error middleware/request ID/metrics layer.
- Client code contains many any types and no frontend test suite.
- Email service decrypts SMTP passwords for internal use; its public contract should return a redacted configuration DTO.
- Generated/document files are mixed into the repository root workflow and caused inventory timeouts.

## Performance bottlenecks

1. Per-request user upserts and timestamp updates.
2. In-process cron loops iterate all users and run discovery serially; a large tenant count will extend job duration linearly.
3. Price Radar stores one snapshot and potentially many extraction/error rows per crawl without retention or archival policy.
4. Legacy scraping starts a browser per scrape and waits fixed two-second delays even when content is already available.
5. Several list/count endpoints run separate queries and some merge large result sets in memory.
6. React dashboard pages poll/refetch frequently and use broad any datasets; client caching and pagination are inconsistent.
7. No distributed queue, concurrency budget, or rate-limit coordination exists across replicas.

## Missing production features

- Distributed job queue and worker process for scraping, AI extraction, monitoring, and discovery.
- Redis-backed rate limiting, job coordination, and SSE/pub-sub fanout.
- Database-backed or external scheduler with retries, dead-letter handling, and job idempotency.
- Centralized request IDs, structured audit events, metrics, traces, and alerting.
- Health/readiness endpoints that validate database and dependency health separately.
- Automated database backup/restore verification and migration rollout strategy.
- Password reset, email verification, session/device management, and account lockout policy.
- Test database provisioning in CI and isolated integration-test configuration.
- Frontend unit/component/e2e tests and accessibility checks.
- Retention/partitioning for price snapshots, scrape pages, extraction logs, and activity events.
- Feature-flag governance and secret rotation procedures.

## Quality scores

| Area            | Score | Rationale                                                                                                        |
| --------------- | ----: | ---------------------------------------------------------------------------------------------------------------- |
| Architecture    |  7/10 | Clear client/API/service/data layers; inline Shopify and in-process workers reduce separation                    |
| Security        |  3/10 | Good baseline controls exist, but secret exposure, CSRF, SSRF, and tenant gaps are production blockers           |
| Performance     |  5/10 | Useful indexes and bounded crawling; request writes, synchronous scraping, and broad queries limit scale         |
| UX              |  6/10 | Strong dashboard coverage and loading/empty primitives; inconsistent errors, polling, and action feedback remain |
| UI              |  7/10 | Distinct visual system and reusable primitives; accessibility and responsive behavior need systematic testing    |
| Scalability     |  4/10 | Single-process cron/SSE/browser work and no queue/pub-sub architecture                                           |
| Maintainability |  5/10 | Good folder boundaries but large files, duplicated direct SQL, legacy paths, and stale docs                      |
| Code quality    |  6/10 | Strict TypeScript and tests exist; any, broad selects, and silent catches reduce confidence                      |
| Testing         |  4/10 | Core pricing and service tests exist; DB setup is absent locally/CI and frontend coverage is missing             |
| Documentation   |  4/10 | Architecture docs are useful, but setup/backend docs contain conflicting legacy Python/SQL Server instructions   |

## Improvement roadmap

### 1. Critical fixes

1. Add public DTO/presenter functions and remove passwordHash, openId, encrypted access tokens, and SMTP secrets from API responses.
2. Protect tRPC state-changing requests with a CSRF token flow and retain secure cookie settings.
3. Make refresh-token rotation atomic and add replay/concurrency tests.
4. Enforce ownership for store upsert/connect, product store references, competitor product links, and competitor price reads.
5. Add public-network/redirect validation to all server-side scraping paths.
6. Validate production environment requirements and make malformed HMAC input return false.

### 2. High-impact improvements

1. Remove authentication writes from ordinary request authentication.
2. Align CI with pnpm and add a real test database service.
3. Update direct dependencies and lockfile in a controlled compatibility-tested change.
4. Add centralized tRPC error formatting, request IDs, and safe structured logging.
5. Add retention and idempotency rules for crawl/price-history data.
6. Move scraping/AI/monitoring to a worker queue with distributed concurrency control.

### 3. Quality improvements

1. Add integration tests for tenant isolation, auth DTOs, CSRF, OAuth state, SSRF, and refresh-token replay.
2. Add client component tests, end-to-end smoke tests, and automated accessibility checks.
3. Replace high-value any types with inferred tRPC DTOs and explicit service contracts.
4. Split large routers/pages and centralize query/filter/pagination schemas.
5. Consolidate stale documentation around the actual Express/PostgreSQL system.

### 4. Future enhancements

1. Shopify webhook-driven product/price synchronization instead of periodic full catalog pulls.
2. Queue-backed notifications and multi-instance SSE using Redis or a managed event service.
3. Immutable audit log with retention/export controls.
4. Explainable AI recommendations with confidence calibration and human approval workflows.
5. Data partitioning/archival for high-volume price snapshots and crawl pages.
6. Billing, plan quotas, usage metering, and per-tenant resource budgets.

## Initial implementation scope

The first code phase will address the confirmed critical issues with incremental type-check/test verification. It will avoid schema/migration changes, preserve existing functionality, and leave generated rapport-pfe work untouched.

## Implementation status — 2026-08-05

The audit was followed by an incremental hardening pass. No database schema migration or destructive filesystem operation was performed, and all pre-existing rapport-pfe changes were preserved.

### Completed fixes

- Added safe public DTO projections for authenticated users and Shopify stores. passwordHash, openId, userId, and encrypted Shopify access tokens no longer cross the API boundary; the client no longer persists the authenticated user in localStorage.
- Added a CSRF token endpoint and automatic CSRF headers for state-changing tRPC requests.
- Made refresh-token rotation atomic and single-use under concurrent requests.
- Hardened OAuth/webhook HMAC comparison for malformed or differently encoded signatures.
- Added production startup validation for database, encryption salt, Shopify credentials, HTTPS app URL, and numeric runtime settings.
- Removed per-request authenticated-user writes from ordinary request authentication.
- Added tenant ownership checks for store upsert/connect, product creation and bulk sync, competitor links, competitor price reads, and pricing-engine data.
- Added shared public-address validation for legacy scraping and browser Price Radar navigation, redirects, IPv4/IPv6 private ranges, credentials, and browser subrequests.
- Added regression coverage for public URL policy and sensitive auth DTOs.
- Aligned GitHub Actions with pnpm 10.34.5 and the tracked lockfile; added a PostgreSQL-backed CI test job.
- Updated tRPC to 11.18.0, Vitest to 3.2.7, Drizzle ORM to 0.45.2, Vite to 7.3.6, and PostCSS to 8.5.25. Added pnpm overrides for the two remaining critical transitive packages, reducing the audit to zero critical findings.

### Verification

- pnpm run check: passed.
- Focused security suites: 18/18 passed.
- Full suite: 63 passed; 15 database-backed product tests remain unable to run locally because this environment has no DATABASE_URL. CI now provisions PostgreSQL and runs schema setup before the full suite.
- pnpm audit --audit-level=high: 0 critical, 23 high, 55 moderate, 9 low. Remaining advisories are primarily transitive/tooling or require major-version migrations and remain tracked in the roadmap.

### Remaining priority work

1. Run the CI database suite against PostgreSQL and add tenant-isolation integration fixtures.
2. Replace unpinned pnpm/action-setup@v4 with a commit-pinned action reference.
3. Resolve the remaining high advisories through controlled upgrades: Express/path-to-regexp, Firecrawl/Axios, lodash consumers, TypeScript tooling, and any compatible Drizzle/Vite transitive dependencies.
4. Add request IDs, centralized error formatting, metrics, readiness probes, and distributed job execution before multi-instance production rollout.

## Phase 2 — Product Excellence & Scalability — 2026-08-05

Phase 2 was implemented incrementally after the security hardening work. The scope remained limited to safe, reversible changes that preserve existing product behavior. No generated `rapport-pfe` artifacts were modified.

### Architecture and reliability changes

- Added request correlation IDs at the Express boundary. Every response receives an `x-request-id`, and tRPC/Express failures include that ID in structured Pino logs.
- Added liveness and readiness endpoints: `/health/live`, `/health/ready`, `/healthz`, and `/readyz`. Readiness checks PostgreSQL and returns HTTP 503 when the dependency is unavailable.
- Added centralized Express error handling with a generic client response and a correlation ID, while preserving safe tRPC error logging.
- Added graceful shutdown for SIGTERM/SIGINT. Cron timers are cleared and in-flight cron handlers are drained before the HTTP server and database pool close.
- Added equivalent abort-and-drain handling for in-process Price Radar crawls, including guarded final status updates so database failures do not create unhandled promise rejections.
- Fixed the database readiness probe to always release its PostgreSQL client, including failed queries.
- Production now binds the configured port exactly; development retains bounded port discovery to avoid silently changing production service endpoints.

### Performance and database changes

- Added composite indexes for common tenant and status access patterns across products, competitors, competitor products, alerts, recommendations, scrape jobs, and Price Radar products.
- Added `price_radar_jobs_user_source_created_idx` for source-scoped job history polling. The API now accepts an optional `sourceId`, and the client no longer fetches a broad history list and filters it in the browser for every source row.
- Price monitoring now processes matched products through a bounded worker pool instead of a serial loop. The pool is capped by the configured scrape concurrency and an eight-worker safety ceiling.
- Competitor discovery now processes users in bounded batches rather than serially iterating the entire tenant set.
- Removed duplicate dashboard product/store query declarations. Onboarding data is cached for 60 seconds and passed to export and Shopify sync handlers through typed props.
- Added route-level lazy loading for dashboard pages. The production build changed from a 2,396.61 kB minified / 607.28 kB gzip monolithic client asset to a 1,412.78 kB largest shared entry plus independently loaded page chunks. The shared entry still warrants further vendor splitting.
- Added validated `DATABASE_POOL_MAX` configuration, wired through PostgreSQL, `.env.example`, and Docker Compose. Deployments can now size connections per instance against the database budget.

### Background processing and SaaS readiness assessment

- The current Price Radar runner remains an in-process background execution path with persisted job state, bounded page concurrency, cancellation, and shutdown draining.
- A cross-instance stale-job recovery routine was intentionally not added: without a database lease or worker identity, one replica could incorrectly mark another replica’s active crawl as failed.
- Redis is present in Docker Compose but is not yet used for distributed rate limits, queue coordination, or SSE fanout. This remains the principal multi-replica scaling gap.
- Tenant predicates remain enforced in service/repository access paths, and the new source-scoped history query preserves the user predicate before applying the optional source filter.
- Usage metering, subscription quotas, durable worker leases, dead-letter handling, retention policies, and distributed rate limiting remain product/operations work rather than being guessed in this phase.

### Phase 2 verification

- `pnpm run check`: passed after every major implementation group and at final verification.
- Focused reliability/performance/Price Radar suites: 20/20 passed.
- Full `pnpm test`: 67 passed; 15 existing PostgreSQL-backed product tests failed because this local environment has no `DATABASE_URL`/running PostgreSQL service. The CI workflow provisions PostgreSQL for the complete suite.
- `pnpm run build`: passed. Vite emitted route chunks and the server bundle successfully.
- `git diff --check`: passed.
- Drizzle generated additive migrations `0014_cooing_thundra.sql` and `0015_superb_chat.sql`; generation used a disposable local connection string and did not connect to or mutate a database.

### Updated current-state scores

| Area            | Current score | Phase 2 impact                                                                                                |
| --------------- | ------------: | ------------------------------------------------------------------------------------------------------------- |
| Architecture    |          7/10 | Better boundary observability and lifecycle handling; worker and router decomposition remain incomplete.      |
| Security        |          8/10 | Phase 1 controls remain in place; distributed controls and dependency advisories remain.                      |
| Performance     |          7/10 | Composite indexes, bounded workers, duplicate-query removal, and route splitting are implemented.             |
| UX              |          7/10 | Faster initial load and narrower Price Radar polling; systematic E2E/accessibility coverage is still missing. |
| UI              |          7/10 | Existing design system preserved; large shared client chunk remains.                                          |
| Scalability     |          6/10 | DB pool sizing and bounded work improved; Redis-backed workers/rate limits are still required for replicas.   |
| Maintainability |          7/10 | Typed data handoff and lifecycle abstractions improved; large legacy files remain.                            |
| Code quality    |          7/10 | New paths are typed and tested; existing `any` usage and broad service modules remain.                        |
| Testing         |          6/10 | 20 new/focused Phase 2 checks pass and CI has PostgreSQL; frontend/E2E and local DB setup remain gaps.        |
| Documentation   |          7/10 | This report now records implementation and measured verification; operational runbooks still need expansion.  |

### Phase 2 remaining risks and priority roadmap

1. **Critical for multi-instance scale:** introduce a durable queue and worker lease model (Redis/BullMQ, a managed queue, or a PostgreSQL-backed equivalent) before running multiple application replicas.
2. **High:** make rate limiting, SSE notifications, and crawl capacity coordination distributed rather than process-local.
3. **High:** add automated PostgreSQL test setup for local development and tenant-isolation integration tests.
4. **High:** split the remaining large shared frontend chunk and add performance budgets to CI.
5. **Medium:** add retention/partitioning for Price Radar pages, extraction logs, snapshots, and activity events.
6. **Medium:** add subscription-ready usage counters, quotas, billing hooks, and per-tenant resource budgets once commercial limits are defined.
