# Handoff — Module 3: Flashcards (deep Anki reviewer)

**Flashcards is being built in the main session** (it has the strongest grasp of the Anki-import requirements). This brief is the scope of record; it can also seed a dedicated session if needed.

## Start here (if run as its own session)
1. Read `docs/freecat-charter.md`, then this brief.
2. `superpowers:brainstorming` (with the user) → `superpowers:writing-plans` → `superpowers:subagent-driven-development`. Own branch `feat/flashcards`.

## What this module is
A faithful, local Anki reviewer. FreeCAT provides import + rendering + spaced-repetition; the cards are **bring-your-own** (users import `.apkg`/`.colpkg`). The most self-contained module — but a meaty one (Anki import is a real sub-system, not a sat-world copy-paste).

## Deep-B scope (confirmed)
**In:**
- Import `.apkg` + `.colpkg` (legacy + modern zstd/protobuf formats).
- General note-type/template rendering (any note type via its front/back templates), cloze, media (image + audio), MathJax, tags + deck/subdeck tree.
- **FSRS** scheduling (`ts-fsrs` is a candidate; sat-world `src/lib/srs/*` is a reference/fallback, not FSRS).
- Honor a deck's existing scheduling history if present, else schedule fresh.
- **Image occlusion** (the single biggest lift).

**Out:** AnkiWeb sync, export to `.apkg`, filtered decks, arbitrary add-ons.

## Foundation contracts you CONSUME (do not rebuild)
- **Gamification API** — `recordActivity(...)` on reviews (§5.4)
- **IPC pattern** — `window.freecat.flashcards.*`; the ZIP parsing + imported-collection SQLite reads live in the main process (§5.3)
- **App shell / design system** (§5.6)
- **MCAT taxonomy** — integration is **loose** only: imported decks have their own structure, so any Qbank/lesson linking is best-effort/tag-based. Do not force imported decks into the taxonomy.

## Tables you own
Imported decks, notes, note types/templates, cards, media references, per-card FSRS scheduling/review state.

## Suggested staging (decide in planning)
1. `.apkg`/`.colpkg` import + general template rendering + cloze + media + MathJax + tags/deck tree.
2. FSRS scheduling + review UI + gamification hookup.
3. Scheduling-history import.
4. Image occlusion (last).

## Out of scope
Anything Qbank/Content Review owns; authoring/distributing FreeCAT's own card content.
