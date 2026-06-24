# Qbank (Module 1) — Design Spec

_Date: 2026-06-23 · Project: FreeCAT · Read `docs/freecat-charter.md` first (source of truth) and `docs/handoffs/qbank.md`; this spec is the working design for the Qbank module and the **shared content contracts** it establishes (charter §5.1 taxonomy, §5.5 authored-content pipeline)._

> **What this module establishes for the whole project:** Qbank is the first content module, so besides its own practice loop it builds two **shared** pieces that Content Review later reuses: the **MCAT taxonomy** (table + seed + repository + read IPC) and the **authored-content pipeline** (on-disk format + Zod schemas + loader + image serving + CI validation). These live in shared locations (`src/main/db` taxonomy, `src/main/content/`), not under a Qbank-only namespace.

## Goal

Deliver the heart of FreeCAT: **original MCAT practice questions with an excellent answer-and-learn loop.** A student composes a practice session (by section / content-category / mixed, optionally narrowed to questions they got wrong or flagged), answers four-choice questions — some passage-based, some with images — and on every submit immediately sees whether they were right, the correct choice, and an explanation that includes why each distractor is wrong. Performance is tracked by taxonomy and surfaced as a strengths/weaknesses dashboard that feeds back into the composer. Answering emits study activity to the existing gamification loop.

## Scope

**In:**
- The **MCAT taxonomy**, established and wired (reuse the 48-node AAMC draft from git history).
- The **authored-content pipeline** (shared): on-disk YAML+Markdown format, per-type Zod schemas, a main-process loader + in-memory index, an Electron content protocol for images, and a `content:validate` CI gate.
- Qbank's own tables + repositories: **practice sessions, attempts, flags**.
- The **practice session engine**: composer → tutor-mode session → authoritative grading → end-of-session summary.
- The **performance dashboard** (overall + by-section + by-content-category accuracy; flagged/incorrect counts).
- **Gamification integration** (`recordActivity({ kind: 'qbank.answer', taxonomyRef })`).
- Renderer: Markdown + math (KaTeX) + image rendering; the full Qbank screen set.
- A small set of **genuinely original seed questions** + an authoring guide.

