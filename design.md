# PrintQueuePro — Design System

Design direction for the customer-facing order-intake screen (and, by extension,
the admin portal) — replacing the generic SaaS-form look with something specific
to Blue Print Copiers, built mobile-first since most orders are placed on a
phone, not the shop's counter tablet.

## What's making the current build read as generated

Before changing anything, it's worth naming exactly what's pulling the current
screen back toward "AI-generated SaaS form" despite the right raw ingredients
(good name, good blue). Fix these specifically, not just "make it nicer":

- **"Place your `print order`"** — coloring a single phrase inside a headline
  is one of the most common generated-design tells. The headline should be one
  weight, one color.
- **`👤 YOUR DETAILS` / `📄 FILES TO PRINT`** — icon + tracked-out ALL-CAPS
  eyebrow label is template chrome. It shows up on every generic form
  regardless of subject matter. The original spec already called for
  numbered, sentence-case headers instead — the build just didn't follow it.
  This revision makes that non-negotiable and shows the exact markup.
- **The cloud-arrow upload icon** — this is *the* default upload glyph, used
  regardless of what's being uploaded. A print shop uploading technical
  drawings and documents has a much more specific visual available to it.
- **The rounded-square printer glyph in the header** — a generic app-icon
  treatment (rounded rect, flat icon, drop shadow) that could belong to any
  SaaS product. The name "Blue Print" deserves a mark that's actually about
  blueprints.
- **Soft card shadow + 16–24px radius elsewhere in the surrounding chrome** —
  still reads as the default "SaaS card kit" until every card on the page
  commits to the hairline-border, tight-radius treatment the original doc
  specified.

Everything below keeps what's already working — the palette is genuinely
tied to the shop's name, Paper/Ink read as warm and legible, "No files
selected yet" is plain and specific — and tightens the rest.

## Concept

A blueprint is a cyanotype: the deep Prussian-blue technical drawings
architects and engineers still use, and the shop literally accepts `.dwg`
files — those drawings. The system leans fully into that: blueprint blue,
paper-toned backgrounds, a drafting typographic voice, and structure that
reads like an order ticket, not a marketing form. Nothing is decorative for
its own sake — every choice ties back to "print shop" or to "quick task on a
phone, sometimes one-handed, sometimes in bright light."

## Color

| Name | Hex | Use |
|---|---|---|
| Blueprint | `#1B3A63` | Primary — headings, buttons, active states, links |
| Blueprint Tint | `#E8EEF5` | Card borders, dividers, subtle fills |
| Paper | `#FAF8F2` | Page background (warm, not flat grey) |
| Ink | `#1F2430` | Body text |
| Stamp | `#C1442D` | Sparing accent — required-field marks, errors, one emphasis moment |

Avoid the generic "trustworthy SaaS blue" (#3B82F6-ish) entirely — Blueprint
reads as *this* shop's color, not a Bootstrap default. Stamp appears in one or
two places max, never as a second competing accent. It never appears inside
a headline.

## Type

Two families, clearly distinct roles — no third "data" font, no monospace
labels as decoration (reserve monospace strictly for genuinely tabular
figures: order numbers, file sizes, page counts).

- **Archivo** (600/700, slightly expanded) — headings, section numbers, button
  labels. Technical, stenciled quality that fits a drafting context without
  being a display gimmick.
- **Work Sans** (400/500) — body copy, input text, helper text, placeholders.

Type scale (base 16px, mobile-first — desktop scales up from here, never down):

| Role | Mobile | Desktop | Weight |
|---|---|---|---|
| H1 / page title | 24px | 28px | Archivo 700 |
| Section label | 15px | 15px | Archivo 600, sentence case |
| Body / input text | 16px | 16px | Work Sans 400 |
| Helper / meta text | 13px | 13px | Work Sans 400, Ink at 65% opacity |

16px minimum on inputs is a hard floor on mobile — anything smaller triggers
iOS Safari's auto-zoom on focus, which breaks the layout mid-task.

No single-word color accents inside headings or copy. No tracked-out
ALL-CAPS eyebrows anywhere in the product. No icon glyph paired with a text
label used purely as decoration — every icon on the page must be either
functional (tap target) or replaced by the numbering system.

## Layout — mobile first

This is a phone flow first, counter-tablet flow second. Design the 375–430px
viewport as the primary case, then let the same single-column layout gain
breathing room on wider screens — don't introduce a second column at any
width. A kiosk/counter form and a customer's phone are both single-task,
single-hand contexts; a marketing-page multi-column layout would be wrong at
any size here.

```
┌───────────────────────┐
│ ▦ Blue Print Copiers   │  ← compact header, no app-icon glyph
│ ─●───────○──           │  ← step indicator, 2 segments
├───────────────────────┤
│                        │
│ Place your print order │  ← one weight, one color
│ Fill in the form —     │
│ staff will prepare it  │
│ right away.            │
│                        │
│ 1 — Your details       │  ← Archivo 600, sentence case, no icon
│ ┌───────────────────┐  │
│ │ Full name *        │  │
│ │ [_______________]  │  │
│ │ Phone number *     │  │
│ │ [_______________]  │  │
│ │ Address (optional) │  │
│ │ [_______________]  │  │
│ └───────────────────┘  │
│                        │
│ 2 — Files to print     │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│ ╎  [paper-stack]     ╎  │  ← corner-bracket frame,
│ ╎  Tap to add files  ╎  │     not a dashed rectangle
│ ╎  PDF DWG JPG PNG   ╎  │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│  No files selected yet.│
│                        │
│         ↕ scrolls       │
├───────────────────────┤
│ Payment at counter.    │  ← sticky bottom bar,
│      [ Submit order ]  │     safe-area padded
└───────────────────────┘
```

- **Single column throughout**, edge-to-edge on phone with 16–20px side
  gutters; the card becomes full-bleed (border only, no floating margin) below
  ~480px so it doesn't look like a shrunken desktop card.
- **Sticky bottom action bar**: on mobile, "Payment & pricing handled at the
  counter" + the Submit button pin to the bottom of the viewport (not the
  bottom of the form) once the form is scrolled past the fold. This is the
  one place a fixed element is earned — it's a long form on a small screen and
  the primary action should always be reachable with a thumb. Pad it for
  `env(safe-area-inset-bottom)` on iOS.
