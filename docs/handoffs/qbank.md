# Handoff — Module 1: Qbank (the heart)

> **Paste-into-a-new-session kickoff.** Before doing anything: read `docs/freecat-charter.md` in full, then this brief. Prerequisite: the **Foundation (Phase 0) must be complete**. Begin by invoking `superpowers:brainstorming` to design this module's internals, then `superpowers:writing-plans`, then execute.

## What this module is

The core FreeCAT experience: original MCAT practice questions, delivered from bundled authored content, with a great answer-and-learn loop. This is the reason the app exists — make it excellent.

## Scope

- Browse/select practice from the **shared taxonomy** (by section, content category, topic).
- A **practice session** engine: assemble a set of questions, present one at a time, accept an answer, score it, show the explanation.
- **Passage-based question sets** (CARS and the science passages): a passage shown alongside its multiple questions. This shapes the data model — questions may belong to a passage.
- **Answer + explanation flow**: 4 choices (MCAT is always 4), reveal correctness + the full Markdown/LaTeX/image explanation.
- **Flagging** and **review** (review incorrect / flagged / all).
- **Per-topic performance** so a student sees strengths/weaknesses against the taxonomy.
- Emit study activity to the **gamification API** (answered N questions → XP/streak/daily-goal).
- **Cross-link to Content Review** via the taxonomy (miss a question → offer the matching lesson). Degrade gracefully if Content Review isn't built yet.

## Foundation contracts you consume (do not fork)

- **Authored-content pipeline** — questions live as YAML+Markdown+images folders under `content/questions/...`, validated by a Zod schema in CI, bundled into the app. Use the question schema the Foundation defines; extend it via PR to the charter if you must.
- **MCAT taxonomy** — reference `contentCategory` / `skill` + `topics`.
- **IPC pattern** — add a `window.freecat.qbank.*` namespace in the main process; the renderer calls it. No direct DB access from React.
- **Gamification API** — `recordActivity(...)`; never implement your own XP/streak.
- **App shell / design system** — render into the Qbank route; reuse shared components.

## Tables you own

Question attempts, practice sessions, flags. (Authored question *content* is files, not DB rows — the DB stores only the user's interaction with it, plus whatever lightweight content registry the Foundation provides.)

## Module-internal decisions to make in your brainstorm

- **Practice modes:** tutor (immediate feedback per question) vs. block (answers at the end). Recommend starting with tutor mode.
- **Session composition:** by topic, mixed, incorrect-only, flagged-only, "fresh vs seen."
- **Passage data model:** how passages group questions on disk and in the session engine.
- **Analytics depth** for v1 (keep it lean — per-category accuracy is plenty to start).

## Out of scope

- Timed full-length exams (a project non-goal).
- In-app question authoring.
- Anything Content Review or Flashcards owns.
