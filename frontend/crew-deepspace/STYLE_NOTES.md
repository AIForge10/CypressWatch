# Crew app styling: matches the supervisor app (M1)

Colors, radii, font and component shapes copy `frontend/packages/ui/src/tokens.css` and
`frontend/supervisor/src/app.css` (M1's terracotta / charcoal / teal look). The crew app is a standalone
project, so it cannot import `@cypresswatch/ui`; the values are copied into `src/themes.css` (the `cypress`
theme) with a comment naming the matching `--cw-*` token. If M1 changes a token, update that file.
The font is Open Sans, shipped with the app (`@fontsource/open-sans`) so it also works offline.

| M1 token | Crew value | Where |
|---|---|---|
| `--cw-brand` #cd533b | primary #b9442d (darker, see below) | buttons, active tab, eyebrow text |
| `--cw-brand-strong` / `--cw-sidebar` #353531 | brand-strong | top bar, hover, focus ring |
| `--cw-subtle` #eef4f4 | background | page |
| `--cw-border` #cbdde0 | border | cards |
| `--cw-brand-soft` #9ac2c9 | brand-soft | "CW" mark |
| `--cw-success` #5b8f86 | success #2f6f63 (darker) | Low, "countdown finished" |
| `--cw-danger` #cd533b | destructive #9f1a10 (different on purpose) | stop-work, High/Extreme |
| radius 4 / 6 / 8 px | `--radius: .25rem` (buttons 4 px, cards 8 px) | cards, buttons |

## Deliberate differences (a phone used outdoors)
- Three colors are slightly darker than M1's so white-on-color text reaches 4.5:1 (M1's terracotta on white is 4.3:1).
- Stop-work stays a distinct deep red, not the terracotta brand color, so "tap this" never looks like "stop work".
  The block is also huge, bordered, and says STOP WORK with an icon.
- "Moderate" stays amber so it never looks like "High". Risk is always an icon plus a word, never color alone.
- Focus ring is the dark charcoal (3 px), form fields get a darker border (3.6:1), buttons stay large for gloves.
- Sunlight mode (header button) overrides everything with black on white and bigger text (7:1 or better).

## Display panel (reading comfort)
Header "Display" button: choose a font (Standard Open Sans, Atkinson Hyperlegible, Lexend, OpenDyslexic, Verdana), text size
(Normal / Large / Larger) and "Easier spacing" (more space between lines, letters and words, no all-capital labels).
Saved on the phone (`cw:reading`) and applied as `data-font`, `data-size`, `data-spacing` on `<html>` (see `src/lib/reading.ts`,
`src/themes.css`; `index.html` sets them before first paint). The fonts are bundled and saved for offline use.
On phones the panel also holds the signed-in name and Sign out, which no longer fit in the top bar.

## Languages (English / Spanish)
All wording lives in `src/lib/i18n.ts` (English and Spanish side by side). Use `const { t } = useT()` then `t('key')`.
The header button (`data-testid="lang-toggle"`) switches the whole app; the choice is saved on the phone.
Server text (briefing, score explanation, hazard summaries, AI suggestions, crew notes) is shown as sent.
A native Spanish speaker should read the stop-work wording (`stop.*`) before real use.
