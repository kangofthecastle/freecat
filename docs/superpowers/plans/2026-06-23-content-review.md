# Content Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Content Review module — discipline→topic MCAT lessons authored as self-contained interactive HTML, rendered in a sandboxed iframe, with progress that feeds gamification and bidirectional cross-links to Qbank through a shared, DB-seeded taxonomy.

**Architecture:** Main-process Drizzle/SQLite owns a shared `taxonomy` (established here) + a `lesson_progress` table; lessons are bundled files loaded by a generic content loader (pipeline v0, also established here). A typed `contentReview` IPC namespace exposes outline/lesson/progress/complete/`lessonForTaxonomy`. The renderer fills the existing Content Review route with a browse view and a reader that renders lesson HTML in `<iframe srcDoc sandbox="allow-scripts">`. Cross-links ride topic slugs; the Qbank half is built in parallel and consumed defensively.

**Tech Stack:** Electron + Vite + React 19, TypeScript (`strict`, `noUncheckedIndexedAccess`), Drizzle ORM + libsql, Zod, `js-yaml`, Vitest, Tailwind v4.

**Reference spec:** `docs/superpowers/specs/2026-06-23-content-review-design.md`.

**Commit convention:** every commit message ends with a blank line then the trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

**Conventions to follow (from the Foundation):**
- Repositories live in `src/main/repositories/*`, take `db: DB` as a parameter (electron-free, unit-testable), use `.returning()` on insert/update, and destructure-and-guard (`const [row] = …; if (!row) throw`) rather than `[0]`/`!` (because `noUncheckedIndexedAccess` is on).
- Schema files in `src/main/db/schema/*.ts`, re-exported from `index.ts`. Migrations are generated with `npm run db:generate` and applied at startup + in tests via `runMigrations(db, 'drizzle')`.
- IPC: channel constants in `src/shared/channels.ts`, DTOs in `src/shared/dto.ts`, the `FreecatApi` interface in `src/shared/api.ts`, preload wiring in `src/preload/index.ts`, handlers in `src/main/ipc/*` registered from `src/main/index.ts`; Zod-validate at the boundary.
- Tests import `createTestDb` from `test/helpers/db.ts` (a migrated, transaction-safe temp-file DB).

---

## File Structure

**Create:**
- `src/main/db/schema/taxonomy.ts` — `taxonomyNode` + `topicAamcCategory` tables.
- `src/main/db/schema/lesson-progress.ts` — `lessonProgress` table.
- `src/main/db/seed/taxonomy-data.ts` — disciplines, topics (+ AAMC mappings), AAMC reference.
- `src/main/repositories/taxonomy.ts` — `seedTaxonomy` + query functions.
- `src/main/repositories/lesson-progress.ts` — progress repo + `completeLesson` + `deriveStatus`.
- `src/main/content/root.ts` — `contentRoot()` (electron path resolver).
- `src/main/content/loader.ts` — generic `loadContentType` + `readBody`.
- `src/main/content/lessons.ts` — `lessonSchema` + `LessonStore` + `loadLessons`/`createLessonStore`.
- `src/main/content/outline.ts` — `composeOutline`.
- `src/main/ipc/content-review.ts` — `registerContentReviewIpc` + Zod schemas.
- `src/renderer/src/content/LessonReader.tsx` — reader (sandboxed iframe + completion + practice).
- `content/lessons/<discipline>/<slug>/{lesson.yaml,body.html}` — sample lessons.
- Tests + fixtures under `test/content/`, `test/repositories/`, `test/fixtures/`.

**Modify:**
- `src/main/db/schema/index.ts` — export new schemas.
- `src/shared/dto.ts`, `src/shared/channels.ts`, `src/shared/api.ts`, `src/preload/index.ts` — add the `contentReview` contract.
- `src/main/index.ts` — seed taxonomy, build the lesson store, register the IPC namespace.
- `src/renderer/src/App.tsx` — `navigate(key, payload?)` extension.
- `src/renderer/src/pages/ContentReview.tsx` — replace placeholder with browse + reader container.
- `package.json` — add `js-yaml` + `@types/js-yaml`.

---

## Task 1: Schemas, dependency, migration

**Files:**
- Modify: `package.json`
- Create: `src/main/db/schema/taxonomy.ts`, `src/main/db/schema/lesson-progress.ts`
- Modify: `src/main/db/schema/index.ts`
- Test: `test/content/schema.test.ts`

- [ ] **Step 1: Add the YAML dependency**

Run:
```bash
npm install js-yaml@^4.1.0 && npm install -D @types/js-yaml@^4.0.9
```
Expected: `package.json` gains `js-yaml` (dependencies) and `@types/js-yaml` (devDependencies); install succeeds.

- [ ] **Step 2: Write the taxonomy schema**

Create `src/main/db/schema/taxonomy.ts`:
```ts
import { sqliteTable, integer, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

// Shared backbone established by Content Review (charter §5.2): disciplines + topics
// as a 2-level tree. Qbank consumes this table and does NOT create its own.
export const taxonomyNode = sqliteTable('taxonomy_node', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['discipline', 'topic'] }).notNull(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  parentId: integer('parent_id').references((): AnySQLiteColumn => taxonomyNode.id),
  sortOrder: integer('sort_order').notNull().default(0)
})

// Many-to-many bridge: a topic → its AAMC content-category code(s).
export const topicAamcCategory = sqliteTable(
  'topic_aamc_category',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    topicId: integer('topic_id')
      .notNull()
      .references(() => taxonomyNode.id),
    aamcCode: text('aamc_code').notNull()
  },
  (t) => ({ uq: uniqueIndex('topic_aamc_uq').on(t.topicId, t.aamcCode) })
)

export type TaxonomyNode = typeof taxonomyNode.$inferSelect
```

- [ ] **Step 3: Write the lesson-progress schema**

Create `src/main/db/schema/lesson-progress.ts`:
```ts
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'

// Content-Review-owned. Single-profile (no profileId, consistent with the
// gamification tables). Status is derived, not stored.
export const lessonProgress = sqliteTable('lesson_progress', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  lessonSlug: text('lesson_slug').notNull().unique(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  lastViewedAt: integer('last_viewed_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  countedForReward: integer('counted_for_reward', { mode: 'boolean' }).notNull().default(false)
})

export type LessonProgress = typeof lessonProgress.$inferSelect
```

- [ ] **Step 4: Export the new schemas**

Modify `src/main/db/schema/index.ts` to:
```ts
export * from './profile'
export * from './gamification'
export * from './taxonomy'
export * from './lesson-progress'
```

- [ ] **Step 5: Write the failing schema test**

Create `test/content/schema.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'

let db: DB
beforeEach(async () => {
  db = await createTestDb()
})

describe('content-review schema', () => {
  it('creates the taxonomy + lesson-progress tables', async () => {
    const rows = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type='table' order by name`
    )
    const names = rows.map((r) => r.name)
    for (const t of ['taxonomy_node', 'topic_aamc_category', 'lesson_progress']) {
      expect(names).toContain(t)
    }
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- test/content/schema.test.ts`
Expected: FAIL — the tables do not exist yet (no migration generated), so `toContain` fails.

- [ ] **Step 7: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0002_*.sql` is created adding `taxonomy_node`, `topic_aamc_category`, `lesson_progress`; `drizzle/meta/_journal.json` + a new snapshot are updated.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- test/content/schema.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/main/db/schema/ drizzle/ test/content/schema.test.ts
git commit -m "feat(content): taxonomy + lesson-progress schema + migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared contract (DTOs, channels, API)

**Files:**
- Modify: `src/shared/dto.ts`, `src/shared/channels.ts`, `src/shared/api.ts`

- [ ] **Step 1: Add the Content Review DTOs**

Append to `src/shared/dto.ts` (after the existing exports). `ActivityResult` is already declared in this file:
```ts
// --- Content Review ---
export type DisciplineKey = 'gen-chem' | 'o-chem' | 'biology' | 'biochem' | 'behavioral-sci'
export type LessonStatus = 'not-started' | 'in-progress' | 'completed'

export interface LessonSummary {
  slug: string
  title: string
  discipline: DisciplineKey
  summary?: string
  aamcCategories: string[]
  status: LessonStatus
  available: boolean // false = topic exists in the taxonomy but no lesson is authored yet
}
export interface OutlineGroup {
  discipline: DisciplineKey
  title: string
  completed: number
  total: number // counts authored (available) lessons only
  lessons: LessonSummary[]
}
export interface Outline {
  groups: OutlineGroup[]
  completed: number
  total: number
}
export interface LessonDetail {
  slug: string
  title: string
  discipline: DisciplineKey
  aamcCategories: string[]
  html: string
  status: LessonStatus
}
export interface LessonRef {
  slug: string
  title: string
  discipline: DisciplineKey
}
export interface MarkCompleteResult {
  status: LessonStatus
  activity?: ActivityResult
}
```

- [ ] **Step 2: Add the channel constants**

