# The API

Everything the client calls goes over **tRPC**, mounted at `/api/trpc`. There
is no REST API and no `/api/v1`. An earlier version of this document described
one in detail; it did not exist then either.

The practical consequence: you do not write requests by hand. The client
imports the router's type and gets the procedure list, its inputs and its
return type from TypeScript. If you want to know what a procedure takes, open
its `z.object(...)` in `server/routers/`.

## Talking to it

**From the client.** `client/src/lib/trpc.ts` exports a typed client.

```ts
const { data } = trpc.products.list.useQuery();
const mutate = trpc.recommendations.dismiss.useMutation();
```

**From outside**, for a one-off check. Queries take their input in the query
string; mutations take a JSON body.

```bash
curl 'http://localhost:3000/api/trpc/products.list?input={"json":null}' \
  -H 'Cookie: app_session_id=...'
```

## Authentication

A session is an httpOnly cookie, `app_session_id`, holding a signed JWT. There
is no `Authorization: Bearer` header — a token in a header would be readable
by any script on the page, which is the thing the cookie is avoiding.

- `auth.login` and `auth.register` set the cookie and a refresh cookie.
- `auth.refreshSession` rotates them.
- `auth.logout` clears both.
- Mutations also require a CSRF token from `GET /api/csrf-token`, because a
  cookie alone is sent by the browser on cross-site requests too.

`protectedProcedure` rejects with `UNAUTHORIZED` when the cookie is missing or
expired. `adminProcedure` additionally requires `role = 'admin'`.

## The routers

One file per namespace under `server/routers/`.

| Namespace | What it is for |
| --- | --- |
| `auth` | Register, log in, refresh, reset a password, who am I |
| `products` | The catalogue: list, create, update, CSV import, Shopify sync, competitor prices for one product |
| `competitors` | The shops we found, their matched products, their feed |
| `recommendations` | Suggested prices: list, generate, implement, dismiss |
| `pricingEngine` | Analysis on demand — market position, the suggested price, dashboard counts |
| `pipeline` | What the daily run is doing, what became of each product, and the full trail for one |
| `prices` | Price history and trends |
| `alerts` | Competitor price movements, read and resolved state |
| `intelligence` | The action centre, extraction by URL, cron status |
| `account` | Plans, usage, and the two pricing rules |
| `billing` | Stripe: status, checkout, portal, plan changes |
| `notifications`, `reports`, `activity`, `analytics`, `system` | Preferences, report runs, the activity log, event tracking, health |

## The endpoints that are not tRPC

These are plain Express routes, because something other than our own client
calls them.

| Route | Who calls it |
| --- | --- |
| `GET /healthz`, `GET /health/live` | Uptime checks. Liveness only — it does not touch the database |
| `GET /health/ready` | Readiness: checks the database and the queue |
| `GET /api/csrf-token` | The client, before any mutation |
| `GET /api/shopify/login` | The merchant, to start OAuth |
| `GET /api/shopify/callback` | Shopify, after the merchant approves |
| `POST /api/shopify/connect` | The client, for the token-exchange path |
| `DELETE /api/shopify/disconnect` | The client |
| `POST /api/shopify/webhooks` | Shopify: `app/uninstalled` and the three GDPR compliance topics, each HMAC-verified |
| `POST /api/billing/webhook` | Stripe, signature-verified |
| `GET /api/oauth/google/start`, `GET /api/oauth/google/callback` | Google sign-in |
| `GET /api/notifications/stream` | The client, server-sent events for live alerts |

Note that anything not matching a route falls through to the SPA and returns
`200` with `index.html`. A `200` from a made-up path is not evidence the
endpoint exists — check this table.

## Errors

tRPC returns its own codes rather than bare HTTP statuses. The ones you will
meet:

| Code | Means |
| --- | --- |
| `BAD_REQUEST` | Zod rejected the input. The message names the field |
| `UNAUTHORIZED` | No session, or it expired |
| `FORBIDDEN` | Signed in, but not allowed — wrong role, or a plan limit |
| `NOT_FOUND` | No such row, or it belongs to someone else |
| `TOO_MANY_REQUESTS` | Rate limited. Note this covers `/api/csrf-token` too, so a client that hits it cannot sign back in until the window passes |
| `INTERNAL_SERVER_ERROR` | Everything else. The response carries a request id that matches the server log |

## Rate limits

Set in `server/_core/rate-limit.ts`, per IP, in-memory.

| Limiter | Window | Ceiling |
| --- | --- | --- |
| General API | 15 min | 1200 |
| Auth | 15 min | tighter — see the file |
| Scraping | 15 min | tighter — see the file |

The server sets `trust proxy` to one hop, so behind the Cloudflare tunnel these
count real visitors rather than counting everyone as the tunnel.

## Tenancy

Every protected procedure filters by `ctx.user.id`. There is no workspace or
team concept: data belongs to a user, which is why a shop cannot yet be shared
by two people. That limitation is written up in `docs/TODO.md`.
