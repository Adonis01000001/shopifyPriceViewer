# Phase 4 — Commercial SaaS Launch Readiness

> **Historical record, 2026-08.** Kept as written. Price Radar and the
> competitor-discovery service it refers to have since been removed.

Date: 2026-08-05

## Executive outcome

The application now has a revenue-safe billing boundary, reusable tenant
entitlements, durable Redis/BullMQ processing, persisted report and delivery
history, and a separate worker deployment target. Existing inline processing
remains available when `QUEUE_MODE=inline`.

## Implemented architecture

```text
Merchant
  -> tRPC billing procedures
  -> Stripe Checkout / Billing Portal
  -> verified /api/billing/webhook (raw body)
  -> billing_events idempotency ledger
  -> subscriptions tenant state
  -> shared plan catalog + server entitlement checks

Scheduler
  -> Redis lock
  -> BullMQ queues
  -> worker process
  -> monitoring / discovery / report email services
```

### Billing

- Stripe Checkout creates subscription sessions with application user and plan
  metadata.
- Billing Portal handles payment method changes and customer self-service.
- Plan changes use Stripe subscription item replacement with prorations.
- Cancellation supports cancel-at-period-end and reversal.
- `customer.subscription.*`, `checkout.session.completed`,
  `invoice.payment_failed`, and `invoice.paid` synchronize the provider-neutral
  `subscriptions` record.
- `billing_events.stripe_event_id` is unique. Processed events are ignored on
  retry; failed events can be replayed safely.
- Webhook requests are verified against the exact raw request body before JSON
  parsing.

### Plans and entitlements

All plan limits and feature flags live in `shared/plans.ts`. Server checks are
centralized in `server/services/entitlement.service.ts`.

- Resource limits: products, competitors, Price Radar sources, monthly changes.
- Monthly quotas: alerts and AI recommendation runs.
- Feature gates: email alerts, advanced analytics, AI recommendations, Price
  Radar, daily reports, anomaly detection, and team access.
- Enforced boundaries: product creation, competitor creation/import, Price Radar
  source creation, AI recommendation generation, portfolio analytics, and
  scheduled reports.

### Background processing

- `price-monitoring`, `competitor-discovery`, `notifications`, and `ai-analysis`
  queues are defined centrally.
- Monitoring and discovery workers use exponential retries and bounded job
  retention. Failed jobs remain available for dead-letter investigation.
- Redis locks prevent multiple scheduler instances from enqueueing the same
  scheduled workload.
- `server/workers/index.ts` is built as `dist/worker.js`; web and worker are
  separate Compose services.
- Notifications currently process persisted report email jobs. The AI queue is
  reserved for a future asynchronous AI contract; current AI recommendations
  remain synchronous and entitlement-protected.

### Retention and reporting

- Daily summary, weekly competitor, and pricing opportunity reports are built
  from the tenant-scoped Action Center.
- `report_runs` stores the period, summary, status, and errors.
- `notification_deliveries` stores channel, delivery status, provider message
  ID, timestamps, and errors.
- SMTP credentials remain encrypted at rest and are decrypted only by the
  worker delivery path.

## Required configuration

Set these before enabling commercial billing:

```env
APP_URL=https://app.example.com
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_SCALE=price_...
BILLING_REQUIRED=true
REDIS_URL=redis://redis:6379
QUEUE_MODE=redis
WORKER_CONCURRENCY=4
```

Configure the Stripe webhook endpoint:

```text
POST https://app.example.com/api/billing/webhook
```

Subscribe at minimum to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`
- `invoice.paid`

## Deployment procedure

1. Apply migrations from a release job or a controlled operator shell:

   ```powershell
   $env:DATABASE_URL="postgresql://..."
   pnpm db:push
   ```

2. Build both runtime targets:

   ```powershell
   pnpm build
   ```

3. Run the web process and worker process independently:

   ```powershell
   node dist/index.js
   node dist/worker.js
   ```

4. Verify `/health/live`, `/health/ready`, and the admin tRPC
   `system.queueHealth` procedure.

5. Send Stripe test-mode events and confirm one `billing_events` row per event,
   one subscription update, and no duplicate delivery on replay.

## Launch blockers and explicit risks

- Stripe account, recurring Prices, webhook secret, tax settings, and portal
  configuration are external prerequisites.
- SMTP credentials and sender-domain authentication (SPF/DKIM/DMARC) are
  required for report delivery.
- `apiRequestsDaily` is not yet a plan-aware quota; the existing IP-based rate
  limiter is not a substitute for tenant usage accounting.
- Entitlement checks are read-before-write guards. High-concurrency catalog
  imports should move to transactional reservations or atomic usage counters
  before very large tenants are onboarded.
- There is no external error tracker or long-term metrics backend configured;
  structured logs and health endpoints are present, but Sentry/Datadog/etc.
  still need wiring.
- Database backup/restore automation and migration rollback drills must be
  completed by the deployment owner.
- The frontend still has a large shared JavaScript chunk; route chunks exist,
  but additional vendor splitting is recommended before broad acquisition.

## Recommended launch gates

- [ ] Production Stripe test-mode checkout and webhook replay completed.
- [ ] Live Stripe Price IDs and portal settings configured.
- [ ] Migration 0017 and 0018 applied to a restored staging database.
- [ ] Worker autoscaling and failed-job alerting configured.
- [ ] SMTP sender verified and report delivery replay tested.
- [ ] Backup restore drill completed and RPO/RTO documented.
- [ ] External error tracking and product analytics enabled.
- [ ] Tenant isolation, plan limits, cancellation, and payment-failure regression
  tests run against PostgreSQL and Redis in CI.
- [ ] Privacy policy, terms, data retention, tax, and billing support processes
  approved by the business owner.
