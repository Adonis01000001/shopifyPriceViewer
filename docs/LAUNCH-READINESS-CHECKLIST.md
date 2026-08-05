# Version 1.0 Launch Readiness Checklist

**Review date:** 2026-08-05  
**Scope:** PriceVision Node/React/PostgreSQL/Redis Shopify application  
**Verdict:** **NOT READY FOR PUBLIC PAID RELEASE** until the explicit blockers
below are closed in a real staging environment and by the legal/business owner.

## Status legend

- **Complete** — verified in source and/or by a repeatable command.
- **Conditional** — implemented, but requires staging/provider verification.
- **Blocker** — missing or impossible to verify without production, legal, or
  business input.

## Local verification snapshot

| Gate                                     | Result               | Evidence / limitation                                                                                                                                   |
| ---------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                               | Pass                 | `pnpm check` completed successfully                                                                                                                     |
| Lint                                     | Pass with warnings   | `pnpm lint`: 0 errors, 36 existing warnings                                                                                                             |
| Focused regression tests                 | Pass                 | 3 files, 6 tests passed                                                                                                                                 |
| Full test suite                          | Conditional          | 69 passed; 15 product-service tests could not acquire the configured database connection                                                                |
| Formatting                               | Pass                 | `pnpm format:check` passed for release-controlled files; repository-wide check is not used because it includes unrelated generated and historical files |
| Dependency audit                         | Pass with advisories | `pnpm audit --audit-level=high`: 0 high, 8 low, 22 moderate                                                                                             |
| Production build                         | Pass with warning    | Web/API/worker artifacts built; client main chunk is 397 KB gzip                                                                                        |
| Production preflight                     | Pass                 | Synthetic production environment passed `node scripts/release-preflight.mjs`                                                                            |
| Public release preflight                 | Expected block       | Correctly blocks until Shopify billing provider and staging readiness are confirmed                                                                     |
| Database migration, smoke, accessibility | Not verified         | Requires a staging URL, deployment credentials, and a configured test database                                                                          |

## Checklist

### Functionality

| Item                                              | Status      | Evidence / verification                                              | Required action                                                                  |
| ------------------------------------------------- | ----------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Authentication, sessions, refresh tokens          | Complete    | Existing auth tests, `pnpm check`                                    | Re-run in staging with real cookies                                              |
| Shopify OAuth and product sync                    | Conditional | OAuth, HMAC, ownership checks, and sync code exist                   | Complete a real development-store install and resync test                        |
| Competitor monitoring, alerts, recommendations    | Conditional | Service and router tests exist; local DB-backed suite is unavailable | Run the full CI test job with PostgreSQL                                         |
| Billing and entitlements                          | Conditional | Stripe checkout/webhook/plan enforcement exists                      | Configure test provider IDs and verify upgrade, downgrade, failure, cancellation |
| Shopify App Store billing                         | Blocker     | Current commercial provider is Stripe                                | Migrate public distribution to Shopify App Pricing or Shopify Billing API        |
| Onboarding activation flow                        | Complete    | Resumable checklist, dashboard CTA, build/typecheck pass             | Verify with a fresh store in under five minutes                                  |
| Shopify uninstall and compliance webhook handling | Conditional | Signed endpoint in `server/_core/shopify-webhooks.ts`                | Trigger every topic with Shopify CLI and verify database effects                 |

### Reliability

| Item                       | Status      | Evidence / verification                                                          | Required action                                            |
| -------------------------- | ----------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Liveness endpoint          | Complete    | `/health/live`, `/healthz` implemented                                           | Add external uptime check                                  |
| Readiness endpoint         | Complete    | `/health/ready` checks PostgreSQL and Redis                                      | Verify 503 behavior during dependency outage               |
| Graceful shutdown          | Complete    | SIGTERM/SIGINT closes scheduler, queue, HTTP, DB                                 | Run container termination drill                            |
| Durable queues and retries | Conditional | BullMQ/Redis worker architecture exists; production now fails fast without Redis | Verify retry, dead-letter, and restart recovery in staging |
| Database migrations        | Complete    | `pnpm db:migrate`; CI applies committed migrations                               | Run forward migration on a restored staging copy           |
| Backups and restore        | Blocker     | Existing docs did not describe PostgreSQL restore                                | Configure provider backups and complete a restore drill    |

### Security

