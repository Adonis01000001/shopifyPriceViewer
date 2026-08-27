# Known work

Open items with enough detail to pick up cold. Each one states what is wrong,
how it was established, and what a fix involves.

Last reviewed 2026-08-27.

Closed on 27 August, during an end-to-end pass: the coarse activity log (item
3 — the pipeline now writes a line per step, roughly one every 3.6 seconds
rather than every 59), the vague control labels and missing justification (item
4), and the unbounded rise on thin evidence (item 5 — a suggestion is now
withheld, not merely flagged, when the evidence cannot carry it).

Also fixed in the same pass, found by running the app rather than reading it:
the indicator stayed on "Idle" through a whole run because the onboarding
wizard has its own sync mutation; a killed run left the indicator claiming to
work forever; every server restart kicked off a full discovery run, quietly
spending two paid searches per product; a fake CRITICAL badge that was decided
by list position; recommendations that suggested no change at all; and a DELTA
column measured against the average while sitting beside one showing the
cheapest rival.

Closed since this list was written: the Status column on Products (removed —
it defaulted to `optimal` forever and contradicted the live market position
beside it), and Path of Wisdom (removed — it wrote LLM-guessed prices into the
same recommendations table as the priced-and-floored ones).

Closed in a second pass on 27 August, all found by using the app rather than
reading it:

- The Overview listed only products that had a suggestion, and only the first
  six of those. Products seven onward read as "not checked yet" while a
  suggestion sat in the database. Every product is now on the list, actionable
  ones first, each other one carrying the reason it has nothing to do.
- `price_index` and `avg_price_diff` on competitors were written once at row
  creation and never again, so every competitor read "+0.0%". Both are now
  derived from the matches themselves at read time. `last_scraped_at` had the
  same problem and showed "Never" beside prices read minutes earlier.
- The product page asked a language model for a second opinion and printed its
  price next to the calculated one — two different numbers, on every page view,
  billing a model call each time. Removed.
- Match confidence rendered as `0.75.toFixed(0)` = "1% match".
- The sidebar said "No store connected" and a "Finish setup" button appeared
  while the queries were still in flight; the onboarding checklist reopened on
  every background refetch.
- A failed database write during the Shopify callback still redirected to a
  success page, so a store could appear connected without being saved.
- `trust proxy` was unset behind the Cloudflare tunnel, so the rate limiter
  counted every visitor as one address.
- Three action controls per row on Products all opened the same page.
- Bento cards on Competitors duplicated the table beneath them, with the sign
  of the price difference coloured the opposite way in each.
- "View feed" appeared to do nothing: the panel rendered below the fold. The
  feed is now the first section on the page.

The undercut and margin numbers are now per-merchant settings rather than
constants (`users.undercut_percent`, `users.min_margin_percent`, migration
0033), read through `pricing-rules.service.ts` so a suggestion shown on screen
and one written by the nightly run cannot disagree.

## 1. Webhook subscriptions ~~are never registered~~ &mdash; done

Registered on connect (`server/_core/oauth.ts`, `registerShopifyWebhooks`) for
`app/uninstalled` plus the three compliance topics. A store whose install is
gone no longer holds its claim on the shop domain, so the next person to
install can connect it.

Left to verify against a real uninstall: nobody has removed the app from a
store since this landed.

## 2. Nothing that can lose money is covered by a test

The suite is 60 tests across 7 files, and the valuable ones are the pricing
engine (undercut, margin floor, averaging) and the product/SKU rules. What has
no test file at all:

| Untested | Why it matters |
| --- | --- |
| `pipeline.service.ts` | The whole run. Discovery, scraping, matching, the per-product deadline. |
| `ai-extraction.service.ts` | The three guards that stop a wrong price being recorded. |
| `oauth.ts` | Connect, callback, the store-claim rule, webhook registration. |
| Shopify sync in `routers.ts` | Product and cost import. |
| `recommendation.service.ts` | Implementing a recommendation and pushing a price to a live store. |
| `scraping.service.ts` | Page fetching and its fallbacks. |

Everything in that table was verified by running it by hand on 26 August. None
of it would catch a regression tomorrow. The price push in particular writes to
a real storefront, and the extraction guards are the only thing standing between
a hallucinated number and a merchant's shop.

Worth doing before the multi-user work below, because that change touches 15
tables and 113 queries with no safety net underneath it.

Start with `ai-extraction`: the guards are pure functions over a page's text and
a model response, so they test without a network or a database.

## 3. One shop cannot be shared by several people

Data belongs to a user, not to a workspace. 15 tables carry a `user_id`
column and 113 queries read `ctx.user!.id` directly.

Cheaper now than it was: the discovery consolidation removed 15 tables that
would otherwise have needed migrating too.

## 4. Prices in different currencies are compared as plain numbers

`resolveLocale()` picks the right market to search in, and each extracted
price is stored with the currency the page reported (defaulting to `USD` when
the page gives nothing). The pricing engine never reads that column — it
compares the numbers directly. A competitor page priced in EUR is therefore
weighed against a USD price as if the units matched.

A currency-normalisation helper used to exist in
`server/services/shared/normalization.ts`, along with multi-pack handling
(`extractOfferQuantity`). Both were unreachable — nothing imported them — and
were deleted on 2026-08-26 rather than left as decoration. Recover them from
git history if useful; the multi-pack problem is real too, since a listing for
a two-pack is not comparable to a single unit either.

## 5. `product_embeddings` is unused

Zero rows, no code reads or writes it. It looks like groundwork for semantic
product matching rather than leftovers from the discovery consolidation, so it
was deliberately left in place when the other orphaned tables were dropped.
Either wire it up or drop it — it should not stay ambiguous.

## 6. Shops with strong bot protection are never read

Amazon and Best Buy block every reader tried, free and paid. Their prices are
simply not collected. Visible in the run logs as `Pipeline: no price on page
(likely blocked), skipping AI call`, which is the guard doing its job rather
than a bug.

## 7. ~~`pnpm dev` does not watch files~~ &mdash; done

`tsx watch` restored on 2026-08-27. Verified by touching a server file and
watching the process restart on its own while the tunnel stayed up.
