# PriceVision — Project Review

## Overview

**PriceVision** is a full-stack TypeScript SaaS platform for competitive price monitoring and optimization, integrated with Shopify. It monitors competitor prices in real-time, provides AI-powered pricing recommendations, and automates alerts when competitors change their pricing.

**Tech Stack:**
| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 7, Wouter (routing), shadcn/ui, Tailwind CSS 4, Recharts |
| Backend | Express 4, tRPC 11, Drizzle ORM, PostgreSQL (node-postgres) |
| Auth | JWT (jose 6.1.0), bcrypt (12 rounds), Shopify OAuth 2.0 |
| Crypto | AES-256-CBC (token encryption via PBKDF2-derived key), HMAC-SHA256 |
| Security | Helmet, CORS, CSRF (csrf-csrf), rate-limiting |
| Validation | Zod (tRPC inputs) |

---

## Project Structure

```
shopify price viwer/
├── client/                  # React frontend (Vite + Wouter + shadcn/ui)
│   ├── src/
│   │   ├── components/     # Shared components (DashboardLayout, ui/, etc.)
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
└── docs/                   # Documentation
```

---

## Database Schema

The database uses **13 tables** with PostgreSQL enums:

### Core Tables

| Table                        | Purpose                     | Key Fields                                                                                                 |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **users**                    | User accounts               | `id`, `email`, `passwordHash` (bcrypt), `role` (user/admin), `loginMethod`, `openId`                       |
| **shopify_stores**           | Connected Shopify stores    | `userId`, `shopDomain`, `accessToken` (AES-256-CBC encrypted), `currency`, `isActive`                      |
| **products**                 | Tracked products            | `userId`, `storeId`, `title`, `sku`, `price`, `status` (optimal/underpriced/overpriced/alert), `isTracked` |
| **competitors**              | Competitor stores           | `userId`, `name`, `domain`, `status`, `priceIndex`, `avgPriceDiff`, `productsTracked`                      |
| **competitor_products**      | Matched competitor products | `competitorId`, `productId`, `price`, `matchScore`, `isVerified`                                           |
| **price_history**            | Price change history        | `productId`, `competitorProductId`, `price`, `source` (shopify/competitor/manual), `recordedAt`            |
| **alerts**                   | Price alerts                | `userId`, `productId`, `alertType`, `severity`, `title`, `message`, `isRead`, `isResolved`                 |
| **recommendations**          | AI pricing recommendations  | `userId`, `productId`, `currentPrice`, `recommendedPrice`, `confidenceScore`, `status`                     |
| **scrape_jobs**              | Competitor scraping jobs    | `competitorId`, `status`, `productsScraped`, `productsUpdated`                                             |
| **email_configs**            | SMTP settings               | `userId`, `smtpServer`, `smtpPassword` (encrypted), `fromEmail`                                            |
| **notification_preferences** | User notification settings  | `userId`, `frequency`, `priceDropThreshold`, `priceIncreaseThreshold`                                      |
| **product_embeddings**       | AI vector embeddings        | `productId`, `embedding` (JSONB), `model`                                                                  |
| **activity_logs**            | Dashboard activity feed     | `userId`, `action`, `entityType`, `entityId`, `detail`                                                     |

### Enums

- `user_role`: user, admin
- `product_status`: optimal, underpriced, overpriced, alert
- `competitor_status`: active, inactive, error
- `alert_type`: price_drop, price_increase, competitor_change, threshold
- `alert_severity`: low, medium, high, critical
- `recommendation_status`: pending, implemented, dismissed
- `scrape_status`: pending, running, success, failed
- `notification_frequency`: realtime, hourly, daily, weekly

---

## Page-by-Page Breakdown

### 1. Auth Page (`/auth`) — `client/src/pages/Auth.tsx`

**Purpose:** Login and registration page with glassmorphism design.

**Layout:** Split-panel design:

- **Left (60%):** Branding panel with logo, typewriter headline ("Track competitor prices effortlessly"), description, and 3 feature cards (Real-time Tracking, AI Recommendations, Price Alerts)
- **Right (40%):** Form panel with Sign In / Sign Up tabs, email/password fields, and submit button

**How it works:**

1. User enters email + password (and name for registration)
2. Form submits via tRPC mutation (`auth.login` or `auth.register`)
3. Server verifies credentials with bcrypt, creates JWT session, sets httpOnly cookie
4. On success, client invalidates `auth.me` cache and redirects to `/`
5. Auth state is managed via `trpc.auth.me.useQuery()` — returns user or null

