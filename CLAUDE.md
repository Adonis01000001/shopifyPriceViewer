# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack TypeScript SaaS price-intelligence platform. Users connect Shopify stores, match competitor products across the web, and get AI-powered pricing recommendations plus real-time alerts when competitors change prices. Dark-mode dashboard with a sidebar-navigated SPA frontend.

## Commands

```bash
pnpm dev              # Express + Vite dev server (server/_core/index.ts, port 3000)
pnpm check            # tsc --noEmit
pnpm test             # vitest run (all)
pnpm test -- -t "name" --run   # run a single test by name
pnpm test -- <path> --run      # run one test file
pnpm format           # prettier --write .
pnpm build            # Vite client build + esbuild bundle of server
pnpm db:push          # drizzle-kit generate && drizzle-kit migrate
pnpm db:seed          # tsx server/seed.ts
```

Build output: client assets served by Vite (dev) or static files from `dist` (prod); server is a single bundled ESM file. `pnpm start` runs the production bundle.

## Architecture

### Layered data flow (never skip layers)


Client → **tRPC router procedure** → **service** → **Drizzle ORM** → Postgres.

- `server/_core/trpc.ts` defines `publicProcedure`, `protectedProcedure`, `adminProcedure`. `protectedProcedure` enforces a logged-in user via JWT cookie; `adminProcedure` additionally requires `role === 'admin'`.
- **Routers** (`server/routers/*.router.ts`) hold HTTP-level orchestration: parse input, verify ownership, call services, return. The `shopify` sub-router in `server/routers.ts` is the exception — Shopify store connect/disconnect/sync lives directly there alongside `appRouter`, not in a separate file.
- **Services** (`server/services/*.service.ts`) own business logic and DB access. Every method takes `userId` as the first arg and filters every query by it — this is the ownership/authorization boundary inside the data layer and must never be bypassed.
- **Schema** lives in `drizzle/schema.ts` as the single source of truth.

### Auth (read this carefully)

The system migrated from a **legacy OAuth portal** (Manus) to local auth. Both paths are still present:

- **JWT sessions** (`server/_core/auth/jwt.ts`): the primary mechanism. Cookie `app_session_id` (httpOnly, 24h), with 30-day refresh tokens stored hashed in `refresh_tokens`.
- **OAuth legacy** (`server/_core/sdk.ts` → `OAuthService`): still active; handles external login flows, `GetUserInfoWithJwt` exchange, and a special **cron user** (`cron_` openId prefix) for scheduled Shopify jobs.
- **Direct SaaS auth** (added later): bcrypt `passwordHash` on `users` row; email/password login.

Authentication entry point is `server/_core/context.ts`: `createContext()` calls `sdk.authenticateRequest(req)`. A `VITE_BYPASS_AUTH=true` dev bypass injects a local admin user — double-gated so it **never** activates in production (logs an error if the env var leaks into prod).

### Conventions worth knowing before you touch code

- **Soft delete**: products, stores, and competitors use `isActive = false`, never hard deletes (`productService.delete`, `shopify.disconnect`).
- **Encrypted at rest**: Shopify access tokens (`shopifyStores.accessToken`) and SMTP passwords (`emailConfigs.smtpPassword`) are AES-256-CBC. Use `encryptToken()` / `decryptToken()` from `server/_core/sdk.ts` — key is PBKDF2-derived (`token-crypto.ts`), salt from `ENCRYPTION_KEY_SALT`.
- **Error masking**: tRPC errors return generic messages; never surface stack traces or internal values. Audit/security severity strings are defined in `@shared/const` (`UNAUTHED_ERR_MSG`, `NOT_ADMIN_ERR_MSG`).
- **Decimal columns** are strings in the schema — treat `price`, `costPrice`, etc. as `string` in TS, never `number`.
- **Async DB access**: `getDb()` / `requireDb()` return a Drizzle handle or null; services call `await requireDb()` at the top of every method and throw if unavailable.
- **Cron jobs**: `server/services/cron-scheduler.service.ts` is booted from `index.ts` and runs monitoring/discovery loops. Run types land in `cron_runs` and detailed attempts in `scrape_logs`.

### Key tables (the "big picture" model)

`users` → `shopify_stores` → `products` → `competitor_products` → `competitors`, with `price_history`, `price_snapshots`, `price_changes`, `alerts`, and `recommendations` tracking events off those. New Phase-4 tables: `product_embeddings` (AI matching), `ai_extractions`, `competitor_discoveries` (search-driven discovery), `serp_api_scouts`. Notifications live in `notification_preferences` and `email_configs`; audit trail in `activity_logs`.

### Frontend

React 19 SPA via **Wouter** (not React Router), **TanStack Query** for server state, **shadcn/ui + Tailwind 4** (OKLCH colors, DM Sans / JetBrains Mono). Route manifest is in `client/src/App.tsx`. tRPC client is configured once in `client/src/main.tsx`; unauthorized responses redirect to login via a QueryCache subscriber.

## Security posture (already applied)

14 CRITICAL/HIGH fixes are live: JWT production validation, PBKDF2 key derivation, encrypted tokens/passwords at rest, no-shopify-token-to-frontend (the old `getToken` endpoint was removed), defense-in-depth rate limiting (general + auth + OAuth-specific + per-route scrape limiter), Helmet headers, CSRF only on Express OAuth routes (tRPC relies on JWT httpOnly cookies), 24h JWT + refresh tokens, `secure` cookie behind `connection.encrypted`, storage proxy path validation, CORS prod origin allowlist.
