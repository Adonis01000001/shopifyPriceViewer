# Environment Configuration Reference

## Required Variables

| Variable              | Description                               | Example                                                                              |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `NODE_ENV`            | Environment mode                          | `development` or `production`                                                        |
| `PORT`                | Server port                               | `3000`                                                                               |
| `DATABASE_URL`        | PostgreSQL connection string              | `postgresql://user:pass@host:5432/dbname`                                            |
| `JWT_SECRET`          | JWT signing secret (min 32 chars in prod) | Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `ENCRYPTION_KEY_SALT` | PBKDF2 salt for token encryption          | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

## Scraping

| Variable                 | Description                         | Default                     |
| ------------------------ | ----------------------------------- | --------------------------- |
| `FIRECRAWL_API_KEY`      | Firecrawl API key. Used only when Jina Reader fails; Jina is free and needs no key | —      |
| `FIRECRAWL_BASE_URL`     | Firecrawl API URL                   | `https://api.firecrawl.dev` |
| `MAX_CONCURRENT_SCRAPES` | Max parallel scrape jobs            | `5`                         |

## Finding competitors

| Variable         | Description                                          | Default |
| ---------------- | ---------------------------------------------------- | ------- |
| `SERPER_API_KEY` | Serper key. Cheaper, and preferred when both are set. | —       |
| `SERP_API_KEY`   | SerpAPI key.                                          | —       |

Without one of these the daily run finds nothing: there is no free fallback
for search.

## AI Extraction

| Variable                     | Description              | Default       |
| ---------------------------- | ------------------------ | ------------- |
| `OPENROUTER_API_KEY`         | The key the pipeline actually uses                       | —             |
| `OPENROUTER_BASE_URL`        | OpenRouter endpoint                                      | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL`           | Model to try first                                       | —             |
| `OPENROUTER_MODELS`          | Comma-separated fallback list. Free models share an upstream pool and 429 often, so the call rotates through these | — |
| `OPENAI_API_KEY`             | OpenAI key, for the paths that use it directly           | —             |
| `OPENAI_MODEL`               | Model for those                                          | `gpt-4o-mini` |
| `MATCH_CONFIDENCE_THRESHOLD` | Below this, a match is rejected. Lower matches more shops and admits more wrong ones | `0.85` |

## Price Monitoring

| Variable                    | Description                   | Default |
| --------------------------- | ----------------------------- | ------- |
| `MONITORING_INTERVAL_HOURS` | Hours between price re-reads. This re-reads pages already matched; it does not search again | `1` |

## Shopify Integration

| Variable             | Description                 |
| -------------------- | --------------------------- |
| `SHOPIFY_API_KEY`    | Shopify app API key         |
| `SHOPIFY_API_SECRET` | Shopify app API secret      |
| `SHOPIFY_APP_URL`    | App URL for OAuth callbacks |
| `SHOPIFY_SCOPES`     | OAuth scopes                |

## Production

| Variable          | Description                          |
| ----------------- | ------------------------------------ |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |
| `REDIS_URL`       | Redis connection string. Without it the queue runs inline in the same process, which is what you want locally |
| `QUEUE_MODE`      | `inline` or `redis`. Defaults to `redis` when `REDIS_URL` is set |
| `BILLING_REQUIRED`| Whether a plan is enforced |
