# Content Review (Module 2) — Design Spec

_Date: 2026-06-23 · Project: FreeCAT · Read `docs/freecat-charter.md` first — it is the source of truth; this spec is a working reference. Module handoff: `docs/handoffs/content-review.md`._

> **Sequencing context (decided with Warren):** Qbank is being built **in parallel**, not before. Content Review is therefore the **first content module to execute**, so it **establishes two shared pieces** the charter nominally assigned to Qbank — the **DB-seeded MCAT taxonomy** and a **generic content-loader (pipeline v0)** — built generic so the parallel Qbank session **consumes and extends them, never recreates them**. Cross-linking questions ↔ lessons is a first-class requirement, wired as a mutual IPC contract keyed on the shared taxonomy. This spec drives charter edits (see _Charter updates required_).

## Goal

Ship a **Content Review module**: readable, **self-contained interactive HTML** MCAT lessons organized by **discipline → topic**, with progress/completion that feeds gamification, and **bidirectional cross-links to Qbank** through the shared taxonomy (finish a lesson → practice it; miss a question → jump to the lesson). The module owns its screens and its progress data; lesson *content* is bundled files authored via PRs.

## Scope

**In:**
- DB-seeded **taxonomy** (5 disciplines, ~25 topics) with a secondary **AAMC content-category mapping** — established here, shared.
- A **generic content loader** (pipeline v0) in `src/main/content/` — shared, schema-agnostic.
- The **lesson content format**: per-topic folder, YAML envelope + a fully **self-contained `body.html`**; one Zod schema; 2–3 real sample lessons.
- **Lesson progress** table + repository; explicit "Mark complete" → `recordActivity({ kind: 'lesson.complete', taxonomyRef })` exactly once per lesson.
- The **`contentReview` IPC namespace** (outline, lesson, progress, complete, `lessonForTaxonomy`).
- The **renderer**: a discipline→topic browse + a lesson reader that renders `body.html` in a **sandboxed iframe**, with chrome (progress, complete, "practice this topic", AAMC footer).
- The **cross-link contract** (both directions) + an additive `navigate(key, payload?)` extension.

