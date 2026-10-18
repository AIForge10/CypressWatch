# Crew app styling: matches the supervisor app (M1)

Colors, radii, font and component shapes copy `frontend/packages/ui/src/tokens.css` and
`frontend/supervisor/src/app.css`. The crew app is a standalone project, so it cannot import
`@cypresswatch/ui`; the values are copied into `src/themes.css` (the `cypress` theme) with a comment
naming the matching `--cw-*` token. If M1 changes a token, update that file.

| M1 token | Crew value | Where |
|---|---|---|
| `--cw-brand` #155d46 | primary | buttons, active tab, eyebrow text |
| `--cw-brand-strong` #0d4433 | brand-strong | top bar, hover, focus ring |
| `--cw-subtle` #edf2ef | background | page |
| `--cw-border` #d7e0da | border | cards |
| `--cw-danger` #b42318 | destructive | stop-work, High/Extreme |
| `--cw-success` #217346 | success | Low, "countdown finished" |
| `--cw-warning-soft` #fff4d6 | caution | banners, Moderate |
| radius 8 / 12 px, shadow-sm | rounded-lg / rounded-xl, shadow-card | cards, buttons |
| Inter font stack | body font | everywhere |

Same shapes as M1: "CW" brand mark, eyebrow + big title page header (`Screen`), pill badges, 12px cards.

## Deliberate differences (a phone used outdoors)
- Touch targets stay large (buttons min 56px tall, tabs 64px).
- Focus ring uses `#0d4433`, not M1's pale `#92cdb2`, which is hard to see in sunlight and fails contrast.
- Form fields use a darker border (`#7f9187`) than cards so they can be seen.
- Risk level is always an icon plus a word, never color alone. Stop-work is a solid red block.
- Atkinson Hyperlegible font was removed to match M1's Inter. A reading-comfort option can bring it back later.
- Muted gray text uses M1's `#617069`, which meets contrast but is lighter than before. Tell me if it is too faint in sun.
