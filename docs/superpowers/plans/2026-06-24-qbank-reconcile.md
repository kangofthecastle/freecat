# Qbank ↔ Shared Spine Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-base the working Qbank module from its AAMC-section axis onto Content Review's merged discipline→topic backbone — adding a Physics discipline, removing CARS, retiring the `topic_aamc_category` bridge, unifying the content directory, and wiring topic-level cross-links both ways.

**Architecture:** One `git merge origin/main` brings the backbone in; then a bottom-up rework (taxonomy → tags → content loader → qbank engine/repos → IPC → CR lessons → renderer → content) re-greens the tree. Tags are per-item, held in the in-memory content index, validated against a TS constant. Migrations: take main's `0001`/`0002`, regenerate one fresh `0003`.

**Tech stack:** Electron + electron-vite + React 19 + TypeScript (`noUncheckedIndexedAccess`), Drizzle + @libsql/client, Zod IPC, Vitest (node env), js-yaml, react-markdown/KaTeX (questions only).

**Spec:** `docs/superpowers/specs/2026-06-24-qbank-reconcile-design.md`. **Brief:** `docs/handoffs/qbank-reconcile.md`.

---

## Execution notes (read before Task 0)

- **The merge is Task 0 and runs once.** Do NOT rebase. Do NOT merge `feat/qbank` into `main` until the whole plan is green.
- **A red build is EXPECTED from Task 0 until Phase 7.** Task 0 sets the final shared contracts/schema; downstream qbank code is reworked phase-by-phase. Per-task gates run the *specific* Vitest file(s) for that task — those pass as each subsystem is reworked (Vitest uses esbuild, which strips types, so a green unit test does not require a globally-green `tsc`). The global `tsc`/`build`/`content:validate` gates are Phase 8 acceptance steps.
- **Migrations:** Task 0 resets `drizzle/` to main's baseline and regenerates ONE `0003` from the final merged schema. Because `test/helpers/db.ts` does `runMigrations(db, 'drizzle')`, the regenerated `0003` (qbank tables) must exist from Task 0 onward or every qbank repo test fails with "no such table". The regenerated filename is random — never hardcode it.
- **Commits:** one per task (the merge is its own commit). Conventional-commit style, `feat(qbank)`/`refactor(qbank)`/`test(qbank)`/`content(qbank)`. End every commit message with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Repository convention:** repos take `db: DB`; use `.returning()`; destructure-and-guard (`const [row] = …; if (!row) throw`); inject `now: Date`/`rng` for determinism. `rng()=0` must yield identity in the Fisher–Yates shuffle (`j = i - Math.floor(rng() * (i + 1))`).

---

## Shared Contract (single source of truth — types referenced by every task below)