**Key tRPC endpoints:**

- `auth.login` — email + password → JWT session cookie
- `auth.register` — email + password + name → create account + JWT session cookie
- `auth.me` — returns current user from session cookie (public, not protected)
- `auth.logout` — clears session cookie

**Styling:** Fixed desktop sizes with responsive down-scaling at 1024px (tablet) and 767px (mobile). Glassmorphism cards, gradient mesh background, floating orbs animation.

---

### 2. Dashboard Layout (`/`) — `client/src/components/DashboardLayout.tsx`

**Purpose:** Main dashboard shell with sidebar navigation, top bar, search, notifications, and Shopify sync.

**Layout:**

- **Sidebar (collapsible):** Logo, 5 nav items (Overview, Products, Competitors, Analytics, Alerts), theme toggle, user avatar with logout
- **Top bar:** Global search, sync status indicator, Export Data button, Sync Shopify button, notification bell with dropdown
- **Main content:** Renders the active page component

**Key features:**

- **Global search:** Debounced search across products and competitors, dropdown results with navigation
- **Notification bell:** Shows unread count badge, dropdown with alert list, mark individual/all as read, links to Alerts page. Auto-refreshes every 30 seconds.
- **Sync Shopify:** Triggers `shopify.syncProducts` mutation to pull products from connected Shopify store
- **Export Data:** Downloads all products as CSV via PapaParse
- **Theme toggle:** Light/dark mode via ThemeContext
- **Resizable sidebar:** Drag to resize between 200-400px, persisted to localStorage

**Auth guard:** Wraps all dashboard routes. If `auth.me` returns null, redirects to `/auth`. Shows loading spinner while checking.

---

### 3. Overview Page (`/`) — `client/src/pages/dashboard/Overview.tsx`

**Purpose:** Strategic dashboard showing KPIs, pricing insights table, competitor movement feed, category mix, and system health.

**Layout:** Multi-section dashboard:

1. **KPI Row (4 cards):** Total Products, Average Price, Active Alerts, Competitors Tracked — each with icon, value, and trend indicator
2. **Pricing Insights Table (8 cols):** Products needing attention (alert/overpriced status) with current price, AI-recommended target price, projected monthly impact, and Approve/Reject actions. When no recommendations exist, the table shows the user's actual products with a per-row **GENERATE** button that calls `recommendations.generate` directly (no navigation away from the overview). "VIEW ALL RECOMMENDATIONS" navigates to `/products`.
3. **Competitor Movement Feed (4 cols):** Real-time feed of competitor price changes with timestamps, price gap percentages, and status badges
4. **Bottom Row:**
   - **Category Mix:** Donut chart (Recharts) showing product distribution by category with percentage legend
   - **Inventory Sync Status:** Health bars for Primary Shopify API, Scraping Cluster, and Price Index Engine with latency indicators

**Data sources:**

- `trpc.products.list` — all products for attention list and category aggregation
- `trpc.products.stats` — total count, average price
- `trpc.competitors.stats` — competitor count
- `trpc.alerts.stats` — unread and critical alert counts

---

### 4. Products Page (`/products`) — `client/src/pages/dashboard/Products.tsx`

**Purpose:** Full product inventory management with search, filtering, and CSV export.

**Layout:**

1. **Summary Cards (4):** Count of products by status (Optimal, Underpriced, Overpriced, Alert) with percentage badges
2. **Filter Bar:** Search input (title/SKU), Category dropdown, Status dropdown, Export CSV button
3. **Products Table:** Columns for Product (avatar, title, category), SKU, Price, Market Low, Delta (color-coded), Status badge, Actions (Price Scout, details, dropdown menu). Market Low and Delta columns are hidden on small screens (below `lg`) until competitor data is wired up.

**How it works:**

- Products loaded via `trpc.products.list` with an error state + Retry button if the query fails
- Client-side filtering by search query, category, and status
- Filtered empty state shows a "Clear Filters" button to reset all filters at once
- Market Low calculated as 92% of current price (placeholder)
- Delta is hardcoded at -5.1% (placeholder for actual competitor comparison)
- Overpriced status is color-coded **red** (was incorrectly green); optimal is green, underpriced amber, alert primary
- Export uses PapaParse to generate CSV download
- Actions: **⚡ Price Scout** navigates to `/price-scout` for that product; **↗ Details** navigates to `/products?id=<productId>`; dropdown has View Details (→ PriceScout) and Copy Product ID
- Uses the shadcn `<TableRow>` component for rows (replaces raw `<tr>`)

