# Environment Configuration Reference

## Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` or `production` |
| `PORT` | Server port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/dbname` |
| `JWT_SECRET` | JWT signing secret (min 32 chars in prod) | Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `ENCRYPTION_KEY_SALT` | PBKDF2 salt for token encryption | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

## Scraping

| Variable | Description | Default |
|----------|-------------|---------|
| `FIRECRAWL_API_KEY` | Firecrawl API key (primary scraper) | — |
| `FIRECRAWL_BASE_URL` | Firecrawl API URL | `https://api.firecrawl.dev` |
| `MAX_CONCURRENT_SCRAPES` | Max parallel scrape jobs | `5` |

## Competitor Discovery

| Variable | Description | Default |
|----------|-------------|---------|
| `SERP_API_KEY` | SerpAPI key for Google Shopping search | Falls back to Firecrawl search |

## AI Extraction

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | — |
| `OPENAI_MODEL` | Model for extraction | `gpt-4o-mini` |
| `MATCH_CONFIDENCE_THRESHOLD` | Minimum match confidence | `0.85` |

## Price Monitoring

| Variable | Description | Default |
|----------|-------------|---------|
| `MONITORING_INTERVAL_HOURS` | Hours between monitoring runs | `1` |

## Shopify Integration

| Variable | Description |
|----------|-------------|
| `SHOPIFY_API_KEY` | Shopify app API key |
| `SHOPIFY_API_SECRET` | Shopify app API secret |
| `SHOPIFY_APP_URL` | App URL for OAuth callbacks |
| `SHOPIFY_SCOPES` | OAuth scopes |

## Production

| Variable | Description |
|----------|-------------|
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |
| `REDIS_URL` | Redis connection string |
