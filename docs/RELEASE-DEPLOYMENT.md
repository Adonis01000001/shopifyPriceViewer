# Version 1.0 Deployment Runbook

This is the current deployment guide for the Node/PostgreSQL/Redis application.
The older `docs/DEPLOYMENT.md` and `SETUP.md` files describe a retired Python,
SQL Server, and Celery architecture and are retained only for historical context.

## Production components

- Web/API: `node dist/index.js`
- Worker: `node dist/worker.js`
- PostgreSQL 16 or compatible managed PostgreSQL
- Redis 7 or compatible managed Redis
- TLS termination at the hosting provider or reverse proxy

## Release sequence

1. Build from the exact commit and verify `pnpm install --frozen-lockfile`.
2. Run `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and
   `pnpm run build`.
3. Build the release image from the same commit with
   `docker build --tag pricevision:<commit-sha> .`; retain the image digest.
4. Back up PostgreSQL and record the backup identifier.
5. Run `pnpm db:migrate` against the release database.
6. Deploy web and worker images from the same build.
7. Wait for `/health/ready` to return 200.
8. In PowerShell, set `$env:SMOKE_BASE_URL="https://app.example.com"`, then run
   `pnpm smoke`.
9. Verify OAuth, product sync, one competitor scan, one alert, and billing in
   staging before production rollout.

Never use `pnpm db:push` against production. Production uses committed migrations
only.

## Required production configuration

Set values through the hosting secret manager, not a committed `.env` file:

- `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`
- `JWT_SECRET`, `ENCRYPTION_KEY_SALT`
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `APP_URL`
- `SHOPIFY_SCOPES=read_products`, `ALLOWED_ORIGINS`, `QUEUE_MODE=redis`
- Billing provider credentials and plan IDs
- External scraping, AI, and SMTP credentials required by enabled features

Production startup rejects missing database, Shopify, HTTPS, and cryptographic
configuration. Billing must be configured before enabling paid traffic.

## Rollback

- Application-only failure: redeploy the previous image when backward compatible.
- Migration failure: stop rollout, preserve logs, restore to a staging clone, and
  use the database provider’s point-in-time restore process. Do not run ad-hoc
  destructive SQL in production.
- Queue failure: restore Redis/worker capacity before accepting scraping traffic.

## Monitoring and incident response

Alert on liveness/readiness failure, HTTP 5xx rate, p95 latency, queue depth,
dead-letter jobs, scrape failures, billing webhook failures, database exhaustion,
and backup failures. Every Sev-1/Sev-2 incident needs an owner, customer
communication decision, and a blameless postmortem.