All DTO snippets land in `src/shared/dto.ts` (merged with main's). Channel names in `src/shared/channels.ts`. `FreecatApi` in `src/shared/api.ts`.

### Discipline / taxonomy (main-owned, extended)
```ts
// shared/dto.ts — extend main's union with 'physics'
export type DisciplineKey = 'gen-chem' | 'o-chem' | 'physics' | 'biology' | 'biochem' | 'behavioral-sci'

// scope-tree DTO served to the Qbank renderer (from repositories/taxonomy.listDisciplinesWithTopics)
export interface TopicDto { slug: string; title: string; aamcCodes: string[] }
export interface DisciplineTreeDto { discipline: DisciplineKey; title: string; topics: TopicDto[] }
```
- `taxonomy_node` table (main, unchanged): `{ id:int PK autoinc, kind:'discipline'|'topic', slug unique, title, parentId:int self-FK, sortOrder int }`.
- `topic_aamc_category` table: **REMOVED** from `schema/taxonomy.ts`.
- Section derivation (fixed map, discipline → MCAT section): `gen-chem|o-chem|physics → 'chem-phys'`; `biology|biochem → 'bio-biochem'`; `behavioral-sci → 'psych-soc'`. Type `SectionCode = 'chem-phys' | 'bio-biochem' | 'psych-soc'` (no `'cars'`).

### Tags
```ts
// shared/dto.ts
export interface Tag { vocab: string; code: string } // vocab e.g. 'aamc'; code e.g. '1A'
```
```ts
// src/main/content/tags.ts (NEW)
export interface TagVocabEntry { vocab: string; code: string; title: string }
export const CONTENT_TAG_VOCAB: readonly TagVocabEntry[] // 31 AAMC entries, vocab:'aamc' (reuse seed/taxonomy-data AAMC_CONTENT_CATEGORIES)
export const TAG_KEYS: ReadonlySet<string>               // `${vocab}:${code}` for fast validation
export function isKnownTag(t: Tag): boolean              // TAG_KEYS.has(`${t.vocab}:${t.code}`)
```

### Content (questions) — `src/main/content/types.ts`
```ts
import type { ChoiceLetter, Tag } from '../../shared/dto'
export type SectionCode = 'chem-phys' | 'bio-biochem' | 'psych-soc'
export interface QuestionContent {
  id: string
  topic: string            // primary topic slug (e.g. 'biochem.enzymes')
  discipline: DisciplineKey // derived from topic's parent
  section: SectionCode      // derived from discipline
  tags: Tag[]               // 0+ (e.g. [{vocab:'aamc',code:'1A'}])
  passageId: string | null
  stem: string
  choices: [string, string, string, string]
  correct: ChoiceLetter
  explanation: string
  choiceExplanations: Partial<Record<ChoiceLetter, string>>
}
export interface PassageContent { id: string; topic: string; discipline: DisciplineKey; section: SectionCode; passage: string; questionIds: string[] }
export interface ContentIndex {
  byId: Map<string, QuestionContent>
  passagesById: Map<string, PassageContent>
  byTopic: Map<string, string[]>          // topicSlug -> questionIds
  byDiscipline: Map<string, string[]>     // DisciplineKey -> questionIds
  byTag: Map<string, string[]>            // `${vocab}:${code}` -> questionIds
  allQuestionIds: string[]
  errors: { file: string; message: string }[]
}
```

### Question / passage YAML envelope — `src/main/content/schema.ts`
```yaml
# question.yaml (standalone)
id: cp-0001-sound-intensity
topic: physics.waves-sound-light          # required, one primary topic slug
tags: [{ vocab: aamc, code: '4D' }]        # optional, default []
stem: "..."
choices: ["...","...","...","..."]
correct: B
explanation: "..."
choiceExplanations: { A: "...", B: "...", C: "...", D: "..." }   # optional, keys A–D
```
```yaml
# passage.yaml
id: bb-0001-competitive-inhibition
topic: biochem.enzymes
tags: [{ vocab: aamc, code: '1A' }]
passage: "..."
questions:               # each sub-question: questionBase + optional own `tags` (inherits passage topic)
  - { id: bb-0001-q1, stem: "...", choices: [...], correct: A, explanation: "...", tags: [...] }
```
- Removed from the envelope: `contentCategory`, `skill`, the `exactlyOneTag`/`atMostOneTag` refinements, folder-encoded section. `topics: string[]` is replaced by the single `topic`.

### Qbank DB — `src/main/db/schema/qbank.ts`
- `qbankSession`: unchanged except `scopeKind` comment (`'mixed'|'discipline'|'topic'`).
- `qbankAttempt`: **drop** `skill`; **keep** `section text` (derived); **add** `topic text NOT NULL`, `discipline text NOT NULL`. Indexes: drop `content_category_idx`, add `topic_idx` on `topic`, `discipline_idx` on `discipline`. (`contentCategory` column is removed.)
- `qbankFlag`: unchanged.

### Qbank DTOs — `src/shared/dto.ts`
```ts
export type ScopeKind = 'mixed' | 'discipline' | 'topic'
export interface PresentedQuestion {
  id: string
  topic: string          // NEW — drives the outbound cross-link
  section: SectionCode   // derived (kept for display)
  passageId: string | null
  stem: string
  choices: [string, string, string, string]
  flagged: boolean
  // NOTE: no answer key; no `skill`; no `contentCategory`
}
export interface QuestionRef { id: string; topic: string }
// StartSessionInput.scope uses { kind: ScopeKind; code?: string } where code is a topic slug or discipline key
// Dashboard accuracy DTOs:
export interface TopicAccuracy { topic: string; title: string; discipline: DisciplineKey; answered: number; correct: number }
export interface DisciplineAccuracy { discipline: DisciplineKey; title: string; answered: number; correct: number }
export interface AamcAccuracy { code: string; title: string; answered: number; correct: number }
export interface DashboardStats {
  totalAnswered: number
  totalCorrect: number
  byDiscipline: DisciplineAccuracy[]
  byTopic: TopicAccuracy[]
  byAamc: AamcAccuracy[]        // computed in JS over the content index
  latestIncorrectQuestionIds: string[]
}
```

### Channels — `src/shared/channels.ts` (add to the merged `CH`)
```ts
taxonomyList: 'taxonomy:list',            // -> DisciplineTreeDto[]
taxonomyTags: 'taxonomy:tags',            // -> Tag vocab (TagVocabEntry[])
qbankStartSession: 'qbank:startSession',  // (unchanged set from the original qbank build)
qbankSubmitAnswer: 'qbank:submitAnswer',
qbankCompleteSession: 'qbank:completeSession',
qbankToggleFlag: 'qbank:toggleFlag',
qbankDashboard: 'qbank:dashboard',
qbankQuestionsForTaxonomy: 'qbank:questionsForTaxonomy', // (topicSlug) -> QuestionRef[]
```

### FreecatApi — `src/shared/api.ts`
```ts
// merged: keep main's profile/gamification/contentReview namespaces; add:
taxonomy: {
  list: () => Promise<DisciplineTreeDto[]>
  tags: () => Promise<TagVocabEntry[]>
}
qbank: {
  startSession: (input: StartSessionInput) => Promise<StartSessionResult>
  submitAnswer: (input: SubmitAnswerInput) => Promise<SubmitAnswerResult>
  completeSession: (sessionId: number) => Promise<SessionSummary>
  toggleFlag: (questionId: string) => Promise<{ flagged: boolean }>
  dashboard: () => Promise<DashboardStats>
  questionsForTaxonomy: (topicSlug: string) => Promise<QuestionRef[]>   // NEW
}
```
- CR-side, consumed not redefined: `contentReview.lessonForTaxonomy(ref:string) => Promise<LessonRef|null>` with `LessonRef = { slug; title; discipline }`; `navigate('content', { lessonSlug })`. `RecordActivityInput.taxonomyRef` is an optional string → set to `q.topic`.
- Shell, consumed: `NavPayload = { lessonSlug?: string; topicSlug?: string }`; `PageProps = { navigate?: (key, payload?) => void; navPayload?: NavPayload }`. `App.tsx` passes both to every page.

---

## Phase 0 — Merge & contract/schema baseline (one merge; build goes red)

### Task 0: Merge `origin/main` and reconcile contracts, schema, and migrations

**Files (resolve conflicts / finalize shapes):** `package.json`, `package-lock.json`, `src/shared/{dto,channels,api}.ts`, `src/preload/index.ts`, `src/main/db/schema/{taxonomy,qbank,index}.ts`, `src/main/db/seed/taxonomy-data.ts`, `src/main/content/loader.ts`, `src/main/repositories/taxonomy.ts`, `src/main/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/pages/Qbank.tsx`, `test/content/{loader,schema}.test.ts`, `drizzle/**`.

- [ ] **Step 1: Fetch and merge.**
```bash
git fetch origin
git merge origin/main          # expect: CONFLICT (content/add-add) in the files below
```
Expected: merge stops with conflicts. If the merge cannot start (dirty tree), stop and report.

- [ ] **Step 2: Resolve `package.json` + lockfile — union.** Keep main's content; add my deps (`react-markdown`, `rehype-katex`, `remark-math`, `katex`, `js-yaml`, `@types/js-yaml`, `tsx`) and my scripts (`content:validate`, `typecheck` if present). Then `rm -rf node_modules package-lock.json && npm install` to produce a clean lockfile (simpler than hand-merging the lockfile). Verify `npm ls react-markdown js-yaml` resolves.

- [ ] **Step 3: Resolve schema — take main's taxonomy, keep my qbank tables.**
  - `src/main/db/schema/taxonomy.ts` → take main's `taxonomyNode`; **delete the `topicAamcCategory` table + its export** (bridge retired).
  - `src/main/db/schema/qbank.ts` (clean add, mine) → edit `qbankAttempt` to the Shared Contract shape: drop `skill` + `contentCategory` + `content_category_idx`; add `topic text NOT NULL`, `discipline text NOT NULL`, `topic_idx`, `discipline_idx`; keep `section`.
  - `src/main/db/schema/index.ts` → barrel exports both main's schema files and `qbank` (union; drop the `topicAamcCategory` re-export).

- [ ] **Step 4: Resolve `src/shared/{dto,channels,api}.ts` + preload to the union shapes** in the Shared Contract above. Keep main's profile/gamification/contentReview entries; add `DisciplineKey += 'physics'`, `Tag`, `TopicDto`/`DisciplineTreeDto`, `ScopeKind`, `PresentedQuestion` (with `topic`, no `skill`), `QuestionRef`, the dashboard accuracy DTOs, the `taxonomy`/`qbank` channels + `FreecatApi` namespaces. **Delete** the old AAMC-shaped `TaxonomyNodeDto` and old `ScopeKind` members. `src/preload/index.ts` exposes `profile`, `gamification`, `contentReview`, `taxonomy`, `qbank`.

- [ ] **Step 5: Resolve `loader.ts` — keep BOTH loaders.** Keep main's `loadContentType`/`readBody` (lessons depend on them) verbatim; keep my `scanContent`/`loadContent`/index builders below them (they will be reworked in Phase 3 — leave them compiling-as-merged for now; type errors are acceptable per the red-build note).

- [ ] **Step 6: Resolve `repositories/taxonomy.ts` — take main's.** Keep `listDisciplinesWithTopics`, `getTopicBySlug`, `topicForTaxonomyRef`. **Delete `topicsForAamcCode`** and the bridge fallback inside `topicForTaxonomyRef` (resolve by slug only). (Tests updated in Phase 1.)

- [ ] **Step 7: Resolve `src/main/index.ts` — additive union.** Keep main's startup (registerSchemesAsPrivileged, seedTaxonomy via main's seed, buildContentIndex/LessonStore, register profile/gamification/contentReview IPC). Add: register `taxonomy` + `qbank` IPC, build the question `ContentIndex` alongside the `LessonStore` from the same `contentRoot()`. Leave references to not-yet-reworked functions; red is fine.

