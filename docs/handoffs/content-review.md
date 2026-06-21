# Handoff — Module 2: Content Review (lessons)

> **Paste-into-a-new-session kickoff.** Before doing anything: read `docs/freecat-charter.md` in full, then this brief. Prerequisite: the **Foundation (Phase 0) must be complete**; ideally **Qbank** exists too, since this module's value is its tight link to it. Begin with `superpowers:brainstorming`, then `superpowers:writing-plans`, then execute.

## What this module is

Readable, well-structured MCAT topic lessons delivered from bundled authored content — the "review the concept" companion to the "practice the concept" Qbank. Its defining feature is **deep integration with Qbank through the shared taxonomy**.

## Scope

- Browse lessons by the **shared taxonomy** (section → content category → topic).
- Render a lesson: Markdown body with LaTeX math and co-located images (same content pipeline as questions).
- **Tight cross-linking with Qbank** (both directions):
  - From a missed/flagged Qbank question → jump to the lesson(s) for that content category/topic.
  - From a lesson → "practice this" launches a Qbank session scoped to the same taxonomy node.
- Track **lesson progress / completion**; completion emits to the **gamification API**.

## Foundation contracts you consume (do not fork)

- **Authored-content pipeline** — lessons live as YAML(front-matter)+Markdown+images folders under `content/lessons/...`, validated by a Zod schema in CI, bundled into the app.
- **MCAT taxonomy** — every lesson is keyed to a taxonomy node; this is what makes Qbank↔lesson linking work.
- **IPC pattern** — add a `window.freecat.content.*` namespace; no direct DB access from React.
- **Gamification API** — `recordActivity(...)` on lesson completion.
- **App shell / design system** — render into the Content Review route; reuse shared components.

## Tables you own

Lesson progress / completion state. (Lesson *content* is files; the DB stores only the user's progress.)

## Module-internal decisions to make in your brainstorm

- Lesson granularity (one lesson per content category? per topic?) and ordering.
- Lesson content schema (sections, learning objectives, summary, linked questions).
- How "practice this" hands off to a Qbank session (a shared IPC call or a navigation contract — coordinate with the Qbank namespace).
- How to behave if a referenced lesson or question doesn't exist yet (graceful degradation).

## Out of scope

- Authoring lessons in-app.
- Owning the taxonomy (Foundation owns it).
- Flashcards integration beyond loose, tag-based suggestions (Flashcards content is user-imported and not in our taxonomy).