In `src/shared/channels.ts`, add these keys inside the `CH` object (before the closing `}`), keeping the existing entries:
```ts
  contentGetOutline: 'content:getOutline',
  contentGetLesson: 'content:getLesson',
  contentMarkViewed: 'content:markViewed',
  contentMarkComplete: 'content:markComplete',
  contentLessonForTaxonomy: 'content:lessonForTaxonomy'
```
(Add a comma after the previous last entry `gamRenamePet: 'gamification:renamePet'` so the object stays valid.)

- [ ] **Step 3: Extend the FreecatApi type**

In `src/shared/api.ts`, update the import and add the `contentReview` namespace to the interface:
```ts
import type {
  ProfileDto, GamificationState, ActivityResult, RecordActivityInput, ServiceResult, PetView,
  Outline, LessonDetail, LessonRef, MarkCompleteResult
} from './dto'
```
Add inside `interface FreecatApi { … }` (after the `gamification` block):
```ts
  contentReview: {
    getOutline: () => Promise<Outline>
    getLesson: (slug: string) => Promise<LessonDetail | null>
    markViewed: (slug: string) => Promise<void>
    markComplete: (slug: string, completed: boolean) => Promise<ServiceResult<MarkCompleteResult>>
    lessonForTaxonomy: (ref: string) => Promise<LessonRef | null>
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL with an error in `src/preload/index.ts` — `api` is missing `contentReview` (this proves the type is now required; the preload is wired in Task 9). This is the only expected error.

- [ ] **Step 5: Commit**

```bash
git add src/shared/dto.ts src/shared/channels.ts src/shared/api.ts
git commit -m "feat(content): contentReview IPC contract (DTOs, channels, FreecatApi)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Taxonomy seed data

**Files:**
- Create: `src/main/db/seed/taxonomy-data.ts`
- Test: `test/content/taxonomy-data.test.ts`

- [ ] **Step 1: Write the seed data**

Create `src/main/db/seed/taxonomy-data.ts`. The AAMC mappings are my assignments and are intended for Warren's review:
```ts
import type { DisciplineKey } from '../../../shared/dto'

export const DISCIPLINES: { slug: DisciplineKey; title: string }[] = [
  { slug: 'gen-chem', title: 'General Chemistry' },
  { slug: 'o-chem', title: 'Organic Chemistry' },
  { slug: 'biology', title: 'Biology' },
  { slug: 'biochem', title: 'Biochemistry' },
  { slug: 'behavioral-sci', title: 'Behavioral Sciences' }
]

export interface TopicSeed {
  slug: string
  discipline: DisciplineKey
  title: string
  aamcCodes: string[]
}

export const TOPICS: TopicSeed[] = [
  // General Chemistry
  { slug: 'gen-chem.atomic-theory', discipline: 'gen-chem', title: 'Atomic Theory & Chemical Composition', aamcCodes: ['4E'] },
  { slug: 'gen-chem.chemical-interactions', discipline: 'gen-chem', title: 'Interactions of Chemical Substances', aamcCodes: ['5B', '5A'] },
  { slug: 'gen-chem.thermo-kinetics-gas', discipline: 'gen-chem', title: 'Thermodynamics, Kinetics & Gas Laws', aamcCodes: ['5E', '4A'] },
  { slug: 'gen-chem.solutions-electrochem', discipline: 'gen-chem', title: 'Solutions & Electrochemistry', aamcCodes: ['5A', '4C'] },
  // Organic Chemistry
  { slug: 'o-chem.intro', discipline: 'o-chem', title: 'Introduction to Organic Chemistry', aamcCodes: ['5D'] },
  { slug: 'o-chem.functional-groups', discipline: 'o-chem', title: 'Functional Groups & Their Reactions', aamcCodes: ['5D'] },
  { slug: 'o-chem.separations-spectroscopy', discipline: 'o-chem', title: 'Separations, Spectroscopy & Analytical Methods', aamcCodes: ['5C', '5D'] },
  // Biology
  { slug: 'biology.molecular-biology', discipline: 'biology', title: 'Molecular Biology', aamcCodes: ['1B'] },
  { slug: 'biology.cellular-biology', discipline: 'biology', title: 'Cellular Biology', aamcCodes: ['2A', '2C'] },
  { slug: 'biology.genetics-evolution', discipline: 'biology', title: 'Genetics & Evolution', aamcCodes: ['1C', '1B'] },
  { slug: 'biology.reproduction', discipline: 'biology', title: 'Reproduction', aamcCodes: ['2C', '3B'] },
  { slug: 'biology.endocrine-nervous', discipline: 'biology', title: 'Endocrine & Nervous Systems', aamcCodes: ['3A'] },
  { slug: 'biology.circulation-respiration', discipline: 'biology', title: 'Circulation & Respiration', aamcCodes: ['3B', '4B'] },
  { slug: 'biology.digestion-excretion', discipline: 'biology', title: 'Digestion & Excretion', aamcCodes: ['3B'] },
  { slug: 'biology.musculoskeletal', discipline: 'biology', title: 'Musculoskeletal System', aamcCodes: ['3B', '4A'] },
  { slug: 'biology.skin-immune', discipline: 'biology', title: 'Skin & Immune Systems', aamcCodes: ['3B'] },
  // Biochemistry
  { slug: 'biochem.amino-acids-proteins', discipline: 'biochem', title: 'Amino Acids & Proteins', aamcCodes: ['1A'] },
  { slug: 'biochem.enzymes', discipline: 'biochem', title: 'Enzymes', aamcCodes: ['1A'] },
  { slug: 'biochem.carbs-nucleotides-lipids', discipline: 'biochem', title: 'Carbs, Nucleotides & Lipids', aamcCodes: ['1D', '5D'] },
  { slug: 'biochem.metabolic-reactions', discipline: 'biochem', title: 'Metabolic Reactions', aamcCodes: ['1D'] },
  // Behavioral Sciences
  { slug: 'behavioral-sci.demographics-social-structure', discipline: 'behavioral-sci', title: 'Demographics & Social Structure', aamcCodes: ['9A', '9B', '10A'] },
  { slug: 'behavioral-sci.identity-social-interaction', discipline: 'behavioral-sci', title: 'Identity & Social Interaction', aamcCodes: ['7B', '8A', '8B', '8C'] },
  { slug: 'behavioral-sci.learning-memory-cognition', discipline: 'behavioral-sci', title: 'Learning, Memory & Cognition', aamcCodes: ['6B', '7A'] },
  { slug: 'behavioral-sci.motivation-emotion-personality', discipline: 'behavioral-sci', title: 'Motivation, Emotion, Attitudes, Personality & Stress', aamcCodes: ['6C', '7A', '7C'] },
  { slug: 'behavioral-sci.sensation-perception-consciousness', discipline: 'behavioral-sci', title: 'Sensation, Perception & Consciousness', aamcCodes: ['6A', '6B'] }
]

// AAMC content-category reference (codes + titles) — used to validate the mapping.
export const AAMC_CONTENT_CATEGORIES: { code: string; title: string }[] = [
  { code: '1A', title: 'Structure and function of proteins and their constituent amino acids' },
  { code: '1B', title: 'Transmission of genetic information from the gene to the protein' },
  { code: '1C', title: 'Transmission of heritable information from generation to generation' },
  { code: '1D', title: 'Principles of bioenergetics and fuel molecule metabolism' },
  { code: '2A', title: 'Assemblies of molecules, cells, and groups of cells within organisms' },
  { code: '2B', title: 'Structure, growth, physiology, and genetics of prokaryotes and viruses' },
  { code: '2C', title: 'Processes of cell division, differentiation, and specialization' },
  { code: '3A', title: 'Structure and functions of the nervous and endocrine systems' },
  { code: '3B', title: 'Structure and integrative functions of the main organ systems' },
  { code: '4A', title: 'Translational motion, forces, work, energy, and equilibrium' },
  { code: '4B', title: 'Importance of fluids for circulation, gas movement, and gas exchange' },
  { code: '4C', title: 'Electrochemistry and electrical circuits and their elements' },
  { code: '4D', title: 'How light and sound interact with matter' },
  { code: '4E', title: 'Atoms, nuclear decay, electronic structure, and atomic chemical behavior' },
  { code: '5A', title: 'Unique nature of water and its solutions' },
  { code: '5B', title: 'Nature of molecules and intermolecular interactions' },
  { code: '5C', title: 'Separation and purification methods' },
  { code: '5D', title: 'Structure, function, and reactivity of biologically-relevant molecules' },
  { code: '5E', title: 'Principles of chemical thermodynamics and kinetics' },
  { code: '6A', title: 'Sensing the environment' },
  { code: '6B', title: 'Making sense of the environment' },
  { code: '6C', title: 'Responding to the world' },
  { code: '7A', title: 'Individual influences on behavior' },
  { code: '7B', title: 'Social processes that influence human behavior' },
  { code: '7C', title: 'Attitude and behavior change' },
  { code: '8A', title: 'Self-identity' },
  { code: '8B', title: 'Social thinking' },
  { code: '8C', title: 'Social interactions' },
  { code: '9A', title: 'Understanding social structure' },
  { code: '9B', title: 'Demographic characteristics and processes' },
  { code: '10A', title: 'Social inequality' }
]

export const AAMC_CODES: ReadonlySet<string> = new Set(AAMC_CONTENT_CATEGORIES.map((c) => c.code))
```

