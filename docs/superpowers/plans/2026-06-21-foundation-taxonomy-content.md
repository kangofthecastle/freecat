# FreeCAT Foundation — Plan 2: MCAT Taxonomy & Content Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two of the shared Foundation contracts the modules consume: the **MCAT taxonomy** (the cross-linking backbone) and the **authored-content pipeline** (the YAML+Markdown+images format, Zod validation, a `content:validate` CLI, and CI), with the taxonomy queryable over IPC and an example question that validates.

**Architecture:** Taxonomy is seeded data in the SQLite DB (a `taxonomy_node` tree from the AAMC content outline), exposed read-only over IPC. Authored content lives as files under `content/` (one folder per item: a YAML envelope + Markdown prose fields + co-located images); a loader parses + validates it against Zod schemas, and a CLI runs that validation in CI. Modules later build their own content-query IPC on top of these schemas/loader.

**Tech Stack:** Drizzle/libsql (existing), Zod (existing), **js-yaml** (new) for the YAML envelope, Vitest, GitHub Actions.

**This is Plan 2 of the Foundation.** Depends on Plan 1 (DB, IPC pattern, repository convention). It does NOT render content in the UI (modules do that) and does NOT configure prod bundling of `content/`/`drizzle/` (Plan 4 packaging). Charter contracts implemented here: §5.1 (taxonomy), §5.5 (content pipeline).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/main/db/schema.ts` | + `taxonomyNode` table (extends existing schema) |
| `src/main/db/taxonomy-seed-data.ts` | The AAMC taxonomy as a plain data array (no electron/db imports) |
| `src/main/db/seed-taxonomy.ts` | `seedTaxonomy(db)` — idempotent upsert of the seed data |
| `src/main/repositories/taxonomy.ts` | `listSections`, `getChildren`, `getByCode`, `listAll` |
| `src/main/ipc/taxonomy.ts` | `registerTaxonomyIpc(db)` — `taxonomy:list` |
| `src/main/content/schemas.ts` | Zod schemas: `questionSchema`, `lessonSchema` + inferred types |
| `src/main/content/loader.ts` | `loadContentItem(dir)`, `loadAllContent(root)` — parse YAML, validate, resolve images |
| `src/main/content/validate-cli.ts` | CLI entry: validate all of `content/`, check taxonomy codes + images + unique ids, exit nonzero on failure |
| `content/questions/chem-phys/0042-doppler/` | Example question (`question.yaml` + an image) that validates |
| `.github/workflows/ci.yml` | CI: install → content:validate → tsc → test → build |
| `test/taxonomy.test.ts`, `test/content-schemas.test.ts`, `test/content-loader.test.ts` | Tests |
| `src/preload/index.ts` | + `taxonomy.list()` on the bridge |
| `src/renderer/src/env.d.ts` | + `taxonomy` types on `window.freecat` |
| `package.json` | + `js-yaml` dep, `content:validate` script |

---

## Task 1: Add js-yaml and the taxonomy_node schema + migration

**Files:** `package.json`, `src/main/db/schema.ts`, generated `drizzle/`

- [ ] **Step 1: Install js-yaml**

Run: `cd ~/wrk/freecat && npm install js-yaml && npm install -D @types/js-yaml`
Expected: both added; `npm ls js-yaml` shows a version.

- [ ] **Step 2: Add the `taxonomyNode` table to `src/main/db/schema.ts`** (append; keep the existing `profile` table)

```ts
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'

// ...existing `profile` table stays...

// Foundation-owned: the MCAT taxonomy tree (AAMC content outline).
export const taxonomyNode = sqliteTable('taxonomy_node', {
  // Stable string id, e.g. "section:chem-phys", "fc:4", "cc:4A", "skill:cars-comprehension", "topic:doppler-effect"
  id: text('id').primaryKey(),
  kind: text('kind', {
    enum: ['section', 'foundational_concept', 'content_category', 'skill', 'topic']
  }).notNull(),
  code: text('code').notNull(), // e.g. "chem-phys", "4", "4A"
  title: text('title').notNull(),
  parentId: text('parent_id') // null for sections
})

