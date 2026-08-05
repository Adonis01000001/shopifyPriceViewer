# PriceVision — Code Explanation

This document explains how the codebase is organized and how the main pieces fit together. It complements `REVIEW.md` (which documents the feature/UI surface) by focusing on the _code_: entry points, data flow, and the key modules you'll touch when extending the app.

---

## 1. Big Picture

```
Browser (React)  ──HTTP /api/trpc──▶  Express + tRPC  ──▶  Drizzle ORM  ──▶  PostgreSQL
       ▲                                  │
       │                                  └──▶ Services (pricing engine, scout, email, shopify…)
       └── JWT session cookie (httpOnly) ──┘
```

- **Client** is a Vite + React SPA. It never talks to the DB directly — every data call goes through tRPC.
- **Server** is an Express app that hosts a tRPC API plus a few Express-only routes (Shopify OAuth). tRPC procedures call **services**, which contain the business logic and talk to the DB through Drizzle.
- **Auth** is session-based: a JWT lives in an `httpOnly` cookie. The tRPC context reads that cookie and attaches a `user` (or `null`) to every request.

---

## 2. Client Entry Flow

### `client/src/main.tsx` — bootstrapping

Three things are wired up here:

1. **React Query (`QueryClient`)** — the cache layer under tRPC. Configured with `retry: 1` and a 5-minute `gcTime`. A subscription on the query/mutation caches watches for errors: if a response carries the `UNAUTHED_ERR_MSG` string, the user is redirected to the login page (`redirectToLoginIfUnauthorized`).
2. **tRPC client** — created with `httpBatchLink` pointing at `/api/trpc`. `superjson` is the transformer (so `Date`, `Map`, etc. survive the wire). `credentials: "include"` ensures the session cookie is sent on every request.
3. **Render** — wraps `<App />` in `trpc.Provider` + `QueryClientProvider`.

```ts
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    }),
  ],
});
```

### `client/src/App.tsx` — routing & auth guard

- Routes use **Wouter** (`Route` / `Switch`), not React Router.
- `AuthGuard` calls `trpc.auth.me.useQuery()`. While loading it shows a spinner; if no user, it renders `<Auth />`; otherwise it renders the protected dashboard tree.
- The tree is: `ErrorBoundary → ThemeProvider (dark default) → TooltipProvider → Toaster → DashboardLayout → <page>`.
- Routes: `/` Overview, `/products`, `/scout` PriceScout, `/alerts`, `/competitors`, `/analytics`, `/settings`. `/auth` is public.

### `client/src/lib/trpc.ts`

Exports the typed `trpc` proxy generated from the server's `AppRouter` type. This is what gives end-to-end type safety: a procedure's input/output types on the server are inferred on the client. Import `trpc` anywhere to call `trpc.products.list.useQuery()`, etc.

---

## 3. How a Page Talks to the Backend (pattern)

Every page follows the same shape:

```tsx
const utils = trpc.useUtils(); // for cache invalidation
const products = trpc.products.list.useQuery(); // READ  (React Query)
const generate = trpc.recommendations.generate.useMutation({
  // WRITE
  onSuccess: () => utils.recommendations.list.invalidate(),
});
```

- `useQuery` → GET-style tRPC query. Add an `error` branch to show a Retry button (see `Products.tsx` / `Alerts.tsx`).
- `useMutation` → POST-style tRPC mutation. Use `onSuccess` to invalidate queries so the UI refetches, and `onError` to toast the failure.
- Navigation between pages uses Wouter's `useLocation()` (e.g. Products ⚡ → `/price-scout`, ↗ → `/products?id=…`).

---

## 4. Server Entry Flow

### `server/_core/index.ts` — the Express app

Boot order:

1. `helmet` security headers (off in dev).
2. `cors` — in production the origin list comes from `ALLOWED_ORIGINS` (comma-separated, `.filter(Boolean)` to drop empty strings); in dev it's `*`.
3. Rate limiters: `apiLimiter` on `/api/`, `shopifyLimiter` on OAuth routes, `authLimiter` on login/register, `scrapeLimiter` on `competitors.scrapeProducts` **and** `scout.*`.
4. Body parsers (1 MB cap), `cookieParser`, CSRF on `/api/shopify/` and `/api/oauth/`.
5. `registerOAuthRoutes(app)` for Shopify OAuth.
6. tRPC mounted at `/api/trpc` via `createExpressMiddleware({ router: appRouter, createContext })`.
7. Port resolution: `Number(process.env.PORT) || 3000`, then `findAvailablePort()` walks up to 20 ports if busy.
8. Vite middleware in dev; static files in prod.
9. `cronScheduler.start()` (wrapped in try/catch) for price monitoring.

### `server/_core/context.ts` — request context

`createContext` runs per request. It calls `sdk.authenticateRequest(req)` to read the JWT cookie and resolve the `user`. On failure it falls through to `null` (public procedures work; protected ones reject). A dev-only `bypassAuth` injects a fake admin user — **double-gated so it can never activate in production** (the code logs an error and ignores it if `ENV.bypassAuth` is set while `ENV.isProduction`).

The context object passed to every procedure:

```ts
type TrpcContext = { req; res; user: User | null };
```

### `server/routers/*` — procedures

Each router file groups related procedures. Middleware tiers (see `REVIEW.md` -> API Routes):

- `publicProcedure` — no auth (`auth.me`, `auth.login`, `auth.register`).
- `protectedProcedure` — requires a resolved `user`; rejects with `UNAUTHED_ERR_MSG` if missing.
- `adminProcedure` — requires `user.role === "admin"` (defined, lightly used).

