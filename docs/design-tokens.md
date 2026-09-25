# Design Tokens — Actual Implementation (src/style.css)

`design.md` (project knowledge doc) describes the aspirational design system —
`--neutral-0` through `--neutral-950`, `--space-1` through `--space-24`, a
5-step radius scale, etc. **`src/style.css` does not use those variable
names.** It implements the same brand intent (maroon/gold, Apple-HIG touch
targets, subtle elevation) under a smaller, different-named token set. This
file documents what's actually in the codebase, so treat it as the source of
truth for anyone editing `style.css` — not `design.md`.

## Color tokens (`:root` in style.css)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand-maroon` | `#7a0c1e` | same | Primary brand, CTAs, active states |
| `--brand-maroon-dark` | `#5a0916` | same | Hover/pressed on maroon |
| `--brand-gold` | `#f5c542` | same | Accent, focus rings |
| `--brand-gold-dark` | `#d4a017` | same | Hover/pressed on gold |
| `--canvas` | `#f7f7f8` | `#121316` | Page background |
| `--surface` | `#ffffff` | `#1c1e22` | Cards, modals |
| `--surface-soft` | `#fafafa` | `#232529` | Subtle section backgrounds |
| `--ink` | `#0f1115` | `#f3f4f6` | Primary text |
| `--ink-soft` | `#33363f` | `#d1d5db` | Secondary text |
| `--muted` | `#6b7280` | `#9ca3af` | Tertiary text, placeholders |
| `--line` / `--line-strong` | `#e5e7eb` / `#d1d5db` | `#33363f` / `#4b4f5a` | Borders, dividers |
| `--success` / `--warning` / `--danger` (+ `-soft` bg variants) | see file | dark-adjusted `-soft` variants | Status colors |
| `--accent-amber` / `--accent-emerald` / `--accent-blue` / `--accent-purple` | `#f59e0b` / `#10b981` / `#3b82f6` / `#8b5cf6` | same | Menu category color-coding + order-status dots |

Dark mode is applied via `@media (prefers-color-scheme: dark)` overriding
the `:root` block — added 2026-09-25 QA sweep, was previously missing entirely.

## Radius scale

`--radius-sm: 8px`, `--radius-md: 12px`, `--radius-lg: 16px`, `--radius-xl: 20px`,
plus `999px` (or `var(--radius-full, 9999px)`) for pills/badges.

Note: a handful of one-off radii (`9px`, `10px`, `15px`) still exist outside
this scale in a few older components — low priority, cosmetic only.

## Shadows

`--shadow-sm`, `--shadow-md`, `--shadow-lg` — stronger alpha values swapped
in automatically for dark mode.

## Spacing

No `--space-*` scale exists — spacing is hardcoded px per-component. If this
becomes a maintenance pain, extracting a scale is a bigger refactor, not a
QA-sweep-sized fix.

## Touch targets

Apple HIG 44px minimum is the standard applied throughout (PIN pad keys,
money inputs, nav items). Fixed during the 2026-09-25 QA sweep: `.pin-key`
was 38px on small screens → now 44px; `.money-input` was 40–42px → now 42–44px.

## Motion

`--ease-standard` and `--ease-emphasis` match design.md section 7 exactly.
`prefers-reduced-motion` is respected globally.
