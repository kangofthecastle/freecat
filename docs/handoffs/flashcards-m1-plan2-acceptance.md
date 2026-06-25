# Flashcards M1 Plan 2 — manual acceptance gates

Run `npm run dev`, open the Flashcards tab.

## MathJax CSP confirmation
- [ ] Import a deck with a MathJax card (e.g. a `[$]x^2[/$]` note). Open it; confirm math typesets.
- [ ] DevTools console shows **no** "call to eval() blocked by CSP". (Iframe `script-src 'unsafe-inline' 'unsafe-eval'` is expected and required — O5.)

## Media subresource confirmation
- [ ] A card with an image paints the image (served via `freecat-media://`).
- [ ] In the iframe's DevTools console, `fetch('freecat-media://<token>/<file>')` is **rejected** (blocked by `default-src 'none'`, no `connect-src`). Media is subresource-only.
- [ ] An image referenced by another deck-set's filename does **not** load (cross-deck-set token denial).

## Isolation
- [ ] The iframe is `sandbox="allow-scripts"` (no `allow-same-origin`); card JS cannot read `window.parent.freecat` (opaque origin).

## Real-deck acceptance (O3)
- [ ] Download `https://ankiweb.net/shared/info/178384887` as `.apkg` (do NOT commit it — copyright), import it, and eyeball: Basic + Cloze render faithfully; image cards show images; `[sound:]` shows the inert chip; Image-Occlusion / unsupported notes show their placeholder and never crash or get skipped.

## Production CSP (optional, if packaging)
- [ ] In a packaged build, the app document response carries the `APP_CSP` header (`script-src 'self'`), and the card iframe still renders.

## Modern .colpkg acceptance (Plan 3)
- [ ] Export a deck from a current Anki desktop as a **.colpkg** (and/or a modern .apkg), import it via the Flashcards tab, and confirm: decks/subdecks appear with the right `::` hierarchy; Basic + Cloze render; images load; nothing falls back to `unsupported-format`.
- [ ] (Optional) Re-export the same AnkiWeb deck (O3, `178384887`) as a modern .colpkg and confirm parity with its legacy .apkg import.