| Item                           | Status   | Evidence / verification                                                                   | Required action                                           |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Production secret validation   | Complete | `server/_core/env.ts` and `pnpm release:preflight` reject missing/weak production secrets | Validate actual deployment environment                    |
| HTTP headers and CORS          | Complete | Helmet and production origin restriction configured                                       | Verify headers with an external scan                      |
| CSRF and rate limiting         | Complete | Express/tRPC CSRF and route limiters exist                                                | Load-test auth, OAuth, scraping, and webhook paths        |
| Tenant ownership checks        | Complete | Protected routers/services scope by user                                                  | Add staging authorization regression tests for new routes |
| Shopify token encryption       | Complete | PBKDF2-derived key and encrypted storage exist                                            | Rotate production salt/key under a runbook                |
| Dependency high-severity gate  | Complete | `pnpm audit --audit-level=high` passes with zero high findings                            | Review remaining 30 low/moderate advisories monthly       |
| Least-privilege Shopify scopes | Complete | Configuration reduced to `read_products`                                                  | Reinstall and confirm granted scopes                      |
| Seed/test credentials          | Complete | Hardcoded `admin123` removed; env credentials required                                    | Never run seed scripts against production                 |

### UX

| Item                         | Status      | Evidence / verification                                 | Required action                            |
| ---------------------------- | ----------- | ------------------------------------------------------- | ------------------------------------------ |
| First-value onboarding       | Complete    | Three-step resumable checklist and clear CTA            | Fresh-store usability test                 |
| Dashboard action hierarchy   | Complete    | Next-best-action panel appears before secondary metrics | Validate with five merchant tasks          |
| Loading, empty, error states | Conditional | Skeletons, toasts, and empty states exist               | Test every route with failed API responses |
| Mobile layout                | Conditional | Responsive layouts exist                                | Verify at 375px, 768px, and desktop widths |
| Upgrade messaging            | Conditional | Contextual upgrade prompt and billing anchor exist      | Verify checkout and plan limits end-to-end |

### Accessibility

| Item                                  | Status      | Evidence / verification                                       | Required action                                    |
| ------------------------------------- | ----------- | ------------------------------------------------------------- | -------------------------------------------------- |
| Semantic labels and form associations | Conditional | Auth and settings use labels; broad route audit not automated | Complete keyboard and screen-reader pass           |
| Keyboard navigation and focus states  | Blocker     | No automated accessibility test or manual evidence committed  | Run WCAG 2.2 AA keyboard review                    |
| Color contrast and non-color status   | Blocker     | No contrast report committed                                  | Run axe/Lighthouse/contrast audit and fix failures |
| Reduced motion and 200% zoom          | Conditional | No release evidence                                           | Verify reduced-motion behavior and zoom            |

### Performance

| Item                                 | Status      | Evidence / verification                            | Required action                                    |
| ------------------------------------ | ----------- | -------------------------------------------------- | -------------------------------------------------- |
| Production build                     | Complete    | `pnpm run build` passes                            | Publish only generated artifacts                   |
| Database indexes and bounded queries | Conditional | Tenant/time indexes exist                          | Capture p95 queries on staging data volume         |
| Frontend bundle size                 | Conditional | Build warns about roughly 397 kB gzip shared chunk | Track with RUM; split only if measured need exists |
| Scraping limits                      | Conditional | Environment limits and worker concurrency exist    | Load-test provider quotas and plan limits          |

### Legal

| Item                              | Status  | Evidence / verification                                        | Required action                                                |
| --------------------------------- | ------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| Terms of service                  | Blocker | No approved terms present                                      | Legal owner must provide and publish terms                     |
| Privacy policy                    | Blocker | No approved privacy policy present                             | Publish and link it from the App Store listing                 |
| Billing/refund/cancellation terms | Blocker | Runtime behavior exists; approved commercial language does not | Approve pricing, trial, refund, tax, and cancellation language |
| Support and emergency contact     | Blocker | No production contact configured                               | Assign monitored support and emergency contacts                |

### Privacy

| Item                             | Status      | Evidence / verification                                                 | Required action                                                           |
| -------------------------------- | ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Compliance webhook configuration | Conditional | TOML and signed endpoint added                                          | Deploy and trigger all three topics                                       |
| Customer-data minimization       | Complete    | App no longer requests order scope or stores customer records           | Confirm production scopes after reinstall                                 |
| Shop redaction                   | Conditional | Store-scoped products are deleted and token removed                     | Resolve remaining user-scoped data retention policy                       |
| Data retention schedule          | Blocker     | No approved schedule exists                                             | Define retention for analytics, prices, scrape artifacts, and logs        |
| Processor inventory              | Blocker     | External providers are used but no approved inventory/DPA record exists | Review Shopify, Stripe, scraping, search, AI, SMTP, and hosting providers |