export type TaxonomyNode = typeof taxonomyNode.$inferSelect
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0001_*.sql` with `CREATE TABLE taxonomy_node (...)`. Confirm the columns + the `kind` CHECK constraint.

- [ ] **Step 4: Run tsc + existing tests (no regressions)**

Run: `npx tsc --noEmit && npm test`
Expected: tsc exit 0; the existing 7 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/main/db/schema.ts drizzle/
git commit -m "feat(taxonomy): add taxonomy_node schema + js-yaml dep"
```

---

## Task 2: AAMC taxonomy seed data + idempotent seeding (TDD)

**Files:** `src/main/db/taxonomy-seed-data.ts`, `src/main/db/seed-taxonomy.ts`, `test/taxonomy.test.ts`

- [ ] **Step 1: Write `src/main/db/taxonomy-seed-data.ts`** — the AAMC content outline as plain data (no imports).

Encode the **official AAMC MCAT content outline**. Shape each entry as `{ id, kind, code, title, parentId }`. Required coverage (verify against the published AAMC outline — use the real category titles):
- **4 sections** (kind `section`, parentId null): `chem-phys` (Chemical and Physical Foundations of Biological Systems), `cars` (Critical Analysis and Reasoning Skills), `bio-biochem` (Biological and Biochemical Foundations of Living Systems), `psych-soc` (Psychological, Social, and Biological Foundations of Behavior).
- **10 foundational concepts** (kind `foundational_concept`): FC1–FC3 under `bio-biochem`, FC4–FC5 under `chem-phys`, FC6–FC10 under `psych-soc`. (CARS has none.)
- **Content categories** (kind `content_category`), parented to their FC, with the exact AAMC codes: `1A–1D`, `2A–2C`, `3A–3B`, `4A–4E`, `5A–5E`, `6A–6C`, `7A–7C`, `8A–8C`, `9A–9B`, `10A`. Use the official category titles.
- **CARS skills** (kind `skill`, parented to `cars`): Foundations of Comprehension; Reasoning Within the Text; Reasoning Beyond the Text.

```ts
export interface TaxonomySeedNode {
  id: string
  kind: 'section' | 'foundational_concept' | 'content_category' | 'skill' | 'topic'
  code: string
  title: string
  parentId: string | null
}

export const taxonomySeed: TaxonomySeedNode[] = [
  { id: 'section:chem-phys', kind: 'section', code: 'chem-phys', title: 'Chemical and Physical Foundations of Biological Systems', parentId: null },
  // ...the other 3 sections...
  { id: 'fc:4', kind: 'foundational_concept', code: '4', title: 'Complex living organisms transport materials, sense their environment, process signals, and respond to changes', parentId: 'section:chem-phys' },
  { id: 'cc:4A', kind: 'content_category', code: '4A', title: 'Translational motion, forces, work, energy, and equilibrium in living systems', parentId: 'fc:4' },
  // ...all remaining FCs, content categories, and CARS skills...
]
```
(Topics are added later alongside content; the seed covers sections → FCs → content categories + CARS skills.)

- [ ] **Step 2: Write the failing test `test/taxonomy.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb, type DB } from '../src/main/db/client'
import { runMigrations } from '../src/main/db/migrate'
import { seedTaxonomy } from '../src/main/db/seed-taxonomy'
import { taxonomySeed } from '../src/main/db/taxonomy-seed-data'
import { listSections, getByCode, getChildren } from '../src/main/repositories/taxonomy'

let db: DB
beforeEach(async () => {
  db = createDb(':memory:')
  await runMigrations(db, 'drizzle')
  await seedTaxonomy(db)
})

describe('taxonomy seed + repository', () => {
  it('seeds the 4 MCAT sections', async () => {
    const sections = await listSections(db)
    expect(sections.map((s) => s.code).sort()).toEqual(['bio-biochem', 'cars', 'chem-phys', 'psych-soc'])
  })

  it('every non-section node has a parent that exists in the seed', () => {
    const ids = new Set(taxonomySeed.map((n) => n.id))
    for (const n of taxonomySeed) {
      if (n.kind !== 'section') expect(ids.has(n.parentId!)).toBe(true)
    }
  })

  it('looks up a content category by code', async () => {
    const cc = await getByCode(db, '4A')
    expect(cc?.kind).toBe('content_category')
    expect(cc?.parentId).toBe('fc:4')
  })

  it('seeding twice is idempotent (no duplicates)', async () => {
    await seedTaxonomy(db)
    const all = await db.select().from((await import('../src/main/db/schema')).taxonomyNode)
    expect(all.length).toBe(taxonomySeed.length)
  })

  it('lists children of a foundational concept', async () => {
    const fc4 = await getByCode(db, '4')
    const kids = await getChildren(db, fc4!.id)
    expect(kids.length).toBeGreaterThanOrEqual(5) // 4A–4E
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/taxonomy.test.ts`
Expected: FAIL — `seedTaxonomy` / repository functions not found.