- [ ] **Step 8: Resolve renderer.** `src/renderer/src/App.tsx` → take main's entirely (owns `navigate`/`NavPayload`/`ROUTES`). `src/renderer/src/pages/Qbank.tsx` → take mine (reworked in Phase 7).

- [ ] **Step 9: Reset `drizzle/` to main's baseline + regenerate one `0003`.**
```bash
git checkout origin/main -- drizzle/                 # main's 0001, 0002_conscious_iron_man, meta/_journal.json (3 entries), snapshots 0000–0002
rm -f drizzle/0002_gorgeous_speed.sql drizzle/0003_aberrant_red_hulk.sql   # delete my stale migrations if reintroduced by the merge
npm run db:generate                                  # emits a fresh 0003_<random>.sql: CREATE qbank tables + DROP topic_aamc_category
```
Expected: exactly one new `0003_*.sql` + its `meta/0003_snapshot.json`, `_journal.json` now has 4 entries, snapshot `prevId` chains off main's `0002` (`791b352c…`). Do not hardcode the name.

- [ ] **Step 10: Verify migrations + the still-green suites, then commit the merge.**
```bash
npm run db:generate            # expect: "No schema changes, nothing to generate" (idempotent)
npx vitest run test/gamification test/profile.test.ts   # expect: PASS (untouched by the reconcile)
git add -A
git commit -m "merge origin/main into feat/qbank: adopt discipline→topic backbone

Reconcile contracts/schema to the shared spine; keep both content loaders;
reset drizzle to main's baseline + regenerate one 0003 (qbank tables, drop
topic_aamc_category). Qbank internals reworked in following phases (build red
until Phase 7 by design).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected: clean merge commit; gamification/profile suites green; the broader `tsc` is red (documented).

---

## Phase 1 — Taxonomy data: add Physics; finish bridge removal

### Task 1: Add the Physics discipline + four topics to the seed

**Files:** Modify `src/main/db/seed/taxonomy-data.ts`. Test: `test/taxonomy.test.ts`.

- [ ] **Step 1: Write the failing test** (append to `test/taxonomy.test.ts`):
```ts
import { describe, it, expect } from 'vitest'
import { createTestDb } from './helpers/db'
import { seedTaxonomy } from '../src/main/db/seed/taxonomy-data' // adjust to the actual seed entry if named differently
import { listDisciplinesWithTopics } from '../src/main/repositories/taxonomy'

