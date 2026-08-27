# Shopify Price Intelligence (PriceVision)

A full-stack SaaS platform for competitive price monitoring, integrated with
Shopify. Once a day it searches for shops selling the same products, reads
their prices, and works out what to charge.

A language model is used for one job only: deciding whether a competitor's page
is selling the same product, and pulling the price off it. The suggested price
itself is arithmetic — the average of the confirmed competitor prices, reduced
by the merchant's undercut setting, never below cost plus their margin setting.
Both settings live on the user row and are editable under Settings.

## Tech Stack

| Layer          | Technology                                                                                |
| -------------- | ----------------------------------------------------------------------------------------- |
| **Frontend**   | React 19, Vite 7, Wouter (routing), shadcn/ui, Tailwind CSS 4, Recharts                   |
| **Backend**    | Express 4, tRPC 11, Drizzle ORM, PostgreSQL (node-pg)                                     |
| **Auth**       | JWT (jose 6.1.0), bcrypt (12 rounds), Shopify OAuth 2.0                                   |
| **Crypto**     | AES-256-CBC (token encryption via PBKDF2-derived key), HMAC-SHA256 (Shopify verification) |
| **Security**   | Helmet (headers), CORS, CSRF (csrf-csrf), rate-limiting                                   |
| **Validation** | Zod (tRPC inputs)                                                                         |

## Project Structure

```
shopify-price-viwer/
├── client/                  # React frontend (Vite + Wouter + shadcn/ui)
│   ├── src/
│   │   ├── components/     # Shared components (dashboard, ui/, etc.)
│   │   ├── pages/          # Route pages (Auth, Home, dashboard/*
│   │   ├── _core/          # Core hooks (useAuth)
│   │   └── lib/            # Utilities (trpc, utils)
│   └── index.css           # Global styles (OKLCH color system, dark mode default)
├── server/                 # Express backend (tRPC + Drizzle ORM + PostgreSQL)
│   ├── _core/              # Auth, middleware, env, rate-limit, csrf
│   │   ├── auth/           # JWT sessions, HMAC, token-crypto, refresh-tokens
│   │   └── env.ts          # Environment config with production validations
│   ├── routers/            # tRPC routers (auth, products, prices, alerts, etc.)
│   ├── services/           # Business logic (product, price, email, etc.)
│   ├── db.ts               # PostgreSQL connection pool (node-pg)
│   └── seed.ts             # Database seeding
├── drizzle/                # Database schema & migrations
│   ├── schema.ts           # Full schema (users, products, competitors, etc.)
│   └── config.ts           # DrizzleKit config
├── shared/                 # Shared types and constants across client/server
│   ├── const.ts            # COOKIE_NAME, SESSION_EXPIRY_MS, etc.
│   └── types.ts            # Shared TypeScript types
├── data/                   # Data directory (CSV datasets, etc.)
└── docs/                   # Documentation
```

## Features

- **Shopify OAuth Authentication** — Secure OAuth 2.0, session management, DB-backed refresh tokens (SHA-256 hashed)
- **Product Synchronization** — Import product catalog from Shopify stores via Admin API
- **Competitor Tracking** — Add competitors, match products, track prices across multiple sources
- **Price History** — Historical price records with trend analysis
- **Pricing Recommendations** — Automated pricing suggestions based on competitor analysis
- **Alerts** — Price drop/increase alerts, threshold notifications
- **Dashboard** — KPIs, pricing insights, category mix, and next-best actions
- **Email Notifications** — Configurable SMTP settings with encrypted credentials at rest

## Development

```bash
pnpm dev          # Start dev server (Express + Vite)
pnpm check        # TypeScript type check
pnpm lint         # ESLint
pnpm test         # Run tests (vitest)
pnpm db:generate  # Generate a migration after schema changes
pnpm db:migrate   # Apply committed Drizzle migrations
pnpm db:push      # Local development only; do not use in production
pnpm db:seed      # Seed database
pnpm smoke        # Smoke-test a running deployment (set SMOKE_BASE_URL)
```

## Version 1.0 release documentation

- [Launch readiness checklist](docs/LAUNCH-READINESS-CHECKLIST.md)
- [Production deployment runbook](docs/RELEASE-DEPLOYMENT.md)
- [Legal and privacy release inputs](docs/LEGAL-PRIVACY-INPUTS.md)
- [Known work](docs/TODO.md) — open gaps and defects, with what each one costs