- [ ] **Step 4: Write `src/main/db/seed-taxonomy.ts`** (idempotent upsert)

```ts
import type { DB } from './client'
import { taxonomyNode } from './schema'
import { taxonomySeed } from './taxonomy-seed-data'

export async function seedTaxonomy(db: DB): Promise<void> {
  for (const node of taxonomySeed) {
    await db
      .insert(taxonomyNode)
      .values(node)
      .onConflictDoUpdate({
        target: taxonomyNode.id,
        set: { kind: node.kind, code: node.code, title: node.title, parentId: node.parentId }
      })
  }
}
```

- [ ] **Step 5: Write `src/main/repositories/taxonomy.ts`** (per the repository convention: `.returning()` where writing, guard-and-throw, electron-free)

```ts
import { eq, isNull } from 'drizzle-orm'
import type { DB } from '../db/client'
import { taxonomyNode, type TaxonomyNode } from '../db/schema'

export async function listAll(db: DB): Promise<TaxonomyNode[]> {
  return db.select().from(taxonomyNode)
}

export async function listSections(db: DB): Promise<TaxonomyNode[]> {
  return db.select().from(taxonomyNode).where(isNull(taxonomyNode.parentId))
}

export async function getByCode(db: DB, code: string): Promise<TaxonomyNode | undefined> {
  const [node] = await db.select().from(taxonomyNode).where(eq(taxonomyNode.code, code)).limit(1)
  return node
}

export async function getChildren(db: DB, parentId: string): Promise<TaxonomyNode[]> {
  return db.select().from(taxonomyNode).where(eq(taxonomyNode.parentId, parentId))
}
```
> Note: `code` is unique per the AAMC outline, so `getByCode` returning the first match is well-defined.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/taxonomy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Run full suite + tsc, then commit**

Run: `npx tsc --noEmit && npm test` (expect 12 passing: 7 prior + 5)

```bash
git add src/main/db/taxonomy-seed-data.ts src/main/db/seed-taxonomy.ts src/main/repositories/taxonomy.ts test/taxonomy.test.ts
git commit -m "feat(taxonomy): AAMC seed data, idempotent seeding, repository (TDD)"
```

---

## Task 3: Seed taxonomy on startup + taxonomy IPC

**Files:** `src/main/index.ts`, `src/main/ipc/taxonomy.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`

- [ ] **Step 1: Write `src/main/ipc/taxonomy.ts`**

```ts
import { ipcMain } from 'electron'
import type { DB } from '../db/client'
import { listAll } from '../repositories/taxonomy'

export function registerTaxonomyIpc(db: DB): void {
  ipcMain.handle('taxonomy:list', () => listAll(db))
}
```

- [ ] **Step 2: Wire seeding + IPC into `src/main/index.ts`** (in the `whenReady` chain, after `runMigrations`, before `createWindow`)

