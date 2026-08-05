# Version 1.0 Release Plan

**Role:** Release Manager  
**Review date:** 2026-08-05  
**Release:** PriceVision 1.0 public paid Shopify application  
**Decision:** **HOLD** until every P0/P1 item below has an owner, evidence, and
staging verification.

This is the execution tracker for the [launch readiness checklist](LAUNCH-READINESS-CHECKLIST.md).
It deliberately separates repository work from external account, legal, and
operational work. No legal, billing, or production evidence is inferred.

## Status legend

- **CLOSED** — repository evidence or a repeatable command proves completion.
- **READY** — implementation exists; external verification is still required.
- **OPEN** — action is required before release.
- **BLOCKED** — cannot close without an external owner, account, decision, or
  staging environment.

## Release gates

| ID      | Blocker / gate                                                         | Primary type                 | Status  | Owner                     | Closure evidence                                                                                    |
| ------- | ---------------------------------------------------------------------- | ---------------------------- | ------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| RLS-001 | Shopify public billing uses Shopify App Pricing/Billing API            | Business + code              | OPEN    | Product/Engineering       | Approved plans, billing adapter, upgrade/downgrade/cancel tests, Partner Dashboard evidence         |
| RLS-002 | Production Shopify installation and OAuth URLs                         | Infrastructure + code        | OPEN    | Engineering/DevOps        | HTTPS app URL, Shopify-owned install, callback and reinstall test                                   |
| RLS-003 | Terms of Service                                                       | Legal                        | BLOCKED | Legal owner               | Approved public URL linked from listing and account surfaces                                        |
| RLS-004 | Privacy Policy                                                         | Legal/privacy                | BLOCKED | Legal owner               | Approved policy URL and Shopify listing configuration                                               |
| RLS-005 | Billing, refund, tax, trial, and cancellation language                 | Business + legal             | BLOCKED | Founder/Finance/Legal     | Approved pricing and customer-facing policy                                                         |
| RLS-006 | Data retention and deletion schedule                                   | Privacy/compliance           | BLOCKED | Privacy owner             | Retention matrix, deletion/export SOP, evidence of execution                                        |
| RLS-007 | Processor inventory and DPAs                                           | Legal/privacy                | BLOCKED | Privacy owner             | Approved subprocessor list and DPAs                                                                 |
| RLS-008 | GDPR/CPRA data-subject operating process                               | Compliance + operational     | BLOCKED | Privacy/support owner     | Intake, identity verification, SLA, deletion/export evidence                                        |
| RLS-009 | PostgreSQL backups and restore drill                                   | Infrastructure + operational | OPEN    | DevOps                    | Provider backup policy, successful restore to isolated staging, recorded RTO/RPO                    |
| RLS-010 | Database-backed test suite and migrations                              | Infrastructure               | OPEN    | Engineering/DevOps        | CI PostgreSQL job green; staging migration log; no local `Database connection unavailable` failures |
| RLS-011 | Accessibility release evidence                                         | Quality + operational        | OPEN    | Product/QA                | WCAG 2.2 AA keyboard, screen-reader, contrast, zoom, and reduced-motion report                      |
| RLS-012 | Error tracking and durable metrics                                     | Infrastructure + operational | OPEN    | DevOps                    | Privacy-reviewed provider, alerts, retained events, dashboard, SLO baseline                         |
| RLS-013 | Incident response and support ownership                                | Operational/business         | BLOCKED | Founder/Support           | Support inbox, severity policy, on-call rota, escalation test                                       |
| RLS-014 | Shopify compliance webhooks and protected-data review                  | Compliance + external        | READY   | Engineering/Shopify owner | Shopify delivery logs for all topics and Partner Dashboard review result                            |
| RLS-015 | Queue retry, dead-letter, and restart recovery                         | Infrastructure + operational | READY   | Engineering/DevOps        | Redis/BullMQ staging drill with retry and worker restart evidence                                   |
| RLS-016 | OAuth, product sync, alerts, billing, and uninstall acceptance test    | Functionality + operational  | READY   | QA/Product                | Signed acceptance run on a fresh development store                                                  |
| RLS-017 | Rollback and release approval process                                  | Infrastructure + operational | OPEN    | Release Manager/DevOps    | Previous image identified, migration recovery tested, go/no-go record                               |
| RLS-018 | Shopify review/support contact                                         | Operational/business         | BLOCKED | Founder                   | Partner Dashboard contact and monitored emergency inbox                                             |
| RLS-019 | Docker copies a non-existent client build path                         | Code + infrastructure        | CLOSED  | Engineering               | Vite output and production static path verified; invalid Docker `COPY` removed                      |
| RLS-020 | Docker installs patched dependencies without the patch files           | Code + infrastructure        | CLOSED  | Engineering               | `patches/` copied before builder and production installs                                            |
| RLS-021 | Docker build context includes secrets and unrelated artifacts          | Security + infrastructure    | CLOSED  | Engineering               | `.dockerignore` excludes `.env`, dependencies, outputs, and large generated artifacts               |
| RLS-022 | Production client build can embed auth bypass                          | Code + security              | CLOSED  | Engineering               | Vite production config rejects `VITE_BYPASS_AUTH=true` at build time                                |
| RLS-023 | Active backend/deployment documentation describes retired architecture | Operational                  | CLOSED  | Engineering               | Stale backend guide is explicitly retired; architecture guide reflects current BullMQ/Redis workers |
| RLS-024 | Deprecated seed source contains hardcoded development credentials      | Code + security              | CLOSED  | Engineering               | Unreferenced `drizzle/seed.ts` removed; supported seed is `server/seed.ts`                          |
| RLS-025 | Production container image build is not verified by CI                 | Infrastructure + operational | OPEN    | Engineering/DevOps        | CI container job added; GitHub run must complete successfully before closure                        |
| RLS-026 | Unreferenced production-copied utility contains a hardcoded DB secret  | Code + security              | CLOSED  | Engineering               | Unused `server/trim-products.ts` removed; no supported script references it                         |
| RLS-027 | Docker healthcheck probes a non-existent tRPC route                    | Code + infrastructure        | CLOSED  | Engineering               | Healthcheck now probes the implemented `/health/live` endpoint                                      |
| RLS-028 | Docker copy destination hides package manifests from pnpm              | Code + infrastructure        | CLOSED  | Engineering               | Dockerfile copies manifests to `/app` and patches to `/app/patches` before both installs            |

