# Handoff — Qbank module

**You are building the Qbank module of FreeCAT in a dedicated session that Warren supervises.**

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
- A **draft taxonomy**: the AAMC outline (4 sections → foundational concepts → content categories; CARS skills) exists as a DB table + seed data + a query repository. (It's in code but not yet seeded on startup or exposed over IPC — finishing that small wiring is part of getting Qbank reading it.)

## Not yet built (coordinate — these are built once, centrally)
- The **content pipeline** — you build it here (shared with Content Review).
- The **gamification API** (`recordActivity(...)`, a port from sat-world) — when it exists, have Qbank emit study activity to it (answering questions → XP/streak). Don't roll your own.

## Tables Qbank owns
Question attempts, practice sessions, flags. (Question *content* is files, not rows.)

## Out of scope
Full-length timed exams (a project non-goal); in-app question authoring; anything Content Review or Flashcards owns.