Add imports:
```ts
import { seedTaxonomy } from './db/seed-taxonomy'
import { registerTaxonomyIpc } from './ipc/taxonomy'
```
In the `whenReady().then(async () => { ... })` body, after `await runMigrations(...)`:
```ts
  await seedTaxonomy(db)
  registerProfileIpc(db)
  registerTaxonomyIpc(db)
```
(Keep the existing `registerProfileIpc(db)` — add `registerTaxonomyIpc(db)` next to it; seeding is idempotent so it's safe on every startup.)

- [ ] **Step 3: Add `taxonomy.list` to `src/preload/index.ts`**

```ts
const api = {
  profile: {
    get: () => ipcRenderer.invoke('profile:get'),
    setName: (name: string) => ipcRenderer.invoke('profile:setName', name)
  },
  taxonomy: {
    list: () => ipcRenderer.invoke('taxonomy:list')
  }
}
```

- [ ] **Step 4: Extend `src/renderer/src/env.d.ts`** with the taxonomy types

```ts
interface TaxonomyNodeDto {
  id: string
  kind: 'section' | 'foundational_concept' | 'content_category' | 'skill' | 'topic'
  code: string
  title: string
  parentId: string | null
}
```
and add to `Window['freecat']`:
```ts
      taxonomy: {
        list: () => Promise<TaxonomyNodeDto[]>
      }
```

- [ ] **Step 5: Verify boot + tsc + tests**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green. Optional dev smoke (background, ~10s, no errors, kill).

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/main/ipc/taxonomy.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat(taxonomy): seed on startup + taxonomy:list IPC"
```

---

## Task 4: Content Zod schemas (TDD)

**Files:** `src/main/content/schemas.ts`, `test/content-schemas.test.ts`

- [ ] **Step 1: Write the failing test `test/content-schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { questionSchema } from '../src/main/content/schemas'

const valid = {
  id: 'cp-0042',
  section: 'chem-phys',
  contentCategory: '4A',
  topics: ['doppler-effect'],
  difficulty: 'medium',
  stem: 'A physician measures blood flow...',
  choices: [
    { id: 'A', text: '0.32 m/s' },
    { id: 'B', text: '0.65 m/s' },
    { id: 'C', text: '1.30 m/s' },
    { id: 'D', text: '2.60 m/s' }
  ],
  correct: 'B',
  explanation: 'From the Doppler formula...'
}

describe('questionSchema', () => {
  it('accepts a valid question', () => {
    expect(questionSchema.parse(valid).id).toBe('cp-0042')
  })
  it('requires exactly 4 choices', () => {
    expect(() => questionSchema.parse({ ...valid, choices: valid.choices.slice(0, 3) })).toThrow()
  })
  it('rejects a correct answer not among the choice ids', () => {
    expect(() => questionSchema.parse({ ...valid, correct: 'E' })).toThrow()
  })
  it('rejects an unknown section', () => {
    expect(() => questionSchema.parse({ ...valid, section: 'biochem' })).toThrow()
  })
})
```

- [ ] **Step 2: Run it; expected FAIL** (`questionSchema` not found): `npx vitest run test/content-schemas.test.ts`

- [ ] **Step 3: Write `src/main/content/schemas.ts`**

```ts
import { z } from 'zod'

export const sectionEnum = z.enum(['chem-phys', 'cars', 'bio-biochem', 'psych-soc'])
export const difficultyEnum = z.enum(['easy', 'medium', 'hard'])

const choiceId = z.enum(['A', 'B', 'C', 'D'])

export const questionSchema = z
  .object({
    id: z.string().min(1),
    section: sectionEnum,
    contentCategory: z.string().optional(),
    skill: z.string().optional(),
    topics: z.array(z.string()).default([]),
    difficulty: difficultyEnum,
    passageId: z.string().optional(),
    stem: z.string().min(1),
    choices: z.array(z.object({ id: choiceId, text: z.string().min(1) })).length(4),
    correct: choiceId,
    explanation: z.string().min(1)
  })
  .refine((q) => q.choices.some((c) => c.id === q.correct), {
    message: 'correct must match one of the choice ids'
  })
  .refine((q) => new Set(q.choices.map((c) => c.id)).size === 4, {
    message: 'choice ids must be unique (A–D)'
  })

export type Question = z.infer<typeof questionSchema>

// Lesson base schema — Content Review module may extend via charter PR.
export const lessonSchema = z.object({
  id: z.string().min(1),
  section: sectionEnum,
  contentCategory: z.string().optional(),
  skill: z.string().optional(),
  topics: z.array(z.string()).default([]),
  title: z.string().min(1),
  body: z.string().min(1)
})

export type Lesson = z.infer<typeof lessonSchema>
```

- [ ] **Step 4: Run it; expected PASS (4 tests).** Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/main/content/schemas.ts test/content-schemas.test.ts
git commit -m "feat(content): question + lesson Zod schemas (TDD)"
```

---

## Task 5: Content loader (TDD)

**Files:** `src/main/content/loader.ts`, `test/content-loader.test.ts`, plus a test fixture folder

- [ ] **Step 1: Create a test fixture** at `test/fixtures/content/questions/sample/question.yaml` (valid) and a `figure-1.png` (any small file, e.g. `printf '' > figure-1.png` is fine — the loader only checks existence). The yaml mirrors the valid object from Task 4, with `stem` referencing `![x](figure-1.png)`.

- [ ] **Step 2: Write the failing test `test/content-loader.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { loadQuestion } from '../src/main/content/loader'

const dir = resolve(__dirname, 'fixtures/content/questions/sample')

describe('content loader', () => {
  it('loads + validates a question folder, returning the parsed question', async () => {
    const q = await loadQuestion(dir)
    expect(q.id).toBe('cp-sample')
    expect(q.choices).toHaveLength(4)
  })

  it('throws if a referenced image is missing', async () => {
    // point at a fixture whose yaml references a nonexistent image
    await expect(
      loadQuestion(resolve(__dirname, 'fixtures/content/questions/missing-image'))
    ).rejects.toThrow(/image/i)
  })
})
```
(Create the second fixture `missing-image/question.yaml` referencing `nope.png` with no such file.)

- [ ] **Step 3: Run it; expected FAIL** (`loadQuestion` not found).

- [ ] **Step 4: Write `src/main/content/loader.ts`**

```ts
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { questionSchema, type Question } from './schemas'

// Markdown image refs: ![alt](path)
const IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g

function referencedImages(...markdownFields: string[]): string[] {
  const out: string[] = []
  for (const field of markdownFields) {
    for (const m of field.matchAll(IMAGE_RE)) out.push(m[1]!)
  }
  return out
}

export async function loadQuestion(dir: string): Promise<Question> {
  const raw = readFileSync(join(dir, 'question.yaml'), 'utf8')
  const parsed = yaml.load(raw)
  const question = questionSchema.parse(parsed)

  const images = referencedImages(question.stem, question.explanation, ...question.choices.map((c) => c.text))
  for (const rel of images) {
    if (rel.startsWith('http')) continue
    if (!existsSync(join(dir, rel))) {
      throw new Error(`Missing referenced image "${rel}" in ${dir}`)
    }
  }
  return question
}
```
(`readFileSync` is fine — this runs in the main process / CLI, not the renderer.)

- [ ] **Step 5: Run it; expected PASS (2 tests).** Then `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/main/content/loader.ts test/content-loader.test.ts test/fixtures
git commit -m "feat(content): question loader with image-reference checking (TDD)"
```

---

## Task 6: Example question content

**Files:** `content/questions/chem-phys/0042-doppler/question.yaml`, `content/questions/chem-phys/0042-doppler/figure-1.png`

- [ ] **Step 1: Create the example question** `content/questions/chem-phys/0042-doppler/question.yaml`:

```yaml
id: cp-0042
section: chem-phys
contentCategory: "4A"
topics: [doppler-effect, fluids]
difficulty: medium
stem: |
  A physician uses Doppler ultrasound to measure blood-flow velocity.

  ![Probe geometry](figure-1.png)

  If the observed frequency shift is 4.2 kHz, what is the flow velocity?
choices:
  - { id: A, text: "0.32 m/s" }
  - { id: B, text: "0.65 m/s" }
  - { id: C, text: "1.30 m/s" }
  - { id: D, text: "2.60 m/s" }
correct: B
explanation: |
  Using $\Delta f = \dfrac{2 f_0 v \cos\theta}{c}$, solve for $v$. (Worked solution.)
```

- [ ] **Step 2: Add the referenced image** — create a real small placeholder PNG at `content/questions/chem-phys/0042-doppler/figure-1.png` (a 1×1 PNG is fine for now; it just must exist).

- [ ] **Step 3: Commit**

```bash
git add content/questions
git commit -m "content: add example Doppler question (template + validation fixture)"
```

---

## Task 7: `content:validate` CLI (TDD)

**Files:** `src/main/content/validate-cli.ts`, `package.json`, `test/content-loader.test.ts` (extend)

- [ ] **Step 1: Add a `validateAll` function to `src/main/content/loader.ts`** and a test for it (TDD). It walks `content/questions/**/question.yaml`, loads+validates each, checks unique ids, and (given the set of valid taxonomy codes) checks each `contentCategory`/`skill` resolves. Returns `{ ok: boolean, errors: string[], count: number }`.

Test (append to `test/content-loader.test.ts`): point `validateAll` at the `content/` root with the known set of taxonomy codes (import `taxonomySeed`, build the code set) and assert `ok === true, count >= 1`; then assert an injected bad code/dup id produces `ok === false` with a descriptive error (use a temp fixture dir).

Implementation sketch:
```ts
import { readdirSync, statSync } from 'fs'
// ...
export async function validateAll(root: string, validCodes: Set<string>): Promise<{ ok: boolean; errors: string[]; count: number }> {
  const errors: string[] = []
  const ids = new Set<string>()
  const dirs = findQuestionDirs(root) // recurse for folders containing question.yaml
  for (const dir of dirs) {
    try {
      const q = await loadQuestion(dir)
      if (ids.has(q.id)) errors.push(`Duplicate id "${q.id}" (${dir})`)
      ids.add(q.id)
      const code = q.contentCategory ?? q.skill
      if (code && !validCodes.has(code)) errors.push(`Unknown taxonomy code "${code}" in ${q.id}`)
    } catch (e) {
      errors.push(`${dir}: ${(e as Error).message}`)
    }
  }
  return { ok: errors.length === 0, errors, count: dirs.length }
}
```
(Write `findQuestionDirs` as a small recursive helper. Run the RED test first, then implement to GREEN.)

- [ ] **Step 2: Write the CLI `src/main/content/validate-cli.ts`**

```ts
import { resolve } from 'path'
import { validateAll } from './loader'
import { taxonomySeed } from '../db/taxonomy-seed-data'

async function main(): Promise<void> {
  const root = resolve(process.cwd(), 'content')
  const codes = new Set(taxonomySeed.map((n) => n.code))
  const { ok, errors, count } = await validateAll(root, codes)
  if (!ok) {
    console.error(`Content validation FAILED (${errors.length} error(s) across ${count} item(s)):`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  console.log(`Content OK: ${count} item(s) validated.`)
}

main()
```

- [ ] **Step 3: Add the npm script** to `package.json`: `"content:validate": "tsx src/main/content/validate-cli.ts"` — and add `tsx` as a devDependency (`npm install -D tsx`) so the TS CLI runs without a separate build.

- [ ] **Step 4: Run it against the real content** — `npm run content:validate`. Expected: `Content OK: 1 item(s) validated.` (the Doppler example). Then run the full test suite + tsc.

- [ ] **Step 5: Commit**

```bash
git add src/main/content/loader.ts src/main/content/validate-cli.ts test/content-loader.test.ts package.json package-lock.json
git commit -m "feat(content): content:validate CLI (taxonomy codes, images, unique ids) (TDD)"
```

---

## Task 8: CI workflow

**Files:** `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run content:validate
      - run: npx tsc --noEmit
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Validate the YAML locally** (e.g. `npx js-yaml .github/workflows/ci.yml` parses without error) and confirm each referenced script exists in `package.json`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: validate content + typecheck + test + build on PR"
```

---

## Definition of Done (Plan 2)

- `taxonomy_node` table seeded from the AAMC outline on startup; `taxonomy:list` IPC works; `getByCode('4A')` resolves.
- `questionSchema`/`lessonSchema` exist and are tested; the loader parses+validates a folder and rejects missing images.
- `npm run content:validate` passes on the example Doppler question and fails on bad codes/dupes/missing images.
- CI workflow runs content:validate + tsc + test + build.
- `npm test` green (prior 7 + taxonomy 5 + schemas 4 + loader tests); `tsc --noEmit` clean; `npm run build` clean.

## Self-review notes

- **Spec coverage:** charter §5.1 (taxonomy: structure, seed, query) → Tasks 1–3; §5.5 (content pipeline: format, Zod, loader, validate CLI, CI) → Tasks 4–8. Prod bundling of `content/` (extraResources) is deferred to Plan 4 (packaging) — the loader reads from `content/` at repo root via `process.cwd()`/relative paths, which works for dev + CI; the packaged-app content path is wired in Plan 4.
- **Convention adherence:** repositories are electron-free, `DB`-param, and use guard-and-throw; `noUncheckedIndexedAccess` is on (note the `m[1]!`/`rel` handling in the loader).
- **Placeholders:** the only "fill-in" is the AAMC seed *data* in Task 2 — that's authoritative reference data (the implementer encodes the published AAMC outline; the test enforces section coverage + parent integrity), not a logic placeholder.
- **No renderer content rendering** here — modules own that. Plan 2 stops at: taxonomy queryable + content validated/loadable.
