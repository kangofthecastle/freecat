# Qbank ↔ Shared Spine Reconciliation — Design Spec

**Status:** Approved (design reviewed against `origin/main` by an Opus reviewer; verdict SOUND-WITH-CHANGES, corrections folded in). Supersedes nothing — extends the original Qbank design (`2026-06-23-qbank-design.md`) to the shared backbone.

**Goal:** Reconcile the working Qbank module onto the shared **discipline→topic** taxonomy and shared content pipeline that Content Review (CR) merged to `main` (PR #5), without rebuilding Qbank — adding a Physics discipline, removing CARS, retiring the AAMC bridge, unifying the content directory, and wiring topic-level cross-links both ways.

**Architecture:** One `git merge origin/main` brings CR's backbone in; Qbank's data/engine/renderer are re-based from an AAMC-section axis onto discipline→topic. Questions and lessons share one content directory and one asset protocol but keep distinct loaders (`scanContent` for questions, `LessonStore` for lessons). Tags become per-item, multi-vocabulary, held in the in-memory content index and validated against a TS vocabulary constant. Cross-links resolve on the shared topic slug.

**Tech stack:** Electron + electron-vite + React 19 + TypeScript (`noUncheckedIndexedAccess`), Drizzle + @libsql/client, Zod-validated typed IPC, Vitest (node env).

---

## 1. Context: what changed, what stays

Content Review settled the shared MCAT taxonomy as **discipline→topic** (`taxonomy_node`, 5 disciplines / 25 topics, each topic carrying AAMC codes via the `topic_aamc_category` bridge) and a content pipeline v0 (`loadContentType` + `LessonStore`). This **supersedes** Qbank's AAMC‑48 taxonomy and standalone pipeline built on `feat/qbank`.

**Stays (do not rebuild):** the Qbank tables/repos (`qbank_session/attempt/flag` + sessions/attempts/flags/analytics), the session engine (planner, authoritative grading, `recordActivity` side-effect, summarize), the `qbank` IPC shape, the renderer screens (Session/QuestionView/ChoiceList/PassagePane/Explanation/SessionSummary + Markdown/KaTeX), the `freecat-content://` image protocol, the `content:validate` CLI, and the CI workflow.

**Changes (this spec):** the taxonomy axis under all of it (AAMC section/contentCategory/skill → discipline→topic + per-item AAMC tags), the content loader's tag resolution, the Composer/Dashboard, and the cross-module wiring.

## 2. The decided model (settled with Warren — not reopened here)

- **Primary spine = discipline→topic**, canonical for both lessons and questions.
- **Add a 6th discipline `physics`** with four topics (AAMC physics codes 4A–4D).
- **CARS is excluded from the app entirely** — no CARS section, no CARS questions, and the `skill` tagging axis (whose only purpose was CARS) is removed.
- **Retire `topic_aamc_category`.** Tags are per-item, multi-vocabulary (AAMC now, Kaplan later).
- **Questions:** exactly one primary topic for v1 (index models question↔topic join-style so multi-topic later needs no migration) + zero-or-more AAMC tags.
- **Composer + Dashboard organized by discipline→topic;** AAMC is an optional secondary filter/breakdown.
- **Cross-links are topic-level both ways.**
- **One shared content pipeline** (one directory, one asset protocol) serving questions (co-located figures, passages) and lessons (self-contained HTML + section anchors).

## 3. Shared taxonomy: adopt + extend

- Adopt main's `taxonomyNode` verbatim: `{ id:int PK autoinc, kind:'discipline'|'topic', slug unique, title, parentId:int self-FK, sortOrder int }`. **Drop `topicAamcCategory`** from the schema (the regenerated migration drops the table).
- **Add `physics`** to `DisciplineKey` (`shared/dto.ts`) and to `DISCIPLINES` in `db/seed/taxonomy-data.ts` (append last — `seedTaxonomy` throws on a topic whose discipline isn't seeded; sortOrder is positional). Four topics:
  - `physics.mechanics` — Mechanics: translational motion, force, work, energy, equilibrium (AAMC 4A)
  - `physics.fluids` — Fluids & Gases (4B)
  - `physics.electrostatics-circuits` — Electrostatics & Circuits (4C)
  - `physics.waves-sound-light` — Waves, Sound & Light (4D)
- **Cross-module effect (intended):** `composeOutline` shows every topic and marks `available` only when a lesson with that slug exists, so adding four lesson-less physics topics surfaces four "no lesson yet" rows in CR's browse. Acceptable and expected.
- `DisciplineKey` has **no exhaustive consumers** on main (no `switch`/`Record<DisciplineKey,…>`); adding `'physics'` is additive-safe. Consumer sites to touch: `shared/dto.ts` (def), `db/seed/taxonomy-data.ts` (seed).

## 4. Tagging system (replaces the AAMC bridge)

- **No DB tag table, no join tables.** Tags live on the authored items and are held in the in-memory content index. Rationale: questions/lessons are file content (the DB holds attempts/progress, not questions); the only consumers — the Composer filter dropdown, the Dashboard AAMC breakdown, and load/CI validation — never query SQL for tags. This mirrors main's existing `AAMC_CONTENT_CATEGORIES`/`AAMC_CODES` TS constants.
- **`CONTENT_TAG_VOCAB`** — a TS constant `{ vocab: 'aamc'|'kaplan'|…; code: string; title: string }[]`, seeded with the 31 AAMC categories under `vocab:'aamc'` (reuse main's `AAMC_CONTENT_CATEGORIES`). Kaplan and others append later with no schema change. Lives in shared/main content code; the Composer reads it (via IPC) to populate the filter; the loader + `content:validate` validate item tags against it.
- A `Tag` DTO: `{ vocab: string; code: string }`.

## 5. Content pipeline reconciliation (keep two loaders, one directory)

- **`loader.ts` is an add/add conflict** — resolve by keeping BOTH mechanisms in `src/main/content/`:
  - **Lessons:** keep main's generic `loadContentType<T>({root,subdir,envelopeFile,schema})` + `readBody` + `LessonStore` verbatim. The lesson path is unchanged except the envelope/`getLesson` tag change in §8.
  - **Questions:** fold in Qbank's bespoke `scanContent`/`loadContent` + `images.ts` (the `freecat-content://` protocol) + `validate.ts`, rewritten for the topic axis (below).
  - "One pipeline" = one `contentRoot()`, one asset protocol, one `content/` tree — not one function.
- **Rewrite the question loader's tag axis (the real work):**
  - **New envelope** (`schema.ts`): `topic: <topic-slug>` (required, one for v1) + `tags: Tag[]` (default `[]`). Remove `contentCategory`/`skill`, the `exactlyOneTag`/`atMostOneTag` refinements, and the section-from-folder coupling. `stem`/`choices`(4)/`correct`/`explanation`/`choiceExplanations` unchanged. Passages: same change to the passage envelope; sub-questions inherit the passage's topic and may carry their own `tags`.
  - **New resolution** (`resolveTopic`, replacing `resolveTag`): validate `topic` exists in the taxonomy seed; derive `discipline` from the topic's parent; derive `section` (3-way `'chem-phys'|'bio-biochem'|'psych-soc'`) from discipline via a fixed map: `gen-chem,o-chem,physics → chem-phys`; `biology,biochem → bio-biochem`; `behavioral-sci → psych-soc`. Validate each `tag` against `CONTENT_TAG_VOCAB`. The loader learns the discipline→topic map by reading the shared seed (`DISCIPLINES`/`TOPICS`).
  - **Delete `taxonomy-codes.ts`** (AAMC code derivation) and its tests/fixtures.
  - **New index shape** (`types.ts` `ContentIndex`): replace `bySection`/`byContentCategory`/`bySkill` with `byTopic: Map<topicSlug,id[]>`, `byDiscipline: Map<DisciplineKey,id[]>`, `byTag: Map<\`${vocab}:${code}\`,id[]>`; keep `byId`, `passagesById`, `allQuestionIds`. `QuestionContent` gains `topic`, `discipline`, `tags: Tag[]`; keeps derived `section`; drops `contentCategory`/`skill`.
  - **Directory convention:** recursive discovery of `question.yaml`/`passage.yaml` under `content/questions/` and `content/passages/`; folder layout is cosmetic (the envelope `topic` is authoritative). Preserve the standalone/passage distinction.

## 6. Qbank DB + engine changes

- **`ScopeKind`** (`shared/dto.ts`): `'mixed' | 'discipline' | 'topic'` (was `mixed|section|content_category|skill`). Update the Zod enum in `ipc/qbank.ts` and `qbankSession.scopeKind`'s comment.
- **`qbankAttempt`** (`db/schema/qbank.ts`): drop `skill`; add `topic text NOT NULL` and `discipline text NOT NULL`; keep derived `section`; replace `content_category_idx` with `topic_idx` (+ `discipline_idx`). Update `recordAttempt` (`qbank-attempts.ts`). All free — `0003` is regenerated fresh (no data migration).
- **Session engine** (`qbank/sessions.ts`): `scopeIds()` gains a `byTopic`/`byDiscipline` branch (drops `bySkill`/`byContentCategory`/`bySection`); `presentQuestion` sets the new `PresentedQuestion.topic`; `gradeAndRecord` sets `taxonomyRef: q.topic` (was `q.contentCategory ?? q.skill`).
- **Analytics** (`qbank-analytics.ts`): `getDashboard` groups by `discipline` and `topic` in SQL (new columns); the **optional AAMC breakdown is computed in JS** by mapping each attempt's `questionId → index.byId.get(id).tags` and aggregating. A question has one topic but multiple AAMC tags, so an attempt contributes to several AAMC buckets (documented double-count; fine for a secondary view). `DashboardStats` gains `byDiscipline`/`byTopic`; the old `bySection`/`byContentCategory` shapes are replaced; optional `byAamc`.

## 7. IPC contracts

- **Scope tree (new):** repurpose the `taxonomy` namespace — `taxonomy.list(): Promise<DisciplineTreeDto[]>` where `DisciplineTreeDto = { discipline: DisciplineKey; title: string; topics: { slug: string; title: string; aamcCodes: string[] }[] }`, served from main's `listDisciplinesWithTopics(db)`. Replaces the dead AAMC-shaped `taxonomy.list → TaxonomyNodeDto[]`; **delete `TaxonomyNodeDto`** and the old kinds.
- **Tag vocabulary (new):** `taxonomy.tags(): Promise<Tag[]>` (or fold into the scope-tree call) returning `CONTENT_TAG_VOCAB`, to populate the Composer filter.
- **Questions for a topic (new):** `qbank.questionsForTaxonomy(topicSlug: string): Promise<QuestionRef[]>`, `QuestionRef = { id: string; topic: string }`. Its **presence** un-greys CR's "Practice this topic"; the Qbank page also calls it / starts a topic-scoped session. Add channel + Zod handler + preload.
- **`PresentedQuestion`** gains `topic: string`; drops `skill`; keeps `section` (derived). Set in `presentQuestion`.
- **Gamification:** `recordActivity({ kind:'qbank.answer', taxonomyRef })` with `taxonomyRef = q.topic`. `RecordActivityInput.taxonomyRef` is an optional string — no contract break.

## 8. Lessons (Content Review changes made in this reconcile)

These touch main-owned files (folded into the reconcile, landing via the PR back to main):

- **`lessonSchema`** gains optional `sections: { title: string; anchor: string; tags: Tag[] }[]`. Body stays self-contained HTML with anchors matching `section.anchor`.
- **`getLesson`** aggregates the lesson's distinct tags from `sections` when present; otherwise falls back to `topic.aamcCodes` (or empty) so the **3 existing section-less seed lessons still render their AAMC footer**. `LessonDetail.aamcCategories` stays `string[]` — only its *source* changes, so the sandboxed-iframe reader is untouched. Keep the requirement that a lesson slug resolves to a topic (load-bearing for `discipline`).
- **`lessonForTaxonomy`/`topicForTaxonomyRef`** (`repositories/taxonomy.ts`): the AAMC-bridge fallback (`topicsForAamcCode` → `topic_aamc_category`) is **removed**; resolution simplifies to slug-only (the renderer only ever passes a topic slug). Delete `topicsForAamcCode`. Update main's `test/repositories/taxonomy.test.ts` to drop bridge assertions.

## 9. Renderer

- **Replace `taxonomy-tree.ts`/`buildTaxonomyTree`** (AAMC sections/content-categories/cars-skills) with a discipline→topic grouping fed by `taxonomy.list(): DisciplineTreeDto[]`.
- **`Composer.tsx`:** browse by discipline→topic; primary scope = pick topic(s) (or a whole discipline → `scopeKind:'discipline'`); optional secondary AAMC tag filter that ANDs with the topic scope (intersect the pool). Start session via the existing `startSession` with the new scope kinds.
- **`Dashboard.tsx`:** accuracy heatmap by discipline→topic (primary); optional AAMC breakdown (from the JS-computed `byAamc`); tap-through to a `scopeKind:'topic'` session.
- **`Explanation.tsx`:** add a "Review the lesson" affordance for the question's topic — calls `contentReview.lessonForTaxonomy(question.topic)`; if a lesson is returned, `navigate('content', { lessonSlug: ref.slug })`. Wire `navigate` by having `Qbank.tsx` consume `props.navigate` and close over it in its `renderExplanation` callback (no change to `Session`/`QuestionView` signatures).
- **`Qbank.tsx`:** consume `props.navigate` and `props.navPayload`. On mount / when `navPayload.topicSlug` is present, auto-start a topic-scoped session (`startSession({ scopeKind:'topic', scopeCode: topicSlug, … })`) instead of opening the composer — this is the half that actually carries CR's "Practice this topic" click (without it the button is a silent no-op).

## 10. Cross-links (topic-level, both directions) — wiring summary

- **Inbound (CR → Qbank):** main already fires `navigate('qbank', { topicSlug: slug })` and feature-detects `window.freecat.qbank?.questionsForTaxonomy` (LessonReader). This reconcile supplies: (a) the `qbank.questionsForTaxonomy` bridge member (existence + real return); (b) `Qbank.tsx` reading `navPayload.topicSlug` and starting the scoped session.
- **Outbound (Qbank → CR):** `PresentedQuestion.topic` → `contentReview.lessonForTaxonomy(topic)` → `navigate('content', { lessonSlug: ref.slug })` from `Explanation`.

## 11. Merge + migration reconciliation (one clean merge — early, gated task)

- **One `git merge origin/main`** (local `main` is stale; merge `origin/main`). Resolve the **verified conflict set**:
  - `package.json`, `package-lock.json` — dependency union (mine adds react-markdown/rehype-katex/remark-math/katex/js-yaml/@types/js-yaml/tsx; main also has js-yaml; no version skew).
  - `src/main/db/schema/taxonomy.ts` (add/add) — take main's discipline→topic; drop the AAMC version; (later) drop `topicAamcCategory`.
  - `src/main/db/schema/index.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/{api,channels,dto}.ts` — additive union: keep CR's base, fold in the `qbank`/`taxonomy` namespaces.
  - `src/main/content/loader.ts` (add/add) — keep both per §5.
  - `src/main/repositories/taxonomy.ts` (add/add) — take main's; apply the §8 bridge-removal edits.
  - `test/content/loader.test.ts`, `test/content/schema.test.ts` (add/add) — keep both APIs' tests; rewrite question-side fixtures/tests for the topic axis.
- **Renderer (git won't flag; reconcile by hand):** `App.tsx` → take main's (owns `navigate`/`NavPayload`/`ROUTES`); `pages/Qbank.tsx` → take mine, then wire per §9.
- **Drizzle:** take main's entire `drizzle/` (journal entries idx 0/1/2; snapshots 0000–0002 incl. `0002_conscious_iron_man`). **Delete** my `0002_gorgeous_speed.sql`, `0003_aberrant_red_hulk.sql`, and my meta `0002`/`0003` snapshots; reset `_journal.json` to main's 3-entry version. Then **`npm run db:generate` ONCE** → a fresh `0003_<random>.sql` (qbank tables; **no** content_tag table per §4) chaining off main's `0002` snapshot. Don't hardcode the regenerated filename.
- Then do the rework as **new commits**; PR `feat/qbank` → `main`. **No rebase; don't merge into main until reconciled + green.**

## 12. Seed content

- Re-tag keepers and move under the question dirs: `competitive-inhibition` (passage) → topic `biochem.enzymes`, tags `[{aamc,1A}]`; `reinforcement-schedules` → `behavioral-sci.learning-memory-cognition`, `[{aamc,7A}]` (optionally 6B); `sound-intensity` (with `figure-1.svg`) → `physics.waves-sound-light`, `[{aamc,4D}]`.
- **Delete the CARS item** `cars-0001-on-maps`.
- Place questions/passages under `content/questions/` and `content/passages/`; lessons stay under `content/lessons/` (from main). Keep the passage (`bb-0001`, 3 Q) vs standalone (`cp-0001`, `ps-0001`) distinction.
- `content:validate` stays a CI gate and must pass on the re-tagged content.

## 13. Testing

- Vitest, `environment: 'node'` (no React Testing Library — renderer verified by `tsc` + `build` + manual smoke).
- Keep both loader test files (question-side rewritten to topic fixtures). Delete `taxonomy-codes.test.ts` + the AAMC section-mismatch/unknown-code fixtures. Update main's `test/repositories/taxonomy.test.ts` to drop bridge assertions. Add tests: `resolveTopic` (discipline/section derivation, unknown topic, tag validation), new `ContentIndex` axes, `scopeIds` topic/discipline branches, attempt denormalization (topic/discipline), analytics `byTopic`/`byDiscipline`/`byAamc`, `questionsForTaxonomy`, `getLesson` section aggregation + fallback.

## 14. Out of scope / non-goals

- CARS (excluded from the app). Full-length timed exams. In-app authoring. Kaplan vocabulary seeding (the model supports it; no data yet). Physics *lessons* (Content Review authors those later; Qbank only adds the physics topics + questions). Section-level deep-links (topic-level only for v1; the lesson section anchors/tags enable this later).

## 15. Acceptance criteria

1. `feat/qbank` merges `origin/main` in one merge; all conflicts resolved; `tsc` + `build` green.
2. Shared taxonomy = discipline→topic with Physics added (6 disciplines, 29 topics); `topic_aamc_category` retired; `seedTaxonomy` idempotently seeds all disciplines incl. physics.
3. Questions tagged by one primary topic + AAMC tags; discipline/section derived; no `skill`/CARS axis anywhere; `content:validate` green.
4. One `content/` tree + asset protocol; lessons via `LessonStore`, questions via `scanContent`; images serve for questions; lessons render unchanged.
5. Composer browses discipline→topic with an optional AAMC tag filter; Dashboard shows accuracy by discipline→topic + an optional AAMC breakdown.
6. CR "Practice this topic" → a topic-scoped Qbank session; Qbank "review the lesson" on a graded question → the topic's CR lesson.
7. `recordActivity` taxonomyRef = topic slug.
8. Lessons gain optional `sections[]` with tags; `getLesson` aggregates with fallback; the 3 existing lessons still render their AAMC footer.
9. Migrations = main's `0001`/`0002` + one fresh `0003` (qbank tables); `_journal.json` consistent; `db:generate` produces no further diff.
10. All gates green (tests, `tsc`, `build`, `content:validate`); thorough final review passes; PR opened `feat/qbank` → `main`.