- **Step indicator, not a progress bar with percentage**: two short segments
  in the header (filled = current/complete). This *is* a genuine two-step
  sequence, so the numbering already used in section headers is earned; the
  header indicator just echoes it at a glance without adding a redundant
  "Step 1 of 2" text string.
- **Card border**: 1px Blueprint Tint hairline, 8px radius (not 16–24px) —
  reads as a drafted sheet, not a floating SaaS card. No drop shadow.
- Inputs stack full-width on mobile; the Full name / Phone number pair only
  sits side-by-side once the viewport is wide enough for both fields to keep
  a comfortable line length (roughly ≥560px) — don't force a two-up row into
  a 375px screen.

## Components

- **Header mark**: replace the rounded-square printer icon with a small
  blueprint corner-registration mark (an L-shaped crosshair bracket, the kind
  printed in the corner of a technical drawing sheet) rendered in Blueprint —
  it's a real drafting convention, not a generic app-icon shape, and it
  doubles as a quiet visual anchor for the corner-bracket motif used on the
  upload zone.
- **Section headers**: numbered ("1 — Your details", "2 — Files to print"),
  Archivo 600, sentence case, no icon, no ALL-CAPS. This replaces the
  icon + eyebrow pattern entirely — it's not optional polish.
- **Upload zone**: four corner brackets (drafting registration marks) instead
  of a dashed rectangle; a paper-stack glyph (a few overlapping rounded
  rectangles, not a cloud) sits at the center. On drag-hover, fill with
  Blueprint Tint rather than a generic blue glow.
- **File-type badges**: small format glyphs instead of plain text pills.
  DWG gets a distinct mark — a tiny drafting-compass or ruled-corner icon —
  since that's the format that signals "we take real technical drawings,"
  not just photos.
- **File row (post-upload)**: format badge, filename (truncate mid-string,
  keep the extension visible), size in Ink at 65%, paper-size and quantity
  as compact controls, remove as a plain "×". Row height ≥52px on mobile —
  taller than the 44px floor, since these rows carry a destructive action
  (remove) that shouldn't be easy to mis-tap next to a stepper control.
- **Buttons**: Blueprint fill, Paper text, no icon on Submit — it isn't an
  upload action, so the arrow/upload-icon convention doesn't apply. Full-width
  on mobile inside the sticky bar; auto-width on desktop.
- **Required marks**: Stamp-colored asterisk — the one default place Stamp
  appears.

## Motion

One deliberate moment only: a brief reveal when the form first loads. No
fade-slide-up per section, no hover transition on every element. On
successful file add, a single small confirmation animation (a checkmark
settling into the format badge) is enough. On mobile, the sticky bottom bar
should appear with a short slide-in the first time it engages, not on every
scroll frame. Respect `prefers-reduced-motion` everywhere motion appears.

## Copy

Keep what's already working: localized placeholders ("Anindya Roy,"
"12 Park Street, Kolkata") and plain empty-state text ("No files selected
yet. Use the area above to add files.") are specific and in plain language —
don't let a visual pass smooth these into generic filler. Confirmation copy
should match the action taken: a submitted order says "Order submitted," not
"Success!" The headline stays a single, unaccented sentence — "Place your
print order" — the shop name and the word "print" already do the branding
work; the copy doesn't need to repeat it in color.

## Accessibility / quality floor

- Blueprint (#1B3A63) on Paper (#FAF8F2) passes AA for body text and UI labels.
- Visible keyboard focus rings in Blueprint Tint, not the browser default.
- Touch targets ≥44px everywhere, ≥52px for destructive/remove actions — this
  runs on phones and a shared counter tablet, often standing, sometimes in
  bright shop lighting; err toward larger, higher-contrast controls than a
  desktop-only form would need.
- Sticky bottom bar never covers focused form fields — scroll padding or
  `scroll-margin-bottom` should account for its height so a focused input
  isn't hidden behind it when the on-screen keyboard is also up.
- Respect `prefers-reduced-motion` for the load-reveal, confirmation
  animation, and sticky-bar entrance.

## Implementation notes (plain HTML/CSS/JS)

- Define tokens as CSS custom properties on `:root` (`--color-primary`,
  `--color-bg`, `--color-ink`, `--color-tint`, `--color-stamp`, `--font-heading`,
  `--font-body`, `--radius`) so the palette/type can be tuned in one place.
- Mobile-first CSS: base styles target the 375–430px viewport; use `min-width`
  media queries to add the side-by-side name/phone row and any extra breathing
  room at wider sizes, rather than designing desktop-down.
- Self-host Archivo and Work Sans (woff2, subset to Latin) rather than pulling
  from Google Fonts at runtime — a shop counter shouldn't depend on external
  network reliability just to render its own order form correctly.
- Reuse the same tokens (and the corner-bracket / registration-mark motif) in
  the admin portal so both surfaces read as one product.