The application is not approved for public paid release until every blocker in
the launch checklist has an owner, evidence, and a completed staging test.

### Prerequisites

- Node.js 22+
- pnpm 10+
- PostgreSQL 14+

### Initial Setup

1. Copy `.env.example` to `.env` and configure:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/priceviewer
JWT_SECRET=your-64-char-hex-secret-here
ENCRYPTION_KEY_SALT=your-32-char-hex-salt-here
SHOPIFY_API_KEY=your_shopify_key
SHOPIFY_API_SECRET=your_shopify_secret
```

2. Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

3. Run local migrations and seed:

```bash
pnpm db:push
pnpm db:seed
```

4. Start development:

```bash
pnpm dev
```

## API Endpoints (tRPC)

All API endpoints are exposed via tRPC at `/api/trpc`.

### Auth

- `auth.me` — Get current user
- `auth.register` — Register with email + password
- `auth.login` — Login with email + password
- `auth.logout` — Clear session cookie

### Products

- `products.list` — List products (paginated: limit/offset)
- `products.count` — Get total product count
- `products.getById` — Get single product
- `products.create` — Create product
- `products.update` — Update product
- `products.delete` — Soft-delete product
- `products.toggleTracking` — Enable/disable tracking
- `products.stats` — Product status statistics
- `products.search` — Search products by title/SKU/category
- `products.bulkSync` — Bulk upsert from Shopify

### Competitors

- `competitors.list` — List competitors (paginated)
- `competitors.count` — Get total competitor count
- `competitors.getById` — Get single competitor
- `competitors.create` — Add competitor
- `competitors.bulkImport` — Import competitors from CSV
- `competitors.update` — Update competitor
- `competitors.delete` — Soft-delete competitor
- `competitors.search` — Search competitors
- `competitors.stats` — Competitor statistics
- `competitors.products` — Get matched products for a competitor

### Alerts

- `alerts.list` — List alerts (paginated, filterable by unread)
- `alerts.count` — Get total alert count
- `alerts.stats` — Alert statistics
- `alerts.markRead` — Mark alert as read
- `alerts.markAllRead` — Mark all alerts as read
- `alerts.resolve` — Resolve alert
- `alerts.delete` — Delete alert

### Prices

- `prices.history` — Get price history for a product
- `prices.summary` — Get price summary (min/max/avg)
- `prices.trend` — Get trend data for charts

### Recommendations

- `recommendations.list` — List recommendations
- `recommendations.getByProduct` — Get recommendations for a product
- `recommendations.implement` — Apply a recommendation
- `recommendations.dismiss` — Dismiss a recommendation
- `recommendations.generate` — Generate new recommendation
- `recommendations.stats` — Recommendation statistics

### Shopify

- `shopify.listStores` — List connected stores
- `shopify.connect` — Connect a new store (OAuth)
- `shopify.disconnect` — Disconnect a store
- `shopify.syncProducts` — Sync products from Shopify

## Security

- **Sessions:** JWT in httpOnly cookies, 24-hour expiry, 30-day refresh tokens (DB-backed, SHA-256 hashed)
- **CSRF:** Double-submit cookie pattern on all state-changing Express routes
- **Rate limiting:** 100 req/15min general, 10/15min auth, 5/hr Shopify OAuth
- **Encryption:** Shopify access tokens and SMTP passwords stored AES-256-CBC encrypted. Key derived via PBKDF2 (100k iterations, unique salt)
- **Passwords:** bcrypt with 12 salt rounds, minimum 8 characters
- **Prod guards:** JWT secret must be set and >=32 chars in production. Auth bypass is production-blocked with error logging.

## Database Schema

Key tables: `users`, `products`, `competitors`, `competitor_products`, `price_history`, `alerts`, `recommendations`, `shopify_stores`, `email_configs`, `notification_preferences`, `activity_logs`, `refresh_tokens`, `scrape_jobs`, `product_embeddings`.

See `drizzle/schema.ts` for full schema definition.

## Product and scaling strategy

- [Phase 3 SaaS Transformation](docs/PHASE-3-SAAS-TRANSFORMATION-2026-08.md)
- [Phase 4 Commercial SaaS Launch](docs/PHASE-4-COMMERCIAL-SAAS-LAUNCH-2026-08.md)
- [Technical Audit and Implementation Status](docs/TECHNICAL-AUDIT-2026-08.md)

## License

MIT