**Key tRPC endpoints:**

- `products.list` — get all products for current user
- `products.stats` — get status counts
- `products.update` — update product fields
- `products.search` — search products by query

---

### 5. Competitors Page (`/competitors`) — `client/src/pages/dashboard/Competitors.tsx`

**Purpose:** Competitor management with bento card layout, price comparison table, and CSV bulk import.

**Layout:**

1. **Bento Cards (4):** First competitor gets double-width card with detailed stats (overlap SKUs, price index, avg delta). Others show name, domain, status, product count.
2. **Comparison Table:** All competitors with Products Tracked, Price Index, Avg Diff (with trend icons), Status, Last Scraped timestamp
3. **Action Buttons:** Import CSV, Add Competitor (dialog)

**How it works:**

- Competitors loaded via `trpc.competitors.list` and `trpc.competitors.stats`
- **Add Competitor dialog:** Form with Name, Domain (validated), Description. Submits via `trpc.competitors.create`
- **CSV Import:** File picker → PapaParse → validates each row (name + domain required) → preview table with valid/invalid indicators → confirm import via `trpc.competitors.bulkImport` (up to 500 rows)
- Price Index < 95 shown in primary color (cheaper), > 95 in red (more expensive)

**Key tRPC endpoints:**

- `competitors.list` — get all competitors
- `competitors.stats` — get aggregate stats
- `competitors.create` — add single competitor
- `competitors.bulkImport` — bulk create from CSV
- `competitors.search` — search competitors
- `competitors.products` — get matched products for a competitor

---

### 6. Alerts Page (`/alerts`) — `client/src/pages/dashboard/Alerts.tsx`

**Purpose:** Alert management with severity filtering, search, and resolution workflow.

**Layout:**

1. **Summary Cards (3):** Critical count, Active count, Resolved count — each with icon
2. **Alert List Panel:**
   - Header with search input, sort dropdown (Newest/Oldest)
   - Tab filters: All, Active, Critical, Resolved — with counts
    - Alert cards showing: severity badge, type badge, title, message, timestamp, Resolve button
    - **Resolve button is now functional:** calls `trpc.alerts.markRead` mutation; on success invalidates the alerts cache and toasts "Alert resolved", on error toasts the failure. Resolved alerts then appear under the Resolved tab.
    - Invalid `createdAt` timestamps are guarded with try/catch so a bad date won't crash the page
    - Query failure shows an error message with a Retry button (instead of a silent empty list)
    - Empty state with bell icon and "No alerts found" message

**How it works:**

- Alerts loaded via `trpc.alerts.list` (all alerts, up to 100)
- Stats loaded via `trpc.alerts.stats` (critical, unread, resolved counts)
- Client-side filtering by search query and tab
- Severity config: critical (red), high (light red), medium (green), low (blue)
- Type config: price_drop (TrendingDown), price_increase (TrendingUp), competitor_change (ArrowUpDown), threshold (Zap)
- Resolved alerts shown with reduced opacity and CheckCircle icon

**Key tRPC endpoints:**

- `alerts.list` — get alerts (with unreadOnly option)
- `alerts.stats` — get alert counts by severity
- `alerts.markRead` — mark single alert as read
- `alerts.markAllRead` — mark all alerts as read

---

### 7. Analytics Page (`/analytics`) — `client/src/pages/dashboard/Analytics.tsx`

**Purpose:** Performance analytics with charts showing margin trends, recommendation impact, and market comparison.

**Layout:**

1. **KPI Row (4 cards):** Average Margin (from costPrice), Price Accuracy (% optimal), AI Recommendations count, Revenue Impact
2. **Charts Row (2 columns):**
   - **Margin Trend:** Area chart (Recharts) showing actual margin % vs 30% target line for up to 12 products
   - **Recommendation Impact:** Bar chart showing count of underpriced/overpriced products by category
3. **Market Price Comparison:** Grouped bar chart comparing "Us" vs "Market Avg" prices by category (market = 102% of our price as placeholder)

**Data sources:**

- `trpc.products.list` — for margin calculations and category aggregation
- `trpc.products.stats` — total product count
- `trpc.recommendations.stats` — AI recommendation count and total savings
- `trpc.competitors.stats` — competitor stats

**Calculations:**

