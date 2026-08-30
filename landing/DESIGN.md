---
name: Polaris Pay — The Board
description: A departure board for money that hasn't moved yet.
colors:
  hall: "#04070f"
  panel: "#080d16"
  flap: "#0d1420"
  lamp: "#bffa62"
  dim: "#64b3c0"
  ink: "#f5f9ff"
  rule: "rgb(245 249 255 / 0.11)"
  rule-soft: "rgb(245 249 255 / 0.022)"
  stencil: "#000000"
typography:
  destination:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 8.5vw, 6rem)"
    fontWeight: 500
    lineHeight: 0.94
    letterSpacing: "-0.035em"
  heading:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 3.4vw, 2.75rem)"
    fontWeight: 500
    lineHeight: 0.94
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.2em"
  micro:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  small:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  lede:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  row-name:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  sub-heading:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  figure-book:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "28px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  figure-hero:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "clamp(5rem, 14vw, 9.5rem)"
    fontWeight: 400
    lineHeight: 0.8
    letterSpacing: "-0.01em"
rounded:
  none: "0px"
spacing:
  div: "12px"
  row: "18px"
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.lamp}"
    textColor: "{colors.hall}"
    rounded: "{rounded.none}"
    padding: "12px 24px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px 24px"
  board-header:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "12px 16px"
  board-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "18px 16px"
  board-row-lit:
    backgroundColor: "transparent"
    textColor: "{colors.lamp}"
    padding: "18px 16px"
---

# Polaris Pay — The Board

## Overview

The world is a **departure board**. An instalment ladder is a schedule of dated
future events, which is the same object as a board in a station hall:
`Sep 11 · SCHEDULED · 50.38` is a departure row. Everything follows from that —
ruled rows instead of cards, fixed columns, right-aligned monospaced figures, a
status column, and an accent that behaves like a lamp behind a flap rather than
a glow around a box.

The direction was reached by roll rather than by ranking: candidate 3 of seven
grounded systems (amortisation schedule · nautical almanac · **departure board** ·
engineering drawing · till roll · passbook · block explorer). Three disciplines
were donated by challengers it beat and are load-bearing here:

- **the graticule** (from a CRT oscilloscope bench) — every element sits on a
  declared division; there is no arbitrary padding on this site
- **the leader line** (from a tensegrity column) — annotation sits beside the
  node it describes, never floating as a caption
- **scale contrast** (from a shader portal) — one oversized figure against tiny
  tracked labels, rather than a row of equal-weight statistics

**Anti-references.** This project must never look like: near-black with a neon
accent and glowing edges; cards of icon-plus-heading-plus-text as page
structure; the hero-metric template; gradient text; glass or blur as decoration;
a coloured `border-left` above 1px; section numbers; and above all **an eyebrow
or kicker above a heading**, which is banned outright. The first version of this
site had five of these, which is what triggered the rebuild.

## Colors

Restrained by strategy: one ground, one lamp, one counter-lamp used exactly
twice. Colour is not decoration here — the lamp marks *state* (a draw that has
been collected, the mode that is selected, the figure that is the answer).

### Primary

`lamp #bffa62` — sampled from the product's own mark, not chosen. It is
emissive: it appears as lit type, a lit rule, a filled button, or a 7%
left-to-right wash behind a lit row. It is **never** a halo, a shadow, or a
radial bloom.

### Secondary

`dim #64b3c0` — appears exactly twice on the whole site, both times on interest
figures. Its scarcity is what makes it mean "this is not the lamp thing."

### Neutral

`hall #04070f` ground · `panel #080d16` board panels and header strips ·
`ink #f5f9ff` type · `rule` at 11% for row hairlines · `rule-soft` at 2.2% for
the graticule.

### Named Rules

- **The lamp marks state, never decorates.** If a lime element is not reporting
  a state or an answer, it is wrong.
- **No radial gradients anywhere.** The one gradient permitted is the linear
  wash behind a lit row.
- Dark is chosen from the use scene, not category: this is signage read in a
  hall, and a board is emissive against a dark ground.

## Typography

Both faces are **pinned brand commitments**, not selections: Space Grotesk for
everything a person reads, JetBrains Mono for anything a machine produced —
figures, dates, addresses, program ids.

### Hierarchy

