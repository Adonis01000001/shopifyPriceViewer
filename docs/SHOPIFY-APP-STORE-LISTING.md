# Shopify App Store Listing Draft

Status: draft for review, 2026-08-05

This is a Shopify-specific adaptation of the metadata and visual-messaging
principles normally used for app-store optimization. It is not an iOS or Android
listing. Claims marked **VERIFY** require a live review store and final production
configuration.

## Positioning

**Promise:** Know which prices to change before a competitor wins the sale.

**Primary merchant:** Shopify merchants with a meaningful catalog who currently
check competitor prices manually or make pricing decisions without evidence.

**Proof path:** Connect Shopify → import products → add a competitor → see a
movement or recommendation → review and approve a decision.

## Listing copy

### Draft title

PriceVision — Shopify Price Intelligence

### Draft short description

Monitor competitor prices, spot changes that matter, and make explainable pricing
decisions from one Shopify dashboard.

### Draft full description

PriceVision helps Shopify merchants turn competitor price changes into clear next
actions. Connect your store, import the products you want to watch, and add the
competitors that shape your market.

PriceVision helps you:

- See the products and competitor movements that deserve attention.
- Review pricing recommendations with the current price, suggested price, and
  explanation visible together.
- Receive alerts for meaningful competitor and price changes.
- Use scheduled monitoring and history to replace repetitive spreadsheet checks.
- Keep decisions under merchant control; the app does not silently change prices.

Start with a focused watchlist and expand as the data proves useful. Monitoring
cadence and feature availability depend on the selected plan and configured
sources.

### Feature bullets

- **Decision-first dashboard:** one clear next action before secondary analytics.
- **Competitor movement tracking:** see what changed and when.
- **Explainable pricing intelligence:** understand the evidence behind a suggested
  move.
- **Merchant-controlled workflows:** review and approve decisions explicitly.
- **Scheduled alerts and reports:** build a repeatable weekly pricing habit.

## Screenshot storyboard

Do not put prices, discount claims, or unverifiable performance numbers in
screenshots. Capture these with a review store containing realistic but fictional
products and competitor data. Use the exact production UI, not marketing mockups.

1. **Dashboard — “Know what needs attention today”**
   - Show the next-best-action panel, one pending recommendation, and one
     competitor movement.
   - Alt text: “PriceVision dashboard prioritizes a competitor movement and a
     recommended product price review.”
2. **Onboarding — “Get your first signal in under five minutes”**
   - Show the resumable three-step checklist with store connected and product
     sync complete.
   - Alt text: “PriceVision onboarding checklist connects Shopify, imports products,
     and adds the first competitor.”
3. **Recommendation review — “Understand why a price should move”**
   - Show current price, suggested price, confidence, reason, and explicit approve
     or dismiss controls.
   - Alt text: “PriceVision explains a recommended price change before a merchant
     approves it.”
4. **Competitor movement — “Catch changes before they become surprises”**
   - Show movement history, timestamps, and the affected product.
   - Alt text: “PriceVision shows competitor price movement history for monitored
     products.”
5. **Alerts/reporting — “Build a pricing habit”**
   - Show alert history or a weekly report preview with delivery status.
   - Alt text: “PriceVision groups monitored price changes into merchant alerts and
     reports.”

## Merchant expectations to make explicit

- What data is read from Shopify and what the app can change.
- The expected monitoring cadence and how a merchant can request a rescan.
- The first-value path and approximate setup time.
- Trial length, plan limits, billing currency, and cancellation behavior in the
  designated pricing details area.
- Support contact, privacy policy, data retention, and how to disconnect a store.
- A test-store account and deterministic review steps for Shopify App Review.

## App Store launch gates

**Verified against Shopify documentation on 2026-08-05:**

- Public App Store apps must use Shopify-provided billing; off-platform billing is
  not acceptable unless Shopify has granted an exception.
- Merchants must be able to change plans without contacting support or reinstalling.
- Pricing details must be accurate and complete; pricing should not be embedded in
  listing images.
- The app must be reliable enough for review, with no critical UI or HTTP errors.

Current blocker: this repository’s commercial billing foundation is Stripe-based.
Before a public Shopify App Store submission, implement and test Shopify App
Pricing or the Shopify Billing API, then update the plan selection and webhook /
subscription verification paths accordingly. Keep Stripe only for deployments
that are explicitly outside the Shopify App Store distribution model.

Official references:

- [Shopify App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
- [About billing for your app](https://shopify.dev/docs/apps/launch/billing)
- [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing)
