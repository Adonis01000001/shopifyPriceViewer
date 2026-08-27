# Setting the project up

What you need to get the app running locally, and what each piece is for. If
something here does not match what the code does, the code is right and this
file is wrong — say so.

## What this is

An Express server and a React app served from the same process. tRPC carries
the calls between them, Drizzle talks to PostgreSQL, and a daily job searches
for competitor prices and works out what to charge.

There is no separate API server, no Python, no SQL Server and no Redis
requirement. Earlier versions of this document described all four; they were
describing a different application.

## Prerequisites

| Need | Version | Notes |
| --- | --- | --- |
| Node | 20+ | |
| pnpm | 9+ | `npm install -g pnpm` |
| PostgreSQL | 14+ | Local install or Docker, either is fine |
| A Shopify Partner account | — | Only needed to connect a real store; the app runs without one |

Redis is optional. Without `REDIS_URL` the queue runs inline in the same
process, which is what you want locally.

## First run

```bash
pnpm install
cp .env.example .env          # then fill in the four values below
createdb pv_review            # or point DATABASE_URL at a database you have
pnpm db:migrate
pnpm start
```

`pnpm start` brings up the app and, if you have set a tunnel up, the tunnel
too. Both stop on Ctrl-C. It refuses to start if something is already
listening on the port rather than half-starting.

The app is on http://localhost:3000.

### The four values you must set

Everything else in `.env.example` has a working default or is optional.

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Where the data goes. |
| `JWT_SECRET` | Signs session cookies. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ENCRYPTION_KEY_SALT` | Encrypts stored Shopify access tokens. Generate the same way. |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Only needed to connect a real store. |

### The keys the pipeline needs

The app runs without these; the daily run just finds nothing.

| Variable | What it buys |
| --- | --- |
| `SERPER_API_KEY` or `SERP_API_KEY` | Finding shops that sell your products. Serper is cheaper and is preferred when both are set. |
| `OPENROUTER_API_KEY` | Deciding whether a page sells the same product, and reading the price off it. |
| `OPENROUTER_MODELS` | A comma-separated fallback list. Free models share an upstream pool and return 429 often, so the pipeline rotates through these rather than giving up. |
| `FIRECRAWL_API_KEY` | Reading pages that resist a plain fetch. Jina Reader is tried first and is free, and there is a Playwright fallback, so this is optional. |

One more worth knowing about: `MATCH_CONFIDENCE_THRESHOLD` decides how sure the
model has to be that a page sells the same product. It defaults to `0.85`.
Lowering it finds more shops and admits more wrong ones; the machine the demo
was recorded on runs at `0.75`, so results will not match exactly out of the
box.

## Connecting a Shopify store

Shopify has to be able to reach your machine over HTTPS, and it pins the
callback URL to whatever the app was released with. A quick tunnel hands out a
new hostname every restart, which means re-releasing the app every time.

```bash
pnpm tunnel:setup     # once: creates a named tunnel on a hostname you own
```

After that the address never changes and Shopify never needs telling again.
`pnpm start` brings the tunnel up with the app.

## Day to day

| Command | Does |
| --- | --- |
| `pnpm start` | App plus tunnel, one terminal, Ctrl-C stops both |
| `pnpm dev` | App only, watches files and restarts itself |
| `pnpm reset` | Wipes every account and everything hanging off it. Asks first; `--yes` skips the prompt |
| `pnpm demo:save` / `demo:load` | Snapshot and restore the database, so a demo can be re-run from a known state without re-scraping |
| `pnpm test` | Vitest, 60 tests |
| `pnpm build` | Type-checks and builds client, server and worker |
| `pnpm db:generate` | Writes a migration from a schema change |
| `pnpm db:migrate` | Applies pending migrations |

Scripts under `scripts/dev/` drive individual pieces by hand — run the pipeline
for one product, push a price, fetch a Shopify token.

## Where things are

```
client/src/pages/dashboard/   the five screens
client/src/components/        shared UI
server/routers/               tRPC procedures, one file per namespace
server/services/              the work: pipeline, pricing, scraping, extraction
server/_core/                 auth, env, rate limiting, Shopify OAuth
drizzle/schema.ts             every table
drizzle/migrations/           applied in order, never edited after the fact
docs/TODO.md                  what is still wrong, with enough detail to pick up cold
```

## If it will not start

**"Something is already listening on port 3000."** Another copy is running.
`lsof -nP -iTCP:3000 -sTCP:LISTEN` will name it.

**"column ... does not exist."** A migration has not been applied. `pnpm
db:migrate`.

**Shopify says the app failed to install.** The tunnel is down, so the
callback had nowhere to land. Check `/tmp/priceintel-tunnel.log`.

**Everything returns 429 and you cannot log back in.** The rate limit covers
the CSRF token endpoint, so the app cannot fetch the token it needs to sign in
again. Wait out the window, or raise the ceiling in
`server/_core/rate-limit.ts` if you are hammering it deliberately.
