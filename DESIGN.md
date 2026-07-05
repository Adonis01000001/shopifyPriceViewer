# Design

## Theme

**Dark mode default.** This is a tool merchants check throughout the day — dark mode reduces eye strain and feels native to the "pro tool" category. Light mode is supported but secondary.

Scene: a Shopify merchant glancing at pricing data on a 15-inch laptop, often in a dim home office or co-working space, switching between Shopify admin and this dashboard. The interface should feel like a calm, focused workspace — not a flashy marketing page.

## Color Strategy

**Restrained** — tinted neutrals + one rose accent at <=10% of surface area. The rose signals "action" and "AI" without screaming. Based on Material 3 rose seed color (`#ba005c` / `#ffb1c5`).

### Palette

| Role        | Light       | Dark        | Usage                                        |
| ----------- | ----------- | ----------- | -------------------------------------------- |
| Primary     | `#ba005c`   | `#ffb1c5`   | Accent rose — CTAs, active states, AI badges |
| Background  | `#fff5f8`   | `#1f0e13`   | Page background                              |
| Surface     | `#ecd9de`   | `#2d1a1f`   | Card surfaces                                |
| On Surface  | `#2d1a1f`   | `#feeef3`   | Body text                                    |
| Tertiary    | `#21a732`   | `#63e063`   | Positive / success — price drops, gains      |
| Error       | `#dc2626`   | `#ffb4ab`   | Errors, delete actions                       |
| Outline     | `#ab8790`   | `#c49aa8`   | Card borders, dividers                       |

### Glow effects

- `--glow-primary`: `0 0 20px rgba(255, 177, 197, 0.3)` — used sparingly on key metrics
- `--glow-accent`: `0 0 15px rgba(255, 177, 197, 0.15)` — subtle card hover

## Typography

- **Sans:** DM Sans — warm, geometric, highly legible at small sizes
- **Mono:** JetBrains Mono — for prices, scores, timestamps, data values
- **Scale:** 12 / 14 / 16 / 20 / 24 / 32 / 48px
- **Body:** 16px / 1.6 line-height / 65ch max-width
- **Hierarchy:** weight contrast (400 vs 600) + size contrast (>=1.25 ratio between steps)
- **Numbers:** always `tabular-nums` + `letter-spacing: -0.02em`

## Layout

- **Max content width:** 1280px, centered, with responsive padding (1rem / 1.5rem / 2rem)
- **Spacing rhythm:** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px — vary within a page, never uniform
- **Sidebar:** persistent left nav on dashboard pages, collapsible on mobile
- **Cards:** used sparingly. Prefer direct data display over card-wrapping everything. No nested cards.
- **Glass card variant:** `background: oklch(0.13 0.012 250 / 0.7)` + `backdrop-filter: blur(12px)` — for overlays, modals, floating panels only

## Components

### Data display

- `.data-value` — monospace, tabular-nums, for prices/scores/metrics
- Price changes: teal for favorable, red for unfavorable, with directional arrow icon
- Confidence scores: shown as percentage with subtle progress bar

### Charts (Recharts)

- Dark tooltip: `oklch(0.13 0.012 250)` background + `oklch(0.22 0.01 250)` border
- Grid lines: `oklch(0.22 0.01 250)` — visible but not competing with data
- Tooltips: always show source + timestamp

### Alerts

- Severity: color-coded border-left (not full background tint)
- Critical: red, High: gold, Medium: teal, Low: muted
- Unread: subtle dot indicator, not bold text

### Buttons

- Primary: filled teal, white text
- Secondary: muted background, foreground text
- Ghost: transparent, hover reveals border
- Destructive: red background, white text

## Motion

- **Ease:** `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out) for all transitions
- **Duration:** 150ms for micro-interactions, 300ms for page transitions
- **Reduced motion:** all animations disabled under `prefers-reduced-motion`
- **No bounce, no elastic** — this is a professional tool, not a game
- **Stagger:** list items fade-in with 30ms stagger for data tables

## Scrollbar

- 6px wide, transparent track
- Thumb: `oklch(0.25 0.01 250)`, hover: `oklch(0.35 0.01 250)`
- Rounded (3px)

## States

- **Loading:** skeleton screens (not spinners) for data-heavy views
- **Empty:** illustration + single CTA + explanation of what this section does
- **Error:** inline message with retry action, never a full-page error
- **Offline:** banner at top, non-blocking