- Average Margin: `((price - costPrice) / price) * 100` for products with costPrice
- Price Accuracy: `(optimal products / total products) * 100`
- Market Avg: Our average price \* 1.02 (placeholder)

---

### 8. Home Page (`/home`) — `client/src/pages/Home.tsx`

**Purpose:** Example/placeholder page. Not routed in App.tsx. Contains boilerplate code showing how to use `useAuth` hook, `Button` component, and `Streamdown` markdown renderer.

---

### 9. Not Found Page (`*`) — `client/src/pages/NotFound.tsx`

**Purpose:** 404 page for unmatched routes. Shows animated AlertCircle icon, "Page Not Found" message, and "Go Home" button.

---

## API Routes (tRPC Routers)

All routers are in `server/routers/`. Middleware types:

- **`publicProcedure`** — no auth required (used for `auth.me`, `auth.login`, `auth.register`)
- **`protectedProcedure`** — requires valid JWT session cookie (all other endpoints)
- **`adminProcedure`** — requires admin role (defined but not currently used in routers)

### Auth Router (`auth.router.ts`)

| Procedure       | Type     | Description                         |
| --------------- | -------- | ----------------------------------- |
| `auth.me`       | query    | Get current user from session       |
| `auth.register` | mutation | Create account + session            |
| `auth.login`    | mutation | Verify credentials + create session |
| `auth.logout`   | mutation | Clear session cookie                |

### Product Router (`product.router.ts`)

| Procedure                 | Type     | Description                 |
| ------------------------- | -------- | --------------------------- |
| `products.list`           | query    | Get all products for user   |
| `products.listByStore`    | query    | Get products by store ID    |
| `products.getById`        | query    | Get single product          |
| `products.create`         | mutation | Create product              |
| `products.update`         | mutation | Update product fields       |
| `products.delete`         | mutation | Delete product              |
| `products.toggleTracking` | mutation | Toggle isTracked flag       |
| `products.stats`          | query    | Get status counts           |
| `products.stores`         | query    | Get user's stores           |
| `products.upsertStore`    | mutation | Create/update Shopify store |
| `products.search`         | query    | Search products by query    |
| `products.bulkSync`       | mutation | Bulk upsert products        |

### Competitor Router (`competitor.router.ts`)

| Procedure                | Type     | Description                      |
| ------------------------ | -------- | -------------------------------- |
| `competitors.list`       | query    | Get all competitors              |
| `competitors.getById`    | query    | Get single competitor            |
| `competitors.create`     | mutation | Add competitor                   |
| `competitors.bulkImport` | mutation | Bulk import from CSV (up to 500) |
| `competitors.update`     | mutation | Update competitor                |
| `competitors.delete`     | mutation | Delete competitor                |
| `competitors.search`     | query    | Search competitors               |
| `competitors.stats`      | query    | Get aggregate stats              |
| `competitors.products`   | query    | Get matched products             |
| `competitors.addProduct` | mutation | Add competitor product match     |

### Alert Router (`alert.router.ts`)

| Procedure            | Type     | Description                         |
| -------------------- | -------- | ----------------------------------- |
| `alerts.list`        | query    | Get alerts (with unreadOnly filter) |
| `alerts.stats`       | query    | Get alert counts by severity        |
| `alerts.markRead`    | mutation | Mark alert as read                  |
| `alerts.markAllRead` | mutation | Mark all alerts as read             |

### Price Router (`price.router.ts`)

| Procedure                  | Type  | Description                     |
| -------------------------- | ----- | ------------------------------- |
| `prices.history`           | query | Get price history for a product |
| `prices.competitorHistory` | query | Get competitor price history    |

### Recommendation Router (`recommendation.router.ts`)

| Procedure                   | Type     | Description                        |
| --------------------------- | -------- | ---------------------------------- |
| `recommendations.list`      | query    | Get AI recommendations             |
| `recommendations.stats`     | query    | Get recommendation stats           |
| `recommendations.implement` | mutation | Mark recommendation as implemented |
| `recommendations.dismiss`   | mutation | Dismiss recommendation             |

### Activity Router (`activity.router.ts`)

| Procedure       | Type  | Description              |
| --------------- | ----- | ------------------------ |
| `activity.list` | query | Get recent activity logs |

---

## Authentication Flow