- [ ] **Step 2: Write the failing data-integrity test**

Create `test/content/taxonomy-data.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { DISCIPLINES, TOPICS, AAMC_CODES } from '../../src/main/db/seed/taxonomy-data'

describe('taxonomy seed data', () => {
  it('has 5 disciplines and 25 topics', () => {
    expect(DISCIPLINES).toHaveLength(5)
    expect(TOPICS).toHaveLength(25)
  })

  it('uses unique topic slugs', () => {
    const slugs = TOPICS.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('every topic belongs to a known discipline', () => {
    const known = new Set(DISCIPLINES.map((d) => d.slug))
    for (const t of TOPICS) expect(known.has(t.discipline)).toBe(true)
  })

  it('every AAMC code on a topic is a real content category', () => {
    for (const t of TOPICS) {
      expect(t.aamcCodes.length).toBeGreaterThan(0)
      for (const code of t.aamcCodes) expect(AAMC_CODES.has(code)).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Run the test**

Run: `npm test -- test/content/taxonomy-data.test.ts`
Expected: PASS (the data file already satisfies the assertions). If a count fails, fix the data, not the test.

- [ ] **Step 4: Commit**

```bash
git add src/main/db/seed/taxonomy-data.ts test/content/taxonomy-data.test.ts
git commit -m "feat(content): MCAT discipline/topic seed data + AAMC mapping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Taxonomy repository (seed + queries)

**Files:**
- Create: `src/main/repositories/taxonomy.ts`
- Test: `test/repositories/taxonomy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/repositories/taxonomy.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import {
  seedTaxonomy, listDisciplinesWithTopics, getTopicBySlug, topicsForAamcCode, topicForTaxonomyRef
} from '../../src/main/repositories/taxonomy'

let db: DB
beforeEach(async () => {
  db = await createTestDb()
})

describe('taxonomy repository', () => {
  it('seeds disciplines, topics, and aamc mappings', async () => {
    await seedTaxonomy(db)
    const groups = await listDisciplinesWithTopics(db)
    expect(groups).toHaveLength(5)
    const totalTopics = groups.reduce((n, g) => n + g.topics.length, 0)
    expect(totalTopics).toBe(25)
    const biochem = groups.find((g) => g.discipline === 'biochem')
    expect(biochem?.topics.map((t) => t.slug)).toContain('biochem.enzymes')
  })

  it('is idempotent (re-seeding does not duplicate)', async () => {
    await seedTaxonomy(db)
    await seedTaxonomy(db)
    const groups = await listDisciplinesWithTopics(db)
    const totalTopics = groups.reduce((n, g) => n + g.topics.length, 0)
    expect(totalTopics).toBe(25)
  })

  it('resolves a topic by slug with discipline + aamc codes', async () => {
    await seedTaxonomy(db)
    const topic = await getTopicBySlug(db, 'biochem.enzymes')
    expect(topic).not.toBeNull()
    expect(topic?.discipline).toBe('biochem')
    expect(topic?.aamcCodes).toContain('1A')
  })

  it('finds topics for an AAMC code', async () => {
    await seedTaxonomy(db)
    const topics = await topicsForAamcCode(db, '1A')
    const slugs = topics.map((t) => t.slug)
    expect(slugs).toContain('biochem.enzymes')
    expect(slugs).toContain('biochem.amino-acids-proteins')
  })

  it('resolves a taxonomy ref by slug OR by AAMC code', async () => {
    await seedTaxonomy(db)
    const bySlug = await topicForTaxonomyRef(db, 'biochem.enzymes')
    expect(bySlug?.slug).toBe('biochem.enzymes')
    const byCode = await topicForTaxonomyRef(db, '3A')
    expect(byCode?.slug).toBe('biology.endocrine-nervous')
    const miss = await topicForTaxonomyRef(db, 'nope.nothing')
    expect(miss).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/repositories/taxonomy.test.ts`
Expected: FAIL — `src/main/repositories/taxonomy.ts` does not exist.

- [ ] **Step 3: Write the repository**

Create `src/main/repositories/taxonomy.ts`:
```ts
import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { taxonomyNode, topicAamcCategory } from '../db/schema'
import { DISCIPLINES, TOPICS } from '../db/seed/taxonomy-data'
import type { DisciplineKey } from '../../shared/dto'

export interface TopicView {
  slug: string
  title: string
  discipline: DisciplineKey
  aamcCodes: string[]
}
export interface DisciplineView {
  discipline: DisciplineKey
  title: string
  topics: { slug: string; title: string; aamcCodes: string[] }[]
}

/** Idempotent seed of disciplines, topics, and AAMC mappings. */
export async function seedTaxonomy(db: DB): Promise<void> {
  await db
    .insert(taxonomyNode)
    .values(DISCIPLINES.map((d, i) => ({ kind: 'discipline' as const, slug: d.slug, title: d.title, parentId: null, sortOrder: i })))
    .onConflictDoNothing()

  const disciplineRows = await db.select().from(taxonomyNode).where(eq(taxonomyNode.kind, 'discipline'))
  const disciplineId = new Map(disciplineRows.map((r) => [r.slug, r.id]))

  const topicValues = TOPICS.map((t, i) => {
    const parentId = disciplineId.get(t.discipline)
    if (parentId === undefined) throw new Error(`seedTaxonomy: unknown discipline ${t.discipline} for ${t.slug}`)
    return { kind: 'topic' as const, slug: t.slug, title: t.title, parentId, sortOrder: i }
  })
  await db.insert(taxonomyNode).values(topicValues).onConflictDoNothing()

  const topicRows = await db.select().from(taxonomyNode).where(eq(taxonomyNode.kind, 'topic'))
  const topicId = new Map(topicRows.map((r) => [r.slug, r.id]))

  const mapValues: { topicId: number; aamcCode: string }[] = []
  for (const t of TOPICS) {
    const id = topicId.get(t.slug)
    if (id === undefined) throw new Error(`seedTaxonomy: missing topic id for ${t.slug}`)
    for (const code of t.aamcCodes) mapValues.push({ topicId: id, aamcCode: code })
  }
  if (mapValues.length > 0) await db.insert(topicAamcCategory).values(mapValues).onConflictDoNothing()
}

async function codesByTopicId(db: DB): Promise<Map<number, string[]>> {
  const maps = await db.select().from(topicAamcCategory)
  const byId = new Map<number, string[]>()
  for (const m of maps) {
    const arr = byId.get(m.topicId) ?? []
    arr.push(m.aamcCode)
    byId.set(m.topicId, arr)
  }
  return byId
}

export async function listDisciplinesWithTopics(db: DB): Promise<DisciplineView[]> {
  const disciplines = await db.select().from(taxonomyNode).where(eq(taxonomyNode.kind, 'discipline')).orderBy(taxonomyNode.sortOrder)
  const topics = await db.select().from(taxonomyNode).where(eq(taxonomyNode.kind, 'topic')).orderBy(taxonomyNode.sortOrder)
  const codes = await codesByTopicId(db)
  return disciplines.map((d) => ({
    discipline: d.slug as DisciplineKey,
    title: d.title,
    topics: topics
      .filter((t) => t.parentId === d.id)
      .map((t) => ({ slug: t.slug, title: t.title, aamcCodes: codes.get(t.id) ?? [] }))
  }))
}

export async function getTopicBySlug(db: DB, slug: string): Promise<TopicView | null> {
  const [topic] = await db.select().from(taxonomyNode).where(eq(taxonomyNode.slug, slug))
  if (!topic || topic.kind !== 'topic' || topic.parentId === null) return null
  const [parent] = await db.select().from(taxonomyNode).where(eq(taxonomyNode.id, topic.parentId))
  if (!parent) return null
  const codes = await codesByTopicId(db)
  return { slug: topic.slug, title: topic.title, discipline: parent.slug as DisciplineKey, aamcCodes: codes.get(topic.id) ?? [] }
}

export async function topicsForAamcCode(db: DB, code: string): Promise<TopicView[]> {
  const maps = await db.select().from(topicAamcCategory).where(eq(topicAamcCategory.aamcCode, code))
  const out: TopicView[] = []
  for (const m of maps) {
    const [topic] = await db.select().from(taxonomyNode).where(eq(taxonomyNode.id, m.topicId))
    if (!topic) continue
    const view = await getTopicBySlug(db, topic.slug)
    if (view) out.push(view)
  }
  return out
}

/** Resolve a Qbank ref — a topic slug first, else an AAMC code (first match). */
export async function topicForTaxonomyRef(db: DB, ref: string): Promise<TopicView | null> {
  const bySlug = await getTopicBySlug(db, ref)
  if (bySlug) return bySlug
  const byCode = await topicsForAamcCode(db, ref)
  return byCode[0] ?? null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/repositories/taxonomy.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/repositories/taxonomy.ts test/repositories/taxonomy.test.ts
git commit -m "feat(content): taxonomy repository (idempotent seed + queries)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Content loader (pipeline v0)

**Files:**
- Create: `src/main/content/loader.ts`, `src/main/content/root.ts`
- Create fixtures: `test/fixtures/content-valid/lessons/biochem/enzymes/{lesson.yaml,body.html}`, `test/fixtures/content-invalid/lessons/x/lesson.yaml`
- Test: `test/content/loader.test.ts`

- [ ] **Step 1: Create the valid fixture envelope**

Create `test/fixtures/content-valid/lessons/biochem/enzymes/lesson.yaml`:
```yaml
slug: biochem.enzymes
title: Enzymes
summary: How enzymes lower activation energy.
```

- [ ] **Step 2: Create the valid fixture body**

Create `test/fixtures/content-valid/lessons/biochem/enzymes/body.html`:
```html
<!doctype html><html><body><h1>Enzymes</h1><p>Biological catalysts.</p></body></html>
```

- [ ] **Step 3: Create the invalid fixture (missing title)**

Create `test/fixtures/content-invalid/lessons/x/lesson.yaml`:
```yaml
slug: broken.no-title
```

- [ ] **Step 4: Write the failing loader test**

Create `test/content/loader.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { join } from 'node:path'
import { loadContentType, readBody } from '../../src/main/content/loader'

