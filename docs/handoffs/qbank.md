# Handoff — Qbank module

**You are building the Qbank module of FreeCAT in a dedicated session that Warren supervises.**

> **STATUS UPDATE (2026-06-23) — read before following the steps below.** Content Review was built in parallel and **already established the shared backbone this brief assumed Qbank would build**: the MCAT **taxonomy** (`taxonomy_node` + `topic_aamc_category`, **seeded on startup** in `src/main/index.ts`, repo `src/main/repositories/taxonomy.ts`) and the generic **content loader / pipeline v0** (`src/main/content/`). **Qbank must CONSUME these, not recreate them** — do **not** add a second taxonomy migration or a second loader (that would collide; see charter §5.2/§5.5). The taxonomy is **discipline→topic-primary** with an AAMC-code bridge; the cross-link key is the **topic slug**. For lesson↔question cross-links, implement `window.freecat.qbank.questionsForTaxonomy(ref)` (Content Review's reader already calls it defensively and stays disabled until it exists) and consume `window.freecat.contentReview.lessonForTaxonomy(ref)`. Any sections below that say "Qbank builds the pipeline/taxonomy" are superseded by this note and charter §5.1/§5.2/§5.5.

## How to run this session
1. Read `docs/freecat-charter.md` (the project source of truth), then this brief.
2. Use the superpowers flow, with Warren reviewing at each gate:
   - `superpowers:brainstorming` — design Qbank **with Warren**; the open decisions below are his to make, not yours to assume.
   - `superpowers:writing-plans` → `superpowers:subagent-driven-development`.
3. Work on your own branch (e.g. `feat/qbank`) off the foundation.

## What Qbank is
The core of FreeCAT: original MCAT practice questions delivered from bundled content files, with a strong answer-and-learn loop. This is why the app exists — make it excellent.

## Input Warren has already given (treat as decided)
- Questions have **exactly 4 answer choices**.
- Both **passage-based** questions (several questions sharing a passage) **and** standalone/discrete questions.
- **Some questions include photos/images.**
- The MCAT taxonomy (AAMC outline) is the organizing backbone — a draft already exists (see "Foundation available"); confirm/refine it, don't redo it.

## Decide in the brainstorm (open — with Warren)
- **The question content schema** — finalize the fields; how a question models its passage; how it tags into the taxonomy; how difficulty works.
- **The content pipeline itself** — the on-disk file format + a loader + validation. IMPORTANT: this is *shared* with Content Review and is **NOT pre-built**. Qbank defines and builds it here (put it in a shared spot, e.g. `src/main/content/`), and Content Review reuses it. Only a rough sketch exists (a YAML envelope + Markdown prose fields + co-located images) — a starting point, not a settled decision.
- Practice modes (tutor / immediate feedback vs. timed block), session composition (by topic / mixed / incorrect-only / flagged), and what analytics matter for v1.

## Foundation available now (built, module-agnostic)
- Electron + React **app shell with navigation** (Qbank has a placeholder route to fill in).
- **Local SQLite** via Drizzle/libsql, migrations, first-run profile.
- The **IPC pattern** (`window.freecat.<namespace>.*` with Zod validation at the main-process boundary) and the **repository convention** (electron-free, `DB`-param, `.returning()`, `noUncheckedIndexedAccess`).
- The **gamification API** — **built** (Foundation C6, PR #3). Call `window.freecat.gamification.recordActivity({ kind: 'qbank.answer', count?, taxonomyRef? })` (returns `ServiceResult<ActivityResult>`) when a question is answered; it credits XP + coins, advances the pet/egg, and updates streak + daily goal. Don't roll your own. `taxonomyRef` can carry the question's topic for future per-topic stats.
- A **draft taxonomy**: the AAMC outline (4 sections → foundational concepts → content categories; CARS skills) exists as a DB table + seed data + a query repository. (It's in code but not yet seeded on startup or exposed over IPC — finishing that small wiring is part of getting Qbank reading it.)

## You build this here (shared)
- The **content pipeline** — you build it here (shared with Content Review).

## Tables Qbank owns
Question attempts, practice sessions, flags. (Question *content* is files, not rows.)

## Out of scope
Full-length timed exams (a project non-goal); in-app question authoring; anything Content Review or Flashcards owns.