1. **Session-based auth** using JWT stored in httpOnly cookies
2. Cookie name: `app_session_id` (from `shared/const.ts`)
3. Session expiry: 24 hours (`SESSION_EXPIRY_MS`)
4. Refresh token expiry: 30 days (`REFRESH_TOKEN_EXPIRY_MS`)
5. Passwords hashed with bcrypt (12 salt rounds)
6. Shopify access tokens encrypted with AES-256-CBC (PBKDF2-derived key)
7. Auth guard in `App.tsx` checks `auth.me` — if null, renders `<Auth />` page instead of dashboard

**Default admin account** (created by seed):

- Email: `admin@example.com`
- Password: `admin123`

---

## Security Features

All 14 CRITICAL and HIGH vulnerabilities have been fixed (as of 2026-06-02):

1. JWT secret validates in production (throws if unset/default/short)
2. SMTP passwords encrypted at rest
3. Encryption key derived via PBKDF2 (not raw SHA-256)
4. `shopify.getToken` endpoint removed (tokens never sent to frontend)
5. Auth bypass double-gated with production error logging
6. Rate limiting on all API endpoints (100 req/15min general, 10/15min auth, 5/hr Shopify OAuth)
7. Helmet security headers
8. CSRF protection on Express routes (double-submit cookie pattern)
9. JWT expiry reduced to 24h with refresh tokens
10. Cookie `secure` flag checks `connection.encrypted`
11. Storage proxy validates path keys against traversal
12. Unused `mysql2` dependency removed
13. Both disconnect endpoints verify `userId`
14. CORS middleware with production origin restriction
15. CORS `ALLOWED_ORIGINS` empty strings filtered out (avoids an unintended `""` origin match in production)
16. Scout service validates fetch URLs (only `http(s):` allowed) before fetching — SSRF protection
17. Rate limiting extended to `scout.*` tRPC endpoints (scrapeLimiter)

---

## Development Commands

```bash
pnpm dev          # Start dev server (Express + Vite)
pnpm check        # TypeScript type check
pnpm test         # Run tests (vitest)
pnpm db:push      # Run Drizzle migrations
pnpm db:seed      # Seed database (creates admin user + sample data)
```

---

## Key Design Patterns

- **tRPC for type-safe API:** All backend procedures are defined with Zod schemas, providing end-to-end type safety from database to UI
- **Service layer:** Business logic is separated into `server/services/` (product.service.ts, competitor.service.ts, etc.)
- **Component composition:** Dashboard uses shadcn/ui components (Card, Table, Dialog, Tabs, etc.) with custom glassmorphism styling
- **Optimistic UI:** tRPC React Query integration provides automatic caching, invalidation, and refetching
- **Dark mode default:** OKLCH color system in `index.css` with light mode support via ThemeContext
- **Responsive design:** Desktop-first with fixed sizes, scaling down at tablet (1024px) and mobile (767px) breakpoints

---

## Recent Code & UI Improvements (2026-07-12)

Improvements made without changing the database schema. `pnpm check` passes with zero type errors.

### Frontend

- **Products page:** Dead action buttons are now functional — ⚡ "Price Scout" navigates to `/price-scout` for that product, ↗ "Details" opens the product (replaced former placeholder toasts). Replaced raw `<tr>` with the shadcn `<TableRow>` component. Added a query error state with a Retry button. Fixed the overpriced status color from green → red. Filtered empty state now offers a "Clear Filters" button. Market Low / Delta columns hidden below `lg` until competitor comparison is wired. Removed unused imports (`MoreHorizontal`, `Plus`).
- **Alerts page:** The previously dead "Resolve" button is wired to `trpc.alerts.markRead`; on success it invalidates the cache and toasts, on error it surfaces the failure. Added a query error state with Retry. Guarded `new Date(createdAt)` in try/catch so a malformed timestamp can't crash the page.
- **Overview page:** Empty-state "GENERATE" button now calls `recommendations.generate` directly instead of only navigating. "VIEW ALL RECOMMENDATIONS" navigates to `/products`.

### Backend

- **`server/_core/index.ts`:** `PORT` parsed with `Number()` + fallback (was `parseInt(process.env.PORT || "3000")`, which could yield `NaN`). `ALLOWED_ORIGINS` split is now `.filter(Boolean)` so empty strings can't slip into the CORS origin list. Rate limiting (`scrapeLimiter`) extended to `scout.*` endpoints. `cronScheduler.start()` wrapped in try/catch.
- **`server/services/scout.service.ts`:** Added `isValidFetchUrl()` guard — only `http(s)` URLs are fetched (SSRF protection for the HTML fallback path).

