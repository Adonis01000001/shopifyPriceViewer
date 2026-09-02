# Competitor Price Intelligence Platform — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        React Frontend (Vite)                        │
│  ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌───────────────────┐  │
│  │ Overview │ │  Products  │ │ Competitors│ │    Intelligence   │  │
│  │Dashboard │ │   Page     │ │   Page     │ │    Dashboard      │  │
│  └──────────┘ └────────────┘ └────────────┘ └───────────────────┘  │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ tRPC over HTTP
┌─────────────────────────────▼───────────────────────────────────────┐
│                     Express + tRPC Server                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    tRPC Routers                              │    │
│  │  auth │ products │ competitors │ prices │ alerts │ intel... │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Services Layer                            │    │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐     │    │
│  │  │ Pipeline Service │  │ AI Extraction Service        │     │    │
│  │  │ (the whole run)  │  │ (single LLM call per page)   │     │    │
│  │  │                  │  │                              │     │    │
│  │  │ • Search         │  │ • Product match validation   │     │    │
│  │  │ • Scrape         │  │ • Price extraction           │     │    │
│  │  │ • Match + guard  │  │ • Structured JSON output     │     │    │
│  │  │ • Price + floor  │  │ • Confidence scoring         │     │    │
│  │  │ • Narrate steps  │  └──────────────────────────────┘     │    │
│  │  └──────────────────┘                                       │    │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐     │    │
│  │  │ Pricing Engine   │  │ Cron Scheduler               │     │    │
│  │  │                  │  │                              │     │    │
│  │  │ • Average        │  │ • Price refresh              │     │    │
│  │  │ • Undercut       │  │ • Daily full run             │     │    │
│  │  │ • Margin floor   │  │ • Skips a job already run    │     │    │
│  │  │ • Position       │  │ • Overlap prevention         │     │    │
│  │  └──────────────────┘  └──────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Data Access (Drizzle ORM)                 │    │
│  └─────────────────────────────────────────────────────────────┘    │
└───────────┬──────────────────┬──────────────────┬───────────────────┘
            │                  │                  │
   ┌────────▼──────┐  ┌───────▼───────┐  ┌───────▼───────┐
   │  PostgreSQL   │  │ Serper/SerpApi│  │  OpenRouter   │
   │  (Drizzle)    │  │ Jina, Firecrawl│ │  (rotating)   │
   └───────────────┘  └───────────────┘  └───────────────┘
```

## Core Workflow

One run does all of it, in `server/services/pipeline.service.ts`. There is no
separate discovery step to trigger and no candidate queue to approve: three
earlier systems worked that way and were removed, because a merchant could not
tell which of them a price had come from.

### 1. Product import

The merchant connects Shopify over OAuth; the catalogue syncs through the
Admin API into `products`, with cost prices where Shopify exposes them. A CSV
import is the alternative for merchants not on Shopify.

### 2. Search, in the merchant's own market

Serper if a key is set, otherwise SerpApi. The query is built from the product
title and run with the country and language the merchant's store sells in —
a price a shopper in that market would not see is not a competitor price.
Results from the merchant's own domain are dropped.

### 3. Read the page, cheapest source first

Jina Reader first: free, no key, and enough for most retailer pages. Firecrawl
only when Jina comes back empty, because it costs credits. Playwright last,
when there is no Firecrawl key at all.

Heavily protected retailers - Amazon, Best Buy - block all three. Those
candidates are skipped and the next domain is tried. This shows in the log as
`no price on page (likely blocked), skipping AI call`, which is the guard
working rather than a fault.

### 4. One model call per page, and three guards

The call decides whether the page sells the same product and reads the price
off it. Nothing is recorded unless it survives all three:

1. **The page must contain a price at all.** Checked before the model call, so
   a blocked page costs nothing.
2. **The match must reach the confidence threshold** —
   `MATCH_CONFIDENCE_THRESHOLD`, default `0.85`. Lowering it matches more
   shops and admits more wrong ones; the local `.env` on the demo machine runs
   at `0.75`, which is worth knowing when comparing results.
3. **The price must appear in the page text.** If the model returns a number
   that is not there, it is thrown away. This catches the failure where a
   model repeats the merchant's own price back, or invents one.

A price outside a plausible band around the merchant's own - under a quarter or
over four times - is also rejected as a parse artefact.

### 5. Work out the price

Average what was confirmed, take the merchant's undercut off it, and never go
below cost plus their margin. Both percentages are per-merchant settings; see
`server/services/pricing-rules.service.ts`. A change under 1% is not raised at
all, because a suggestion to move a price by pennies is noise on a list of
things to do.

### 6. Narrate it

Every step writes a line to `activity_logs` naming the shop and what came of
it. That is what the top-bar indicator reads, and what the product page shows
as "everything we checked" — so a merchant can audit a suggestion rather than
trust it.

### 7. What runs when

| Job | Interval | Does |
| --- | --- | --- |
| `price_monitor` | Daily at `PRICE_REFRESH_HOUR:PRICE_REFRESH_MINUTE` in `PRICE_REFRESH_TIMEZONE` | Re-reads pages already matched; disabled while idle and never runs at startup |
| `daily_reports` | 24h | Report generation for plans that include it |

The scheduler reads `cron_runs` before starting a job and skips one that has
already run within its interval, so restarting the server does not re-run a
day's work.

## Database Schema (Key Tables)

| Table                    | Purpose                            |
| ------------------------ | ---------------------------------- |
| `products`               | Merchant's products                |
| `users`                  | Accounts, and the two pricing rules |
| `competitors`            | Known competitor stores            |
| `competitor_products`    | Matched competitor products        |
| `ai_extractions`         | AI validation + extraction results |
| `price_snapshots`        | Immutable price history            |
| `price_changes`          | Detected change events             |
| `scrape_logs`            | Per-URL scrape attempt logs        |
| `cron_runs`              | Monitoring job tracking            |
| `activity_logs`          | Timeline events, and the pipeline's step-by-step narration |
| `alerts`                 | Price change alerts                |

## The API

See `docs/API.md`. In short: tRPC at `/api/trpc`, one router file per
namespace under `server/routers/`, sessions in an httpOnly cookie.

The intelligence router used to carry a dozen discovery endpoints - approve a
candidate, reject one, import one as a competitor. They went with the systems
behind them. What is left there is the action centre, extraction by URL, and
cron status.

## Deployment

### Docker Compose

```bash
docker-compose up -d
```

### Manual

```bash
pnpm install
pnpm db:migrate     # Apply migrations
pnpm start          # Tunnel and app together
```

Full instructions are in `docs/SETUP.md`.

## Scalability Considerations

- **Concurrent scraping**: Semaphore-controlled (`MAX_CONCURRENT_SCRAPES`, default 5)
- **Per-product deadline**: six minutes, after which the run abandons that
  product and moves on rather than stalling everything behind it
- **Model refusals**: free models share an upstream pool and 429 often, so the
  call rotates through `OPENROUTER_MODELS` before giving up
- **Cron jobs**: In-process with overlap prevention, and a `cron_runs` check so
  a restart does not repeat a day's work
- **Database**: Indexed for analytics queries on product_id, competitor_id, created_at
- **Snapshots**: Immutable — never overwritten, only appended
- **AI costs**: Single call per page, structured output minimizes tokens
- **Workers**: BullMQ + Redis are implemented for distributed price monitoring,
  competitor discovery, and notification processing; staging recovery still
  requires the evidence tracked in `docs/RELEASE-PLAN-V1.md`.