**Out (deferred / non-goals):** the **timed-block mode UI** (schema is mode-ready, but v1 ships tutor/immediate-feedback only) · **question difficulty** (no difficulty field anywhere) · **in-app question authoring** (content is contributed as files via GitHub PRs) · **spaced repetition of questions** (that is Flashcards' domain; "drill my incorrects" is a filter, not SRS) · **full-length timed exams** (project non-goal) · **topic-level (free-form) analytics** (the `topics` tag is stored on attempts but not surfaced in the v1 dashboard) · the live **Content-Review lesson jump** (the taxonomy makes "missed → lesson" *ready*, but the jump is a stub until Content Review ships).

## The product shape (decided with Warren in the brainstorm)

1. **Four choices**, passage-based **and** standalone questions, **images allowed anywhere prose appears** (stem, passage, any of the 4 choices, explanation).
2. **Tutor mode** is the v1 flagship: submit → immediate feedback. Sessions carry a `mode` field so a timed block drops in later with no migration.
3. **Explanation** = a required main rationale + an optional per-choice "why it's wrong" map for the distractors.
4. **Composer** = `scope` (a section / a content category / a CARS skill / mixed) × `refine` (all / incorrect / flagged) × `length`. **Passage sets are always pulled whole.**
5. **Analytics** = end-of-session summary + a persistent dashboard (overall, by section, by content category) that taps through into the composer.
6. **No difficulty.**

---

## The authored-content format (the shared contract)

One folder per item. A **YAML envelope** holds the fields; every **prose field is Markdown** (LaTeX math + `![](image)` embeds allowed); **images are co-located files** referenced by relative path.

```
content/
  questions/<section>/<id>/question.yaml   + figure-*.png   # standalone / discrete
  passages/<section>/<id>/passage.yaml     + figure-*.png   # passage sets
  README.md                                                 # authoring guide
```

`<section>` ∈ `chem-phys | cars | bio-biochem | psych-soc` (organizational; the loader cross-checks it against the section *derived* from the taxonomy tag).

**Standalone question** (`question.yaml`):

```yaml
id: cp-0042-doppler                 # stable, globally unique; the attempt/flag key
contentCategory: "4A"               # XOR `skill` for CARS; section is derived from this
topics: [doppler-effect]            # optional free-form tags (not taxonomy nodes)
stem: |
  A sonographer measures blood flow toward the probe.
  ![Doppler trace](figure-1.png)
choices:                            # exactly 4 (validation enforces it); Markdown each
  - "Observed frequency rises"
  - "Observed frequency falls"
  - "Wavelength is unchanged"
  - "Speed of sound doubles"
correct: A                          # a letter A–D (A = the first choice)
explanation: |
  An approaching source compresses successive wavefronts, so the
  observed frequency increases (Doppler effect).
choiceExplanations:                 # optional, may be partial (distractors)
  B: "Falling frequency is the *receding* case."
  C: "Wavelength shortens as the source approaches."
  D: "The medium is unchanged; wave speed is fixed."
```

**Passage set** (`passage.yaml`) — passage prose + an ordered list of its questions in one file:

```yaml
id: bb-0007-enzyme-kinetics
contentCategory: "1A"               # passage-level tag → section + default for its questions
topics: [enzyme-kinetics]
passage: |
  ...Markdown prose, may embed ![](figure-1.png)...
questions:                          # ordered; each item is a question minus its passage
  - id: bb-0007-q1
    # contentCategory/skill optional here — inherits the passage's unless overridden
    stem: | ...
    choices: ["...", "...", "...", "..."]
    correct: C
    explanation: | ...
    choiceExplanations: { ... }
  - id: bb-0007-q2
    ...
```

- **Taxonomy tag:** science items carry `contentCategory` (a content-category code); CARS items carry `skill` (a CARS skill code). Exactly one is required. **Section is derived** from the tag via the taxonomy lineage and validated against the folder. Passage questions inherit the passage's tag but may override (notably CARS, where skills vary per question).
- **Normalization:** the loader flattens both forms into one internal `Question` shape; passage questions are stamped with their `passageId`. Relative image paths are rewritten to the `freecat-content://` protocol (see C2).

---

## Components

Each lists **purpose / interface / dependencies**.

### C1 — MCAT taxonomy (establish & wire) — *shared*
- **Purpose:** the single hierarchy questions tag into and the composer/dashboard browse (charter §5.1).
- **Interface:** `taxonomy_node` table `{ id (text pk), kind, code, title, parentId }` in `src/main/db/schema/taxonomy.ts`; the **48-node AAMC seed** ported from git history (`taxonomy-seed-data.ts`) applied by an **idempotent startup seed** (`seedTaxonomy`, upsert on `id`); a read repository (`listAll`, `listSections`, `getByCode`, `getChildren`, `getDescendants`); a read-only `taxonomy` IPC namespace (`taxonomy.list()`).
- **Reuse:** adapt commits `6b3880a` (schema) + `181bdec` (seed/repo/test) from the single-file `schema.ts` into the current `schema/` directory layout. Leaf `topics` stay free-form (not seeded).
- **Depends on:** Foundation C2 (DB), C3 (IPC).

### C2 — Authored-content pipeline (loader, validation, images) — *shared*
- **Purpose:** turn the on-disk content tree into a validated in-memory index the engine queries; serve co-located images; gate contributions in CI.
- **Interface:** `src/main/content/` —
  - `schema.ts`: Zod schemas (`questionSchema`, `passageSchema`) enforcing exactly-4 choices, a valid `correct` letter, a taxonomy tag that resolves to a known code, well-formed `choiceExplanations` keys, and existing relative image paths.
  - `loader.ts`: at main startup, scan `questions/` + `passages/` → parse YAML (`js-yaml`) → validate → build indices (`byId`, `bySection`, `byContentCategory`, `bySkill`, `passagesById`). Source root = repo `content/` in dev, `process.resourcesPath/content` in prod.
  - `images.ts`: register an Electron custom protocol `freecat-content://` that serves files **only** from the content root (path-escape–guarded); the loader rewrites `![](rel.png)` to it.
  - `types.ts`: internal `Question` / `Passage` and the renderer-facing `PresentedQuestion` (no answer key) / `PresentedPassage` / `AnswerResult` DTOs.
  - `validate.ts` + `npm run content:validate`: the same Zod pass over the whole tree, exit-non-zero on any error — wired into CI.
- **Boundary:** the loader framework is content-type-agnostic so Content Review adds a `lessonSchema` beside the question/passage schemas without forking it.
- **Depends on:** C1 (code validation), Foundation C1.

### C3 — Qbank tables & repositories
- **Purpose:** persist sessions, attempts, flags; compute analytics — all electron-free and unit-tested.
- **Interface:** `src/main/db/schema/qbank.ts` (tables below) + repositories in `src/main/repositories/`:
  - `qbank-sessions.ts` — `createSession`, `getSession`, `completeSession`.
  - `qbank-attempts.ts` — `recordAttempt` (grades + inserts, denormalizing taxonomy tags), `latestIncorrectQuestionIds`, `getSessionAttempts`.
  - `qbank-flags.ts` — `toggleFlag`, `listFlaggedIds`, `isFlagged`.
  - `qbank-analytics.ts` — `getDashboard` (overall + per-section + per-content-category accuracy via SQL `GROUP BY`), `getCounts` (incorrect, flagged).
- **Convention:** `DB`-param, `.returning()`, destructure-and-guard under `noUncheckedIndexedAccess`; **inject `now`** (mirroring the gamification now/tz convention) so time-dependent rows are deterministic in tests.
- **Depends on:** Foundation C2.

### C4 — Practice session engine + gamification
- **Purpose:** plan a session from the composer inputs, grade answers authoritatively, fire gamification, summarize.
- **Interface:** `src/main/repositories/qbank-session-planner.ts` (or in `qbank-sessions.ts`) —
  - **Plan:** resolve eligible question **units** (a standalone question or a whole passage set) from the in-memory index by `scope`, intersect with `refine` (incorrect ⇒ `latestIncorrectQuestionIds`; flagged ⇒ `listFlaggedIds`), shuffle (with an **injectable `rng`** for deterministic tests, mirroring the gamification `Rng` pattern), take units until `requestedCount` questions are reached (a passage set is taken whole even if it slightly overshoots), persist the session row, return `PresentedQuestion[]` + `passages` map (no answers).
  - **Grade:** `submitAnswer` records the attempt (with denormalized `section`/`contentCategory`/`skill`), then calls `recordActivity({ kind: 'qbank.answer', taxonomyRef: <contentCategory|skill> })` **in a separate transaction** (gamification is a side-effect, not part of attempt atomicity), and returns `{ correct, correctChoice, explanation, choiceExplanations, activity }`.
  - **Summary:** `completeSession` marks `completedAt` and returns score + per-question review rows from the session's attempts.
- **Semantics:** `incorrect` refine = questions whose **latest** attempt was wrong (getting one right later drops it from the drill). Passage-intactness means a drilled passage question brings its siblings along for context.
- **Depends on:** C2, C3, Foundation C6 (gamification `recordActivity`).

### C5 — Qbank IPC namespace
- **Purpose:** the renderer's only path to the engine; Zod-validated at the boundary.
- **Interface:** `src/main/ipc/qbank.ts` (`registerQbankIpc`) + `src/main/ipc/taxonomy.ts` (`registerTaxonomyIpc`); channels in `src/shared/channels.ts`; `FreecatApi` extended in `src/shared/api.ts`; DTOs in `src/shared/dto.ts` (or `dto/qbank.ts`). Operations on `window.freecat`:
  - `taxonomy.list()` → `TaxonomyNode[]`
  - `qbank.getComposerData()` → `{ incorrectCount, flaggedCount, totalQuestions }`
  - `qbank.startSession(input)` → `{ sessionId, mode, questions, passages }`
  - `qbank.submitAnswer(input)` → `ServiceResult<AnswerResult & { activity: ActivityResult | null }>`
  - `qbank.completeSession(sessionId)` → `SessionSummary`
  - `qbank.toggleFlag(questionId)` → `ServiceResult<{ flagged: boolean }>`
  - `qbank.getDashboard()` → `DashboardStats`
- **Zod:** `startSessionSchema` (`scopeKind` enum, optional `scopeCode`, `refine` enum, `count` 1–100), `submitAnswerSchema` (`sessionId` int, `questionId` string, `choice` A–D, optional `timeMs`), `completeSessionSchema`, `toggleFlagSchema`.
- **Depends on:** C1, C4. Adopt the charter §5.3 IPC hardening already in place (shared DTOs + channel constants + typed `FreecatApi`).

### C6 — Renderer: practice UI
- **Purpose:** the answer-and-learn experience.
- **Interface:** `src/renderer/src/pages/Qbank.tsx` drives a local sub-view machine (`composer | session | summary | dashboard`) — the app uses a route registry, not a nested router. Components in `src/renderer/src/qbank/`:
  - `Composer.tsx` — taxonomy scope picker (tree from `taxonomy.list()`), refine radios with live counts, length picker, Start.
  - `Session.tsx` — holds the session payload; tracks position; renders the current question with its `PassagePane` when it has a `passageId`.
  - `QuestionView.tsx` + `ChoiceList.tsx` — stem + 4 selectable choices; on submit shows correctness, `Explanation`, a flag toggle, and Next.
  - `PassagePane.tsx` — the passage Markdown shown alongside its questions (sticky while moving through siblings).
  - `Explanation.tsx` — main explanation + per-choice rationale, correct choice highlighted, your wrong pick marked.
  - `SessionSummary.tsx` — score, time, tap-through review.
- **Depends on:** C5, C8.

### C7 — Renderer: performance dashboard
- **Purpose:** turn practice into directed study.
- **Interface:** `src/renderer/src/qbank/Dashboard.tsx` — overall accuracy; a by-section row (always present) and a by-content-category heatmap (fills in as practiced); flagged/incorrect counts. Tapping a weak content category opens the composer pre-scoped to it. Reads `qbank.getDashboard()`.
- **Depends on:** C5.

### C8 — Markdown + math + image rendering
- **Purpose:** faithfully render authored prose everywhere it appears.
- **Interface:** `src/renderer/src/qbank/Markdown.tsx` using **react-markdown + remark-math + rehype-katex (KaTeX)**; raw HTML left **disabled** (no `rehype-raw`) so authored content cannot inject HTML. Image `src` values already point at `freecat-content://` (rewritten by the loader). KaTeX CSS imported once.
- **Depends on:** C2 (image protocol). New renderer deps: `react-markdown`, `remark-math`, `rehype-katex`, `katex`.

### C9 — Seed content, authoring guide & CI
- **Purpose:** exercise the pipeline end-to-end and make the repo contributor-ready.
- **Interface:** a small set of **original** questions spanning the sections — at minimum one C/P standalone with an image, one B/B passage set (2–3 Qs), one P/S standalone, one CARS passage set (2 Qs) — under `content/`; `content/README.md` authoring guide (format, taxonomy codes, image rules, the `correct`-letter + 4-choice rules); the `content:validate` npm script wired into the project's CI (alongside Foundation C8 when it lands). All content original or openly licensed — never copyrighted exam material (charter §5.7, `CONTENT-LICENSE.md`).
- **Depends on:** C2.

## Shared data model (Qbank-owned tables)

```
qbank_session
  id            integer pk autoincrement
  mode          text     not null default 'tutor'      -- 'tutor' | 'timed' (future)
  scope_kind    text     not null                      -- 'mixed' | 'section' | 'content_category' | 'skill'
  scope_code    text                                   -- taxonomy code when scoped, else null
  refine        text     not null default 'all'        -- 'all' | 'incorrect' | 'flagged'
  requested_count integer not null
  created_at    integer(timestamp) not null
  completed_at  integer(timestamp)

qbank_attempt
  id            integer pk autoincrement
  session_id    integer  not null references qbank_session(id)
  question_id   text     not null
  passage_id    text                                   -- null for standalone
  section       text     not null                      -- denormalized for SQL analytics
  content_category text                                -- null for CARS
  skill         text                                   -- null for science
  chosen        text     not null                      -- 'A'..'D'
  is_correct    integer(boolean) not null
  time_ms       integer
  answered_at   integer(timestamp) not null
  indexes: (session_id), (question_id), (section), (content_category)

qbank_flag
  id            integer pk autoincrement
  question_id   text     not null unique               -- a per-question toggle
  note          text
  created_at    integer(timestamp) not null
```

Question/passage **content** is files, never rows. Attempts denormalize the taxonomy tag at answer time so the dashboard is a pure SQL aggregation that never re-reads content files. Foundation tables are referenced by meaning only, never altered.

## Suggested internal build sequence

1. **Q1** — C1 taxonomy: table + ported seed + idempotent startup seeding + repository + `taxonomy.list()` IPC. (Port the git-history TDD test.)
2. **Q2** — C2 pipeline: Zod schemas + loader + `freecat-content://` protocol + `content:validate`, loading a tiny fixture tree; loader tests (valid loads, invalid fails each way).
3. **Q3** — C3 tables + repositories with unit tests (sessions, attempts grading/denormalization, flag toggle, analytics aggregation).
4. **Q4** — C4 session planner + `submitAnswer` grading + gamification hook; C5 IPC namespace + Zod + shared DTOs/channels/typed `FreecatApi`; IPC-validation tests.
5. **Q5** — C8 rendering infra + C6 practice UI wired through IPC (composer → session → explanation → summary).
6. **Q6** — C7 dashboard; dashboard→composer pre-scoping.
7. **Q7** — C9 seed content + authoring guide + `content:validate` CI wiring; end-to-end smoke.

## Testing

- **Unit (Vitest, in-memory libsql):** session creation/planning, attempt grading + denormalization, latest-incorrect logic, flag toggle, dashboard aggregations; taxonomy seed idempotency (ported test).
- **Loader:** a fixture tree loads; invalid fixtures fail clearly — missing answer, `choices ≠ 4`, unknown taxonomy code, broken image path, bad `choiceExplanations` key.
- **IPC validation:** Zod rejects malformed `startSession` / `submitAnswer` / `toggleFlag` payloads.
- **Smoke:** boot → seed taxonomy → load content → compose a session → submit answers (immediate feedback + gamification fires) → complete → dashboard reflects the attempts.

## Acceptance criteria

1. On boot, the taxonomy is seeded idempotently and `taxonomy.list()` returns the 48-node tree; content loads from files (dev repo / prod `resourcesPath`).
2. `content:validate` fails a tree with a missing answer, `choices ≠ 4`, an unknown taxonomy code, or a broken image path — with a clear message.
3. The composer builds a session by `scope` × `refine` × `length`; **passage sets are intact**; `incorrect`/`flagged` filters work off the attempt/flag tables.
4. Tutor flow: the renderer presents a question **without** its answer key; submit returns immediate correctness + the correct choice + explanation + per-choice rationale; the attempt is recorded and `recordActivity({ kind: 'qbank.answer', taxonomyRef })` fires.
5. Images render anywhere (including inside a choice) via `freecat-content://`; math renders via KaTeX; authored raw HTML is not executed.
6. The session summary shows score + time + tap-through review; the dashboard shows overall + by-section + by-content-category accuracy from SQL, and a content category taps through into a pre-scoped composer.
7. No renderer code reads an answer key except through `submitAnswer` grading, and no renderer code touches SQLite directly.
8. The full unit/loader/IPC test suite passes.

## Risks & notes

- **Packaged image paths:** the `freecat-content://` root differs dev vs. prod (`resourcesPath`); verify on a *packaged* build early (ties to Foundation C8 bundling content as an `extraResources`).
- **Protocol safety:** the content protocol must resolve only within the content root (reject `..` escapes); never serve arbitrary disk paths.
- **Markdown safety:** keep raw-HTML rendering disabled so community Markdown can't inject HTML/scripts.
- **Section derivation needs the taxonomy first:** load/seed taxonomy before validating content codes; `content:validate` loads the seed to resolve codes.
- **Passage-intactness vs. count:** a passage set is taken whole and may slightly overshoot `requestedCount`; document this (acceptable for v1).
- **In-memory index scale:** fine for a bundled question bank (small text records; images stay on disk); revisit only if content grows very large.
- **Shared-pipeline discipline:** `src/main/content/` and the taxonomy are shared contracts — Content Review extends them (a lesson schema), it does not fork them (charter §5).
- **Content-Review seam:** attempts are taxonomy-tagged so "missed → jump to lesson" is data-ready; the jump itself is a no-op stub until Content Review exists.