## Repository work completed in this release pass

- Production startup now fails if Redis is absent or `QUEUE_MODE` is not `redis`.
- Production startup now fails if explicit HTTPS `ALLOWED_ORIGINS` are absent;
  CORS consumes the validated configuration.
- Added `pnpm release:preflight` and a `--public` mode that refuses to pass until
  Shopify billing readiness is explicitly confirmed.
- Added `scripts/backup-postgres.ps1` for a pre-migration custom-format backup.
- Removed the invalid Docker copy of `/app/client/dist`; the production image
  already receives the Vite output at `/app/dist/public`.
- Copied the tracked pnpm patch directory before both Docker dependency
  installs, and added `.dockerignore` to keep secrets and generated artifacts
  out of the build context.
- Added a Vite production-build guard so `VITE_BYPASS_AUTH=true` cannot be
  embedded in the client bundle.
- Removed the deprecated credential-bearing `drizzle/seed.ts` source; the
  supported seed entry point remains `server/seed.ts`.
- Retired the stale backend runbook, corrected the architecture worker status,
  and added a CI container build gate.
- Removed the unreferenced `server/trim-products.ts` utility, which contained a
  hardcoded database password and destructive ad-hoc SQL.
- Corrected the Docker healthcheck to use the implemented liveness endpoint.
- Corrected Docker `COPY` destinations so package manifests are available to
  both dependency-install stages.

### Current audit verification

- `pnpm format:check`, `pnpm check`, `pnpm lint`, `pnpm build`, and
  `pnpm audit --audit-level=high` pass.
- `pnpm test` currently reports 69 passing and 15 failing tests. All 15
  failures are database-backed product tests that cannot initialize because the
  current shell does not provide a test `DATABASE_URL`; CI defines a disposable
  PostgreSQL service and must provide the authoritative green run.
- Docker is not installed in the current audit environment, so the container
  job and image build remain unverified until a CI or DevOps runner executes it.
- CI, package/runtime requirements, migrations, smoke checks, signed Shopify
  webhooks, dependency gates, and launch documentation are already in place.

## Exact repository verification sequence