**Out (deferred / not ours):**
- **Physics** and **CARS** lessons (no Physics/CARS in v1 — per Warren).
- In-app authoring; owning the taxonomy data beyond seeding it; the Qbank side of cross-links (its `questionsForTaxonomy`, question→lesson jump) — contracts specified here, wired at integration.
- A `postMessage` lesson↔app bridge (lessons are self-contained in v1).
- Deep Flashcards integration (imported decks aren't in the taxonomy).

## Key decisions (brainstorm outcomes)

| Decision | Choice |
| --- | --- |
| Lesson granularity | **One lesson per discipline→topic** (~25 lessons across 5 disciplines) |
| Disciplines (v1) | `gen-chem`, `o-chem`, `biology`, `biochem`, `behavioral-sci` (no Physics, no CARS) |
| Cross-link key | **Topic slug is primary** (both modules tag against it); each topic **also** carries mapped **AAMC content-category code(s)** as a secondary bridge |
| Taxonomy storage | **DB-seeded** (`taxonomyNode` + `topicAamcCategory`), idempotent seed on startup |
| Lesson body format | **Fully self-contained interactive HTML** (`body.html`; CSS/JS/math/images inlined) |
| Lesson rendering | **Sandboxed `<iframe srcdoc=…>` with `sandbox="allow-scripts"`** (no `allow-same-origin`) |
| Interactivity (v1) | **Self-contained** — app chrome owns completion + cross-links (no postMessage bridge) |
| Completion | **Explicit "Mark complete"** button; once-only XP via `recordActivity` |
| Pipeline | **Generic loader v0 built here** in `src/main/content/`; Qbank adopts/extends it |

## Taxonomy (the discipline→topic backbone)

Two-axis model: a **discipline→topic tree** (primary, what lessons and questions tag against) plus a **many-to-many bridge** to AAMC content-category codes (secondary, "applied intelligently").

**Disciplines & topics (v1):**
- **Gen Chem** (`gen-chem`): Atomic Theory & Chemical Composition · Interactions of Chemical Substances · Thermodynamics, Kinetics & Gas Laws · Solutions & Electrochemistry
- **O Chem** (`o-chem`): Introduction to Organic Chemistry · Functional Groups & Their Reactions · Separations, Spectroscopy & Analytical Methods
- **Biology** (`biology`): Molecular Biology · Cellular Biology · Genetics & Evolution · Reproduction · Endocrine & Nervous Systems · Circulation & Respiration · Digestion & Excretion · Musculoskeletal System · Skin & Immune Systems
- **Biochem** (`biochem`): Amino Acids & Proteins · Enzymes · Carbs, Nucleotides & Lipids · Metabolic Reactions
- **Behavioral Sciences** (`behavioral-sci`): Demographics & Social Structure · Identity & Social Interaction · Learning, Memory & Cognition · Motivation, Emotion, Attitudes, Personality & Stress · Sensation, Perception & Consciousness

Slugs are `<discipline>.<kebab-topic>` (e.g. `biochem.enzymes`, `gen-chem.thermo-kinetics-gas`).

**AAMC mapping:** each topic is assigned its correct AAMC content-category code(s) in the seed data (e.g. `biochem.enzymes → ['1A']`, `biology.genetics-evolution → ['1B','3B']`). The full table lives in `taxonomy-data.ts` and is **reviewed by Warren**. Codes are validated at seed time against a static `AAMC_CONTENT_CATEGORIES` reference (codes + titles, recoverable from git `181bdec`).

## Lesson content format

On disk, consuming the shared pipeline's convention (bundled as an electron-builder extra resource; read from `process.resourcesPath/content` in prod, repo `content/` in dev):

```
content/lessons/<discipline>/<topic-slug>/
├── lesson.yaml     # envelope
└── body.html       # fully self-contained interactive HTML (inline CSS/JS/math; no network)
```

`lesson.yaml` (validated by `lessonSchema`):
- `slug` (string, **must equal a taxonomy topic slug**)
- `title` (string)
- `summary` (string, optional — one-line blurb for the browse list)
- `order` (int, optional — else falls back to the topic's `sortOrder`)
- `bodyFile` (string, optional — defaults to `body.html`)

`discipline` and `aamcCategories` are **not duplicated** here — they resolve from the taxonomy entry the `slug` points to (single source of truth).

**Validation:** `slug` exists in the taxonomy; `bodyFile` exists and is non-empty. Deep HTML validation is out of scope (content is trusted, PR-reviewed) — body validation is "present, non-empty, parses as HTML".

## Components

Each lists **purpose / interface / depends on**.

### CR1 — Taxonomy (schema + seed + repository)
- **Purpose:** the shared discipline→topic backbone both modules tag against, plus the AAMC bridge.
- **Interface:**
  - Schema `src/main/db/schema/taxonomy.ts`:
    - `taxonomyNode` — `{ id, kind: 'discipline'|'topic', slug (unique), title, parentId (nullable self-FK), sortOrder }`
    - `topicAamcCategory` — `{ id, topicId (FK taxonomyNode.id), aamcCode }`, unique `(topicId, aamcCode)`
  - Seed data `src/main/db/seed/taxonomy-data.ts` (disciplines, topics, topic→AAMC map) + `AAMC_CONTENT_CATEGORIES` reference.
  - `seedTaxonomy(db)` — idempotent (insert-or-ignore by slug); called at startup after migrations.
  - Repository `src/main/repositories/taxonomy.ts`: `listDisciplinesWithTopics(db)`, `getTopicBySlug(db, slug)`, `topicsForAamcCode(db, code)`, `topicForTaxonomyRef(db, ref)` (resolves a slug **or** an AAMC code → topic; slug match first).
- **Depends on:** Foundation DB/migrations.

### CR2 — Content loader (pipeline v0, shared)
- **Purpose:** the one shared, schema-agnostic loader for bundled authored content; Qbank extends it for questions/passages.
- **Interface:**
  - `src/main/content/root.ts`: `contentRoot()` → `app.isPackaged ? join(process.resourcesPath,'content') : join(app.getAppPath(),'content')` (mirrors `migrationsFolder()`).
  - `src/main/content/loader.ts`: `loadContentType<T>({ root, subdir, envelopeFile, schema }): ContentRecord<T>[]` where `ContentRecord<T> = { dir, data: T }`. Walks `root/subdir/**/<envelopeFile>`, parses YAML (`js-yaml`), validates with the passed Zod schema. Plus `readBody(dir, file): string`.
  - Loader functions take `root` as a **parameter** (electron-free, unit-testable against fixtures); a thin main-side wrapper passes `contentRoot()`.
- **Depends on:** `js-yaml` (new dep), Zod. **Shared:** Qbank consumes this exact module.

### CR3 — Lesson schema + content + index
- **Purpose:** the lesson content type and an in-memory index over it.
- **Interface:** `lessonSchema` (Zod, in `src/shared/` or `src/main/content/lessons.ts`); a `LessonStore` built at startup via the loader (parses every `lesson.yaml`, validates `slug` against the taxonomy, lazily reads `body.html` on demand); 2–3 real sample lessons (e.g. `biochem.enzymes`, `gen-chem.thermo-kinetics-gas`, `behavioral-sci.learning-memory-cognition`).
- **Depends on:** CR1, CR2.

### CR4 — Lesson progress + completion
- **Purpose:** track per-lesson progress; credit gamification once on completion.
- **Interface:**
  - Schema `src/main/db/schema/lesson-progress.ts`: `lessonProgress` — `{ id, lessonSlug (unique), completedAt (nullable timestamp), lastViewedAt (timestamp), countedForReward (boolean, default false) }`. Single-profile (no `profileId`, consistent with gamification tables).
  - **Derived status:** `completed` if `completedAt` is set; else `in-progress` if a row exists (lesson was opened → `markViewed`); else `not-started`.
  - Repository `src/main/repositories/lesson-progress.ts`: `getAllProgress(db)`, `markViewed(db, slug)` (upsert `lastViewedAt`), `setCompleted(db, slug, completed, now?)` → `{ newlyCompleted }` (sets `completedAt` + `countedForReward` on first completion; un-completing nulls `completedAt` but **keeps** `countedForReward` so XP never re-grants).
  - Orchestrator `completeLesson(db, slug)`: `setCompleted(...)`; if `newlyCompleted`, call `recordActivity(db, { kind: 'lesson.complete', taxonomyRef: slug })` and return its `ActivityResult`.
- **Depends on:** CR1, Foundation gamification (`recordActivity` in `repositories/activity.ts`).

### CR5 — `contentReview` IPC namespace
- **Purpose:** the only renderer→data path for the module (charter §5.3 pattern).
- **Interface:**
  - Channels (`src/shared/channels.ts`): `contentGetOutline`, `contentGetLesson`, `contentMarkViewed`, `contentMarkComplete`, `contentLessonForTaxonomy`.
  - DTOs (`src/shared/dto.ts`): `DisciplineKey`; `LessonSummary { slug, title, discipline, summary?, aamcCategories, status }`; `OutlineGroup { discipline, title, completed, total, lessons }`; `Outline { groups, completed, total }`; `LessonDetail { slug, title, discipline, aamcCategories, html, status }`; `LessonRef { slug, title, discipline }`; `MarkCompleteResult { status, activity? }`. (`status` ∈ `'not-started'|'in-progress'|'completed'`.)
  - `FreecatApi.contentReview`: `getOutline(): Promise<Outline>` · `getLesson(slug): Promise<LessonDetail | null>` · `markViewed(slug): Promise<void>` · `markComplete(slug, completed): Promise<ServiceResult<MarkCompleteResult>>` · `lessonForTaxonomy(ref): Promise<LessonRef | null>`.
  - `markComplete` dispatches on `completed`: `true` → `completeLesson` (once-only reward; `activity` present on the newly-completed transition), `false` → `setCompleted(slug, false)` (clears `completedAt`, no reward, `activity` omitted).
  - Handlers `src/main/ipc/content-review.ts` (`registerContentReviewIpc(db)`), Zod-validated; preload `contentReview` namespace; wire `seedTaxonomy(db)` + `registerContentReviewIpc(db)` in `src/main/index.ts`.
- **Depends on:** CR1–CR4. **Shared files (additive, coordinate with Qbank):** `channels.ts`, `dto.ts`, `api.ts`, `preload/index.ts`, `main/index.ts`.

### CR6 — Renderer: browse + reader
- **Purpose:** fill the existing `ContentReview` route.
- **Interface:** internal view state `{ mode: 'browse' } | { mode: 'reader', slug }`; accepts a `navPayload` deep-link (`{ lessonSlug }`).
  - `LessonBrowse` — disciplines as sections, topics with progress badges, overall header ("8 / 25 lessons").
  - `LessonReader` — breadcrumb/header; **`<iframe srcDoc={html} sandbox="allow-scripts" title={title} />`**; **"Mark complete"** (shows XP/streak/goal toast from the returned `ActivityResult`); **"Practice this topic"** (cross-link, guarded — see CR7); AAMC-category footer; resumes via `markViewed`.
  - `ProgressBadge`, small `Toast`.
- **Depends on:** CR5. (No `react-markdown`/KaTeX.)

### CR7 — Cross-link contract (both directions)
- **Purpose:** wire lessons ↔ questions via the shared taxonomy.
- **Interface:**
  - **Built now (ours):** `contentReview.lessonForTaxonomy(ref)` resolves a topic slug or AAMC code → `LessonRef` (Qbank's "missed question → lesson" works the moment it calls this).
  - **Consumed, guarded:** `LessonReader` calls `window.freecat.qbank?.questionsForTaxonomy?.(topicSlug)` if present; otherwise the panel shows "Practice coming soon".
  - **Navigation:** additive extension to `PageProps` — `navigate(key: RouteKey, payload?: NavPayload)` with `NavPayload = { lessonSlug?: string; topicSlug?: string }`; `App.tsx` stashes the payload and passes it to the active page. Existing pages ignore it.
- **Depends on:** CR5, CR6, the Foundation router (`App.tsx`).

## Shared data model (tables this module establishes / owns)

- **Establishes (shared):** `taxonomyNode`, `topicAamcCategory` — the shared taxonomy backbone. **Qbank consumes these and must not create its own taxonomy migration.**
- **Owns:** `lessonProgress`.
- Qbank still owns its own tables (attempts, sessions, flags) and the `content_registry` table; it references `taxonomyNode` by id/slug, never alters its meaning.

## Security model (iframe isolation)

Authored lesson HTML is **untrusted at runtime** even though it is PR-reviewed (defense-in-depth):
- Rendered **only** inside `<iframe srcDoc={html} sandbox="allow-scripts">` — **no `allow-same-origin`**. The iframe gets an **opaque origin**: lesson scripts cannot reach `window.freecat` (the IPC/DB bridge), the shell DOM, or the parent's storage; lesson CSS cannot leak into the shell.
- **Never** rendered via `dangerouslySetInnerHTML` or injected into the React tree.
- Only the `allow-scripts` token is granted (covers JS-driven interactivity). Add `allow-forms`/`allow-popups` later only if a specific lesson requires it.
- **Local-first / no network:** the generated HTML must inline everything (CSS/JS/math/images) — no CDN. Math is KaTeX/MathJax **inlined or pre-rendered** by the generator.

## Cross-module contract (what the parallel Qbank session must implement)

1. **Tag questions against the shared taxonomy** — by topic `slug` (primary); AAMC codes optional/secondary.
2. **Expose** `window.freecat.qbank.questionsForTaxonomy(ref: string): Promise<QuestionRef[]>` (ref = topic slug or AAMC code) so lessons can list related practice.
3. **Consume** `window.freecat.contentReview.lessonForTaxonomy(ref)` for "missed question → lesson".
4. **Accept the nav payload** `{ topicSlug }` to open Qbank filtered to a topic; use the shared `navigate(key, payload?)` signature.
5. **Do not** create a second `taxonomy` table/migration or a second content loader — consume CR1/CR2.

## Suggested internal build sequence

1. **CR1** — taxonomy schema + migration + seed data + `seedTaxonomy` + repository (TDD).
2. **CR2** — content loader v0: `contentRoot()` + generic `loadContentType` + `readBody`, over fixtures (TDD); add `js-yaml`.
3. **CR3** — `lessonSchema` + sample lessons + `LessonStore` (slug-validates against taxonomy).
4. **CR4** — `lessonProgress` schema + migration + repository + `completeLesson` orchestration (TDD).
5. **CR5** — `contentReview` IPC: channels, DTOs, `FreecatApi`, handlers, preload, `main/index.ts` wiring (TDD on handlers/validation).
6. **CR6** — renderer browse + reader (sandboxed iframe) + completion toast + practice button.
7. **CR7** — `lessonForTaxonomy` (built), guarded `questionsForTaxonomy` consumption, `navigate(key, payload?)` extension; document Qbank's half.
8. **Docs** — apply charter edits; add a short content-authoring note (lesson folder + self-contained HTML + offline constraint).

## Testing

- **Unit (Vitest, in-memory libsql):** taxonomy seed idempotency + `getTopicBySlug`/`topicsForAamcCode`/`topicForTaxonomyRef`; lesson-progress (`markViewed` upsert, `setCompleted` once-only reward, un-complete never re-grants); `completeLesson` fires `recordActivity` exactly once.
- **Loader/schema:** `loadContentType` over a fixture content dir (valid + invalid envelopes, missing body); `lessonSchema` accept/reject; slug-not-in-taxonomy rejected.
- **Aggregation:** outline/progress counts (per-discipline + overall); `lessonForTaxonomy` resolution by slug and by AAMC code.
- **Renderer (light):** browse renders groups + progress; reader mounts an iframe with `srcDoc` + `sandbox="allow-scripts"` and **no** `allow-same-origin`; "Mark complete" calls the IPC.
- **CI:** unit + typecheck + build per the Foundation convention.

## Acceptance criteria

1. Content Review route shows the discipline→topic browse with progress (0/25 on first run).
2. Opening a topic renders its self-contained `body.html` in a sandboxed iframe; interactivity works; lesson JS **cannot** access `window.freecat` (sandbox verified).
3. "Mark complete" sets completion and fires `recordActivity({ kind: 'lesson.complete', taxonomyRef })` **exactly once** (XP/streak/daily update; re-completing never re-grants); browse reflects new progress.
4. `lessonForTaxonomy(ref)` resolves a topic slug **and** an AAMC code to the correct lesson.
5. "Practice this topic" is present; populates when `qbank.questionsForTaxonomy` exists, degrades gracefully otherwise.
6. Taxonomy is DB-seeded idempotently (re-running seed is a no-op); a fresh DB ends with 5 disciplines + ~25 topics + their AAMC mappings.
7. No renderer code accesses SQLite directly — all data flows through `contentReview`; lesson HTML stays isolated in the iframe.

## Risks & notes

- **Parallel-Qbank collision (top risk):** shared touchpoints are the taxonomy table/migration, `src/main/content/`, `src/shared/{channels,dto,api}.ts`, `preload/index.ts`, `main/index.ts`, and `App.tsx`. Mitigation: CR owns taxonomy + loader v0; **additive-only** edits to shared files; the cross-module contract above is the agreement; coordinate merge order with the Qbank session (Warren supervises both).
- **AAMC mapping correctness:** the topic→AAMC table is a judgment call — Warren reviews it in `taxonomy-data.ts`.
- **Large `srcDoc` strings:** self-contained HTML with inlined assets can be large to pass over IPC; acceptable for v1 (lazy-read body on `getLesson`); revisit caching if needed.
- **Sandbox tokens:** `allow-scripts` only; revisit if a lesson legitimately needs forms/popups.
- **Content authoring is offline:** generated HTML must inline math/assets (no CDN) — document for contributors.
- **Confirm during authoring:** Biology's "Molecular Biology" vs "Cellular Biology" split (treated as two topics → count 9); the exact O-Chem topic-3 title.

## Charter updates required

- **§5.1 (taxonomy):** record that the taxonomy is **discipline→topic-primary** (5 disciplines, ~25 topics) with an **AAMC content-category mapping** as the secondary bridge, and that it was **defined in the Content Review brainstorm** (Qbank running in parallel) and is reused by Qbank.
- **§5.2 (DB ownership):** Content Review **establishes the shared `taxonomy` tables** (`taxonomyNode` + `topicAamcCategory`); Qbank consumes them. Content Review owns `lessonProgress`.
- **§5.5 (pipeline):** the generic loader (pipeline v0) is **established here** in `src/main/content/`; lessons use a **self-contained `body.html`** (not the original Markdown sketch); Qbank reuses/extends the loader.
- **§5.6 (shell):** the `navigate(key, payload?)` extension supports cross-module deep-links.