describe('physics discipline', () => {
  it('seeds physics with four topics under chem-phys disciplines', async () => {
    const db = await createTestDb()
    await seedTaxonomy(db)
    const tree = await listDisciplinesWithTopics(db)
    const physics = tree.find((d) => d.discipline === 'physics')
    expect(physics).toBeDefined()
    expect(physics!.topics.map((t) => t.slug).sort()).toEqual([
      'physics.electrostatics-circuits', 'physics.fluids', 'physics.mechanics', 'physics.waves-sound-light'
    ])
    expect(physics!.topics.find((t) => t.slug === 'physics.waves-sound-light')!.aamcCodes).toContain('4D')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`physics` undefined).
```bash
npx vitest run test/taxonomy.test.ts -t "physics discipline"
```

- [ ] **Step 3: Implement.** In `taxonomy-data.ts`, append to `DISCIPLINES` (after `o-chem`, before `biology`, so `chem-phys` disciplines group; sortOrder is positional): `{ slug: 'physics', title: 'Physics' }`. Append to `TOPICS`:
```ts
{ slug: 'physics.mechanics', discipline: 'physics', title: 'Mechanics: Motion, Force, Work & Energy', aamcCodes: ['4A'] },
{ slug: 'physics.fluids', discipline: 'physics', title: 'Fluids & Gases', aamcCodes: ['4B'] },
{ slug: 'physics.electrostatics-circuits', discipline: 'physics', title: 'Electrostatics & Circuits', aamcCodes: ['4C'] },
{ slug: 'physics.waves-sound-light', discipline: 'physics', title: 'Waves, Sound & Light', aamcCodes: ['4D'] },
```
(Confirm `DisciplineKey` already includes `'physics'` from Task 0 Step 4 — `DISCIPLINES`'s `slug` is typed `DisciplineKey`, so this won't compile otherwise.)

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run test/taxonomy.test.ts`

- [ ] **Step 5: Commit.** `feat(taxonomy): add Physics discipline + four topics (4A–4D)`

### Task 2: Remove the AAMC-bridge code path from the taxonomy repo + tests

**Files:** Modify `src/main/repositories/taxonomy.ts` (if not fully done in Task 0), `test/repositories/taxonomy.test.ts` (main's, if present under that path) / `test/taxonomy.test.ts`.

- [ ] **Step 1: Update the test** — delete assertions referencing `topicsForAamcCode`/`topic_aamc_category`; assert `topicForTaxonomyRef(db, 'biochem.enzymes')` resolves by slug and returns `{ slug:'biochem.enzymes', discipline:'biochem', … }`, and that an unknown ref returns `null`.
- [ ] **Step 2: Run — expect FAIL** if `topicsForAamcCode` import is gone but referenced. `npx vitest run test/taxonomy.test.ts`
- [ ] **Step 3: Implement** — ensure `topicsForAamcCode` is deleted and `topicForTaxonomyRef` is slug-only (verify Task 0 Step 6 landed). Remove any now-dead imports.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `refactor(taxonomy): retire topic_aamc_category bridge (slug-only resolution)`

---

## Phase 2 — Content tag vocabulary

### Task 3: `content/tags.ts` — the AAMC tag vocabulary constant

**Files:** Create `src/main/content/tags.ts`. Test: `test/content/tags.test.ts`.

- [ ] **Step 1: Write the failing test:**
```ts
import { describe, it, expect } from 'vitest'
import { CONTENT_TAG_VOCAB, isKnownTag } from '../../src/main/content/tags'

describe('content tag vocab', () => {
  it('seeds the 31 AAMC categories under vocab aamc', () => {
    const aamc = CONTENT_TAG_VOCAB.filter((t) => t.vocab === 'aamc')
    expect(aamc).toHaveLength(31)
    expect(aamc.find((t) => t.code === '1A')!.title).toMatch(/proteins/i)
  })
  it('validates known/unknown tags', () => {
    expect(isKnownTag({ vocab: 'aamc', code: '4D' })).toBe(true)
    expect(isKnownTag({ vocab: 'aamc', code: 'ZZ' })).toBe(false)
    expect(isKnownTag({ vocab: 'kaplan', code: '1A' })).toBe(false)
  })
})
```
- [ ] **Step 2: Run — expect FAIL** (module missing). `npx vitest run test/content/tags.test.ts`
- [ ] **Step 3: Implement** `src/main/content/tags.ts`:
```ts
import type { Tag } from '../../shared/dto'
import { AAMC_CONTENT_CATEGORIES } from '../db/seed/taxonomy-data'

export interface TagVocabEntry { vocab: string; code: string; title: string }

export const CONTENT_TAG_VOCAB: readonly TagVocabEntry[] = AAMC_CONTENT_CATEGORIES.map(
  (c) => ({ vocab: 'aamc', code: c.code, title: c.title })
)

export const TAG_KEYS: ReadonlySet<string> = new Set(CONTENT_TAG_VOCAB.map((t) => `${t.vocab}:${t.code}`))

export function isKnownTag(t: Tag): boolean {
  return TAG_KEYS.has(`${t.vocab}:${t.code}`)
}
```
(Confirm `AAMC_CONTENT_CATEGORIES` is exported from main's `seed/taxonomy-data.ts` — it is, per the merge.)
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `feat(content): AAMC tag vocabulary constant + validation`

---

## Phase 3 — Content pipeline rewrite (topic axis)

### Task 4: Rewrite `content/types.ts` to the topic-based index shape

**Files:** Modify `src/main/content/types.ts`. (No standalone test — exercised via Task 6.)

- [ ] **Step 1: Replace the file body** with the `QuestionContent`/`PassageContent`/`ContentIndex`/`SectionCode` definitions from the Shared Contract (topic/discipline/section/tags; `byTopic`/`byDiscipline`/`byTag`). Import `DisciplineKey` and `Tag` from `../../shared/dto`. Remove `contentCategory`/`skill`/`bySection`/`byContentCategory`/`bySkill`.
- [ ] **Step 2: Commit.** `refactor(content): topic-based ContentIndex + QuestionContent types` (compiles against Tasks 5–6; red elsewhere is fine).

### Task 5: Rewrite `content/schema.ts` to the topic+tags envelope

**Files:** Modify `src/main/content/schema.ts`. Test: `test/content/schema.test.ts`.

- [ ] **Step 1: Rewrite the test** (`schema.test.ts`) for the new envelope: a standalone with `topic` + `tags` parses; missing `topic` fails; a tag with a bad shape fails; a passage with `questions[]` (each inheriting topic, optional own `tags`) parses; the old `contentCategory`/`skill` keys are now rejected by `.strict()`.
```ts
import { describe, it, expect } from 'vitest'
import { standaloneQuestionSchema, passageSchema } from '../../src/main/content/schema'

const base = { id: 'q1', stem: 's', choices: ['a','b','c','d'], correct: 'A', explanation: 'e' }
describe('question schema', () => {
  it('parses topic + tags', () => {
    const r = standaloneQuestionSchema.parse({ ...base, topic: 'biochem.enzymes', tags: [{ vocab: 'aamc', code: '1A' }] })
    expect(r.topic).toBe('biochem.enzymes')
    expect(r.tags).toEqual([{ vocab: 'aamc', code: '1A' }])
  })
  it('defaults tags to []', () => {
    expect(standaloneQuestionSchema.parse({ ...base, topic: 'biochem.enzymes' }).tags).toEqual([])
  })
  it('requires topic', () => {
    expect(() => standaloneQuestionSchema.parse(base)).toThrow()
  })
  it('rejects legacy contentCategory key', () => {
    expect(() => standaloneQuestionSchema.parse({ ...base, topic: 'x', contentCategory: '1A' })).toThrow()
  })
})
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run test/content/schema.test.ts`
- [ ] **Step 3: Implement.** Rewrite `schema.ts`:
```ts
import { z } from 'zod'
const choiceLetter = z.enum(['A', 'B', 'C', 'D'])
const choices = z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)])
const choiceExplanations = z.object({ A: z.string().min(1), B: z.string().min(1), C: z.string().min(1), D: z.string().min(1) }).partial().strict().optional()
const tag = z.object({ vocab: z.string().min(1), code: z.string().min(1) }).strict()
const questionBase = { id: z.string().min(1), stem: z.string().min(1), choices, correct: choiceLetter, explanation: z.string().min(1), choiceExplanations, tags: z.array(tag).default([]) }
export const standaloneQuestionSchema = z.object({ ...questionBase, topic: z.string().min(1) }).strict()
export const passageQuestionSchema = z.object({ ...questionBase }).strict()  // inherits passage topic; may carry own tags
export const passageSchema = z.object({ id: z.string().min(1), topic: z.string().min(1), tags: z.array(tag).default([]), passage: z.string().min(1), questions: z.array(passageQuestionSchema).min(1) }).strict()
export type StandaloneQuestionInput = z.infer<typeof standaloneQuestionSchema>
export type PassageQuestionInput = z.infer<typeof passageQuestionSchema>
export type PassageInput = z.infer<typeof passageSchema>
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `refactor(content): topic+tags question/passage schema (drop contentCategory/skill)`

