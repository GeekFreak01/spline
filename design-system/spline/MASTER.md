# Design System Master File — Spline

> Source of truth for the Spline UI. Generated with ui-ux-pro-max, then adapted at the
> owner's request (2026-10-14): the first, playful claymorphism direction was replaced by a
> professional workspace look in the spirit of Photoshop, AutoCAD and Glyphs.

**Product:** desktop-style font editor (creative pro tool, also usable by beginners)
**Style:** Minimalism & Swiss principles applied to a dark, dense workspace:
flat panels, 1px hard separators, one accent color, clear type hierarchy, no decorative effects.

## Layout

```
┌ menu bar (File Edit View Glyph Help · document title · Export) ─────────── 32px ┐
├ options bar (context: search/tile size, or tool options + zoom + glyph nav) 38px ┤
├ side panel 220 │ workspace (glyph grid / canvas)          │ dock 270 (sections) ┤
│ (grid only)    │ toolstrip 42 (editor only, icon + tooltip)│ Glyph · Transform · │
│                │                                           │ Actions · Font      │
├ preview (collapsible) ───────────────────────────────────────────────────────────┤
└ status bar: tool hint · X/Y · zoom · selection count ─────────────────── 24px ──┘
```

## Colors (CSS variables in `web/css/app.css`)

| Role | Dark (default) | Light |
|------|----------------|-------|
| App background | `#1E1E1E` | `#D6D6D6` |
| Panel | `#2B2B2B` | `#F0F0F0` |
| Panel header / raised | `#323232` / `#3A3A3A` | `#E4E4E4` / `#DADADA` |
| Separator | `#151515` | `#B4B4B4` |
| Text / secondary / hint | `#E3E3E3` / `#A8A8A8` / `#8A8A8A` | `#1C1C1C` / `#4A4A4A` / `#626262` |
| Accent (selection, primary action) | `#3B8EEA` | `#1F6FD1` |
| Danger / OK | `#F26B6B` / `#4CC38A` | `#C62828` / `#1E8A55` |
| Canvas pasteboard / em box | `#1B1B1B` / `#232323` | `#E2E2E2` / `#FFFFFF` |

Glyph labels (red, orange, yellow, green, blue, purple) tint the whole tile, as in Glyphs.

## Typography

- UI: system font stack (`Segoe UI`, `system-ui`, `-apple-system`, Roboto), 13px, 12px for secondary.
- Numbers, coordinates, Unicode codes: monospace with tabular numerals.
- No web fonts: the app works offline.

## Components

- Controls 28px high, radius 4px, 1px borders; toolstrip buttons 32px icon-only with tooltip + shortcut.
- Dock sections are `<details>` with uppercase 12px headers; open state is remembered.
- Menus: full keyboard support (arrows, Esc), shortcuts shown right-aligned.
- Dialogs: header bar, body, footer with Cancel / primary action.
- Toasts bottom-right, colored left border (OK / error).

## Interaction rules

- Every icon-only control has `aria-label` and a tooltip with its shortcut.
- Visible focus ring (`--focus`) on every control; reduced motion respected.
- Destructive actions confirm (delete glyphs, clear outlines) and are undoable.
- Pointer drags have keyboard alternatives (arrow nudge, numeric fields for metrics/transformations).
- Modifiers: Shift = constrain to 45° / square; Ctrl or Alt = one side of a point (break or remove a handle).

## Anti-patterns

- Playful/toy-like visuals, emoji icons, large rounded cards.
- More than one accent color for interactive state.
- Text below 11px; low-contrast gray-on-gray text.