Run from a clean checkout with the deployment secret manager attached:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm lint
pnpm format:check
pnpm audit --audit-level=high
pnpm test
pnpm run build
docker build --tag pricevision:<commit-sha> .
pnpm release:preflight -- --public
pnpm db:migrate
.\scripts\backup-postgres.ps1 -OutputDirectory .\release-backups
$env:SMOKE_BASE_URL = "https://app.example.com"
pnpm smoke
```

Never run `pnpm db:push` against production. Never run seed scripts against a
production database.

## Manual closure runbooks

### RLS-001 — Shopify billing

1. Decide the plan names, prices, trial length, taxes, refunds, and cancellation
   policy with the founder/finance owner.
2. In Shopify Partner Dashboard, configure public App Pricing or implement the
   Shopify Billing API flow. Do not submit the public app with Stripe-only
   billing.
3. Add the provider adapter behind the existing billing/entitlement boundary;
   preserve idempotent event handling and tenant plan enforcement.
4. Create a development-store test matrix: trial start, successful conversion,
   upgrade, downgrade, failed payment, cancellation, reinstall, and webhook
   replay.
5. Set `BILLING_REQUIRED=true`, `BILLING_PROVIDER=shopify`, and
   `SHOPIFY_BILLING_READY=true` only after the matrix is green.
6. Run `pnpm release:preflight -- --public` and attach the test results.

### RLS-002 — Production Shopify installation

1. Provision the final HTTPS application and API URLs.
2. Update `shopify.app.toml` with the production `application_url` and callback
   URL; remove localhost values and `use_legacy_install_flow = true`.
3. Configure the same URLs in Partner Dashboard and deploy the exact commit.
4. Start installation from a Shopify-owned surface, install into a development
   store, complete OAuth, refresh the app, uninstall, and reinstall.
5. Confirm only `read_products` is granted and product synchronization works.

### RLS-003–RLS-008 — Legal, privacy, and compliance

1. Legal owner completes `docs/LEGAL-PRIVACY-INPUTS.md`.
2. Publish approved Terms and Privacy Policy URLs.
3. Create a data inventory covering account data, Shopify metadata, products,
   competitor data, analytics, logs, billing identifiers, and provider data.
4. Assign retention periods and deletion/export procedures for each category.
5. Review Shopify, hosting, PostgreSQL, Redis, billing, scraping, search, AI,
   SMTP, and monitoring providers; execute required DPAs.
6. Test a data-subject request and shop redaction in staging; record request,
   verification, deletion, and completion timestamps.
7. Complete Shopify protected-customer-data review and compliance webhook checks.

### RLS-009–RLS-010 — Database and deployment

1. Provision managed PostgreSQL and Redis in the target region.
2. Enable encrypted backups, point-in-time recovery, retention, and alerting.
3. Run `scripts/backup-postgres.ps1` before the first staging migration.
4. Restore the backup into an isolated database, run `pnpm db:migrate`, and
   verify the application and worker against the restored database.
5. Run CI with PostgreSQL, then run the same migration and smoke sequence in
   staging. Record the migration identifier and backup identifier.

### RLS-011–RLS-013 — QA, monitoring, and support

1. Run keyboard-only, screen-reader, contrast, 200% zoom, and reduced-motion
   checks on authentication, onboarding, dashboard, products, competitors,
   analytics, alerts, and settings.
2. Configure a privacy-reviewed error tracker and metrics backend. Alert on
   readiness failure, 5xx rate, p95 latency, queue depth, dead letters, scrape
   failure rate, billing failures, database exhaustion, and backup failures.
3. Publish a monitored support inbox and merchant FAQ.
4. Assign incident severity, response targets, escalation contacts, and an
   on-call owner. Perform one notification drill.

### RLS-014–RLS-018 — Final acceptance and go/no-go

1. Trigger `app/uninstalled`, `customers/data_request`, `customers/redact`, and
   `shop/redact` with signed Shopify deliveries; verify status and data effects.
2. Force a worker failure, observe retry/dead-letter behavior, restart the
   worker, and confirm recovery without duplicate processing.
3. Execute the fresh-store acceptance test for OAuth, sync, monitoring, alert,
   recommendation, billing, uninstall, and reinstall.
4. Deploy the candidate web and worker images, run smoke checks, and confirm
   dashboards and alerts.
5. Record rollback image, migration state, backup, approvers, and go/no-go time.
6. Set each tracker row to `CLOSED` only when the evidence link exists.

## Go/no-go rule

Release is approved only when every row is `CLOSED`, the public preflight passes,
CI is green, staging acceptance is signed, and the legal/business owner has
approved the public terms, privacy, pricing, and support commitments.
