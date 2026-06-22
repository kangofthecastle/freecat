# Handoff — Content Review module

**You are building the Content Review module of FreeCAT in a dedicated session that Warren supervises.**

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

## Not yet built (coordinate — built once)
- The **gamification API** (`recordActivity(...)` on lesson completion) — emit to it when it exists; don't roll your own.

## Tables Content Review owns
Lesson progress / completion. (Lesson *content* is files.)

## Out of scope
In-app authoring; owning the taxonomy (it's shared); deep Flashcards integration (imported decks aren't in the taxonomy).