### Compliance

| Item                           | Status      | Evidence / verification                                          | Required action                                                |
| ------------------------------ | ----------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Shopify compliance webhooks    | Conditional | Required topics declared in `shopify.app.toml`                   | Pass Shopify automated checks                                  |
| Shopify install flow           | Blocker     | Current flow asks for a shop domain and uses local/legacy config | Implement Shopify-owned installation and production OAuth URLs |
| Shopify public billing         | Blocker     | Stripe is current provider                                       | Implement Shopify App Pricing/Billing API                      |
| Protected customer data review | Conditional | Access scopes reduced to products                                | Confirm opt-out in Partner Dashboard                           |
| GDPR/CPRA operating process    | Blocker     | No approved data-subject process exists                          | Assign owner, SLA, deletion/export evidence, and legal review  |

### Documentation

| Item                           | Status      | Evidence / verification                                  | Required action                  |
| ------------------------------ | ----------- | -------------------------------------------------------- | -------------------------------- |
| Architecture/API documentation | Complete    | `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/BACKEND.md` | Keep synchronized                |
| Environment reference          | Conditional | `docs/ENVIRONMENT.md` exists                             | Add production secret ownership  |
| Deployment runbook             | Complete    | `docs/RELEASE-DEPLOYMENT.md` added                       | Review with operator and test it |
| Launch checklist               | Complete    | This document                                            | Update after staging evidence    |
| Legal/privacy input inventory  | Complete    | `docs/LEGAL-PRIVACY-INPUTS.md` added                     | Complete with legal owner        |

### Deployment

| Item                      | Status      | Evidence / verification                                                                                    | Required action                                      |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Frozen lockfile install   | Conditional | Local `pnpm install --frozen-lockfile --ignore-scripts` passed after releasing a project-process file lock | Verify on a clean CI runner                          |
| Docker non-root runtime   | Complete    | Dockerfile uses Node 22 Alpine and `appuser`                                                               | Build/run image in staging                           |
| Web and worker separation | Complete    | `dist/index.js` and `dist/worker.js` build separately                                                      | Deploy both with restart policies                    |
| Production URLs/secrets   | Blocker     | TOML still contains localhost configuration                                                                | Set production URLs, contacts, and secrets           |
| Rollback process          | Blocker     | No tested PostgreSQL rollback procedure                                                                    | Define previous image and migration recovery process |

### Monitoring

| Item                        | Status      | Evidence / verification                 | Required action                                                        |
| --------------------------- | ----------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Structured logs/request IDs | Complete    | Pino and request-ID middleware exist    | Ship logs to retained production sink                                  |
| Health monitoring           | Conditional | Health endpoints and `pnpm smoke` exist | Configure uptime/readiness alerts                                      |
| Error tracking              | Blocker     | No external tracker configured          | Select/configure provider with privacy review                          |
| Metrics/SLOs                | Blocker     | No long-term metrics backend exists     | Track availability, p95, queue depth, scrape success, billing failures |
| Incident response           | Blocker     | No on-call/runbook owner exists         | Assign severity policy, escalation, and postmortem process             |

### Support

| Item                           | Status      | Evidence / verification                           | Required action                                      |
| ------------------------------ | ----------- | ------------------------------------------------- | ---------------------------------------------------- |
| Support channel                | Blocker     | No production support address configured          | Publish monitored support channel                    |
| Merchant troubleshooting guide | Conditional | Setup/deployment docs exist; end-user FAQ is thin | Add merchant FAQ and known limitations               |
| Billing support workflow       | Conditional | Stripe portal/cancel flow exists                  | Define failed-payment, refund, and dispute ownership |
| Shopify review contact         | Blocker     | No emergency/API contact configured in repo       | Set Partner Dashboard contacts and inbox monitoring  |

## Verification commands

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm format:check
pnpm audit --audit-level=high
pnpm db:migrate
pnpm test
pnpm run build
SMOKE_BASE_URL=https://staging.example.com pnpm smoke
```

## Release decision

Do not submit to the Shopify App Store or enable paid production traffic until
all **Blocker** items have owner/date/evidence and conditional provider tests have
passed. Shopify requires public apps to use Shopify-provided billing, subscribe
to compliance webhooks, request only necessary scopes, and provide a privacy
policy.

- [Shopify App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
- [Shopify privacy-law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
- [Shopify privacy requirements](https://shopify.dev/docs/apps/launch/privacy-requirements)