const VALID = join(__dirname, '../fixtures/content-valid')
const INVALID = join(__dirname, '../fixtures/content-invalid')
const schema = z.object({ slug: z.string().min(1), title: z.string().min(1), summary: z.string().optional() })

describe('content loader', () => {
  it('loads + validates envelopes under a subdir', () => {
    const recs = loadContentType({ root: VALID, subdir: 'lessons', envelopeFile: 'lesson.yaml', schema })
    expect(recs).toHaveLength(1)
    const rec = recs[0]
    if (!rec) throw new Error('no record')
    expect(rec.data.slug).toBe('biochem.enzymes')
    expect(rec.data.title).toBe('Enzymes')
  })

  it('reads a co-located body file', () => {
    const recs = loadContentType({ root: VALID, subdir: 'lessons', envelopeFile: 'lesson.yaml', schema })
    const rec = recs[0]
    if (!rec) throw new Error('no record')
    expect(readBody(rec.dir, 'body.html')).toContain('<h1>Enzymes</h1>')
  })

  it('returns [] when the subdir is absent', () => {
    expect(loadContentType({ root: VALID, subdir: 'nope', envelopeFile: 'lesson.yaml', schema })).toEqual([])
  })

  it('throws on an envelope that fails the schema', () => {
    expect(() => loadContentType({ root: INVALID, subdir: 'lessons', envelopeFile: 'lesson.yaml', schema })).toThrow()
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- test/content/loader.test.ts`
Expected: FAIL — `src/main/content/loader.ts` does not exist.

- [ ] **Step 6: Write the loader**

Create `src/main/content/loader.ts`:
```ts
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import type { ZodType } from 'zod'

export interface ContentRecord<T> {
  dir: string
  data: T
}

export interface LoadOptions<T> {
  root: string
  subdir: string
  envelopeFile: string
  schema: ZodType<T>
}

/** Generic, schema-agnostic loader for bundled authored content (shared pipeline v0). */
export function loadContentType<T>(opts: LoadOptions<T>): ContentRecord<T>[] {
  const base = join(opts.root, opts.subdir)
  if (!existsSync(base)) return []
  const out: ContentRecord<T>[] = []
  for (const dir of itemDirs(base, opts.envelopeFile)) {
    const raw = readFileSync(join(dir, opts.envelopeFile), 'utf8')
    const data = opts.schema.parse(loadYaml(raw))
    out.push({ dir, data })
  }
  return out
}

export function readBody(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

/** Directories (sorted) under base that directly contain envelopeFile. */
function itemDirs(base: string, envelopeFile: string): string[] {
  const result: string[] = []
  const stack: string[] = [base]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur === undefined) continue
    const entries = readdirSync(cur, { withFileTypes: true })
    if (entries.some((e) => e.isFile() && e.name === envelopeFile)) result.push(cur)
    for (const e of entries) if (e.isDirectory()) stack.push(join(cur, e.name))
  }
  return result.sort()
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- test/content/loader.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 8: Write the content-root resolver**

Create `src/main/content/root.ts` (electron-dependent; not unit-tested — mirrors `migrationsFolder()` in `src/main/index.ts`):
```ts
import { app } from 'electron'
import { join } from 'node:path'

/** Bundled content lives in resources (prod) or the repo `content/` dir (dev). */
export function contentRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'content') : join(app.getAppPath(), 'content')
}
```

- [ ] **Step 9: Commit**

```bash
git add src/main/content/loader.ts src/main/content/root.ts test/content/loader.test.ts test/fixtures/
git commit -m "feat(content): generic content loader + content-root resolver (pipeline v0)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Lesson schema + LessonStore

**Files:**
- Create: `src/main/content/lessons.ts`
- Test: `test/content/lessons.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/content/lessons.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { lessonSchema, createLessonStore, loadLessons } from '../../src/main/content/lessons'

const VALID = join(__dirname, '../fixtures/content-valid')

describe('lessonSchema', () => {
  it('accepts a minimal envelope', () => {
    expect(lessonSchema.parse({ slug: 'a.b', title: 'T' }).slug).toBe('a.b')
  })
  it('rejects a missing title', () => {
    expect(() => lessonSchema.parse({ slug: 'a.b' })).toThrow()
  })
})

describe('LessonStore', () => {
  it('lists loaded lessons', () => {
    const recs = loadLessons(VALID)
    expect(recs.map((r) => r.slug)).toContain('biochem.enzymes')
  })

  it('reads a lesson body via get()', () => {
    const store = createLessonStore(VALID)
    expect(store.has('biochem.enzymes')).toBe(true)
    const lesson = store.get('biochem.enzymes')
    expect(lesson?.title).toBe('Enzymes')
    expect(lesson?.html).toContain('<h1>Enzymes</h1>')
  })

  it('returns null for an unknown slug', () => {
    const store = createLessonStore(VALID)
    expect(store.get('nope.nope')).toBeNull()
    expect(store.has('nope.nope')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/content/lessons.test.ts`
Expected: FAIL — `src/main/content/lessons.ts` does not exist.

- [ ] **Step 3: Write the lesson store**

Create `src/main/content/lessons.ts`:
```ts
import { z } from 'zod'
import { loadContentType, readBody } from './loader'

export const lessonSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  order: z.number().int().optional(),
  bodyFile: z.string().optional()
})
export type LessonEnvelope = z.infer<typeof lessonSchema>

export interface LessonRecord {
  slug: string
  title: string
  summary?: string
  dir: string
  bodyFile: string
}
export interface LoadedLesson {
  slug: string
  title: string
  summary?: string
  html: string
}

export function loadLessons(root: string): LessonRecord[] {
  return loadContentType({ root, subdir: 'lessons', envelopeFile: 'lesson.yaml', schema: lessonSchema }).map(
    ({ dir, data }) => ({ slug: data.slug, title: data.title, summary: data.summary, dir, bodyFile: data.bodyFile ?? 'body.html' })
  )
}

export class LessonStore {
  private bySlug: Map<string, LessonRecord>
  private bodyCache = new Map<string, string>()

  constructor(records: LessonRecord[]) {
    this.bySlug = new Map(records.map((r) => [r.slug, r]))
  }

  list(): { slug: string; title: string; summary?: string }[] {
    return [...this.bySlug.values()].map((r) => ({ slug: r.slug, title: r.title, summary: r.summary }))
  }

  has(slug: string): boolean {
    return this.bySlug.has(slug)
  }

  get(slug: string): LoadedLesson | null {
    const r = this.bySlug.get(slug)
    if (!r) return null
    let html = this.bodyCache.get(slug)
    if (html === undefined) {
      html = readBody(r.dir, r.bodyFile)
      this.bodyCache.set(slug, html)
    }
    return { slug: r.slug, title: r.title, summary: r.summary, html }
  }
}

export function createLessonStore(root: string): LessonStore {
  return new LessonStore(loadLessons(root))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/content/lessons.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/content/lessons.ts test/content/lessons.test.ts
git commit -m "feat(content): lesson schema + LessonStore (loads bundled lessons)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Outline composition + status

**Files:**
- Create: `src/main/content/outline.ts`
- Test: `test/content/outline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/content/outline.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { composeOutline, deriveStatus } from '../../src/main/content/outline'
import type { LessonProgress } from '../../src/main/db/schema'

const disciplines = [
  {
    discipline: 'biochem' as const,
    title: 'Biochemistry',
    topics: [
      { slug: 'biochem.enzymes', title: 'Enzymes', aamcCodes: ['1A'] },
      { slug: 'biochem.metabolic-reactions', title: 'Metabolic Reactions', aamcCodes: ['1D'] }
    ]
  }
]
const lessons = [{ slug: 'biochem.enzymes', title: 'Enzymes', summary: 'Catalysts' }]

function progress(partial: Partial<LessonProgress> & { lessonSlug: string }): LessonProgress {
  return { id: 1, completedAt: null, lastViewedAt: new Date(), countedForReward: false, ...partial }
}

describe('deriveStatus', () => {
  it('maps rows to status', () => {
    expect(deriveStatus(undefined)).toBe('not-started')
    expect(deriveStatus(progress({ lessonSlug: 'x' }))).toBe('in-progress')
    expect(deriveStatus(progress({ lessonSlug: 'x', completedAt: new Date() }))).toBe('completed')
  })
})

describe('composeOutline', () => {
  it('marks authored topics available and counts totals against them', () => {
    const out = composeOutline(disciplines, lessons, [])
    const group = out.groups[0]
    if (!group) throw new Error('no group')
    expect(group.total).toBe(1) // only the enzymes lesson is authored
    expect(group.lessons).toHaveLength(2) // both topics shown
    const enzymes = group.lessons.find((l) => l.slug === 'biochem.enzymes')
    const metabolic = group.lessons.find((l) => l.slug === 'biochem.metabolic-reactions')
    expect(enzymes?.available).toBe(true)
    expect(metabolic?.available).toBe(false)
  })

  it('counts completed lessons', () => {
    const out = composeOutline(disciplines, lessons, [progress({ lessonSlug: 'biochem.enzymes', completedAt: new Date() })])
    expect(out.completed).toBe(1)
    expect(out.total).toBe(1)
    expect(out.groups[0]?.completed).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/content/outline.test.ts`
Expected: FAIL — `src/main/content/outline.ts` does not exist.

- [ ] **Step 3: Write the outline composer**

Create `src/main/content/outline.ts`:
```ts
import type { Outline, OutlineGroup, LessonSummary, DisciplineKey, LessonStatus } from '../../shared/dto'
import type { LessonProgress } from '../db/schema'

export interface OutlineTopic {
  slug: string
  title: string
  aamcCodes: string[]
}
export interface OutlineDiscipline {
  discipline: DisciplineKey
  title: string
  topics: OutlineTopic[]
}
export interface OutlineLesson {
  slug: string
  title: string
  summary?: string
}

export function deriveStatus(row: LessonProgress | undefined): LessonStatus {
  if (!row) return 'not-started'
  return row.completedAt ? 'completed' : 'in-progress'
}

/** Merge taxonomy (all topics) + authored lessons + progress into the browse outline.
 *  Every topic is shown; only authored topics are `available` and counted in totals. */
export function composeOutline(
  disciplines: OutlineDiscipline[],
  lessons: OutlineLesson[],
  progress: LessonProgress[]
): Outline {
  const lessonBySlug = new Map(lessons.map((l) => [l.slug, l]))
  const progressBySlug = new Map(progress.map((p) => [p.lessonSlug, p]))
  const groups: OutlineGroup[] = []
  let completedAll = 0
  let totalAll = 0

  for (const d of disciplines) {
    const items: LessonSummary[] = []
    let completed = 0
    let total = 0
    for (const t of d.topics) {
      const lesson = lessonBySlug.get(t.slug)
      const available = lesson !== undefined
      const status = available ? deriveStatus(progressBySlug.get(t.slug)) : 'not-started'
      items.push({
        slug: t.slug,
        title: lesson?.title ?? t.title,
        discipline: d.discipline,
        summary: lesson?.summary,
        aamcCategories: t.aamcCodes,
        status,
        available
      })
      if (available) {
        total += 1
        if (status === 'completed') completed += 1
      }
    }
    groups.push({ discipline: d.discipline, title: d.title, completed, total, lessons: items })
    completedAll += completed
    totalAll += total
  }

  return { groups, completed: completedAll, total: totalAll }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/content/outline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/content/outline.ts test/content/outline.test.ts
git commit -m "feat(content): outline composition + status derivation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Lesson-progress repository + completion

**Files:**
- Create: `src/main/repositories/lesson-progress.ts`
- Test: `test/repositories/lesson-progress.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/repositories/lesson-progress.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { getState } from '../../src/main/repositories/gamification-state'
import { REWARDS_CONFIG } from '../../src/shared/gamification/config'
import {
  markViewed, setCompleted, completeLesson, getAllProgress, getProgressForSlug
} from '../../src/main/repositories/lesson-progress'

const SLUG = 'biochem.enzymes'
let db: DB
beforeEach(async () => {
  db = await createTestDb()
})

describe('lesson-progress repository', () => {
  it('markViewed creates then updates a row', async () => {
    await markViewed(db, SLUG)
    const first = await getProgressForSlug(db, SLUG)
    expect(first?.completedAt).toBeNull()
    await markViewed(db, SLUG)
    expect(await getAllProgress(db)).toHaveLength(1)
  })

  it('setCompleted sets completedAt and reports newlyCompleted once', async () => {
    const a = await setCompleted(db, SLUG, true)
    expect(a.newlyCompleted).toBe(true)
    const b = await setCompleted(db, SLUG, true)
    expect(b.newlyCompleted).toBe(false)
  })

  it('un-completing clears completedAt but never re-grants on re-complete', async () => {
    await setCompleted(db, SLUG, true)
    await setCompleted(db, SLUG, false)
    const row = await getProgressForSlug(db, SLUG)
    expect(row?.completedAt).toBeNull()
    const again = await setCompleted(db, SLUG, true)
    expect(again.newlyCompleted).toBe(false)
  })

  it('completeLesson credits gamification exactly once', async () => {
    const r1 = await completeLesson(db, SLUG)
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.data.status).toBe('completed')
      expect(r1.data.activity).toBeDefined()
    }
    const afterFirst = await getState(db)
    expect(afterFirst.xp).toBe(REWARDS_CONFIG.xpPerActivity)

    await setCompleted(db, SLUG, false)
    const r2 = await completeLesson(db, SLUG)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.data.activity).toBeUndefined() // no second grant
    const afterSecond = await getState(db)
    expect(afterSecond.xp).toBe(REWARDS_CONFIG.xpPerActivity)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/repositories/lesson-progress.test.ts`
Expected: FAIL — `src/main/repositories/lesson-progress.ts` does not exist.

- [ ] **Step 3: Write the repository**

Create `src/main/repositories/lesson-progress.ts`:
```ts
import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { lessonProgress, type LessonProgress } from '../db/schema'
import { recordActivity } from './activity'
import { deriveStatus } from '../content/outline'
import { ok, type ServiceResult, type MarkCompleteResult } from '../../shared/dto'

export async function getAllProgress(db: DB): Promise<LessonProgress[]> {
  return db.select().from(lessonProgress)
}

export async function getProgressForSlug(db: DB, slug: string): Promise<LessonProgress | undefined> {
  const [row] = await db.select().from(lessonProgress).where(eq(lessonProgress.lessonSlug, slug))
  return row
}

export async function markViewed(db: DB, slug: string, now = new Date()): Promise<void> {
  await db
    .insert(lessonProgress)
    .values({ lessonSlug: slug, lastViewedAt: now })
    .onConflictDoUpdate({ target: lessonProgress.lessonSlug, set: { lastViewedAt: now } })
}

/** Set/clear completion. `newlyCompleted` is true only the first time a lesson is
 *  ever completed (guarded by countedForReward), so XP is granted at most once. */
export async function setCompleted(
  db: DB,
  slug: string,
  completed: boolean,
  now = new Date()
): Promise<{ newlyCompleted: boolean }> {
  const existing = await getProgressForSlug(db, slug)
  if (!existing) {
    await db.insert(lessonProgress).values({
      lessonSlug: slug,
      lastViewedAt: now,
      completedAt: completed ? now : null,
      countedForReward: completed
    })
    return { newlyCompleted: completed }
  }
  const newlyCompleted = completed && !existing.countedForReward
  await db
    .update(lessonProgress)
    .set({
      completedAt: completed ? existing.completedAt ?? now : null,
      countedForReward: existing.countedForReward || completed
    })
    .where(eq(lessonProgress.id, existing.id))
  return { newlyCompleted }
}

/** Mark complete and, on the first-ever completion, credit gamification. */
export async function completeLesson(
  db: DB,
  slug: string,
  now = new Date()
): Promise<ServiceResult<MarkCompleteResult>> {
  const { newlyCompleted } = await setCompleted(db, slug, true, now)
  if (!newlyCompleted) return ok<MarkCompleteResult>({ status: 'completed' })
  const activity = await recordActivity(db, { kind: 'lesson.complete', taxonomyRef: slug, now })
  return ok<MarkCompleteResult>({ status: 'completed', activity: activity.ok ? activity.data : undefined })
}

export { deriveStatus }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/repositories/lesson-progress.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/repositories/lesson-progress.ts test/repositories/lesson-progress.test.ts
git commit -m "feat(content): lesson-progress repo + once-only completion reward

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: contentReview IPC + preload + wiring

**Files:**
- Create: `src/main/ipc/content-review.ts`
- Modify: `src/preload/index.ts`, `src/main/index.ts`
- Test: `test/content/ipc-validation.test.ts`

- [ ] **Step 1: Write the failing validation test**

Create `test/content/ipc-validation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { slugSchema, markCompleteSchema } from '../../src/main/ipc/content-review'

describe('content-review IPC validation', () => {
  it('accepts a valid slug', () => {
    expect(slugSchema.parse('biochem.enzymes')).toBe('biochem.enzymes')
  })
  it('rejects an empty slug', () => {
    expect(() => slugSchema.parse('')).toThrow()
  })
  it('validates the markComplete payload', () => {
    expect(markCompleteSchema.parse({ slug: 'a.b', completed: true })).toEqual({ slug: 'a.b', completed: true })
    expect(() => markCompleteSchema.parse({ slug: 'a.b' })).toThrow()
    expect(() => markCompleteSchema.parse({ slug: '', completed: true })).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/content/ipc-validation.test.ts`
Expected: FAIL — `src/main/ipc/content-review.ts` does not exist.

- [ ] **Step 3: Write the IPC handlers**

Create `src/main/ipc/content-review.ts`:
```ts
import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { ok } from '../../shared/dto'
import type { LessonDetail, LessonRef, Outline } from '../../shared/dto'
import { listDisciplinesWithTopics, getTopicBySlug, topicForTaxonomyRef } from '../repositories/taxonomy'
import {
  getAllProgress, getProgressForSlug, markViewed, setCompleted, completeLesson, deriveStatus
} from '../repositories/lesson-progress'
import { composeOutline } from '../content/outline'
import type { LessonStore } from '../content/lessons'

export const slugSchema = z.string().min(1).max(128)
export const markCompleteSchema = z.object({ slug: z.string().min(1).max(128), completed: z.boolean() })

export function registerContentReviewIpc(db: DB, store: LessonStore): void {
  ipcMain.handle(CH.contentGetOutline, async (): Promise<Outline> => {
    const [taxonomy, progress] = await Promise.all([listDisciplinesWithTopics(db), getAllProgress(db)])
    return composeOutline(taxonomy, store.list(), progress)
  })

  ipcMain.handle(CH.contentGetLesson, async (_e, raw: unknown): Promise<LessonDetail | null> => {
    const slug = slugSchema.parse(raw)
    const lesson = store.get(slug)
    if (!lesson) return null
    const topic = await getTopicBySlug(db, slug)
    if (!topic) return null
    const progress = await getProgressForSlug(db, slug)
    return {
      slug,
      title: lesson.title,
      discipline: topic.discipline,
      aamcCategories: topic.aamcCodes,
      html: lesson.html,
      status: deriveStatus(progress)
    }
  })

  ipcMain.handle(CH.contentMarkViewed, async (_e, raw: unknown): Promise<void> => {
    await markViewed(db, slugSchema.parse(raw))
  })

  ipcMain.handle(CH.contentMarkComplete, async (_e, raw: unknown) => {
    const p = markCompleteSchema.parse(raw)
    if (p.completed) return completeLesson(db, p.slug)
    await setCompleted(db, p.slug, false)
    const row = await getProgressForSlug(db, p.slug)
    return ok({ status: deriveStatus(row) })
  })

  ipcMain.handle(CH.contentLessonForTaxonomy, async (_e, raw: unknown): Promise<LessonRef | null> => {
    const ref = slugSchema.parse(raw)
    const topic = await topicForTaxonomyRef(db, ref)
    if (!topic || !store.has(topic.slug)) return null
    return { slug: topic.slug, title: topic.title, discipline: topic.discipline }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/content/ipc-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the preload namespace**

In `src/preload/index.ts`, add the `contentReview` namespace to the `api` object (after the `gamification` block, inside the object literal):
```ts
  contentReview: {
    getOutline: () => ipcRenderer.invoke(CH.contentGetOutline),
    getLesson: (slug) => ipcRenderer.invoke(CH.contentGetLesson, slug),
    markViewed: (slug) => ipcRenderer.invoke(CH.contentMarkViewed, slug),
    markComplete: (slug, completed) => ipcRenderer.invoke(CH.contentMarkComplete, { slug, completed }),
    lessonForTaxonomy: (ref) => ipcRenderer.invoke(CH.contentLessonForTaxonomy, ref)
  }
```
(Add a comma after the `gamification: { … }` block's closing brace.)

- [ ] **Step 6: Wire main-process startup**

In `src/main/index.ts`, add imports near the other repository/IPC imports:
```ts
import { registerContentReviewIpc } from './ipc/content-review'
import { seedTaxonomy } from './repositories/taxonomy'
import { createLessonStore } from './content/lessons'
import { contentRoot } from './content/root'
```
Then inside `app.whenReady().then(async () => { … })`, after `await ensureStarterGrant(db)` and before the `registerProfileIpc(db)` line, add:
```ts
  await seedTaxonomy(db)
  const lessonStore = createLessonStore(contentRoot())
```
And after `registerGamificationIpc(db)` add:
```ts
  registerContentReviewIpc(db, lessonStore)
```

- [ ] **Step 7: Typecheck + full test suite**

Run: `npx tsc --noEmit`
Expected: PASS (the preload now satisfies `FreecatApi`; no errors).

Run: `npm test`
Expected: PASS — all existing + new tests green.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/content-review.ts src/preload/index.ts src/main/index.ts test/content/ipc-validation.test.ts
git commit -m "feat(content): contentReview IPC handlers, preload, startup wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Navigation payload extension

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Extend the router with an optional payload**

Replace the body of `src/renderer/src/App.tsx` with (keeps the existing `ROUTES`/nav markup, adds `NavPayload` + payload state):
```tsx
import { useState } from 'react'
import Home from './pages/Home'
import Nest from './pages/Nest'
import Qbank from './pages/Qbank'
import ContentReview from './pages/ContentReview'
import Flashcards from './pages/Flashcards'

const ROUTES = {
  home: { label: 'Home', component: Home },
  nest: { label: 'Nest', component: Nest },
  qbank: { label: 'Qbank', component: Qbank },
  content: { label: 'Content Review', component: ContentReview },
  flashcards: { label: 'Flashcards', component: Flashcards }
} as const

export type RouteKey = keyof typeof ROUTES

/** Optional deep-link target carried across a module switch (cross-links). */
export interface NavPayload {
  lessonSlug?: string
  topicSlug?: string
}

/** Pages may opt into navigation by accepting these props. */
export interface PageProps {
  navigate?: (key: RouteKey, payload?: NavPayload) => void
  navPayload?: NavPayload
}

export default function App(): React.JSX.Element {
  const [route, setRoute] = useState<RouteKey>('home')
  const [payload, setPayload] = useState<NavPayload | undefined>(undefined)
  const Active = ROUTES[route].component

  const navigate = (key: RouteKey, p?: NavPayload): void => {
    setRoute(key)
    setPayload(p)
  }

  return (
    <div className="flex h-screen">
      <nav className="w-48 bg-gray-100 p-4 space-y-1">
        <div className="text-lg font-bold text-blue-600 mb-4">FreeCAT</div>
        {(Object.keys(ROUTES) as RouteKey[]).map((key) => (
          <button
            key={key}
            onClick={() => navigate(key)}
            aria-current={route === key ? 'page' : undefined}
            className={`block w-full text-left px-3 py-2 rounded ${
              route === key ? 'bg-blue-600 text-white' : 'hover:bg-gray-200'
            }`}
          >
            {ROUTES[key].label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto">
        <Active navigate={navigate} navPayload={payload} />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (existing pages accept the superset `PageProps`; `navPayload` is optional).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(shell): navigate(key, payload?) for cross-module deep-links

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Sample lessons (bundled content)

**Files:**
- Create: `content/lessons/biochem/enzymes/{lesson.yaml,body.html}`
- Create: `content/lessons/gen-chem/thermo-kinetics-gas/{lesson.yaml,body.html}`
- Create: `content/lessons/behavioral-sci/learning-memory-cognition/{lesson.yaml,body.html}`

Each `body.html` is fully self-contained (inline CSS/JS; no network). Keep them short but real, with one interactive element to exercise the sandbox.

- [ ] **Step 1: Enzymes — envelope**

Create `content/lessons/biochem/enzymes/lesson.yaml`:
```yaml
slug: biochem.enzymes
title: Enzymes
summary: Biological catalysts — how they speed reactions and how they're regulated.
```

- [ ] **Step 2: Enzymes — body**

Create `content/lessons/biochem/enzymes/body.html`:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root { font-family: system-ui, sans-serif; color: #1f2937; line-height: 1.6; }
  body { margin: 0; padding: 2rem; max-width: 46rem; }
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.2rem; margin-top: 1.5rem; }
  .quiz { margin-top: 1.5rem; padding: 1rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; background: #f9fafb; }
  button { font: inherit; padding: 0.4rem 0.8rem; border: 0; border-radius: 0.375rem; background: #2563eb; color: #fff; cursor: pointer; }
  .answer { margin-top: 0.75rem; color: #047857; font-weight: 600; display: none; }
</style>
</head>
<body>
  <h1>Enzymes</h1>
  <p>Enzymes are protein catalysts that lower the <strong>activation energy</strong> of a reaction without being consumed. They do not change the equilibrium — only the rate at which it is reached.</p>
  <h2>Key ideas</h2>
  <ul>
    <li>The <em>active site</em> binds substrate (induced-fit model).</li>
    <li>Activity depends on temperature and pH.</li>
    <li>Inhibitors: competitive (raise apparent K<sub>m</sub>) vs. noncompetitive (lower V<sub>max</sub>).</li>
  </ul>
  <div class="quiz">
    <p><strong>Check:</strong> Does an enzyme change the equilibrium constant of a reaction?</p>
    <button id="reveal">Reveal answer</button>
    <p class="answer" id="answer">No — enzymes speed up both forward and reverse rates equally, so K<sub>eq</sub> is unchanged.</p>
  </div>
  <script>
    document.getElementById('reveal').addEventListener('click', function () {
      document.getElementById('answer').style.display = 'block';
    });
  </script>
</body>
</html>
```

- [ ] **Step 3: Thermodynamics — envelope**

Create `content/lessons/gen-chem/thermo-kinetics-gas/lesson.yaml`:
```yaml
slug: gen-chem.thermo-kinetics-gas
title: Thermodynamics, Kinetics & Gas Laws
summary: Energy, spontaneity, reaction rates, and the behavior of ideal gases.
```

- [ ] **Step 4: Thermodynamics — body**

Create `content/lessons/gen-chem/thermo-kinetics-gas/body.html`:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root { font-family: system-ui, sans-serif; color: #1f2937; line-height: 1.6; }
  body { margin: 0; padding: 2rem; max-width: 46rem; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.2rem; margin-top: 1.5rem; }
  code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 0.25rem; }
  .quiz { margin-top: 1.5rem; padding: 1rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; background: #f9fafb; }
  button { font: inherit; padding: 0.4rem 0.8rem; border: 0; border-radius: 0.375rem; background: #2563eb; color: #fff; cursor: pointer; }
  .answer { margin-top: 0.75rem; color: #047857; font-weight: 600; display: none; }
</style>
</head>
<body>
  <h1>Thermodynamics, Kinetics &amp; Gas Laws</h1>
  <p>Gibbs free energy ties enthalpy and entropy together: <code>ΔG = ΔH − TΔS</code>. A reaction is spontaneous when <code>ΔG &lt; 0</code>.</p>
  <h2>Kinetics vs. thermodynamics</h2>
  <p>Thermodynamics says <em>whether</em> a reaction is favorable; kinetics says <em>how fast</em>. A spontaneous reaction can still be slow (large activation energy).</p>
  <h2>Ideal gas law</h2>
  <p><code>PV = nRT</code> relates pressure, volume, moles, and temperature.</p>
  <div class="quiz">
    <p><strong>Check:</strong> A reaction has ΔG &lt; 0 but proceeds slowly. Why?</p>
    <button id="reveal">Reveal answer</button>
    <p class="answer" id="answer">Spontaneity (ΔG) is separate from rate — a high activation energy keeps it slow despite being thermodynamically favorable.</p>
  </div>
  <script>
    document.getElementById('reveal').addEventListener('click', function () {
      document.getElementById('answer').style.display = 'block';
    });
  </script>
</body>
</html>
```

- [ ] **Step 5: Learning & memory — envelope**

Create `content/lessons/behavioral-sci/learning-memory-cognition/lesson.yaml`:
```yaml
slug: behavioral-sci.learning-memory-cognition
title: Learning, Memory & Cognition
summary: Conditioning, memory stores, and how information is encoded and retrieved.
```

- [ ] **Step 6: Learning & memory — body**

Create `content/lessons/behavioral-sci/learning-memory-cognition/body.html`:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root { font-family: system-ui, sans-serif; color: #1f2937; line-height: 1.6; }
  body { margin: 0; padding: 2rem; max-width: 46rem; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.2rem; margin-top: 1.5rem; }
  .quiz { margin-top: 1.5rem; padding: 1rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; background: #f9fafb; }
  button { font: inherit; padding: 0.4rem 0.8rem; border: 0; border-radius: 0.375rem; background: #2563eb; color: #fff; cursor: pointer; }
  .answer { margin-top: 0.75rem; color: #047857; font-weight: 600; display: none; }
</style>
</head>
<body>
  <h1>Learning, Memory &amp; Cognition</h1>
  <p>Classical conditioning pairs a neutral stimulus with a reflex; operant conditioning shapes behavior through reinforcement and punishment.</p>
  <h2>Memory stores</h2>
  <p>Sensory → short-term/working → long-term. Encoding strategies (e.g., elaborative rehearsal) move information into durable storage.</p>
  <div class="quiz">
    <p><strong>Check:</strong> A rat presses a lever more often after receiving food. Which type of conditioning is this?</p>
    <button id="reveal">Reveal answer</button>
    <p class="answer" id="answer">Operant conditioning — behavior increases because it is followed by positive reinforcement.</p>
  </div>
  <script>
    document.getElementById('reveal').addEventListener('click', function () {
      document.getElementById('answer').style.display = 'block';
    });
  </script>
</body>
</html>
```

- [ ] **Step 7: Commit**

```bash
git add content/lessons/
git commit -m "content: three sample lessons (enzymes, thermo, learning & memory)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Renderer — browse + reader

**Files:**
- Create: `src/renderer/src/content/LessonReader.tsx`
- Modify: `src/renderer/src/pages/ContentReview.tsx`

No RTL/jsdom harness exists in this repo (Vitest runs in the `node` environment), so renderer correctness is verified by `npx tsc --noEmit` plus a manual `npm run dev` smoke; all testable logic lives in the already-tested main process.

- [ ] **Step 1: Write the lesson reader**

Create `src/renderer/src/content/LessonReader.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react'
import type { LessonDetail, LessonStatus, ActivityResult } from '../../../shared/dto'
import type { RouteKey, NavPayload } from '../App'

interface Props {
  slug: string
  navigate?: (key: RouteKey, payload?: NavPayload) => void
  onBack: () => void
}

export default function LessonReader({ slug, navigate, onBack }: Props): React.JSX.Element {
  const [lesson, setLesson] = useState<LessonDetail | null>(null)
  const [status, setStatus] = useState<LessonStatus>('not-started')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.freecat.contentReview
      .getLesson(slug)
      .then((l) => {
        if (!alive) return
        if (!l) {
          setFailed(true)
          return
        }
        setLesson(l)
        setStatus(l.status)
      })
      .catch((e) => {
        console.error('Failed to load lesson', e)
        if (alive) setFailed(true)
      })
    void window.freecat.contentReview.markViewed(slug).catch((e) => console.error('markViewed failed', e))
    return () => {
      alive = false
    }
  }, [slug])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const toggleComplete = useCallback(
    async (completed: boolean) => {
      setBusy(true)
      try {
        const res = await window.freecat.contentReview.markComplete(slug, completed)
        if (res.ok) {
          setStatus(res.data.status)
          if (res.data.activity) setToast(buildToast(res.data.activity))
        } else {
          console.error('markComplete failed', res.error)
        }
      } catch (e) {
        console.error('markComplete threw', e)
      } finally {
        setBusy(false)
      }
    },
    [slug]
  )

  const practiceAvailable =
    typeof (window.freecat as unknown as { qbank?: { questionsForTaxonomy?: unknown } }).qbank
      ?.questionsForTaxonomy === 'function'

  if (failed) {
    return (
      <div className="p-8">
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
          ← Content Review
        </button>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-800">Could not load this lesson.</p>
      </div>
    )
  }
  if (!lesson) return <div className="p-8 text-gray-400">Loading…</div>

  const completed = status === 'completed'
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
            ← Content Review
          </button>
          <h2 className="text-lg font-semibold text-gray-800">{lesson.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={busy}
            onClick={() => toggleComplete(!completed)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
              completed
                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {completed ? '✓ Completed' : 'Mark complete'}
          </button>
          <button
            disabled={!practiceAvailable}
            title={practiceAvailable ? 'Practice this topic in Qbank' : 'Practice coming soon'}
            onClick={() => navigate?.('qbank', { topicSlug: slug })}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Practice this topic →
          </button>
        </div>
      </header>

      <iframe
        title={lesson.title}
        srcDoc={lesson.html}
        sandbox="allow-scripts"
        className="min-h-0 flex-1 bg-white"
      />

      {lesson.aamcCategories.length > 0 && (
        <footer className="border-t border-gray-100 px-6 py-2 text-xs text-gray-400">
          AAMC categories: {lesson.aamcCategories.join(', ')}
        </footer>
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

function buildToast(a: ActivityResult): string {
  const parts = ['Lesson complete! 🎉']
  if (a.goalJustMet) parts.push('Daily goal met!')
  if (a.eggBecameReady) parts.push('Your egg is ready to hatch!')
  parts.push(`🔥 ${a.streak}-day streak`)
  return parts.join('  ·  ')
}
```

- [ ] **Step 2: Write the browse container (replace the placeholder)**

Replace `src/renderer/src/pages/ContentReview.tsx` with:
```tsx
import { useCallback, useEffect, useState } from 'react'
import type { Outline, LessonStatus } from '../../../shared/dto'
import type { PageProps } from '../App'
import LessonReader from '../content/LessonReader'

export default function ContentReview({ navigate, navPayload }: PageProps): React.JSX.Element {
  const [outline, setOutline] = useState<Outline | null>(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState<string | null>(navPayload?.lessonSlug ?? null)

  const load = useCallback(async () => {
    try {
      setOutline(await window.freecat.contentReview.getOutline())
      setFailed(false)
    } catch (e) {
      console.error('Failed to load content outline', e)
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (navPayload?.lessonSlug) setActive(navPayload.lessonSlug)
  }, [navPayload])

  if (active) {
    return (
      <LessonReader
        slug={active}
        navigate={navigate}
        onBack={() => {
          setActive(null)
          void load()
        }}
      />
    )
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="flex items-center justify-between">
        <h2 className="text-3xl font-bold text-gray-800">Content Review</h2>
        {outline && (
          <span className="text-sm text-gray-500">
            {outline.completed} / {outline.total} lessons
          </span>
        )}
      </header>

      {failed && (
        <p className="mt-8 rounded-lg bg-amber-50 p-4 text-amber-800">
          We could not load your lessons just now.
        </p>
      )}

      <div className="mt-8 space-y-8">
        {outline?.groups.map((g) => (
          <section key={g.discipline}>
            <div className="flex items-baseline justify-between">
              <h3 className="text-xl font-semibold text-gray-800">{g.title}</h3>
              <span className="text-xs text-gray-400">
                {g.completed}/{g.total}
              </span>
            </div>
            <ul className="mt-3 divide-y divide-gray-100 rounded-xl bg-white ring-1 ring-gray-100">
              {g.lessons.map((l) => (
                <li key={l.slug}>
                  <button
                    disabled={!l.available}
                    onClick={() => setActive(l.slug)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      <StatusDot status={l.status} available={l.available} />
                      <span className="font-medium text-gray-800">{l.title}</span>
                    </span>
                    <span className="text-xs text-gray-400">
                      {!l.available
                        ? 'Coming soon'
                        : l.status === 'completed'
                          ? 'Completed'
                          : l.status === 'in-progress'
                            ? 'In progress'
                            : 'Start'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function StatusDot({ status, available }: { status: LessonStatus; available: boolean }): React.JSX.Element {
  const color = !available
    ? 'bg-gray-200'
    : status === 'completed'
      ? 'bg-emerald-500'
      : status === 'in-progress'
        ? 'bg-amber-400'
        : 'bg-gray-300'
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`
Verify:
1. Click **Content Review** → all 5 disciplines render; 3 topics are clickable (enzymes, thermo, learning & memory), the rest show "Coming soon"; header reads "0 / 3 lessons".
2. Open **Enzymes** → the HTML renders in the iframe; clicking **Reveal answer** inside the lesson works (sandbox `allow-scripts`).
3. Click **Mark complete** → button flips to "✓ Completed", a toast shows the streak; **Practice this topic** is disabled ("coming soon", since Qbank isn't wired).
4. Back → header now reads "1 / 3 lessons" and Enzymes shows a green dot / "Completed".
5. In DevTools console, run `window.freecat` — confirm no error; attempting `window.parent` from inside the iframe (via the lesson) has no access to `freecat` (sandboxed). 
Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/ContentReview.tsx src/renderer/src/content/LessonReader.tsx
git commit -m "feat(content): browse + sandboxed-iframe lesson reader UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Charter updates, authoring doc, final verification

**Files:**
- Modify: `docs/freecat-charter.md`
- Create: `docs/content-authoring.md`

- [ ] **Step 1: Update the charter**

In `docs/freecat-charter.md`, make these edits (the taxonomy is now defined by Content Review, running parallel to Qbank):

§5.1 — append after the existing taxonomy paragraph:
```markdown
**Update (2026-06-23, Content Review):** the working taxonomy is **discipline→topic-primary** — 5 disciplines (`gen-chem`, `o-chem`, `biology`, `biochem`, `behavioral-sci`; no Physics/CARS in v1) with ~25 topics, each topic also carrying mapped **AAMC content-category code(s)** as a secondary bridge. It is **DB-seeded** (`taxonomy_node` + `topic_aamc_category`) and was defined in the **Content Review brainstorm** (Qbank built in parallel). The cross-link key is the **topic slug**; Qbank tags questions against it.
```

§5.2 — append an update note immediately after the ownership bullet list (the bullets currently say Qbank "establishes the shared `taxonomy` + content-registry tables"):
```markdown
**Update (2026-06-23):** because Content Review executed first (Qbank built in parallel), **Content Review establishes the shared `taxonomy` tables** (`taxonomy_node` + `topic_aamc_category`); **Qbank consumes them and must not create its own taxonomy migration.** Content Review owns `lesson_progress`. Qbank still owns its attempts/sessions/flags + the `content_registry` table.
```

§5.5 — append:
```markdown
**Update (2026-06-23):** the generic content **loader (pipeline v0)** is established by Content Review in `src/main/content/` (`loadContentType` + `contentRoot`); Qbank reuses/extends it. Content Review lessons use a **self-contained `body.html`** (interactive HTML rendered in a sandboxed iframe) rather than the original Markdown sketch.
```

§5.6 — append:
```markdown
**Update (2026-06-23):** the shell's `navigate` accepts an optional payload — `navigate(key, payload?)` with `{ lessonSlug?, topicSlug? }` — for cross-module deep-links.
```

- [ ] **Step 2: Write the authoring doc**

Create `docs/content-authoring.md`:
```markdown
# Authoring Content Review lessons

A lesson is one folder under `content/lessons/<discipline>/<topic-slug>/`:

- `lesson.yaml` — `slug` (must match a taxonomy topic slug in `src/main/db/seed/taxonomy-data.ts`), `title`, optional `summary`, `order`, `bodyFile`.
- `body.html` — the lesson, as **fully self-contained interactive HTML**.

## Rules
- **Offline / no network.** Inline all CSS, JS, images (data URIs), and math (KaTeX/MathJax inlined or pre-rendered). No CDN links — the app runs with no network.
- **Sandboxed.** The HTML renders in `<iframe sandbox="allow-scripts">` with an opaque origin. It cannot access the app, your data, or other lessons. Only `allow-scripts` is granted (no forms/popups).
- **Cross-links** come from the taxonomy, not the lesson — tag the matching topic slug; the app supplies "Practice this topic" and related questions.

## Disciplines (v1)
`gen-chem`, `o-chem`, `biology`, `biochem`, `behavioral-sci`. (Physics and CARS are out of v1.)
```

- [ ] **Step 3: Final full verification**

Run: `npm test`
Expected: PASS — entire suite green (existing Foundation/gamification tests + all new content tests).

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

Run: `npm run build`
Expected: the electron-vite build completes for main, preload, and renderer with no errors.

- [ ] **Step 4: Commit**

```bash
git add docs/freecat-charter.md docs/content-authoring.md
git commit -m "docs: charter taxonomy/pipeline updates + lesson authoring guide

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes & cross-module follow-ups (not tasks)

- **Prod content bundling (depends on Foundation C8):** packaging must add `content/` to electron-builder `extraResources` so `contentRoot()` resolves under `process.resourcesPath` in a packaged build. C8 isn't built yet; dev path works today. Flag this when C8 lands.
- **Qbank's half of the cross-link (parallel session must implement):** `window.freecat.qbank.questionsForTaxonomy(ref)` (ref = topic slug or AAMC code); tag questions with topic slugs; consume `contentReview.lessonForTaxonomy(ref)`; honor the `{ topicSlug }` nav payload. Until then, "Practice this topic" stays disabled and degrades gracefully.
- **AAMC mapping review:** the topic→AAMC assignments in `taxonomy-data.ts` are best-effort and meant for Warren's review.
- **`lessonForTaxonomy` with an AAMC code** that maps to several topics returns the first authored match; questions normally carry the precise topic slug, so this fallback is rarely hit.
