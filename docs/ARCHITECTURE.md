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
│  │  │ Competitor       │  │ AI Extraction Service        │     │    │
│  │  │ Discovery Svc    │  │ (single LLM call per page)   │     │    │
│  │  │ (SerpAPI +       │  │                              │     │    │
│  │  │  Firecrawl)      │  │ • Product match validation   │     │    │
│  │  │                  │  │ • Price extraction           │     │    │
│  │  │ • Country-aware  │  │ • Description extraction     │     │    │
│  │  │ • Language-aware │  │ • Structured JSON output     │     │    │
│  │  │ • URL dedup      │  │ • Confidence scoring         │     │    │
│  │  │ • Confidence     │  └──────────────────────────────┘     │    │
│  │  └──────────────────┘                                       │    │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐     │    │
│  │  │ Price Monitoring │  │ Cron Scheduler               │     │    │
│  │  │ Engine           │  │                              │     │    │
│  │  │                  │  │ • Hourly price monitoring    │     │    │
│  │  │ • Scrape pages   │  │ • Daily competitor discovery │     │    │
│  │  │ • AI extraction  │  │ • Staggered job starts       │     │    │
│  │  │ • Detect changes │  │ • Overlap prevention         │     │    │
│  │  │ • Store snapshots│  └──────────────────────────────┘     │    │
│  │  │ • Generate alerts│                                       │    │
│  │  │ • Timeline events│                                       │    │
│  │  └──────────────────┘                                       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Data Access (Drizzle ORM)                 │    │
│  └─────────────────────────────────────────────────────────────┘    │
└───────────┬──────────────────┬──────────────────┬───────────────────┘
            │                  │                  │
   ┌────────▼──────┐  ┌───────▼───────┐  ┌───────▼───────┐
   │  PostgreSQL   │  │   Firecrawl   │  │   OpenAI /    │
   │  (Drizzle)    │  │   API         │  │   Forge LLM   │
   └───────────────┘  └───────────────┘  └───────────────┘
```

## Core Workflow

### 1. Product Import
- Merchant connects Shopify store via OAuth
- Products synced via Shopify Admin API (`shopify.syncProducts`)
- Stored in `products` table with title, SKU, GTIN, vendor, price

### 2. Automated Competitor Discovery
- Triggered manually via `intelligence.discoverCompetitors` or daily cron
- Uses SerpAPI (primary) or Firecrawl search (fallback)
- Generates localized search queries per product
- Deduplicates URLs against known domains
- Scores confidence based on title overlap, brand match, position
- Stores candidates in `competitor_discoveries` table

### 3. Intelligent Scraping Layer
- **Primary**: Firecrawl API — handles JS-heavy sites, Cloudflare
- **Fallback**: Playwright — full JS rendering, human-like navigation
- Scraper adapter pattern for extensibility
- Retry logic with exponential backoff

### 4. Single AI Validation + Extraction Call
- One LLM call per competitor page performs ALL tasks:
  - **Product Match Validation**: Brand, model, SKU, storage, color, size
  - **Price Extraction**: Current, sale, original price + currency
  - **Description Extraction**: Title, description, key features
  - **Structured Output**: Strict JSON with confidence scores
- JSON schema validation enforced
- Results stored in `ai_extractions` table

### 5. Price Monitoring Engine
- Hourly cron job (`price_monitor`)
- For each active competitor-product match:
  1. Scrape page (Firecrawl)
  2. Run AI extraction
  3. Compare against latest snapshot
  4. Detect changes (price increase/decrease, OOS, promotion)
  5. Store immutable snapshot
  6. Generate timeline event
  7. Create alert for significant changes (>2%)

### 6. Activity Timeline
- Generated automatically from price change events
- Stored in `activity_logs` table
- Paginated API endpoint
- Examples: "Amazon lowered price from $699 to $679 (3.2% decrease)"

### 7. Confidence & Quality System
- **Search confidence**: Based on search result position
- **AI confidence**: Overall extraction confidence (0-1)
- **SKU match confidence**: Exact SKU/barcode match
- **Title similarity**: Word overlap between titles
- **Variant similarity**: Color/size/storage match
- **Default threshold**: 0.85 — matches below are rejected

## Database Schema (Key Tables)

| Table | Purpose |
|-------|---------|
| `products` | Merchant's products |
| `competitors` | Known competitor stores |
| `competitor_products` | Matched competitor products |
| `competitor_discoveries` | Search-discovered candidate URLs |
| `ai_extractions` | AI validation + extraction results |
| `price_snapshots` | Immutable price history |
| `price_changes` | Detected change events |
| `scrape_logs` | Per-URL scrape attempt logs |
| `cron_runs` | Monitoring job tracking |
| `activity_logs` | Merchant-facing timeline events |
| `alerts` | Price change alerts |

## API Endpoints (tRPC)

### Intelligence Router
| Endpoint | Type | Description |
|----------|------|-------------|
| `intelligence.discoverCompetitors` | mutation | Discover competitors for a product |
| `intelligence.discoverAllProducts` | mutation | Discover for all tracked products |
| `intelligence.getDiscoveries` | query | List discovered candidates |
| `intelligence.approveDiscovery` | mutation | Approve a discovery |
| `intelligence.rejectDiscovery` | mutation | Reject a discovery |
| `intelligence.importDiscoveryAsCompetitor` | mutation | Import as tracked competitor |
| `intelligence.extractFromUrl` | mutation | AI extract from any URL |
| `intelligence.getExtractions` | query | List AI extractions |
| `intelligence.runMonitoring` | mutation | Trigger price monitoring run |
| `intelligence.getPriceChanges` | query | List detected price changes |
| `intelligence.getTimeline` | query | Get activity timeline |
| `intelligence.getCronRuns` | query | List monitoring job runs |
| `intelligence.getCronStatus` | query | Get scheduler status |
| `intelligence.getSnapshotHistory` | query | Get price snapshot history |
| `intelligence.scrapeAndExtract` | mutation | Scrape + AI extract combined |

## Deployment

### Docker Compose
```bash
docker-compose up -d
```

### Manual
```bash
pnpm install
pnpm db:push        # Run migrations
pnpm db:seed        # Seed data (optional)
pnpm dev            # Development
pnpm build && pnpm start  # Production
```

## Scalability Considerations

- **Concurrent scraping**: Semaphore-controlled (default 5)
- **Cron jobs**: In-process with overlap prevention
- **Database**: Indexed for analytics queries on product_id, competitor_id, created_at
- **Snapshots**: Immutable — never overwritten, only appended
- **AI costs**: Single call per page, structured output minimizes tokens
- **Future**: Can be extended to use BullMQ + Redis for distributed workers