### Task 6: Rewrite `loader.ts` `scanContent` + `resolveTopic`; rebuild fixtures

**Files:** Modify `src/main/content/loader.ts` (the question half), `src/main/content/images.ts` (unchanged — verify). Delete `src/main/content/taxonomy-codes.ts` + `test/content/taxonomy-codes.test.ts`. Rebuild `test/content/fixtures/**`. Test: `test/content/loader.test.ts`.

- [ ] **Step 1: Build a topic→discipline resolver.** In `loader.ts`, import `TOPICS` from `../db/seed/taxonomy-data` and `isKnownTag` from `./tags`; build `topicToDiscipline: Map<string, DisciplineKey>` from `TOPICS`. Add:
```ts
const SECTION_BY_DISCIPLINE: Record<DisciplineKey, SectionCode> = {
  'gen-chem': 'chem-phys', 'o-chem': 'chem-phys', 'physics': 'chem-phys',
  'biology': 'bio-biochem', 'biochem': 'bio-biochem', 'behavioral-sci': 'psych-soc'
}
function resolveTopic(topic: string, file: string, acc: { errors: {file:string;message:string}[] }):
  { topic: string; discipline: DisciplineKey; section: SectionCode } | null {
  const discipline = topicToDiscipline.get(topic)
  if (!discipline) { acc.errors.push({ file, message: `unknown topic "${topic}"` }); return null }
  return { topic, discipline, section: SECTION_BY_DISCIPLINE[discipline] }
}
```
And a tag validator that pushes an error for any `!isKnownTag(t)`.
- [ ] **Step 2: Rewrite `scanContent`** to walk `content/questions/**` (standalone) and `content/passages/**` (passages) recursively for envelopes (reuse the existing recursive `itemDirs`), parse via the new schema, resolve topic+tags, and build the index keyed `byTopic`/`byDiscipline`/`byTag`. Passages: sub-questions inherit the passage's resolved topic/discipline/section; merge sub-questions + passage atomically (keep the existing `pending`-buffer pattern so a bad sub-question doesn't half-commit a passage). Drop all folder-section derivation.
- [ ] **Step 3: Delete** `src/main/content/taxonomy-codes.ts` and `test/content/taxonomy-codes.test.ts`. `git rm` them.
- [ ] **Step 4: Rebuild fixtures** under `test/content/fixtures/`: replace section-folder layout with `good/questions/<id>/question.yaml` (topic+tags) and `good/passages/<id>/passage.yaml`; replace `bad-section-mismatch`/`bad-unknown-code` with `bad-unknown-topic` (topic not in taxonomy) and `bad-unknown-tag` (tag not in vocab); keep `bad-choices`/`bad-missing-correct`/`bad-image` updated to the new envelope.
- [ ] **Step 5: Rewrite `loader.test.ts`** to assert: a good tree indexes `byTopic`/`byDiscipline`/`byTag` and derives section; `bad-unknown-topic` and `bad-unknown-tag` produce `errors`; passages index their sub-question ids.
- [ ] **Step 6: Run — expect PASS.** `npx vitest run test/content/loader.test.ts test/content/images.test.ts`
- [ ] **Step 7: Commit.** `refactor(content): topic-axis scanContent + resolveTopic; rebuild fixtures`

