# Improvement Plan — "make the app much better"

> **Historical.** A plan written before the discovery consolidation. Items
> referring to Price Radar, Scoop or Path of Wisdom no longer apply — those
> systems were removed. The current open list is `docs/TODO.md`.

> **Hard constraint:** database-untouchable. No changes to `drizzle/schema.ts`,
> `drizzle/migrations/*`, no `db:push` / `db:generate`, no new columns / tables /
> indexes. Every fix is code-only (TypeScript handlers, Zod schemas, React
> components, new tRPC procedures that only call existing service methods, tests,
> docs).

## The DB boundary

- **WILL change:** service/router TypeScript, Zod input schemas, React components,
  new tRPC procedures over existing service methods, test files, `README.md` /
  `CLAUDE.md`.
- **WILL NOT touch:** `drizzle/schema.ts`, `drizzle/migrations/*`, any migration
  command, or any new column/table/index — including the store-hijack fix, which
  stays code-level (ownership pre-check, not a constraint change).

## Test baseline (captured before edits)

`pnpm test` → 3 app suites:

- `server/services/__tests__/pricing-engine.test.ts` — **passing** (pins exact
  values: 95, 110, 95.04, 100.33 — refactors must preserve these).
- `server/auth.logout.test.ts` — **passing**.
- `server/services/__tests__/product.test.ts` — **DB-backed**, fails locally with
  "Database connection unavailable" (no `.env`/Postgres in the test process). Not
  a code regression; needs a test DB to run.
- No `validation.test.ts` yet.

---

## Phase 1 — Security & correctness (tests on each)

| #   | File                                    | Change                                                                                                                                              |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | `product.service.ts` `upsertStore`      | Add `userId` first arg; pre-query by `shopDomain`; if owned by a different user → `TRPCError CONFLICT`. Thread `userId` from `product.router.ts:207`. Code-level guard, **no constraint change**. |
| 1.2 | `product.service.ts` `findByName`       | SQL `regexp_replace(lower(trim(title)),'\s+',' ','g')` to match `normalizeName`'s space-collapsing.                                                  |
| 1.3 | `pricing-engine.service.ts`             | Integer-cents math internally; public API / return types stay `number`. Preserve all pinned test values.                                            |
| 1.4 | `product.service.ts` `getCompetitorPrices` | Take `userId`; ownership-guard so only the owner reads. Update call sites `pricing-engine.router.ts:99,209`.                                       |

## Phase 2 — Harden & add tests

- `trpc.ts`: central `errorFormatter` — log unexpected server errors, mask messages
  (keep `TRPCError` messages intact).
- `context.ts`: log invalid/expired token attempts (currently a silent swallow).
- Remove `as any` (`product.service.ts:134`); replace `Math.min(...spread)` /
  `Math.max(...spread)` (`pricing-engine.service.ts:199-200`) with `reduce`
  (array-blowup safety).
- New tests: `validation.test.ts` (sku/price/name schemas), plus pricing-engine
  float-trap cases.

## Phase 3 — Performance & DX

- **N+1 fix:** replace the per-product loop in `analyzeAll` / `dashboardStats`
  (`pricing-engine.router.ts:98-99`, `:208-209`) with one batched
  `getCompetitorPricesForProducts(userId, ids[])` using `inArray`, grouped in memory.
- `README.md`: fix `.env.example` references → point at `docs/ENVIRONMENT.md`
  (matches the CLAUDE.md fix already applied).

## Phase 4 — Features & UX (all four, DB-free)

- **Bulk product actions** — new `products.bulkAction` procedure
  (`ids[]`, `action: track | untrack | delete`) looping existing `productService`
  methods filtered by `userId`; checkbox column + action bar on `Products.tsx`.
- **One-click apply price** — "Apply" button in `PricingRecommendationWidget` →
  `products.update({ price: String(recommendedPrice) })` (decimal-as-string),
  optimistic update + toast.
- **CSV export** — client-only: build CSV from fetched query data + `Blob`
  download; buttons on Products / Competitors / Analytics. No backend change.
- **UX polish** — loading skeletons, empty states, `ErrorBoundary` coverage using
  existing `PageSkeleton` / `empty` / `error-recovery` components across dashboard
  pages.

## Sequencing & verification

Order: **1 → 2 → 3 → 4**. After **each phase**: `pnpm check` (tsc) → `pnpm test`
(vitest) → restart `pnpm dev`, hit `http://localhost:3000`, exercise the changed
flow. Checkpoint after each phase before continuing. No migration step anywhere.

---

## Progress log

- **Phase 1 — in progress**
  - [x] **BUILD FIX (2026-07-11):** `dollarsToCents` / `centsToDollars` were referenced
        but never defined → `pnpm check` was red (7 × TS2304). Now defined in the
        Helpers section of `pricing-engine.service.ts`. `pnpm check` is **green** and
        `pricing-engine.test.ts` passes **33/33**.
  - [x] 1.3 `calculateAverageCompetitorPrice` + `classifyMarketPosition` use integer-cents
        (via the now-defined helpers).
  - [ ] 1.3 remaining: `calculateRecommendedPrice` still float-multiplies
        (`avgCompetitorPrice * UNDERCUT_FACTOR`); finish cents conversion or leave as-is
        until a later phase. Tests pin 95 / 110 / 95.04 and still pass either way.
  - [ ] 1.4 `getCompetitorPrices(userId, productId)` ownership guard + call-site updates.
  - [ ] 1.1 `upsertStore` ownership guard.
  - [ ] 1.2 `findByName` space-collapsing SQL.
  - [x] verify: `pnpm check` ✅ (green). `pnpm test` ⚠️ `product.test.ts` still fails
        locally — DB-backed, "Database connection unavailable" (no Postgres in env),
        not a regression.
- **Phase 2 — pending**
- **Phase 3 — pending**
- **Phase 4 — pending**
