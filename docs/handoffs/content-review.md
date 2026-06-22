# Handoff — Module 2: Content Review (lessons)

**You are building the Content Review module of FreeCAT in a dedicated, user-supervised session.**

## Start here
1. Read `docs/freecat-charter.md` (single source of truth), then this brief.
2. Run the superpowers flow with the user (Warren) reviewing at each gate:
   - `superpowers:brainstorming` — design internals **with the user** (their decisions, don't assume).
   - `superpowers:writing-plans` → `superpowers:subagent-driven-development`.
3. Work on your own branch (e.g. `feat/content-review`).
4. Best built after / alongside Qbank, since this module's value is its tight link to it.

## What this module is
Readable MCAT topic lessons from bundled authored content — the "review the concept" companion to Qbank's "practice the concept." Defining feature: deep cross-linking with Qbank through the shared taxonomy.

## Foundation contracts you CONSUME (do not rebuild — Foundation-owned, built once)
- **Authored-content pipeline** — lessons as YAML/front-matter + Markdown + images (§5.5)
- **MCAT taxonomy** — every lesson keyed to a node; this is what makes Qbank↔lesson linking work (§5.1)
- **Gamification API** — `recordActivity(...)` on lesson completion (§5.4)
- **IPC pattern** — `window.freecat.content.*`; no DB access from the renderer (§5.3)
- **App shell / design system** — render into the Content Review route (§5.6)

> If one of these isn't built yet, coordinate — it's built once in the Foundation, not here.

## Tables you own
Lesson progress / completion. (Lesson *content* is files.)

## Bring to the brainstorm (decisions for the user)
- Lesson granularity (per content category? per topic?) + ordering.
- Lesson content schema (learning objectives, body, summary, linked questions).
- How "practice this" hands off to a Qbank session (coordinate with the `qbank` IPC namespace).
- Graceful behavior if a referenced lesson/question doesn't exist yet.

## Out of scope
In-app authoring; owning the taxonomy (Foundation owns it); deep Flashcards integration (imported decks aren't in our taxonomy).
