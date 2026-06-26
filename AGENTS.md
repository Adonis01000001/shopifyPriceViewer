# Shopify Price Intelligence — Project Context

## Project Overview

Full-stack TypeScript SaaS platform for competitive price monitoring and optimization, integrated with Shopify. Monitors competitor prices in real-time, provides AI-powered pricing recommendations, and automates alerts.

## Architecture

```
shopify price viwer/
├── client/                  # React frontend (Vite + Wouter + shadcn/ui)
│   ├── src/
│   │   ├── components/     # Shared components (dashboard, ui/, etc.)
│   │   ├── pages/          # Route pages (Auth, Home, dashboard/*)
│   │   ├── _core/          # Core hooks (useAuth)
│   │   └── lib/            # Utilities (trpc, utils)
│   └── index.css           # Global styles (OKLCH color system, dark mode default)
├── server/                 # Express backend (tRPC + Drizzle ORM + PostgreSQL)
│   ├── _core/              # Auth, middleware, env, rate-limit, csrf
│   │   ├── auth/           # JWT sessions, HMAC, token-crypto, refresh-tokens
│   │   └── env.ts          # Environment config with production validations
│   ├── routers/            # tRPC routers (auth, products, prices, alerts, etc.)
│   ├── services/           # Business logic (product, price, email, etc.)
│   ├── db.ts               # PostgreSQL connection pool (node-postgres)
│   └── seed.ts             # Database seeding
├── drizzle/                # Database schema & migrations
│   ├── schema.ts           # Full schema (users, products, competitors, etc.)
│   └── config.ts           # DrizzleKit config
├── shared/                 # Shared types and constants across client/server
│   ├── const.ts            # COOKIE_NAME, SESSION_EXPIRY_MS, etc.
│   └── types.ts            # Shared TypeScript types
├── frontend/               # Next.js frontend shell (separate from client/)
├── data/                   # Data directory
└── docs/                   # Documentation
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite 7, Wouter (routing), shadcn/ui, Tailwind CSS 4, Recharts |
| **Backend** | Express 4, tRPC 11, Drizzle ORM, PostgreSQL (node-pg) |
| **Auth** | JWT (jose 6.1.0), bcrypt (12 rounds), Shopify OAuth 2.0 |
| **Crypto** | AES-256-CBC (token encryption via PBKDF2-derived key), HMAC-SHA256 (Shopify verification) |
| **Security** | Helmet (headers), CORS, CSRF (csrf-csrf), rate-limiting |
| **Validation** | Zod (tRPC inputs) |

## Key Conventions

### Security
- **Sessions:** JWT in httpOnly cookies. 24-hour expiry with 30-day refresh tokens.
- **CSRF:** `csrf-csrf` double-submit cookie pattern on all state-changing Express routes.
- **Rate limiting:** 100 req/15min general, 10/15min auth, 5/hr Shopify OAuth.
- **Encryption:** Shopify access tokens and SMTP passwords stored AES-256-CBC encrypted. Key derived via PBKDF2 (100k iterations, unique salt).
- **Passwords:** bcrypt with 12 salt rounds. Minimum 8 characters.
- **Prod guards:** JWT secret must be set and >=32 chars in production. Auth bypass is production-blocked with error logging.

### Database
- Uses Drizzle ORM with PostgreSQL. All service methods verify `userId` ownership before CRUD operations.
- Schema in `drizzle/schema.ts`. Seed data in `server/seed.ts`.

### API
- tRPC endpoints use `publicProcedure`, `protectedProcedure`, or `adminProcedure` middleware.
- Express routes for OAuth callbacks (`/api/shopify/*`) and storage proxy (`/manus-storage/*`).
- All errors return generic messages. Never expose stack traces or internal details.

### Frontend
- Dark mode default (OKLCH color system in `client/src/index.css`).
- DM Sans (body) + JetBrains Mono (data/numbers).
- Dashboard sidebar layout. Pages: Auth, Overview, Products, Competitors, Analytics, Alerts, Settings.

## Important Security Notes (Applied 2026-06-02)

All 14 CRITICAL and HIGH vulnerabilities have been fixed:

1. JWT secret validates in production (throws if unset/default/short)
2. SMTP passwords encrypted at rest
3. Encryption key derived via PBKDF2 (not raw SHA-256)
4. `shopify.getToken` endpoint removed (tokens never sent to frontend)
5. Auth bypass double-gated with production error logging
6. Rate limiting on all API endpoints
7. Helmet security headers
8. CSRF protection on Express routes
9. JWT expiry reduced to 24h with refresh tokens
10. Cookie `secure` flag checks `connection.encrypted` (not just spoofable header)
11. Storage proxy validates path keys against traversal
12. Unused `mysql2` dependency removed
13. Both disconnect endpoints verify `userId`
14. CORS middleware with production origin restriction

## Development

```bash
pnpm dev          # Start dev server (Express + Vite)
pnpm check        # TypeScript type check
pnpm test         # Run tests (vitest)
pnpm db:push      # Run Drizzle migrations
pnpm db:seed      # Seed database
```

## Design Context

See `PRODUCT.md` (strategic) and `DESIGN.md` (visual system) for design intent, brand personality, anti-references, and color/typography/component specs. Loaded by the `/impeccable` skill.
