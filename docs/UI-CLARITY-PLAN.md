# UI clarity pass

The app is for a merchant who wants verdicts and action items, not a dashboard
to interpret. Every screen should answer three questions without being asked:

1. **What am I looking at?**
2. **What is the app doing right now?**
3. **What should I do next?**

Written 2026-08-26. Each item below states the problem, the fix, and how to
tell it worked.

## 1. Raise the type floor

**Problem.** 238 hardcoded sizes in the client sit between 9px and 13px, and a
dozen CSS rules go below 0.7rem. Labels, table meta, badges and timestamps are
all at or under 11px. Small type reads as "reference material you can ignore",
which is the wrong signal for numbers a merchant is meant to act on.

**Fix.** No text below 12px. Bump each arbitrary step up one, redefine the
small end of the Tailwind scale, and lift the sub-0.7rem CSS rules.

| Before | After |
| --- | --- |
| `text-[9px]` | `text-[12px]` |
| `text-[10px]` | `text-[12px]` |
| `text-[11px]` | `text-[13px]` |
| `text-[12px]`, `text-xs` | `text-[13px]` |
| `text-[13px]` | `text-[14px]` |

**Check.** Nothing in the rendered app computes below 12px.

## 2. Name pages for what they hold

**Problem.** The eyebrow labels are decoration: "Decision workspace",
"Attention queue", "Catalog / merchandising", "Market landscape", "Workspace
configuration". None tells a merchant what the page contains, and two of them
("attention queue", "decision workspace") are the kind of phrase that sounds
considered and means nothing.

**Fix.** Replace each with what is actually on the page, or drop it. The page
title plus a plain one-line purpose carries the weight instead.

**Check.** Every page's first two lines describe its contents in words a
merchant would use.

## 3. Empty states explain themselves

**Problem.** "No products tracked yet", "No recent movements", "All clear" say
what is absent, not why, and not what fills them. On a first run the whole app
is empty states while the pipeline works, which is exactly when a person
decides whether the product is broken.

**Fix.** Every empty state says why it is empty and what will fill it, and
reflects whether a run is in progress rather than looking identical either way.

**Check.** During a first run, no screen is silent about the fact that work is
underway.

## 4. Numbers say what they mean

**Problem.** The Overview tiles read LEADING / COMPETITIVE / OVERPRICED / NO
DATA with a count. The Products table shows a POSITION badge of LEAD / OVER /
N/A. Neither says what the words mean or what follows from them, and the four
tiles are not clickable, so a count of 6 overpriced products is a dead end.

**Fix.** Give each its plain meaning, and make the tiles filter the products
list so a count leads somewhere.

**Check.** Every status word on screen can be explained by its own label.

Done 2026-08-27. LEADING / COMPETITIVE / OVERPRICED / N/A now read "Cheaper
than them" / "About the same" / "Dearer than them" / "Not checked yet" on both
screens, each carrying the rule that decided it in its `title`. The four counts
link to `/products?stand=…`, which filters the table and shows a removable
chip. Products now takes one `analyzeAll` query for the whole page rather than
one `analyze` per row, which is what made filtering possible.

## 5. Buttons say what they will do

**Problem.** APPROVE and UPDATE SHOPIFY sit side by side. One records a
decision, the other writes a price to the live store. The only difference in
the UI is colour and a `title` attribute nobody reads.

**Fix.** Make the destructive one state its effect before it runs, including
the product, the old price and the new one.

**Check.** Nobody can change a live storefront price without seeing that
sentence first.

## 6. Say what the pipeline is doing

Done, before this plan. The topbar carries a live indicator and an activity
panel; lists refetch as products finish. Recorded here so the set is complete.