### Task 7: Rewrite `validate.ts` to topic-axis errors

**Files:** Modify `src/main/content/validate.ts`. Test: `test/content/validate.test.ts`.

- [ ] **Step 1: Update the test** to assert the CLI reports unknown-topic / unknown-tag / schema errors and exits non-zero on a bad tree, zero on the good tree.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — the validator runs `scanContent(root)` and fails if `index.errors.length > 0`, printing each `{file, message}`; success prints the counts (questions, passages, topics covered).
- [ ] **Step 4: Run — expect PASS.** Also run `npm run content:validate` against the repo `content/` (will fail until Phase 8 re-tags content — that's expected here; this step only runs the unit test).
- [ ] **Step 5: Commit.** `refactor(content): content:validate on topic/tag errors`

---

## Phase 4 — Qbank engine + repositories (topic axis)

### Task 8: `recordAttempt` denormalizes topic + discipline

**Files:** Modify `src/main/repositories/qbank-attempts.ts`. Test: `test/qbank/attempts.repo.test.ts`.

- [ ] **Step 1: Update the test** — `recordAttempt(db, { sessionId, questionId, topic:'biochem.enzymes', discipline:'biochem', section:'bio-biochem', chosen:'A', correct:true })` round-trips via `getSessionAttempts`; assert the row has `topic`/`discipline` and no `skill`.
- [ ] **Step 2: Run — expect FAIL** (column/arg mismatch). `npx vitest run test/qbank/attempts.repo.test.ts`
- [ ] **Step 3: Implement** — change the insert payload + the function's input type to `{ topic, discipline, section, … }` (drop `contentCategory`/`skill`). Keep `.returning()` + destructure-guard.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `refactor(qbank): attempts denormalize topic + discipline`

### Task 9: Session engine — `scopeIds`, `presentQuestion`, `gradeAndRecord`

**Files:** Modify `src/main/qbank/sessions.ts`. Tests: `test/qbank/sessions-plan.test.ts`, `test/qbank/sessions-grade.test.ts`.

- [ ] **Step 1: Update `sessions-plan.test.ts`** — `planSession` with `scope:{kind:'topic', code:'biochem.enzymes'}` selects only that topic's question ids (from `index.byTopic`); `{kind:'discipline', code:'biochem'}` uses `index.byDiscipline`; `{kind:'mixed'}` uses `allQuestionIds`. `presentQuestion(q, flaggedSet)` returns `{ id, topic, section, passageId, stem, choices, flagged }` with no answer key and `flagged` reflecting the set.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `scopeIds`:**
```ts
function scopeIds(index: ContentIndex, scope: { kind: ScopeKind; code?: string }): string[] {
  if (scope.kind === 'topic') return index.byTopic.get(scope.code ?? '') ?? []
  if (scope.kind === 'discipline') return index.byDiscipline.get(scope.code ?? '') ?? []
  return index.allQuestionIds
}
```
Update `presentQuestion` to set `topic: q.topic` and drop `contentCategory`/`skill`. Keep the injectable-`rng` Fisher–Yates (`j = i - Math.floor(rng() * (i + 1))`).
- [ ] **Step 4: Update `sessions-grade.test.ts`** — assert `gradeAndRecord` records the attempt with `topic`/`discipline` and calls `recordActivity` with `taxonomyRef === q.topic` (mock `recordActivity`, typed `Parameters<RecordActivityFn>`, assert `.mock.calls[0]?.[0].taxonomyRef`). Gamification failure stays non-blocking (try/catch).
- [ ] **Step 5: Implement** `gradeAndRecord`: pass `topic: q.topic, discipline: q.discipline, section: q.section` to `recordAttempt`; `recordActivity({ kind: 'qbank.answer', taxonomyRef: q.topic })`.
- [ ] **Step 6: Run both — expect PASS.** `npx vitest run test/qbank/sessions-plan.test.ts test/qbank/sessions-grade.test.ts`
- [ ] **Step 7: Commit.** `refactor(qbank): topic/discipline session scoping + gamification by topic`

### Task 10: Dashboard analytics — by discipline/topic (SQL) + by AAMC (JS over index)

**Files:** Modify `src/main/repositories/qbank-analytics.ts`. Test: `test/qbank/analytics.repo.test.ts`.

- [ ] **Step 1: Update the test** — seed attempts across two topics in one discipline + one in another; assert `getDashboard(db, index)` returns `byDiscipline`/`byTopic` accuracy (SQL group-by on the new columns) and `byAamc` aggregated from each attempt's question tags via `index.byId` (a question with two AAMC tags contributes to both buckets — assert the documented double-count). `latestIncorrectQuestionIds` unchanged.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** SQL `group by discipline` and `group by topic` for the accuracy arrays; for `byAamc`, load all attempts, and for each look up `index.byId.get(a.questionId)?.tags`, incrementing per `${vocab}:${code}` (then map to `{code,title}` via `CONTENT_TAG_VOCAB`). Resolve topic titles via the taxonomy (`listDisciplinesWithTopics` or a passed map). `getDashboard` now takes `(db, index)`.
- [ ] **Step 4: Run — expect PASS.** `npx vitest run test/qbank/analytics.repo.test.ts`
- [ ] **Step 5: Commit.** `refactor(qbank): dashboard accuracy by discipline/topic + AAMC breakdown`

---

## Phase 5 — IPC

### Task 11: Taxonomy IPC — `taxonomy.list` (scope tree) + `taxonomy.tags`

**Files:** Modify `src/main/ipc/taxonomy.ts`. Test: `test/qbank/ipc-validation.test.ts` (or a new `test/taxonomy-ipc.test.ts`).

- [ ] **Step 1: Update/add the test** — register the taxonomy IPC against a seeded test DB; assert `taxonomy:list` returns `DisciplineTreeDto[]` including the physics discipline with its four topics, and `taxonomy:tags` returns the AAMC vocab (31 entries). (Invoke the handler functions directly, as the existing ipc-validation tests do.)
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `registerTaxonomyIpc(db)`:
```ts
ipcMain.handle(CH.taxonomyList, async (): Promise<DisciplineTreeDto[]> => listDisciplinesWithTopics(db))
ipcMain.handle(CH.taxonomyTags, async (): Promise<TagVocabEntry[]> => [...CONTENT_TAG_VOCAB])
```
(`listDisciplinesWithTopics` already returns `{ discipline, title, topics:[{slug,title,aamcCodes}] }` — structurally `DisciplineTreeDto[]`.) Remove the old AAMC `taxonomy:list` handler + any `TaxonomyNodeDto` use.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `feat(qbank): taxonomy IPC — discipline→topic scope tree + tag vocab`

### Task 12: Qbank IPC — `ScopeKind` Zod + `questionsForTaxonomy`

**Files:** Modify `src/main/ipc/qbank.ts`. Test: `test/qbank/ipc-validation.test.ts`.

- [ ] **Step 1: Update the test** — the scope Zod accepts `{kind:'topic', code:'biochem.enzymes'}` / `{kind:'discipline', code:'biochem'}` / `{kind:'mixed'}` and rejects `{kind:'skill'}`; `qbank:questionsForTaxonomy('biochem.enzymes')` returns `QuestionRef[]` (`{id, topic}`) from `index.byTopic`, and `[]` for an unknown topic.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — change the scope Zod to `z.object({ kind: z.enum(['mixed','discipline','topic']), code: z.string().min(1).optional() })`; add:
```ts
ipcMain.handle(CH.qbankQuestionsForTaxonomy, async (_e, raw: unknown): Promise<QuestionRef[]> => {
  const topic = z.string().min(1).parse(raw)
  return (index.byTopic.get(topic) ?? []).map((id) => ({ id, topic }))
})
```
- [ ] **Step 4: Run — expect PASS.** `npx vitest run test/qbank/ipc-validation.test.ts`
- [ ] **Step 5: Commit.** `feat(qbank): questionsForTaxonomy IPC + discipline/topic scope validation`

---

## Phase 6 — Content Review lessons (section tags)

### Task 13: Optional lesson `sections[]`; `getLesson` aggregates tags with fallback

**Files:** Modify `src/main/content/lessons.ts` (schema + `LoadedLesson`), `src/main/ipc/content-review.ts` (`getLesson`). Test: `test/content/lessons.test.ts` (main's) + a `getLesson` test.

- [ ] **Step 1: Update the test** — a lesson envelope with `sections: [{title, anchor, tags:[{vocab,code}]}]` parses; `getLesson` for a sectioned lesson returns `aamcCategories` = the distinct codes aggregated from its sections; a section-less lesson (the 3 existing seeds) falls back to `topic.aamcCodes` so its footer still renders.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Add to `lessonSchema`: `sections: z.array(z.object({ title: z.string().min(1), anchor: z.string().min(1), tags: z.array(z.object({ vocab: z.string(), code: z.string() })).default([]) })).optional()`. Surface `sections` on `LessonRecord`/`LoadedLesson`. In `content-review.ts` `getLesson`, compute `aamcCategories`:
```ts
const fromSections = lesson.sections?.flatMap((s) => s.tags.filter((t) => t.vocab === 'aamc').map((t) => t.code))
const aamcCategories = fromSections && fromSections.length ? [...new Set(fromSections)] : topic.aamcCodes
```
`LessonDetail.aamcCategories` stays `string[]` — the reader is untouched.
- [ ] **Step 4: Run — expect PASS.** `npx vitest run test/content/lessons.test.ts`
- [ ] **Step 5: Commit.** `feat(content-review): optional lesson section tags; getLesson aggregates with fallback`

---

## Phase 7 — Renderer (discipline→topic UI + cross-links)

> No React Testing Library (Vitest is node-env). Each renderer task's gate is **`npm run build`** (electron-vite typechecks the renderer) plus the described manual smoke. By Phase 7 the main process is green, so `build` errors localize to the file under edit.

### Task 14: Replace `taxonomy-tree.ts` with a discipline→topic scope helper

**Files:** Replace `src/renderer/src/qbank/taxonomy-tree.ts` (→ `scope-tree.ts`), update importers.

- [ ] **Step 1: Implement** a helper that consumes `DisciplineTreeDto[]` (from `window.freecat.taxonomy.list()`) and yields the grouped structure the Composer/Dashboard render (disciplines → topics). Delete `buildTaxonomyTree` + the old AAMC/cars-skill grouping. Export a `Scope = { kind: 'mixed' } | { kind: 'discipline'; code: string } | { kind: 'topic'; code: string }` helper type matching `StartSessionInput`.
- [ ] **Step 2: Gate.** `npm run build` (expect renderer errors to now point only at Composer/Dashboard, fixed next).
- [ ] **Step 3: Commit.** `refactor(qbank): discipline→topic scope-tree helper`

### Task 15: Composer — browse by discipline→topic + optional AAMC tag filter

**Files:** Modify `src/renderer/src/qbank/Composer.tsx`.

- [ ] **Step 1: Implement** — load `taxonomy.list()` + `taxonomy.tags()` on mount; render the discipline→topic tree for primary scope (pick a topic, a whole discipline, or mixed); render an optional AAMC tag multi-select that ANDs with the scope; on start, call `startSession({ scope, tagFilter })`. (Thread `tagFilter?: Tag[]` through `StartSessionInput` → `planSession`, which intersects the scoped ids with `index.byTag`; add this to Task 9's `scopeIds` or a post-filter — update the engine + its test if not already covered. If adding now, write the planSession tag-filter test here.)
- [ ] **Step 2: Gate.** `npm run build`.
- [ ] **Step 3: Manual smoke (describe in commit):** Composer lists Physics + topics; selecting a topic and starting yields a scoped session; an AAMC filter narrows the pool.
- [ ] **Step 4: Commit.** `feat(qbank): Composer scopes by discipline→topic with AAMC tag filter`

### Task 16: Dashboard — accuracy by discipline→topic + optional AAMC breakdown

**Files:** Modify `src/renderer/src/qbank/Dashboard.tsx`.

- [ ] **Step 1: Implement** — render `dashboard()`'s `byDiscipline`/`byTopic` as the primary heatmap (grouped by discipline, topics within), an optional AAMC breakdown panel from `byAamc`, and tap-through that starts a `{kind:'topic'}` session for the tapped topic. Remove the old section/content-category/cars rendering.
- [ ] **Step 2: Gate.** `npm run build`.
- [ ] **Step 3: Commit.** `feat(qbank): Dashboard accuracy by discipline→topic + AAMC breakdown`

### Task 17: Cross-links — Explanation "review the lesson" + `Qbank.tsx` navPayload/scoped start

**Files:** Modify `src/renderer/src/qbank/Explanation.tsx`, `src/renderer/src/pages/Qbank.tsx`.

- [ ] **Step 1: Implement outbound.** `Explanation` takes a `navigate` (closed over by `Qbank.tsx`'s `renderExplanation`); on "Review the lesson" it calls `window.freecat.contentReview.lessonForTaxonomy(question.topic)` and, if non-null, `navigate('content', { lessonSlug: ref.slug })` (button hidden if the call returns null). `PresentedQuestion.topic` is already present (Task 9).
- [ ] **Step 2: Implement inbound.** `Qbank.tsx` consumes `props.navigate` + `props.navPayload`; in a mount `useEffect`, if `navPayload?.topicSlug`, auto-start `startSession({ scope: { kind:'topic', code: navPayload.topicSlug } })` (guard against double-start with a ref) instead of opening the Composer. Wire `props.navigate` into `renderExplanation`.
- [ ] **Step 3: Gate.** `npm run build` (expect fully green now).
- [ ] **Step 4: Manual smoke (describe in commit):** From a CR lesson, "Practice this topic" lands on a scoped Qbank session; answering a question shows "Review the lesson" which returns to the topic's lesson.
- [ ] **Step 5: Commit.** `feat(qbank): topic-level cross-links (CR↔Qbank) both directions`

---

## Phase 8 — Seed content + full green

### Task 18: Re-tag seed content; delete CARS; update the authoring guide

**Files:** Move/edit under `content/questions/` + `content/passages/`; delete `content/**/cars-0001-on-maps/**`; update `content/README.md`.

- [ ] **Step 1: Re-tag + relocate.**
  - `cp-0001-sound-intensity` (+`figure-1.svg`) → `content/questions/cp-0001-sound-intensity/question.yaml`: `topic: physics.waves-sound-light`, `tags: [{vocab: aamc, code: '4D'}]`. Keep the figure ref.
  - `ps-0001-reinforcement-schedules` → `content/questions/ps-0001-reinforcement-schedules/question.yaml`: `topic: behavioral-sci.learning-memory-cognition`, `tags: [{vocab: aamc, code: '7A'}]`.
  - `bb-0001-competitive-inhibition` (3-question passage) → `content/passages/bb-0001-competitive-inhibition/passage.yaml`: `topic: biochem.enzymes`, `tags: [{vocab: aamc, code: '1A'}]`.
  - **Delete** the CARS item directory.
- [ ] **Step 2: Update `content/README.md`** — document the topic+tags envelope, the `content/questions/` + `content/passages/` layout, and the no-spaces/no-parens filename rule.
- [ ] **Step 3: Validate.** `npm run content:validate` → expect PASS (every item resolves to a known topic + known tags).
- [ ] **Step 4: Commit.** `content(qbank): re-tag seeds to topic+tags; drop CARS; refresh authoring guide`

### Task 19: Full green — all gates

**Files:** none (verification + fixups only).

- [ ] **Step 1: Typecheck + build.** `npm run build` → expect PASS (no type errors anywhere).
- [ ] **Step 2: Tests.** `npx vitest run` → expect ALL green (gamification, profile, content, taxonomy, qbank, content-review).
- [ ] **Step 3: Content gate.** `npm run content:validate` → PASS.
- [ ] **Step 4: Migration idempotency.** `npm run db:generate` → "No schema changes". 
- [ ] **Step 5: Fix any failures** found (no new scope — only reconcile fixups). Re-run all four gates until green.
- [ ] **Step 6: Commit.** `chore(qbank): full reconcile green — tests, build, content:validate, migrations`

---

## Self-review checklist (controller runs before dispatch)

- **Spec coverage:** §3 taxonomy→Task 1–2; §4 tags→Task 3; §5 loader→Task 4–7; §6 engine/repos→Task 8–10; §7 IPC→Task 11–12; §8 lessons→Task 13; §9 renderer→Task 14–17; §11 merge/migrations→Task 0; §12 seed→Task 18; §13 tests→woven per task; AC1–AC10→Task 19 gates.
- **No placeholders:** every code step shows code; merge steps are explicit; the regenerated migration filename is deliberately not hardcoded.
- **Type consistency:** `Tag`, `DisciplineKey(+physics)`, `ScopeKind('mixed'|'discipline'|'topic')`, `PresentedQuestion.topic`, `ContentIndex.byTopic/byDiscipline/byTag`, `DashboardStats.byDiscipline/byTopic/byAamc`, `QuestionRef{id,topic}` — defined once in the Shared Contract and referenced identically throughout.

