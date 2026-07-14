# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack TypeScript SaaS price-intelligence platform. Users connect Shopify stores, match competitor products across the web, and get AI-powered pricing recommendations plus real-time alerts when competitors change prices. Dark-mode dashboard with a sidebar-navigated SPA frontend.

## Commands

```bash
pnpm dev              # Express + Vite dev server (server/_core/index.ts, port 3000; auto-falls back to 3001–3019 if busy)
pnpm check            # tsc --noEmit
pnpm test             # vitest run (all)
pnpm test -- -t "name" --run   # run a single test by name
pnpm test -- <path> --run      # run one test file
pnpm format           # prettier --write .
pnpm build            # Vite client build + esbuild bundle of server
pnpm start            # run the production bundle (dist/index.js)
pnpm db:push          # drizzle-kit generate && drizzle-kit migrate
pnpm db:seed          # tsx server/seed.ts
pnpm db:seed:electronics  # tsx server/seed-electronics.ts (sample electronics catalog)
```

Build output: client assets built to `dist/public` (served by Vite in dev, as static files in prod); server is a single bundled ESM file at `dist/index.js`.

Prerequisites: Node.js 18+, pnpm 10+, PostgreSQL 14+.

### First-time setup

1. Create a `.env` file — there is **no `.env.example` template** in the repo; the authoritative variable list lives in `docs/ENVIRONMENT.md`. Required core vars: `DATABASE_URL`, `JWT_SECRET` (>=32 chars in prod), `ENCRYPTION_KEY_SALT`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`. Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   - For live competitor scraping/discovery you also need `FIRECRAWL_API_KEY` (primary scraper), `SERP_API_KEY` (Google Shopping discovery fallback), and `OPENAI_API_KEY` (AI product matching). Without these the app boots fine but the price-monitoring and competitor-discovery cron jobs emit `429` / `insufficient credits` warnings (see `server/services/scraping.service.ts`).
2. `pnpm db:push` then `pnpm db:seed`.
3. `pnpm dev`.

### Database migration notes

`pnpm db:push` runs `drizzle-kit generate` (writes a new SQL snapshot under `drizzle/migrations/`) **and** `drizzle-kit migrate` (applies it). Use it when changing `drizzle/schema.ts`. Always review the generated SQL in `drizzle/migrations/` before committing — `generate` captures intent, but column renames/drops can produce surprising statements.

## Architecture

### Layered data flow (never skip layers)

Client → **tRPC router procedure** → **service** → **Drizzle ORM** → Postgres.

- `server/_core/trpc.ts` defines `publicProcedure`, `protectedProcedure`, `adminProcedure`. `protectedProcedure` enforces a logged-in user via JWT cookie; `adminProcedure` additionally requires `role === 'admin'`.
- **Routers** (`server/routers/*.router.ts`) hold HTTP-level orchestration: parse input, verify ownership, call services, return. The `shopify` sub-router in `server/routers.ts` is the exception — Shopify store connect/disconnect/sync lives directly there alongside `appRouter`, not in a separate file.
- **Services** (`server/services/*.service.ts`) own business logic and DB access. Every method takes `userId` as the first arg and filters every query by it — this is the ownership/authorization boundary inside the data layer and must never be bypassed.
- **Schema** lives in `drizzle/schema.ts` as the single source of truth.

### Router map (server)

`server/routers.ts` composes the `appRouter`. The full set of routers:

- `auth` (`auth.router.ts`) — register/login/logout/me
- `products` (`product.router.ts`) — CRUD + search + bulkSync + stats
- `competitors` (`competitor.router.ts`) — CRUD + scrapeProducts + search + stats
- `prices` (`price.router.ts`) — history/summary/trend
- `alerts` (`alert.router.ts`) — list/count/markRead/resolve/delete
- `recommendations` (`recommendation.router.ts`) — list/getByProduct/implement/dismiss/generate
- `activity` (`activity.router.ts`) — user activity feed
- `intelligence` (`intelligence.router.ts`) — competitor discovery (SerpAPI + Firecrawl)
- `pricingEngine` (`pricing-engine.router.ts`) — pricing recommendation engine
- `scout` (`scout.router.ts`) — search-driven competitor scouting
- `system` (`_core/systemRouter.ts`) — health/version/heartbeat
- `shopify` (inlined in `routers.ts`) — listStores/connect/disconnect/syncProducts

### Service map (server/services)

`product` · `competitor` · `price` · `alert` · `recommendation` · `activity` · `email` · `ai-extraction` · `competitor-discovery` · `exa-search` · `scout` · `scraping` · `pricing-engine` · `price-monitoring` · `cron-scheduler`. The `scraping.service.ts` file is the scraper adapter layer (Firecrawl primary, Playwright fallback) used by `price-monitoring` and `competitor-discovery`.

### Auth (read this carefully)

The system migrated from a **legacy OAuth portal** (Manus) to local auth. Both paths are still present:

- **JWT sessions** (`server/_core/auth/jwt.ts`): the primary mechanism. Cookie `app_session_id` (httpOnly, 24h), with 30-day refresh tokens stored hashed in `refresh_tokens`.
- **OAuth legacy** (`server/_core/sdk.ts` → `OAuthService`): still active; handles external login flows, `GetUserInfoWithJwt` exchange, and a special **cron user** (`cron_` openId prefix) for scheduled Shopify jobs.
- **Direct SaaS auth** (added later): bcrypt `passwordHash` on `users` row; email/password login.

Authentication entry point is `server/_core/context.ts`: `createContext()` calls `sdk.authenticateRequest(req)`. A `VITE_BYPASS_AUTH=true` dev bypass injects a local admin user — double-gated so it **never** activates in production (logs an error if the env var leaks into prod).

### Conventions worth knowing before you touch code

- **Soft delete**: products, stores, and competitors use `isActive = false`, never hard deletes (`productService.delete`, `shopify.disconnect`).
- **Encrypted at rest**: Shopify access tokens (`shopifyStores.accessToken`) and SMTP passwords (`emailConfigs.smtpPassword`) are AES-256-CBC. Use `encryptToken()` / `decryptToken()` from `server/_core/sdk.ts` — key is PBKDF2-derived (`_core/auth/token-crypto.ts`), salt from `ENCRYPTION_KEY_SALT`.
- **Error masking**: tRPC errors return generic messages; never surface stack traces or internal values. Audit/security severity strings are defined in `@shared/const` (`UNAUTHED_ERR_MSG`, `NOT_ADMIN_ERR_MSG`).
- **Decimal columns** are strings in the schema — treat `price`, `costPrice`, etc. as `string` in TS, never `number`.
- **Async DB access**: `getDb()` / `requireDb()` return a Drizzle handle or null; services call `await requireDb()` at the top of every method and throw if unavailable.
- **Cron jobs**: `server/services/cron-scheduler.service.ts` is booted from `_core/index.ts` and runs monitoring/discovery loops. Run types land in `cron_runs` and detailed attempts in `scrape_logs`. The cron user has an `openId` prefixed with `cron_` — do not treat it as a normal user.
- **Shared constants**: `shared/const.ts` holds cookie names, expiry durations, and error code strings. Import from `@shared/const`, don't re-literal them.
- **Shared Zod schemas**: `shared/validation.ts` holds reusable input schemas (`skuSchema`, `productNameSchema`, `priceSchema`, `normalizeName`). Import from `@shared/validation`, don't re-define them in routers.
- **Scraping adapter layer**: `server/services/scraping.service.ts` wraps Firecrawl (primary) and Playwright (fallback); dispatch through it rather than calling Firecrawl directly from services.
- **Path aliases**: `@/*` resolves to `client/src/*`, `@shared/*` resolves to `shared/*` (configured in both `tsconfig.json` and `vite.config.ts`). `vite.config.ts` also defines `@assets` → `attached_assets`, but that alias is **Vite-only** (absent from `tsconfig.json`), so it works at dev/build time but not under `tsc --noEmit`.
- **Seed file**: `server/seed.ts` (not `server/seed.js` or `server/_core/seed.ts`).

### Key tables (the "big picture" model)

`users` → `shopify_stores` → `products` → `competitor_products` → `competitors`, with `price_history`, `price_snapshots`, `price_changes`, `alerts`, and `recommendations` tracking events off those. Phase-4 tables: `product_embeddings` (AI matching), `ai_extractions`, `competitor_discoveries` (search-driven discovery), `serp_api_scouts`. Notifications live in `notification_preferences` and `email_configs`; audit trail in `activity_logs`.

### Frontend

React 19 SPA via **Wouter** (not React Router), **TanStack Query** for server state, **shadcn/ui + Tailwind 4** (OKLCH colors, DM Sans / JetBrains Mono). Route manifest is in `client/src/App.tsx`:

- `/` → `Overview` (dashboard)
- `/products` → `Products`
- `/products/new` → `AddProductDialog`
- `/competitors` → `Competitors`
- `/alerts` → `Alerts`
- `/analytics` → `Analytics`
- `/scout` → `PriceScout`
- `/admin` → `Admin` (admin-only)
- login wall via `AuthGuard` (queries `trpc.auth.me.useQuery`; unauthenticated renders `Auth`)

tRPC client is configured once in `client/src/lib/trpc.ts`; unauthorized responses redirect to login via a QueryCache subscriber. Shared UI primitives live in `client/src/components/ui/` (shadcn); dashboard-specific components in `client/src/components/dashboard/`.

## Stale documentation warning

`docs/BACKEND.md` describes an **older Python/FastAPI/SQLAlchemy architecture** that was never built — the actual backend is Express + TypeScript + Drizzle ORM + PostgreSQL. Do not trust it. The authoritative architecture reference is `docs/ARCHITECTURE.md` (which accurately describes the Express + tRPC + Drizzle stack). When in doubt, read the code — `server/_core/index.ts` is the entry point.

## Security posture (already applied)

JWT production validation, PBKDF2 key derivation, encrypted tokens/passwords at rest, no-shopify-token-to-frontend (the old `getToken` endpoint was removed — see comment in `routers.ts`), defense-in-depth rate limiting (general + auth + OAuth-specific + per-route scrape limiter) — tuned to 100 req/15min general, 10 req/15min auth, 5 req/hr Shopify OAuth, plus a per-route limiter on `competitors.scrapeProducts`, Helmet headers, CSRF only on Express OAuth routes (tRPC relies on JWT httpOnly cookies), 24h JWT + refresh tokens, `secure` cookie behind `connection.encrypted`, storage proxy path validation, CORS prod origin allowlist (`ALLOWED_ORIGINS`).
