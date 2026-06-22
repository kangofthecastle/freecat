# Handoff — Module 1: Qbank (the heart)

**You are building the Qbank module of FreeCAT in a dedicated, user-supervised session.**

## Start here
1. Read `docs/freecat-charter.md` in full — the single source of truth for the project (architecture, the shared contracts you must consume, non-goals).
2. Read this brief.
3. Run the superpowers flow, with the user (Warren) reviewing at each gate:
   - `superpowers:brainstorming` — design this module's internals **with the user**; the implementation decisions are theirs to make, don't assume them.
   - `superpowers:writing-plans` — turn the agreed design into a plan.
   - `superpowers:subagent-driven-development` — build it task-by-task with review.
4. Work on your own branch (e.g. `feat/qbank`) off the foundation, to stay isolated from the other module sessions.

## What this module is
The core FreeCAT experience: original MCAT practice questions delivered from bundled authored content, with a great answer-and-learn loop. This is why the app exists — make it excellent.

## Foundation contracts you CONSUME (do not rebuild — Foundation-owned, built once)
- **Authored-content pipeline** — questions as YAML + Markdown + images, validated by Zod in CI, bundled (charter §5.5)
- **MCAT taxonomy** — tag questions to content category / topic (§5.1)
- **Gamification API** — `recordActivity(...)`; never roll your own XP/streak (§5.4)
- **IPC pattern** — add a `window.freecat.qbank.*` namespace; no DB access from the renderer (§5.3)
- **App shell / design system** — render into the Qbank route (§5.6)

> If one of these isn't built yet, **coordinate — it is built once in the Foundation, not here.** Do not fork or reinvent it.

## Tables you own
Question attempts, practice sessions, flags. (Question *content* is files, not rows.)

## Bring to the brainstorm (decisions for the user)
- Practice modes: tutor (immediate feedback) vs. block (answers at the end).
- Session composition: by topic / mixed / incorrect-only / flagged-only.
- Passage-based question sets (CARS + science passages) — data model + UI.
- Analytics depth for v1 (keep lean).

## Out of scope
Full-length timed exams (project non-goal); in-app authoring; anything Content Review or Flashcards owns.