Procedures either return data directly (simple cases) or delegate to a **service** for anything non-trivial.

---

## 5. Service Layer (business logic)

`server/services/` holds the logic. Routers are thin; services do the work. Key services:

| Service                     | Responsibility                                                                  |
| --------------------------- | ------------------------------------------------------------------------------- |
| `product.service.ts`        | CRUD + status calc (optimal/under/over/alert) for products                      |
| `competitor.service.ts`     | Competitor stores, CSV import, product matching                                 |
| `pricing-engine.service.ts` | Computes recommended prices / deltas, price-index math                          |
| `scout.service.ts`          | Looks up competitor prices via Firecrawl + SerpApi + Exa, with an HTML fallback |
| `email.service.ts`          | SMTP sending (encrypted password at rest)                                       |
| `shopify.service.ts`        | Shopify OAuth + product sync                                                    |
| `cron-scheduler.service.ts` | Periodic price monitoring jobs                                                  |

### Scout service — how price lookup works (`scout.service.ts`)

`scoutProduct` enriches one of our products with competitor market prices:

1. Try **Firecrawl** scrape of known competitor URLs.
2. Try **SerpApi** search (`/search?…`) -> parse organic results for prices.
3. Try **Exa** semantic search.
4. **HTML fallback**: `fetch(url)` the product page and regex-extract a price — **guarded by `isValidFetchUrl()` so only `http(s)` URLs are fetched** (SSRF protection).

Helpers worth knowing:

- `extractDomain(url)` — hostname without `www.`.
- `parsePrice(raw)` — pulls a value + currency out of a messy price string.
- `isValidFetchUrl(url)` — allows only `http:`/`https:` (added in the 2026-07-12 pass).

The result is a `ScoutResult` with `prices: ScoutPrice[]`, `status` (`success`/`partial`/`failed`), and an `errorMessage`.

---

## 6. Database Layer

- `drizzle/schema.ts` — 13 tables + enums, defined with Drizzle's `pgTable` builders. Shared enums (`product_status`, `alert_severity`, …) are exported for reuse on the client.
- `server/db.ts` — `node-postgres` pool; `server/_core/db-assert.ts` exports `requireDb()` used by services to fail fast if the DB is unreachable.
- `drizzle/config.ts` — DrizzleKit config (migrations).
- `shared/` — `const.ts` (cookie name, session expiry) and `types.ts` (types usable on both sides). `UNAUTHED_ERR_MSG` lives in `shared/const.ts` and is what the client checks to trigger a redirect.

Migrations: use `pnpm db:generate` after schema changes and `pnpm db:migrate` to
apply committed migrations. `pnpm db:push` is for local development only. Seed:
`pnpm db:seed` requires `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`; it does
not contain a default production credential.

---

## 7. Auth Deep-Dive

1. `auth.register` / `auth.login` verify the password with **bcrypt (12 rounds)**, then mint a **JWT** (jose) containing the user id.
2. The JWT is set as an `httpOnly`, `sameSite` cookie (`app_session_id`). The `secure` flag is set only when `req.connection.encrypted` is true (not just a spoofable header).
3. On each request, `context.ts` verifies the JWT and loads the user.
4. `auth.logout` clears the cookie. Refresh tokens (30-day) extend sessions; access tokens expire in 24h.
5. Shopify access tokens are stored **AES-256-CBC encrypted** with a PBKDF2-derived key — never exposed to the frontend.

---

## 8. Styling & UI System

- `client/src/index.css` — OKLCH color tokens, dark-mode default, glassmorphism utilities (`glass-card`, etc.).
- `client/src/components/ui/` — shadcn/ui primitives (Card, Table, Dialog, Tabs, Button, Badge, sonner `Toaster`…). Prefer these over raw HTML elements (e.g. use `<TableRow>`, not `<tr>`).
- Pages live in `client/src/pages/` (`Auth.tsx`, `Home.tsx`, `NotFound.tsx`) and `client/src/pages/dashboard/` (Overview, Products, Alerts, Competitors, Analytics, PriceScout, Settings).
- Icons: `lucide-react` (e.g. `Zap`, `ExternalLink`, `TrendingUp`). Avoid raw emoji in buttons.

---

## 9. Recent Code/UI Changes (2026-07-12)

See the matching section in `REVIEW.md`. Summary of the code-level changes:

- **Client:** Products/Alerts/Overview gained functional buttons, query error states with Retry, and correct status colors. Dead ⚡/↗ buttons now navigate; Resolve calls `markRead`; empty-state GENERATE calls `recommendations.generate`.
- **Server:** `PORT` parsed safely; CORS origins `.filter(Boolean)`; `scout.*` rate-limited; `isValidFetchUrl()` guards fetches (SSRF); `cronScheduler.start()` wrapped in try/catch.

All changes keep `pnpm check` (tsc) clean.

---

## 10. Where to Start When Extending

| I want to…                     | Start here                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Add an API endpoint            | `server/routers/<domain>.router.ts` (+ a service method)                                         |
| Change a DB table              | `drizzle/schema.ts` -> `pnpm db:push`                                                            |
| Add a dashboard page           | `client/src/pages/dashboard/<Name>.tsx` + route in `App.tsx` + nav item in `DashboardLayout.tsx` |
| Change pricing logic           | `server/services/pricing-engine.service.ts`                                                      |
| Change competitor price lookup | `server/services/scout.service.ts`                                                               |
| Change auth/session rules      | `server/_core/auth/*`, `server/_core/context.ts`, `shared/const.ts`                              |
| Tweak styling/theme            | `client/src/index.css`                                                                           |
