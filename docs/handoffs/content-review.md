# Handoff — Content Review module

**You are building the Content Review module of FreeCAT in a dedicated session that Warren supervises.**

> **STATUS UPDATE (2026-06-23) — this module is BUILT.** Implemented on branch `content-review-implementation` (spec: `docs/superpowers/specs/2026-06-23-content-review-design.md`; plan: `docs/superpowers/plans/2026-06-23-content-review.md`). It also **established the shared taxonomy** (`taxonomy_node` + `topic_aamc_category`, seeded on startup) and the **generic content loader** (`src/main/content/`) for Qbank to consume. Lessons are discipline→topic, authored as self-contained interactive HTML rendered in a sandboxed iframe; completion calls `recordActivity({ kind: 'lesson.complete' })` once. Remaining: the Qbank side of the cross-links (`questionsForTaxonomy` + the practice deep-link) lands when Qbank ships.

## How to run this session
1. Read `docs/freecat-charter.md` (the project source of truth), then this brief.
2. Use the superpowers flow, with Warren reviewing at each gate:
   - `superpowers:brainstorming` — design Content Review **with Warren**; the open decisions below are his.
   - `superpowers:writing-plans` → `superpowers:subagent-driven-development`.
3. Work on your own branch (e.g. `feat/content-review`).
4. **Best built after Qbank** — it reuses the content pipeline + taxonomy usage Qbank establishes, and it links to real Qbank questions.

## What Content Review is
Readable MCAT topic lessons. Per Warren: it **links into Qbank but is ultimately separate** — its own module that cross-references Qbank through the shared taxonomy, not something bolted onto Qbank.

## Input Warren has already given (treat as decided)
- Content Review is a **separate module** from Qbank (own screens, own data).
- It **cross-links with Qbank** via the shared taxonomy (e.g. a lesson points to related practice questions; a missed question can point back to the relevant lesson).

## Decide in the brainstorm (open — with Warren)
- The **lesson content schema** + granularity (per content category? per topic?).
- **How the cross-links to Qbank work** in practice (the navigation / IPC contract — coordinate with Qbank's namespace).
- Completion / progress tracking.

## Foundation available now
- App shell + navigation (Content Review has a placeholder route to fill in); local SQLite via Drizzle/libsql; the IPC + repository conventions; first-run profile.
- The **draft taxonomy** (the same shared backbone Qbank uses).
- The **content pipeline that Qbank establishes** — reuse it for lessons; do **not** build a second one. (If Qbank isn't done yet, coordinate — the pipeline is shared.)

## Gamification (built — Foundation C6, PR #3)
- Call `window.freecat.gamification.recordActivity({ kind: 'lesson.complete', count?, taxonomyRef? })` (returns `ServiceResult<ActivityResult>`) on lesson completion; it credits XP + coins, advances the pet/egg, and updates streak + daily goal. Don't roll your own. `taxonomyRef` can carry the lesson's topic.

## Tables Content Review owns
Lesson progress / completion. (Lesson *content* is files.)

## Out of scope
In-app authoring; owning the taxonomy (it's shared); deep Flashcards integration (imported decks aren't in the taxonomy).