`destination` (hero) → `heading` (section) → `body` → `label` (tracked caps) →
`figure` / `figure-hero` (mono, tabular).

### Named Rules

- **Every computed figure is `.figure`** — mono, `tabular-nums lining-nums`, so
  a rolling value cannot reflow the digits beside it and columns align down the
  board.
- **Labels are tracked caps at 0.625rem**, and they sit *beside or above data*,
  never above a heading.
- Display tracking floor is −0.035em; the hero never exceeds 6rem.
- Body measure stays at 62–75ch on reading surfaces.

## Layout

One measuring system: `--div: 12px`. Every pad, gap and section rhythm is a
multiple of it, expressed as `calc(var(--div) * n)`. Content column is 1180px on
the board, 62ch on reading surfaces.

The board grid is a fixed four-column template —
`2.5rem 1fr auto 7.5rem` (number · draw · amount · status) — shared by every
board on the page so the columns line up between sections.

The `.graticule` is a 168px etched field at 2.2% opacity, radially masked so it
fades toward section edges. It is a measuring reference, not a texture: if it
competes with content it is too strong.

## Elevation & Depth

**There is none, deliberately.** No shadows anywhere. Depth is carried by
hairline rules, panel fills, and the lit wash. A board is flat; adding a shadow
would make it a card, which is the thing this world exists to avoid.

## Shapes

Radius is `0` everywhere — buttons, panels, boards, inputs. A flap is
rectangular. The single exception permitted is the product mark itself, which
ships as an image and is never redrawn.

## Components

- **`board`** — a bordered region containing a `board-header` strip (`panel`
  ground, tracked caps) and N `board-row`s separated by hairlines. Last row
  carries no bottom rule. A total row sits on a `panel` fill above the border.
- **`board-row-lit`** — collected state: lime type in the draw, amount and
  status columns, plus a 7% linear wash from the left edge.
- **`button-primary`** — filled lamp, hall-coloured text, square, `hover:opacity-85`.
- **`button-secondary`** — 1px rule, ink text, square, rule brightens on hover.

## Motion

One authored moment, repeated with intent: **the flap**. Rows arrive by rotating
on their own top edge (`rotateX -82° → 0`, `expo.out`, 55ms stagger) the way a
split-flap board updates. Nothing on this site slides or fades in any other way.

Motion is an **enhancement and never load-bearing**:

- An inline script arms `html.armed` only when the document is visible and
  reduced motion is not requested. Unarmed, the page renders complete.
- A watchdog reverts the whole context if GSAP's ticker has not advanced 1.2s
  after building. A tab can report itself visible and still be throttled.
- Every figure ships its **final** value in the markup; the roll animates *to*
  what is already there.

This is not defensive over-engineering: an earlier build of this site shipped a
page that was blank whenever `requestAnimationFrame` did not fire.

## Do's and Don'ts

**Do**

- Put data in ruled rows with aligned columns.
- Right-align every figure and set it in mono.
- Let one number per section be enormous and its label tiny.
- Name the network on screen — `devnet` is stated, not hidden.
- Theme the browser's own surfaces: selection, focus ring, scrollbar, underline
  offset all belong to the board.

**Don't**

- Don't add an eyebrow above a heading. Ever.
- Don't reach for a card when a row will do, and never nest one.
- Don't use the lamp as a glow, halo, or radial bloom.
- Don't put mono on prose — it is for figures, dates, addresses and ids only.
- Don't invent a figure. Every number on this site is program output, and the
  list of real evidence is in PRODUCT.md.

### A flagged pattern kept on purpose

The design detector reports `overused-font` for **Space Grotesk** on the
dashboard and merchant surfaces. It is not changed, and this is a decision
rather than an oversight.

The faces are a **pinned brand commitment** recorded in PRODUCT.md, the user
asked for them explicitly, and they run across eight surfaces including two
Android apps whose theme is compiled from the same tokens. Impeccable's own
precedence rule is that the brief wins over a saturated-pattern warning:
honouring a pinned face is not the same as defaulting to one. Swapping it to
clear a detector line would trade real brand consistency for a clean report.

Every other finding the detector raised was fixed at source, never suppressed:
a gradient heading, a purple that belonged to no token, two decorative
full-screen grids, three border-on-a-circle spinners, a body font that silently
overrode the webfont the app was already downloading, and a stray teal
selection colour on a lime-branded page.
