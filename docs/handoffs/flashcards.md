# Handoff — Module 3: Flashcards (deep Anki reviewer)

> **Paste-into-a-new-session kickoff.** Before doing anything: read `docs/freecat-charter.md` in full, then this brief. Prerequisite: the **Foundation (Phase 0) must be complete**. Begin with `superpowers:brainstorming`, then `superpowers:writing-plans`, then execute.

## What this module is

A **faithful, local Anki reviewer**. FreeCAT provides the import + rendering + spaced-repetition engine; the *cards* are **bring-your-own** — users drop in any `.apkg` / `.colpkg` deck they've downloaded (the free MCAT deck ecosystem is excellent). FreeCAT distributes no third-party decks.

This is the most self-contained module and also a meaty one — Anki import is a real sub-system, not a sat-world copy-paste. Budget for it.

## Scope ("deep B" — confirmed)

**In:**
- Import **`.apkg` and `.colpkg`** (a ZIP wrapping a SQLite collection + a media map + media files). Note: modern Anki exports may use the newer `collection.anki21b` format (zstd-compressed) with protobuf metadata — handle both legacy and modern.
- **General note-type/template rendering** — render *any* note type via its front/back card templates (conditional fields `{{#field}}`, etc.), not just special-casing Basic. This uniformly covers most decks.
- **Cloze** deletions (`{{c1::...}}`).
- **Media:** images and audio.
- **MathJax / LaTeX** rendering (med decks lean on it heavily).
- **Tags** and the **deck / subdeck** tree.
- **FSRS scheduler** — what serious Anki users expect in 2026. Consider the `ts-fsrs` package. (sat-world's `src/lib/srs/` scheduler is a strong reference / fallback, but it is not FSRS — decide in your brainstorm whether to extend it or adopt `ts-fsrs`.)
- **Honor a deck's existing scheduling history if present**; otherwise schedule imported cards as fresh. (Most downloaded decks ship effectively fresh.)
- **Image occlusion** — hugely popular in med Anki. Both the newer built-in Image Occlusion note type and the legacy add-on format exist; support at least the modern one. **This is the single biggest lift in the module.**

**Out:**
- AnkiWeb sync, exporting back to `.apkg`, filtered/custom-study decks, arbitrary add-on behaviors.

## Foundation contracts you consume (do not fork)

- **IPC pattern** — add a `window.freecat.flashcards.*` namespace; Drizzle/SQLite access stays in main. The Anki ZIP parsing + the imported collection's SQLite reading also belong in the main process.
- **Gamification API** — `recordActivity(...)` on reviews so flashcard study feeds the same pet/streak/XP/daily-goal.
- **App shell / design system** — render into the Flashcards route; reuse shared components.
- **MCAT taxonomy** — integration is **loose**: imported decks have their own structure we don't control, so any linking to Qbank/lessons is best-effort, tag-based. Do not force imported decks into the taxonomy.

## Tables you own

Imported decks, notes, note types/templates, cards, media references, and per-card scheduling/review state (FSRS parameters + review log).

## Suggested internal staging (decide in your plan)

1. `.apkg`/`.colpkg` import + general template rendering + cloze + media + MathJax + tags/deck tree.
2. FSRS scheduling + review UI + gamification hookup.
3. Scheduling-history import.
4. Image occlusion (last — biggest lift).

## Out of scope

- Anything Qbank or Content Review owns.
- Authoring/distributing FreeCAT's own card content (cards are user-imported).
