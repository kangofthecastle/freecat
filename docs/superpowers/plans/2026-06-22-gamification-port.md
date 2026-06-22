# Gamification Port (Foundation C6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Code-writing subagents MUST run Opus 4.8 at max effort** (Warren's standing constraint).

**Goal:** Port sat-world's pet/coin/egg gamification into FreeCAT as the module-agnostic Foundation loop — a `recordActivity()` entry point that drives XP, a daily-coin economy, egg incubation → a collectible pet, streak, and a daily goal — surfaced on a Home dashboard and a Nest (collection/incubator/shop) screen.

**Architecture:** Pure reward logic + shared DTO/types live in `src/shared/` (one copy consumed by main, preload, and renderer). DB-touching services live in `src/main/repositories/*` (electron-free, `DB`-param, `.returning()`, guard-and-throw). The renderer reaches them only through `window.freecat.gamification.*` (Zod-validated IPC, structured `ServiceResult` envelopes per charter §5.3). Sprites are vendored into the renderer and resolved via `import.meta.glob` (hashed, base-correct URLs that survive Electron packaging — replacing sat-world's `public/` + absolute-path approach).

**Tech Stack:** Electron + electron-vite, React 19, Drizzle ORM + `@libsql/client` (SQLite), Zod, Tailwind v4, Vitest.

**Source of truth for the port:** sat-world repo, branch `dev` @ `c99b1da` (Warren confirmed "latest dev"). **Two deliberate exclusions** (Warren: "I don't want the slime species, that must be a regression"): (1) the `slime` species and its sprites; (2) the orphan `content.png` files (`cat/`, `slime/`) that nothing references. Everything else (six chibi animals: cat, dog, pig, frog, capybara, axolotl; the `happy/sleeping/sad/angry` mood ladder + `eating` action; day-based decay + 12h treat boost; coin economy; 4 accessories; `coin.svg`) ports as-is.

---

## Design decisions to confirm at plan review (NOT straight ports — Warren's call)

1. **XP and coins coexist.** Charter §5.4 makes **XP** a first-class output; scope A is the **coin economy**. So each activity earns *both*: **XP** (lifetime progression / level, never spent) and **coins** (spendable on the egg/treat/accessory shop). Dashboard shows both.
2. **Daily goal replaces "daily-clear."** sat-world's bonus fired when the SAT vocab queue emptied — not generalizable. FreeCAT awards a once-per-day bonus when you hit **N activities today** (`dailyGoal`, default 20). This is the charter's "daily goal."
3. **First-run starter egg.** A brand-new profile has 0 coins, so it could never reach the first pet (egg costs 100 coins; hatch needs 150 incubation points). On first gamification load we grant **one free incubating egg** so studying visibly progresses toward a first hatch. (Flag if you'd rather grant a starter *pet*, or nothing.)
4. **Single local profile.** sat-world keys every row on `userId`. FreeCAT has one profile, so the port **drops the user dimension** entirely (singleton `gamification_state`; `pets/eggs/owned_items` have no owner column; "one active pet" / "one un-hatched egg" become global invariants).

---

## Build order (resolves cross-task dependencies)

Tasks are dispatched in numbered order; two clarifications override the per-task headers where they differ (the schema and repositories would otherwise forward-reference modules created later):

- **`src/shared/gamification/types.ts` is created at the start of Task 1** — the schema imports `CoinReason`/`Rarity` from it (and `drizzle-kit generate` must be able to resolve that import). Task 2's "types.ts" step then becomes a *verify*, not a re-create.
- **The shared contract — `src/shared/dto.ts`, `src/shared/channels.ts`, `src/shared/api.ts` — is created in Task 2**, alongside the pure logic, because the repositories (Tasks 3–5) and IPC (Task 7) import its DTOs + `ServiceResult`. **Task 6 therefore only refactors the existing `profile` IPC onto this already-built shared module** (it does not *create* dto/channels/api), and the "dto.ts stub" note in Task 3 is moot — dto.ts already exists.

---

## File structure

**New — `src/shared/` (pure, imported by main + preload + renderer):**
- `src/shared/gamification/types.ts` — `MoodLevel`, `Rarity`, `AccessorySlot`, `CoinReason`, `MoodState`, `Anchor`, `Species`, `Item`, `Rng`.
- `src/shared/gamification/config.ts` — `REWARDS_CONFIG`, `RARITY_WEIGHTS`.
- `src/shared/gamification/economy.ts` — `coinsForActivity`, `canAfford`.
- `src/shared/gamification/catalog.ts` — `SPECIES` (6, no slime), `ITEMS` (4).
- `src/shared/gamification/hatch.ts` — `rollSpecies`.
- `src/shared/gamification/incubation.ts` — `advanceIncubation`, `isReady`, `incubationProgress`.
- `src/shared/gamification/wellbeing.ts` — `moodFromState`.
- `src/shared/gamification/dates.ts` — `dayKeyInTz`, `prevDayKey`, `nextDayKey`.
- `src/shared/gamification/streak.ts` — `streakDays`.
- `src/shared/gamification/level.ts` — `levelForXp` (new).
- `src/shared/gamification/pet-art.ts` — `resolveSprite` (returns species/state/frames/duration, **no URL**), `resolveAccessories`, `mouthAnchor`.
- `src/shared/gamification/pet-frames.ts` — frame manifest (6 species, no slime).
- `src/shared/dto.ts` — `ServiceResult`, `ServiceErrorCode`, `ok`/`err`, `PetView`, `EggView`, `GamificationState` (the dashboard+nest DTO), `ActivityResult`, `ProfileDto` (moved here), `RecordActivityInput`.
- `src/shared/channels.ts` — channel-name constants for `profile` + `gamification`.
- `src/shared/api.ts` — the `FreecatApi` (`window.freecat`) contract, imported by preload + renderer.

**New — main:**
- `src/main/db/schema/profile.ts`, `src/main/db/schema/gamification.ts`, `src/main/db/schema/index.ts` (schema split by ownership).
- `src/main/repositories/gamification-state.ts` — singleton coins/xp + ledger (`getState`, `credit`, `spend`).
- `src/main/repositories/activity.ts` — `recordActivity`, `getStreak`, `getDailyProgress`, `ensureStarterGrant`.
- `src/main/repositories/pets.ts` — `buyEgg`, `buyTreat`, `buyItem`, `hatchEgg`, `setActivePet`, `equipItem`, `unequipItem`, `renamePet`, `getGamificationState` (the aggregate read).
- `src/main/ipc/gamification.ts` — `registerGamificationIpc(db)`.
- `src/main/gamification/errors.ts` — `isUniqueViolation` (SQLite-aware) [only if needed; see Task 5].

**New — renderer:**
- `src/renderer/src/assets/pets/<species>/<state>.png` (30), `assets/pets/items/{cap,glasses,scarf,bow}.png`, `assets/coin.svg`, `assets/pets/CREDITS.md`.
- `src/renderer/src/gamification/sprite-urls.ts` — `import.meta.glob` URL maps + `spriteUrl(species,state)`, `itemUrl(key)`, `coinUrl`.
- `src/renderer/src/components/Pet.tsx`, `src/renderer/src/components/Coin.tsx`.
- `src/renderer/src/pages/Nest.tsx`; rewrite `src/renderer/src/pages/Home.tsx` (dashboard).

**Modified:**
- `drizzle.config.ts` (schema path → dir glob), `src/main/db/client.ts` (no change if `./schema` resolves to `./schema/index.ts`; verify), `src/main/index.ts` (register gamification IPC + starter grant), `src/main/ipc/profile.ts` + `src/preload/index.ts` + `src/renderer/src/env.d.ts` (refactor onto `src/shared/`), `src/renderer/src/styles.css` (pet animation keyframes), `src/renderer/src/App.tsx` (Nest route).

---

## Task 1: Schema split + gamification tables + migration

**Files:**
- Create: `src/main/db/schema/profile.ts`, `src/main/db/schema/gamification.ts`, `src/main/db/schema/index.ts`
- Delete: `src/main/db/schema.ts`
- Modify: `drizzle.config.ts`
- Test: `test/schema.test.ts`
- Generate: `drizzle/0001_*.sql`

- [ ] **Step 1: Move the profile table into the schema dir.** Create `src/main/db/schema/profile.ts` with the exact current contents of `src/main/db/schema.ts` (the `profile` table + `Profile` type), then delete `src/main/db/schema.ts`.

- [ ] **Step 2: Add the gamification tables.** Create `src/main/db/schema/gamification.ts`:

```ts
import { sqliteTable, integer, text, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import type { CoinReason, Rarity } from '../../../shared/gamification/types'

// Singleton (id is always 1): the spendable coin balance + lifetime XP.
export const gamificationState = sqliteTable('gamification_state', {
  id: integer('id').primaryKey(),               // always 1
  coins: integer('coins').notNull().default(0),
  xp: integer('xp').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => [
  check('gamification_state_singleton', sql`${t.id} = 1`),
  check('gamification_state_coins_nonneg', sql`${t.coins} >= 0`)
])

export const coinLedger = sqliteTable('coin_ledger', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  amount: integer('amount').notNull(),          // + earn, - spend
  reason: text('reason').$type<CoinReason>().notNull(),
  kind: text('kind'),                           // activity source tag (e.g. 'qbank.answer'); null for non-activity rows
  taxonomyRef: text('taxonomy_ref'),            // optional future per-topic analytics hook
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => [index('coin_ledger_reason_created_idx').on(t.reason, t.createdAt)])

export const pets = sqliteTable('pets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  species: text('species').notNull(),
  name: text('name'),
  rarity: text('rarity').$type<Rarity>().notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  baseHappiness: integer('base_happiness').notNull().default(100),
  lastInteractionAt: integer('last_interaction_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastTreatAt: integer('last_treat_at', { mode: 'timestamp' }),
  equipped: text('equipped', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  hatchedAt: integer('hatched_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => [
  // at most one active companion (single profile → global invariant)
  uniqueIndex('pets_one_active_idx').on(t.isActive).where(sql`${t.isActive} = 1`)
])

export const eggs = sqliteTable('eggs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  incubationPoints: integer('incubation_points').notNull().default(0),
  status: text('status').$type<'incubating' | 'ready' | 'hatched'>().notNull().default('incubating'),
  hatchedPetId: integer('hatched_pet_id').references(() => pets.id, { onDelete: 'set null' }),
  acquiredAt: integer('acquired_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  hatchedAt: integer('hatched_at', { mode: 'timestamp' })
}, (t) => [index('eggs_status_idx').on(t.status)])

export const ownedItems = sqliteTable('owned_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemKey: text('item_key').notNull(),
  acquiredAt: integer('acquired_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => [uniqueIndex('owned_items_item_idx').on(t.itemKey)])

// Per-tz-day activity counter → drives streak + daily goal.
export const dailyActivity = sqliteTable('daily_activity', {
  dayKey: text('day_key').primaryKey(),         // 'YYYY-MM-DD' in APP_TZ
  count: integer('count').notNull().default(0),
  goalAwardedAt: integer('goal_awarded_at', { mode: 'timestamp' }) // set once the daily-goal bonus is granted
})

export type PetRow = typeof pets.$inferSelect
export type EggRow = typeof eggs.$inferSelect
```

> Note: "one un-hatched egg" is enforced by an in-transaction existence check in Task 5 (single-profile + serialized local writes make a partial-unique race guard unnecessary, and "exactly one non-hatched row total" is awkward to express as a partial unique index).

- [ ] **Step 3: Re-export from an index.** Create `src/main/db/schema/index.ts`:

```ts
export * from './profile'
export * from './gamification'
```

- [ ] **Step 4: Point drizzle-kit at the dir.** In `drizzle.config.ts` change `schema: './src/main/db/schema.ts'` → `schema: './src/main/db/schema/*.ts'`. (`src/main/db/client.ts`'s `import * as schema from './schema'` now resolves to `./schema/index.ts` — leave it.)

- [ ] **Step 5: Write a migration smoke test.** Create `test/schema.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, type DB } from '../src/main/db/client'
import { runMigrations } from '../src/main/db/migrate'

let db: DB
beforeEach(async () => {
  db = createDb(':memory:')
  await runMigrations(db, 'drizzle')
})

describe('gamification schema', () => {
  it('creates all gamification tables', async () => {
    const rows = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type='table' order by name`
    )
    const names = rows.map((r) => r.name)
    for (const t of ['profile', 'gamification_state', 'coin_ledger', 'pets', 'eggs', 'owned_items', 'daily_activity']) {
      expect(names).toContain(t)
    }
  })
})
```

- [ ] **Step 6: Generate the migration.** Run: `npm run db:generate`. Expected: a new `drizzle/0001_*.sql` adding the six gamification tables (profile unchanged). Inspect it for the six `CREATE TABLE`s + the two unique indexes.

- [ ] **Step 7: Run tests.** Run: `npm test`. Expected: the existing 7 + the new schema test PASS (`db.all` is the libsql raw-query helper; if the type param errors, use `db.all(sql\`...\`)` untyped and cast).

- [ ] **Step 8: Commit.**

```bash
git add -A && git commit -m "feat(gamification): schema split + gamification tables + migration"
```

---

## Task 2: Port the pure reward logic + helpers (TDD)

All files are pure (no DB/Electron). **Port the matching `*.test.ts` first**, run it red, then port the implementation. Source paths are sat-world `dev` @ `c99b1da`.

**Files (create under `src/shared/gamification/` unless noted):** `types.ts`, `config.ts`, `economy.ts`, `catalog.ts`, `hatch.ts`, `incubation.ts`, `wellbeing.ts`, `dates.ts`, `streak.ts`, `level.ts`
**Tests (create under `test/gamification/`):** `economy.test.ts`, `catalog.test.ts`, `hatch.test.ts`, `incubation.test.ts`, `wellbeing.test.ts`, `dates.test.ts`, `streak.test.ts`, `level.test.ts`

- [ ] **Step 1: `types.ts`** — copy `sat-world/src/lib/rewards/types.ts`, with **two changes**: (1) `MoodLevel` is already `'happy' | 'sleeping' | 'sad' | 'angry'` — keep it; (2) **change `CoinReason`** from sat-world's `'review' | 'daily_clear' | …` to FreeCAT's values (this is the single source of `CoinReason`, imported by `schema/gamification.ts` and `shared/dto.ts`):

```ts
export type CoinReason = 'activity' | 'daily_goal' | 'spend_egg' | 'spend_treat' | 'spend_item'
```

Then **append** a local RNG type to replace sat-world's `@/lib/srs/types` import used by `hatch.ts`:

```ts
/** A deterministic-friendly random source in [0,1); defaults to Math.random at call sites. */
export type Rng = () => number
```

- [ ] **Step 2: `config.ts`** — copy `sat-world/src/lib/rewards/config.ts` verbatim, then **add** the activity/goal/XP constants:

```ts
// FreeCAT additions (module-agnostic activity loop):
//   coinsPerActivity — coins earned per activity event (alias of coinsPerReview)
//   xpPerActivity    — XP earned per activity event (XP is progression, never spent)
//   dailyGoal        — activities/day that earns the once-daily bonus
//   dailyGoalBonus   — coin bonus for hitting the daily goal (replaces sat-world's dailyClearBonus)
```
Add these keys inside `REWARDS_CONFIG`: `coinsPerActivity: 1, xpPerActivity: 10, dailyGoal: 20, dailyGoalBonus: 10,`. Keep all existing keys (`eggPrice`, `treatPrice`, `incubationThreshold`, `treatBoost`, `treatBoostDurationMs`, `happinessMax/Floor/Start`, `decayPerDay`, `moodHappyAt/SleepingAt/SadAt`).

- [ ] **Step 3: `economy.ts`** — port `sat-world/src/lib/rewards/economy.ts`, renaming `coinsForReview` → `coinsForActivity` (return `cfg.coinsPerActivity`). Keep `canAfford`. Test (`economy.test.ts`): port sat-world's `economy.test.ts`, updating the name.

- [ ] **Step 4: `catalog.ts`** — copy `sat-world/src/lib/rewards/catalog.ts` **minus the slime entry** (delete the first `SPECIES` element `{ key: 'slime', ... }`). Result: 6 species (cat=common, dog=uncommon, pig=uncommon, frog=rare, capybara=rare, axolotl=rare), 4 ITEMS unchanged. Test (`catalog.test.ts`): port sat-world's `catalog.test.ts`; **add** an explicit guard: `expect(SPECIES.map(s => s.key)).not.toContain('slime')` and `expect(SPECIES).toHaveLength(6)`.

- [ ] **Step 5: `hatch.ts`** — copy `sat-world/src/lib/rewards/hatch.ts`, changing the import `import type { Rng } from '@/lib/srs/types'` → `import type { Rng } from './types'`. Test (`hatch.test.ts`): port sat-world's `hatch.test.ts` (its `Rng` import similarly points at `./types`).

- [ ] **Step 6: `incubation.ts`** — copy `sat-world/src/lib/rewards/incubation.ts` verbatim. Test: port `incubation.test.ts`.

- [ ] **Step 7: `wellbeing.ts`** — copy `sat-world/src/lib/rewards/wellbeing.ts`, changing its import of `dayKeyInTz` from `@/lib/dates` → `./dates`. Test (`wellbeing.test.ts`): port sat-world `dev`'s `wellbeing.test.ts` **verbatim** (it already asserts the 4-rung ladder + treat boost; it imports only `./wellbeing`).

- [ ] **Step 8: `dates.ts`** — create with just the three helpers FreeCAT needs (copied from `sat-world/src/lib/dates.ts`): `dayKeyInTz`, `prevDayKey`, `nextDayKey`. Test (`dates.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { dayKeyInTz, prevDayKey, nextDayKey } from '../../src/shared/gamification/dates'

describe('date helpers', () => {
  it('formats a tz day key as YYYY-MM-DD', () => {
    // 2026-06-08T03:00:00Z = 2026-06-07 20:00 PDT
    expect(dayKeyInTz(new Date('2026-06-08T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-06-07')
    expect(dayKeyInTz(new Date('2026-06-08T03:00:00Z'), 'UTC')).toBe('2026-06-08')
  })
  it('steps days', () => {
    expect(prevDayKey('2026-06-01')).toBe('2026-05-31')
    expect(nextDayKey('2026-06-30')).toBe('2026-07-01')
  })
})
```

- [ ] **Step 9: `streak.ts`** — copy `streakDays` from `sat-world/src/lib/stats.ts`, changing its import to `import { dayKeyInTz, prevDayKey } from './dates'`. Test (`streak.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { streakDays } from '../../src/shared/gamification/streak'

const TZ = 'UTC'
const NOW = new Date('2026-06-22T12:00:00Z')

describe('streakDays', () => {
  it('counts consecutive active days ending today', () => {
    const keys = new Set(['2026-06-22', '2026-06-21', '2026-06-20'])
    expect(streakDays(keys, NOW, TZ)).toBe(3)
  })
  it('today-with-zero does not break a live streak', () => {
    const keys = new Set(['2026-06-21', '2026-06-20'])
    expect(streakDays(keys, NOW, TZ)).toBe(2)
  })
  it('a gap ends the streak', () => {
    const keys = new Set(['2026-06-22', '2026-06-20'])
    expect(streakDays(keys, NOW, TZ)).toBe(1)
  })
  it('no activity → 0', () => {
    expect(streakDays(new Set(), NOW, TZ)).toBe(0)
  })
})
```

- [ ] **Step 10: `level.ts`** (new) — a simple XP→level curve:

```ts
/** Level from lifetime XP: level N needs 100·N·(N-1)/2 XP cumulatively (100, 300, 600, …). */
export function levelForXp(xp: number): { level: number; into: number; toNext: number } {
  let level = 1
  let floor = 0
  while (xp >= floor + level * 100) { floor += level * 100; level++ }
  const span = level * 100
  return { level, into: xp - floor, toNext: span - (xp - floor) }
}
```
Test (`level.test.ts`): `levelForXp(0)` → level 1, into 0, toNext 100; `levelForXp(100)` → level 2, into 0, toNext 200; `levelForXp(99)` → level 1, into 99, toNext 1; `levelForXp(300)` → level 3.

- [ ] **Step 11: Run all tests.** Run: `npm test`. Expected: every ported pure-logic test PASSES.

- [ ] **Step 12: Commit.**

```bash
git add -A && git commit -m "feat(gamification): port pure reward logic, mood, hatch, streak, level (TDD)"
```

---

## Task 3: Gamification state repository — coins + XP + ledger (TDD)

**Files:** Create `src/main/repositories/gamification-state.ts`; Test `test/gamification/state.repo.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb, type DB } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { getState, credit, spend } from '../../src/main/repositories/gamification-state'

let db: DB
beforeEach(async () => { db = createDb(':memory:'); await runMigrations(db, 'drizzle') })

describe('gamification-state repository', () => {
  it('lazily reports 0 coins / 0 xp before any credit', async () => {
    const s = await getState(db)
    expect(s.coins).toBe(0); expect(s.xp).toBe(0)
  })
  it('credit adds coins + xp and writes a ledger row', async () => {
    const s = await credit(db, { coins: 5, xp: 50, reason: 'activity', kind: 'test', now: new Date() })
    expect(s.coins).toBe(5); expect(s.xp).toBe(50)
    expect((await getState(db)).coins).toBe(5)
  })
  it('spend debits coins (with a negative ledger row) and refuses overdraft', async () => {
    await credit(db, { coins: 30, xp: 0, reason: 'activity', kind: null, now: new Date() })
    const ok = await spend(db, { amount: 20, reason: 'spend_egg', now: new Date() })
    expect(ok.ok).toBe(true)
    expect((await getState(db)).coins).toBe(10)
    const bad = await spend(db, { amount: 999, reason: 'spend_egg', now: new Date() })
    expect(bad).toEqual({ ok: false, error: 'insufficient-coins' })
  })
})
```

Run: `npx vitest run test/gamification/state.repo.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 2: Implement `src/main/repositories/gamification-state.ts`.** Singleton row (id=1), upsert via `onConflictDoUpdate`, ledger on every coin movement. `getState` returns `{ coins, xp }` (0/0 if the row doesn't exist yet). `credit` is also reused inside transactions, so accept an optional `tx`:

```ts
import { sql, eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { gamificationState, coinLedger } from '../db/schema'
import { canAfford } from '../../shared/gamification/economy'
import type { CoinReason, ServiceResult } from '../../shared/dto'
import { ok, err } from '../../shared/dto'

type Exec = DB | Parameters<Parameters<DB['transaction']>[0]>[0]

export async function getState(db: Exec): Promise<{ coins: number; xp: number }> {
  const [row] = await db.select({ coins: gamificationState.coins, xp: gamificationState.xp })
    .from(gamificationState).where(eq(gamificationState.id, 1))
  return { coins: row?.coins ?? 0, xp: row?.xp ?? 0 }
}

export async function credit(
  db: Exec,
  p: { coins: number; xp: number; reason: CoinReason; kind: string | null; taxonomyRef?: string | null; now: Date }
): Promise<{ coins: number; xp: number }> {
  await db.insert(gamificationState)
    .values({ id: 1, coins: p.coins, xp: p.xp, updatedAt: p.now })
    .onConflictDoUpdate({
      target: gamificationState.id,
      set: { coins: sql`${gamificationState.coins} + ${p.coins}`, xp: sql`${gamificationState.xp} + ${p.xp}`, updatedAt: p.now }
    })
  if (p.coins !== 0) {
    await db.insert(coinLedger).values({ amount: p.coins, reason: p.reason, kind: p.kind, taxonomyRef: p.taxonomyRef ?? null, createdAt: p.now })
  }
  return getState(db)
}

export async function spend(
  db: Exec,
  p: { amount: number; reason: CoinReason; now: Date }
): Promise<ServiceResult<number>> {
  const { coins } = await getState(db)
  if (!canAfford(coins, p.amount)) return err('insufficient-coins')
  await db.update(gamificationState).set({ coins: coins - p.amount, updatedAt: p.now }).where(eq(gamificationState.id, 1))
  await db.insert(coinLedger).values({ amount: -p.amount, reason: p.reason, kind: null, taxonomyRef: null, createdAt: p.now })
  return ok(coins - p.amount)
}
```

> `ServiceResult`/`ok`/`err`/`CoinReason` are defined in Task 6's `src/shared/dto.ts`. If executing strictly in order, create a minimal `src/shared/dto.ts` stub with just those four exports now and flesh it out in Task 6. (The implementer should create the stub as part of this task to keep the build green.)

- [ ] **Step 3: Run the test.** Run: `npx vitest run test/gamification/state.repo.test.ts`. Expected: PASS.

- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(gamification): coins+xp state repository with ledger (TDD)"`

---

## Task 4: `recordActivity` + streak + daily goal (TDD)

This is the **module-agnostic entry point** (charter §5.4). It generalizes sat-world's `applyStudyRewards` away from the study queue.

**Files:** Create `src/main/repositories/activity.ts`; Test `test/gamification/activity.repo.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb, type DB } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { recordActivity, getStreak, getDailyProgress } from '../../src/main/repositories/activity'
import { getState } from '../../src/main/repositories/gamification-state'
import { eggs, pets, dailyActivity } from '../../src/main/db/schema'
import { REWARDS_CONFIG } from '../../src/shared/gamification/config'

const TZ = 'UTC'
const NOW = new Date('2026-06-22T12:00:00Z')
let db: DB
beforeEach(async () => { db = createDb(':memory:'); await runMigrations(db, 'drizzle') })

describe('recordActivity', () => {
  it('credits coins + xp and logs the activity', async () => {
    const r = await recordActivity(db, { kind: 'qbank.answer', count: 1, now: NOW, tz: TZ })
    expect(r.ok).toBe(true)
    const s = await getState(db)
    expect(s.coins).toBe(REWARDS_CONFIG.coinsPerActivity)
    expect(s.xp).toBe(REWARDS_CONFIG.xpPerActivity)
  })

  it('advances an incubating egg and flips it to ready at threshold', async () => {
    await db.insert(eggs).values({ incubationPoints: REWARDS_CONFIG.incubationThreshold - 1, status: 'incubating' })
    await recordActivity(db, { kind: 'flashcard.review', count: 1, now: NOW, tz: TZ })
    const [egg] = await db.select().from(eggs)
    expect(egg.incubationPoints).toBe(REWARDS_CONFIG.incubationThreshold)
    expect(egg.status).toBe('ready')
  })

  it('refreshes the active pet (happiness reset, lastInteractionAt = now)', async () => {
    await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true, baseHappiness: 30, lastInteractionAt: new Date('2026-06-01T00:00:00Z') })
    await recordActivity(db, { kind: 'qbank.answer', count: 1, now: NOW, tz: TZ })
    const [pet] = await db.select().from(pets)
    expect(pet.baseHappiness).toBe(REWARDS_CONFIG.happinessStart)
    expect(pet.lastInteractionAt.getTime()).toBe(NOW.getTime())
  })

  it('awards the daily-goal bonus once when the goal is reached', async () => {
    await recordActivity(db, { kind: 'q', count: REWARDS_CONFIG.dailyGoal, now: NOW, tz: TZ })
    const afterGoal = await getState(db)
    // dailyGoal activities × coinsPerActivity + the one-time bonus
    expect(afterGoal.coins).toBe(REWARDS_CONFIG.dailyGoal * REWARDS_CONFIG.coinsPerActivity + REWARDS_CONFIG.dailyGoalBonus)
    const [row] = await db.select().from(dailyActivity).where(eq(dailyActivity.dayKey, '2026-06-22'))
    expect(row.goalAwardedAt).not.toBeNull()
    // a further activity the same day does NOT re-award the bonus
    const before = (await getState(db)).coins
    await recordActivity(db, { kind: 'q', count: 1, now: new Date(NOW.getTime() + 1000), tz: TZ })
    expect((await getState(db)).coins).toBe(before + REWARDS_CONFIG.coinsPerActivity)
  })

  it('tracks streak + daily progress', async () => {
    await recordActivity(db, { kind: 'q', count: 3, now: NOW, tz: TZ })
    expect(await getStreak(db, NOW, TZ)).toBe(1)
    const dp = await getDailyProgress(db, NOW, TZ)
    expect(dp).toEqual({ count: 3, goal: REWARDS_CONFIG.dailyGoal, met: false })
  })

  it('succeeds with no egg and no pet', async () => {
    const r = await recordActivity(db, { kind: 'q', count: 1, now: NOW, tz: TZ })
    expect(r.ok).toBe(true)
  })
})
```

Run: `npx vitest run test/gamification/activity.repo.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `src/main/repositories/activity.ts`.**

```ts
import { and, eq, sql, gt } from 'drizzle-orm'
import type { DB } from '../db/client'
import { eggs, pets, dailyActivity } from '../db/schema'
import { REWARDS_CONFIG } from '../../shared/gamification/config'
import { advanceIncubation, isReady } from '../../shared/gamification/incubation'
import { streakDays } from '../../shared/gamification/streak'
import { dayKeyInTz } from '../../shared/gamification/dates'
import { credit } from './gamification-state'
import type { ActivityResult, ServiceResult } from '../../shared/dto'
import { ok } from '../../shared/dto'

export async function recordActivity(
  db: DB,
  p: { kind: string; count?: number; taxonomyRef?: string; now?: Date; tz?: string }
): Promise<ServiceResult<ActivityResult>> {
  const count = Math.max(1, Math.floor(p.count ?? 1))
  const now = p.now ?? new Date()
  const tz = p.tz ?? appTz()
  const dayKey = dayKeyInTz(now, tz)

  return db.transaction(async (tx) => {
    // 1. coins + xp for the activity
    await credit(tx, {
      coins: count * REWARDS_CONFIG.coinsPerActivity,
      xp: count * REWARDS_CONFIG.xpPerActivity,
      reason: 'activity', kind: p.kind, taxonomyRef: p.taxonomyRef ?? null, now
    })

    // 2. advance the incubating egg
    let eggBecameReady = false
    const [egg] = await tx.select().from(eggs).where(eq(eggs.status, 'incubating'))
    if (egg) {
      let pts = egg.incubationPoints
      for (let i = 0; i < count; i++) pts = advanceIncubation(pts)
      const ready = isReady(pts)
      eggBecameReady = ready
      await tx.update(eggs).set({ incubationPoints: pts, status: ready ? 'ready' : 'incubating' }).where(eq(eggs.id, egg.id))
    }

    // 3. refresh the active pet (studying = full happiness)
    await tx.update(pets)
      .set({ baseHappiness: REWARDS_CONFIG.happinessStart, lastInteractionAt: now })
      .where(eq(pets.isActive, true))

    // 4. bump today's activity counter
    await tx.insert(dailyActivity).values({ dayKey, count })
      .onConflictDoUpdate({ target: dailyActivity.dayKey, set: { count: sql`${dailyActivity.count} + ${count}` } })
    const [today] = await tx.select().from(dailyActivity).where(eq(dailyActivity.dayKey, dayKey))
    const todayCount = today?.count ?? count

    // 5. daily-goal bonus (once/day)
    let goalJustMet = false
    if (todayCount >= REWARDS_CONFIG.dailyGoal && today && today.goalAwardedAt == null) {
      await credit(tx, { coins: REWARDS_CONFIG.dailyGoalBonus, xp: 0, reason: 'daily_goal', kind: null, now })
      await tx.update(dailyActivity).set({ goalAwardedAt: now }).where(eq(dailyActivity.dayKey, dayKey))
      goalJustMet = true
    }

    const keys = await activeDayKeys(tx)
    return ok<ActivityResult>({
      streak: streakDays(keys, now, tz),
      daily: { count: todayCount, goal: REWARDS_CONFIG.dailyGoal, met: todayCount >= REWARDS_CONFIG.dailyGoal },
      eggBecameReady, goalJustMet
    })
  })
}

export async function getStreak(db: DB, now = new Date(), tz = appTz()): Promise<number> {
  return streakDays(await activeDayKeys(db), now, tz)
}

export async function getDailyProgress(db: DB, now = new Date(), tz = appTz()): Promise<{ count: number; goal: number; met: boolean }> {
  const [row] = await db.select().from(dailyActivity).where(eq(dailyActivity.dayKey, dayKeyInTz(now, tz)))
  const count = row?.count ?? 0
  return { count, goal: REWARDS_CONFIG.dailyGoal, met: count >= REWARDS_CONFIG.dailyGoal }
}

type Exec = DB | Parameters<Parameters<DB['transaction']>[0]>[0]
async function activeDayKeys(db: Exec): Promise<Set<string>> {
  const rows = await db.select({ k: dailyActivity.dayKey }).from(dailyActivity).where(gt(dailyActivity.count, 0))
  return new Set(rows.map((r) => r.k))
}

/** App timezone for day bucketing — the local machine tz (single local user). */
export function appTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
```

- [ ] **Step 3: Run the test.** Run: `npx vitest run test/gamification/activity.repo.test.ts`. Expected: PASS. (If `db.transaction` typing rejects passing `tx` to `credit`, widen `credit`'s `Exec` type as in Task 3 — it already accepts the tx type.)

- [ ] **Step 4: Run the full suite.** Run: `npm test`. Expected: all green.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(gamification): recordActivity + streak + daily goal (TDD)"`

---

## Task 5: Pet / shop / nest services (TDD)

Port `sat-world/src/lib/services/pets.ts` to single-profile FreeCAT. **Transformations applied to every function:** drop the `userId` param + all `eq(.userId, userId)` filters; drop `.for('update')` (libsql serializes writes — atomicity comes from `db.transaction`); use `getState`/`spend`/`credit` from Task 3 instead of the `wallet` table; `ServiceResult`/`ok`/`err` import from `src/shared/dto`. The egg "already exists" guard becomes a plain in-transaction existence check (no partial-unique race handling needed).

**Files:** Create `src/main/repositories/pets.ts`; Test `test/gamification/pets.repo.test.ts`

- [ ] **Step 1: Write the failing test** (port + adapt sat-world's `tests/integration/{shop,nest}.test.ts` to single-profile + in-memory libsql — drop `makeUser`/`hasTestDb`/`truncateAll`, use `createDb(':memory:')`):

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb, type DB } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { credit } from '../../src/main/repositories/gamification-state'
import { buyEgg, buyTreat, buyItem, hatchEgg, setActivePet, equipItem, getGamificationState } from '../../src/main/repositories/pets'
import { eggs, pets, ownedItems } from '../../src/main/db/schema'
import { REWARDS_CONFIG } from '../../src/shared/gamification/config'
import { ITEMS, SPECIES } from '../../src/shared/gamification/catalog'

const NOW = new Date('2026-06-22T12:00:00Z')
const TZ = 'UTC'
let db: DB
beforeEach(async () => { db = createDb(':memory:'); await runMigrations(db, 'drizzle') })
const giveCoins = (n: number) => credit(db, { coins: n, xp: 0, reason: 'activity', kind: null, now: NOW })

describe('shop', () => {
  it('buyEgg debits coins and creates an incubating egg', async () => {
    await giveCoins(REWARDS_CONFIG.eggPrice)
    expect((await buyEgg(db, NOW)).ok).toBe(true)
    const [egg] = await db.select().from(eggs)
    expect(egg.status).toBe('incubating')
  })
  it('buyEgg without funds → insufficient-coins, no egg', async () => {
    await giveCoins(REWARDS_CONFIG.eggPrice - 1)
    expect(await buyEgg(db, NOW)).toEqual({ ok: false, error: 'insufficient-coins' })
    expect(await db.select().from(eggs)).toHaveLength(0)
  })
  it('buyEgg rejected when an un-hatched egg already exists', async () => {
    await giveCoins(REWARDS_CONFIG.eggPrice * 2)
    await db.insert(eggs).values({ status: 'incubating' })
    expect(await buyEgg(db, NOW)).toEqual({ ok: false, error: 'egg-exists' })
  })
  it('buyTreat needs an active pet, debits, sets lastTreatAt', async () => {
    await giveCoins(REWARDS_CONFIG.treatPrice)
    await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true })
    expect((await buyTreat(db, NOW)).ok).toBe(true)
    const [pet] = await db.select().from(pets)
    expect(pet.lastTreatAt?.getTime()).toBe(NOW.getTime())
  })
  it('buyTreat without an active pet → no-pet', async () => {
    await giveCoins(REWARDS_CONFIG.treatPrice)
    expect(await buyTreat(db, NOW)).toEqual({ ok: false, error: 'no-pet' })
  })
  it('buyItem debits + records ownership; re-buy → already-owned; unknown → not-found', async () => {
    await giveCoins(ITEMS[0]!.price * 2)
    expect((await buyItem(db, ITEMS[0]!.key, NOW)).ok).toBe(true)
    expect(await buyItem(db, ITEMS[0]!.key, NOW)).toEqual({ ok: false, error: 'already-owned' })
    expect(await buyItem(db, 'nope', NOW)).toEqual({ ok: false, error: 'not-found' })
  })
})

describe('nest', () => {
  it('hatchEgg on a ready egg creates an active pet (first one) and marks the egg hatched', async () => {
    await db.insert(eggs).values({ status: 'ready', incubationPoints: REWARDS_CONFIG.incubationThreshold })
    const res = await hatchEgg(db, NOW, () => 0)
    expect(res.ok).toBe(true)
    const [pet] = await db.select().from(pets)
    expect(pet.isActive).toBe(true)
    expect(SPECIES.map((s) => s.key)).toContain(pet.species)
  })
  it('hatchEgg on a non-ready egg → not-ready', async () => {
    await db.insert(eggs).values({ status: 'incubating', incubationPoints: 5 })
    expect(await hatchEgg(db, NOW, () => 0)).toEqual({ ok: false, error: 'not-ready' })
  })
  it('setActivePet swaps the single active flag', async () => {
    const [a] = await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true }).returning()
    const [b] = await db.insert(pets).values({ species: 'dog', rarity: 'uncommon', isActive: false }).returning()
    expect((await setActivePet(db, b!.id)).ok).toBe(true)
    const active = await db.select().from(pets).where(eq(pets.isActive, true))
    expect(active).toHaveLength(1); expect(active[0]!.id).toBe(b!.id)
  })
  it('equipItem requires ownership and replaces a same-slot item', async () => {
    const [pet] = await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true }).returning()
    const neck = ITEMS.filter((i) => i.slot === 'neck')
    expect(await equipItem(db, pet!.id, neck[0]!.key)).toEqual({ ok: false, error: 'not-owned' })
    await db.insert(ownedItems).values({ itemKey: neck[0]!.key })
    expect((await equipItem(db, pet!.id, neck[0]!.key)).ok).toBe(true)
    if (neck[1]) {
      await db.insert(ownedItems).values({ itemKey: neck[1]!.key })
      await equipItem(db, pet!.id, neck[1]!.key)
      const [p] = await db.select().from(pets)
      expect(p.equipped).toEqual([neck[1]!.key])
    }
  })
  it('getGamificationState returns coins, xp/level, derived mood, collection, egg progress, shop', async () => {
    await giveCoins(40)
    await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true, baseHappiness: 100, lastInteractionAt: NOW })
    await db.insert(eggs).values({ status: 'incubating', incubationPoints: 75 })
    const st = await getGamificationState(db, NOW, TZ)
    expect(st.coins).toBe(40)
    expect(st.activePet?.mood.level).toBe('happy')
    expect(st.collection).toHaveLength(1)
    expect(st.egg?.progress).toBeCloseTo(0.5)
    expect(st.shop.items).toHaveLength(ITEMS.length)
  })
})
```

Run: `npx vitest run test/gamification/pets.repo.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `src/main/repositories/pets.ts`.** Port each function from `sat-world/src/lib/services/pets.ts` @ `c99b1da` with the transformations above. Reference implementation:

```ts
import { and, asc, eq, ne } from 'drizzle-orm'
import type { DB } from '../db/client'
import { eggs, ownedItems, pets, type PetRow } from '../db/schema'
import { REWARDS_CONFIG } from '../../shared/gamification/config'
import { incubationProgress, isReady } from '../../shared/gamification/incubation'
import { rollSpecies } from '../../shared/gamification/hatch'
import { moodFromState } from '../../shared/gamification/wellbeing'
import { ITEMS, SPECIES } from '../../shared/gamification/catalog'
import { levelForXp } from '../../shared/gamification/level'
import { streakDays } from '../../shared/gamification/streak'
import { dailyActivity } from '../db/schema'
import { gt } from 'drizzle-orm'
import type { Rng, MoodState, Rarity } from '../../shared/gamification/types'
import type { GamificationState, PetView, ServiceResult } from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import { getState, spend } from './gamification-state'
import { appTz } from './activity'

const RESTING: MoodState = { value: REWARDS_CONFIG.happinessStart, level: 'happy' } // inactive pets don't decay

const speciesRarity = (key: string): Rarity => SPECIES.find((s) => s.key === key)?.rarity ?? 'common'

function toView(p: PetRow, now: Date, tz: string): PetView {
  const mood = p.isActive ? moodFromState(p.baseHappiness, p.lastInteractionAt, p.lastTreatAt, now, tz) : RESTING
  return { id: p.id, species: p.species, name: p.name, rarity: p.rarity, isActive: p.isActive, equipped: p.equipped, mood }
}

export async function buyEgg(db: DB, now: Date): Promise<ServiceResult<null>> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(eggs).where(ne(eggs.status, 'hatched'))
    if (existing) return err('egg-exists')
    const debit = await spend(tx, { amount: REWARDS_CONFIG.eggPrice, reason: 'spend_egg', now })
    if (!debit.ok) return err(debit.error)
    await tx.insert(eggs).values({ status: 'incubating', acquiredAt: now })
    return ok(null)
  })
}

export async function buyTreat(db: DB, now: Date): Promise<ServiceResult<null>> {
  return db.transaction(async (tx) => {
    const [pet] = await tx.select().from(pets).where(eq(pets.isActive, true))
    if (!pet) return err('no-pet')
    const debit = await spend(tx, { amount: REWARDS_CONFIG.treatPrice, reason: 'spend_treat', now })
    if (!debit.ok) return err(debit.error)
    await tx.update(pets).set({ lastTreatAt: now }).where(eq(pets.id, pet.id))
    return ok(null)
  })
}

export async function buyItem(db: DB, itemKey: string, now: Date): Promise<ServiceResult<null>> {
  const item = ITEMS.find((i) => i.key === itemKey)
  if (!item) return err('not-found')
  return db.transaction(async (tx) => {
    const [owned] = await tx.select().from(ownedItems).where(eq(ownedItems.itemKey, itemKey))
    if (owned) return err('already-owned')
    const debit = await spend(tx, { amount: item.price, reason: 'spend_item', now })
    if (!debit.ok) return err(debit.error)
    await tx.insert(ownedItems).values({ itemKey, acquiredAt: now })
    return ok(null)
  })
}

export async function hatchEgg(db: DB, now: Date, rng: Rng = Math.random): Promise<ServiceResult<PetView>> {
  return db.transaction(async (tx) => {
    const [egg] = await tx.select().from(eggs).where(eq(eggs.status, 'ready'))
    if (!egg || !isReady(egg.incubationPoints)) return err('not-ready')
    const speciesKey = rollSpecies(rng, SPECIES)
    const [hasActive] = await tx.select({ id: pets.id }).from(pets).where(eq(pets.isActive, true))
    const [pet] = await tx.insert(pets).values({
      species: speciesKey, rarity: speciesRarity(speciesKey),
      isActive: !hasActive, baseHappiness: REWARDS_CONFIG.happinessStart, lastInteractionAt: now, hatchedAt: now
    }).returning()
    if (!pet) throw new Error('hatch failed to create pet')
    await tx.update(eggs).set({ status: 'hatched', hatchedPetId: pet.id, hatchedAt: now }).where(eq(eggs.id, egg.id))
    return ok(toView(pet, now, appTz()))
  })
}

export async function setActivePet(db: DB, petId: number): Promise<ServiceResult<null>> {
  return db.transaction(async (tx) => {
    const [pet] = await tx.select().from(pets).where(eq(pets.id, petId))
    if (!pet) return err('not-found')
    await tx.update(pets).set({ isActive: false }).where(eq(pets.isActive, true))
    await tx.update(pets).set({ isActive: true, baseHappiness: REWARDS_CONFIG.happinessStart, lastInteractionAt: new Date() }).where(eq(pets.id, petId))
    return ok(null)
  })
}

export async function equipItem(db: DB, petId: number, itemKey: string): Promise<ServiceResult<null>> {
  const item = ITEMS.find((i) => i.key === itemKey)
  if (!item) return err('not-found')
  return db.transaction(async (tx) => {
    const [owned] = await tx.select().from(ownedItems).where(eq(ownedItems.itemKey, itemKey))
    if (!owned) return err('not-owned')
    const [pet] = await tx.select().from(pets).where(eq(pets.id, petId))
    if (!pet) return err('not-found')
    const kept = pet.equipped.filter((k) => ITEMS.find((i) => i.key === k)?.slot !== item.slot)
    await tx.update(pets).set({ equipped: [...kept, itemKey] }).where(eq(pets.id, petId))
    return ok(null)
  })
}

export async function unequipItem(db: DB, petId: number, itemKey: string): Promise<ServiceResult<null>> {
  return db.transaction(async (tx) => {
    const [pet] = await tx.select().from(pets).where(eq(pets.id, petId))
    if (!pet) return err('not-found')
    await tx.update(pets).set({ equipped: pet.equipped.filter((k) => k !== itemKey) }).where(eq(pets.id, petId))
    return ok(null)
  })
}

export async function renamePet(db: DB, petId: number, name: string): Promise<ServiceResult<null>> {
  const trimmed = name.trim()
  if (trimmed.length > 24) return err('name-too-long')
  const updated = await db.update(pets).set({ name: trimmed || null }).where(eq(pets.id, petId)).returning({ id: pets.id })
  return updated.length ? ok(null) : err('not-found')
}

export async function getGamificationState(db: DB, now: Date, tz = appTz()): Promise<GamificationState> {
  const { coins, xp } = await getState(db)
  const petRows = await db.select().from(pets).orderBy(asc(pets.hatchedAt))
  const views = petRows.map((p) => toView(p, now, tz))
  const [egg] = await db.select().from(eggs).where(ne(eggs.status, 'hatched'))
  const owned = await db.select({ k: ownedItems.itemKey }).from(ownedItems)
  const dayRows = await db.select({ k: dailyActivity.dayKey, c: dailyActivity.count }).from(dailyActivity).where(gt(dailyActivity.count, 0))
  const today = dayRows.find((d) => d.k === (await import('../../shared/gamification/dates')).dayKeyInTz(now, tz))
  const todayCount = today?.c ?? 0
  return {
    coins, xp, level: levelForXp(xp),
    streak: streakDays(new Set(dayRows.map((d) => d.k)), now, tz),
    daily: { count: todayCount, goal: REWARDS_CONFIG.dailyGoal, met: todayCount >= REWARDS_CONFIG.dailyGoal },
    activePet: views.find((v) => v.isActive) ?? null,
    collection: views,
    egg: egg ? { incubationPoints: egg.incubationPoints, progress: incubationProgress(egg.incubationPoints), ready: egg.status === 'ready' } : null,
    ownedItemKeys: owned.map((o) => o.k),
    shop: { eggPrice: REWARDS_CONFIG.eggPrice, treatPrice: REWARDS_CONFIG.treatPrice, items: ITEMS }
  }
}
```

> Clean-up note for the implementer: replace the inline `await import(...)` for `dayKeyInTz` with a top-of-file import; it's written inline here only to keep the snippet self-contained. Keep imports tidy.

- [ ] **Step 3: Run the test.** Run: `npx vitest run test/gamification/pets.repo.test.ts`. Expected: PASS.

- [ ] **Step 4: Run the suite + typecheck.** Run: `npm test` then `npx tsc --noEmit`. Expected: green.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(gamification): pet/shop/nest services, single-profile (TDD)"`

---

## Task 6: Shared DTO + channels module; profile-IPC hardening (charter §5.3)

Adopt the second-namespace hardening now: a typed `src/shared/` boundary, channel constants, an explicitly-typed preload `api`, and the structured-result envelope.

**Files:** Create `src/shared/dto.ts`, `src/shared/channels.ts`, `src/shared/api.ts`; Modify `src/main/ipc/profile.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`. (`src/main/repositories/profile.ts` can keep returning the row as-is.) Test: existing tests must stay green.

- [ ] **Step 1: `src/shared/dto.ts`** — the cross-process contract (flesh out the Task 3 stub):

```ts
import type { MoodState, Rarity, Item, CoinReason } from './gamification/types'

export type ServiceErrorCode =
  | 'not-found' | 'invalid' | 'insufficient-coins' | 'egg-exists'
  | 'no-pet' | 'already-owned' | 'not-owned' | 'not-ready' | 'name-too-long'
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: ServiceErrorCode }
export const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data })
export const err = <T = never>(error: ServiceErrorCode): ServiceResult<T> => ({ ok: false, error })

export type { CoinReason } // single source: src/shared/gamification/types.ts

export interface ProfileDto { id: number; displayName: string; createdAt: Date }

export interface PetView {
  id: number; species: string; name: string | null; rarity: Rarity
  isActive: boolean; equipped: string[]; mood: MoodState
}
export interface EggView { incubationPoints: number; progress: number; ready: boolean }
export interface DailyProgress { count: number; goal: number; met: boolean }
export interface LevelInfo { level: number; into: number; toNext: number }

export interface GamificationState {
  coins: number; xp: number; level: LevelInfo; streak: number; daily: DailyProgress
  activePet: PetView | null; collection: PetView[]; egg: EggView | null
  ownedItemKeys: string[]; shop: { eggPrice: number; treatPrice: number; items: Item[] }
}
export interface ActivityResult { streak: number; daily: DailyProgress; eggBecameReady: boolean; goalJustMet: boolean }
export interface RecordActivityInput { kind: string; count?: number; taxonomyRef?: string }
```

> Re-export `CoinReason` from `./gamification/types` instead of redeclaring if the implementer prefers a single source — keep ONE definition. (Plan default: define `CoinReason` in `types.ts`, import it here and in the schema.)

- [ ] **Step 2: `src/shared/channels.ts`** — channel-name constants:

```ts
export const CH = {
  profileGet: 'profile:get',
  profileSetName: 'profile:setName',
  gamGetState: 'gamification:getState',
  gamRecordActivity: 'gamification:recordActivity',
  gamBuyEgg: 'gamification:buyEgg',
  gamBuyTreat: 'gamification:buyTreat',
  gamBuyItem: 'gamification:buyItem',
  gamHatchEgg: 'gamification:hatchEgg',
  gamSetActivePet: 'gamification:setActivePet',
  gamEquipItem: 'gamification:equipItem',
  gamUnequipItem: 'gamification:unequipItem',
  gamRenamePet: 'gamification:renamePet'
} as const
```

- [ ] **Step 3: Refactor `src/main/ipc/profile.ts`** to use the channel constants (`CH.profileGet`, `CH.profileSetName`) and keep `setNameSchema`.

- [ ] **Step 4: Type the preload boundary.** In `src/preload/index.ts`, import the to-be-defined `FreecatApi` window type and annotate `const api: FreecatApi`, and use `CH.*` constants for channel strings. (Define `FreecatApi` in `env.d.ts`, Step 5, and import it.)

- [ ] **Step 5a: `src/shared/api.ts`** — the single `window.freecat` contract, consumed by both preload and renderer:

```ts
import type { ProfileDto, GamificationState, ActivityResult, RecordActivityInput, ServiceResult, PetView } from './dto'

export interface FreecatApi {
  profile: { get: () => Promise<ProfileDto>; setName: (name: string) => Promise<ProfileDto> }
  gamification: {
    getState: () => Promise<GamificationState>
    recordActivity: (input: RecordActivityInput) => Promise<ServiceResult<ActivityResult>>
    buyEgg: () => Promise<ServiceResult<null>>
    buyTreat: () => Promise<ServiceResult<null>>
    buyItem: (itemKey: string) => Promise<ServiceResult<null>>
    hatchEgg: () => Promise<ServiceResult<PetView>>
    setActivePet: (petId: number) => Promise<ServiceResult<null>>
    equipItem: (petId: number, itemKey: string) => Promise<ServiceResult<null>>
    unequipItem: (petId: number, itemKey: string) => Promise<ServiceResult<null>>
    renamePet: (petId: number, name: string) => Promise<ServiceResult<null>>
  }
}
```

- [ ] **Step 5b: `src/renderer/src/env.d.ts`** — bind the contract to `window`:

```ts
import type { FreecatApi } from '../../shared/api'
declare global { interface Window { freecat: FreecatApi } }
export {}
```

- [ ] **Step 6: Run tests + typecheck.** Run: `npm test && npx tsc --noEmit`. Expected: existing 7 + new suites green; types resolve.

- [ ] **Step 7: Commit.** `git add -A && git commit -m "refactor(ipc): shared DTO+channel module, typed preload boundary (charter §5.3)"`

---

## Task 7: Gamification IPC + preload + main wiring

**Files:** Create `src/main/ipc/gamification.ts`; Modify `src/preload/index.ts`, `src/main/index.ts`; Test `test/gamification/ipc-validation.test.ts`

- [ ] **Step 1: Write the failing validation test.**

```ts
import { describe, it, expect } from 'vitest'
import { recordActivitySchema, itemKeySchema, petIdSchema, renameSchema } from '../../src/main/ipc/gamification'

describe('gamification IPC validation', () => {
  it('accepts a valid recordActivity payload', () => {
    expect(recordActivitySchema.parse({ kind: 'qbank.answer', count: 2 })).toEqual({ kind: 'qbank.answer', count: 2 })
  })
  it('rejects an empty kind / non-positive count', () => {
    expect(() => recordActivitySchema.parse({ kind: '' })).toThrow()
    expect(() => recordActivitySchema.parse({ kind: 'x', count: 0 })).toThrow()
  })
  it('validates item key + pet id + rename', () => {
    expect(itemKeySchema.parse('cap')).toBe('cap')
    expect(() => petIdSchema.parse(-1)).toThrow()
    expect(() => renameSchema.parse({ petId: 1, name: 'x'.repeat(25) })).toThrow()
  })
})
```

Run: `npx vitest run test/gamification/ipc-validation.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `src/main/ipc/gamification.ts`.** Domain ops return `ServiceResult` envelopes (they don't throw on domain errors); Zod throws only on malformed input.

```ts
import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { recordActivity, appTz } from '../repositories/activity'
import { buyEgg, buyTreat, buyItem, hatchEgg, setActivePet, equipItem, unequipItem, renamePet, getGamificationState } from '../repositories/pets'

export const recordActivitySchema = z.object({
  kind: z.string().min(1).max(64),
  count: z.number().int().positive().max(10_000).optional(),
  taxonomyRef: z.string().min(1).max(128).optional()
})
export const itemKeySchema = z.string().min(1).max(64)
export const petIdSchema = z.number().int().positive()
export const renameSchema = z.object({ petId: z.number().int().positive(), name: z.string().max(24) })
const equipSchema = z.object({ petId: z.number().int().positive(), itemKey: z.string().min(1).max(64) })

export function registerGamificationIpc(db: DB): void {
  ipcMain.handle(CH.gamGetState, () => getGamificationState(db, new Date(), appTz()))
  ipcMain.handle(CH.gamRecordActivity, (_e, raw: unknown) => recordActivity(db, recordActivitySchema.parse(raw)))
  ipcMain.handle(CH.gamBuyEgg, () => buyEgg(db, new Date()))
  ipcMain.handle(CH.gamBuyTreat, () => buyTreat(db, new Date()))
  ipcMain.handle(CH.gamBuyItem, (_e, raw: unknown) => buyItem(db, itemKeySchema.parse(raw), new Date()))
  ipcMain.handle(CH.gamHatchEgg, () => hatchEgg(db, new Date()))
  ipcMain.handle(CH.gamSetActivePet, (_e, raw: unknown) => setActivePet(db, petIdSchema.parse(raw)))
  ipcMain.handle(CH.gamEquipItem, (_e, raw: unknown) => { const p = equipSchema.parse(raw); return equipItem(db, p.petId, p.itemKey) })
  ipcMain.handle(CH.gamUnequipItem, (_e, raw: unknown) => { const p = equipSchema.parse(raw); return unequipItem(db, p.petId, p.itemKey) })
  ipcMain.handle(CH.gamRenamePet, (_e, raw: unknown) => { const p = renameSchema.parse(raw); return renamePet(db, p.petId, p.name) })
}
```

- [ ] **Step 3: Extend `src/preload/index.ts`** with the `gamification` namespace, using `CH.*` and the `FreecatApi` type:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/channels'
import type { FreecatApi } from '../shared/api'

const api: FreecatApi = {
  profile: {
    get: () => ipcRenderer.invoke(CH.profileGet),
    setName: (name) => ipcRenderer.invoke(CH.profileSetName, name)
  },
  gamification: {
    getState: () => ipcRenderer.invoke(CH.gamGetState),
    recordActivity: (input) => ipcRenderer.invoke(CH.gamRecordActivity, input),
    buyEgg: () => ipcRenderer.invoke(CH.gamBuyEgg),
    buyTreat: () => ipcRenderer.invoke(CH.gamBuyTreat),
    buyItem: (itemKey) => ipcRenderer.invoke(CH.gamBuyItem, itemKey),
    hatchEgg: () => ipcRenderer.invoke(CH.gamHatchEgg),
    setActivePet: (petId) => ipcRenderer.invoke(CH.gamSetActivePet, petId),
    equipItem: (petId, itemKey) => ipcRenderer.invoke(CH.gamEquipItem, { petId, itemKey }),
    unequipItem: (petId, itemKey) => ipcRenderer.invoke(CH.gamUnequipItem, { petId, itemKey }),
    renamePet: (petId, name) => ipcRenderer.invoke(CH.gamRenamePet, { petId, name })
  }
}
contextBridge.exposeInMainWorld('freecat', api)
```

> `FreecatApi` lives in `src/shared/api.ts` (Task 6), so neither preload nor renderer owns the contract — both import it.

- [ ] **Step 4: Wire main.** In `src/main/index.ts`, after `registerProfileIpc(db)` add `registerGamificationIpc(db)` and `await ensureStarterGrant(db)` (Task 8 adds the grant; import both). Import `registerGamificationIpc` from `./ipc/gamification`.

- [ ] **Step 5: Run tests + typecheck + build.** Run: `npm test && npx tsc --noEmit && npm run build`. Expected: green; the renderer/preload/main all compile.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(gamification): IPC handlers + preload namespace + main wiring"`

---

## Task 8: Vendor sprite assets + URL resolver + starter grant

**Files:** copy assets into `src/renderer/src/assets/...`; create `src/renderer/src/gamification/sprite-urls.ts`, `src/shared/gamification/pet-art.ts`, `src/shared/gamification/pet-frames.ts`; add `ensureStarterGrant` to `src/main/repositories/activity.ts`. Test `test/gamification/pet-art.test.ts`, extend `test/gamification/activity.repo.test.ts`.

- [ ] **Step 1: Copy assets** from sat-world `dev` @ `c99b1da` (six animals only; **skip `slime/` and every `content.png`**):

```bash
mkdir -p src/renderer/src/assets/pets/items
for sp in cat dog pig frog capybara axolotl; do
  mkdir -p "src/renderer/src/assets/pets/$sp"
  for st in happy sleeping sad angry eating; do
    cp "/Users/warren/wrk/sat-world/public/pets/$sp/$st.png" "src/renderer/src/assets/pets/$sp/$st.png"
  done
done
cp /Users/warren/wrk/sat-world/public/pets/items/{cap,glasses,scarf,bow}.png src/renderer/src/assets/pets/items/
cp /Users/warren/wrk/sat-world/public/coin.svg src/renderer/src/assets/coin.svg
```
Then create `src/renderer/src/assets/pets/CREDITS.md` from sat-world's, **dropping the Slime (CC0) section** and changing the header to "Six creatures" (the six chibi animals are project-owned, so no third-party license applies).

- [ ] **Step 2: `src/shared/gamification/pet-frames.ts`** — copy sat-world's, **delete the `"slime": { ... }` block**. Verify it declares exactly `cat,dog,pig,frog,capybara,axolotl`, each with `happy/sleeping/sad/angry/eating`.

- [ ] **Step 3: `src/shared/gamification/pet-art.ts`** — port sat-world's, but make `resolveSprite` **URL-free** (the renderer maps to a bundled URL):

```ts
import { ITEMS, SPECIES } from './catalog'
import type { Anchor, MoodLevel } from './types'
import { PET_FRAMES, type FrameSpec } from './pet-frames'

export type PetAction = 'eating'
export type SpriteState = MoodLevel | PetAction
export interface Layer { itemKey: string; anchor?: Anchor }
export interface Sprite extends FrameSpec { species: string; state: SpriteState }

export function resolveSprite(speciesKey: string, mood: MoodLevel, action?: PetAction): Sprite | null {
  if (!SPECIES.some((s) => s.key === speciesKey)) return null
  const state: SpriteState = action ?? mood
  const spec = PET_FRAMES[speciesKey]?.[state] ?? { frames: 1, durationMs: 0 }
  return { species: speciesKey, state, frames: spec.frames, durationMs: spec.durationMs }
}

export function resolveAccessories(speciesKey: string, equipped: string[]): Layer[] {
  const species = SPECIES.find((s) => s.key === speciesKey)
  if (!species) return []
  const layers: Layer[] = []
  for (const key of equipped) {
    const item = ITEMS.find((i) => i.key === key)
    if (!item) continue
    layers.push({ itemKey: key, anchor: species.anchors[item.slot] })
  }
  return layers
}

export function mouthAnchor(speciesKey: string): Anchor | undefined {
  const face = SPECIES.find((s) => s.key === speciesKey)?.anchors.face
  return face && { ...face, y: Math.min(1, face.y + 0.08) }
}
```
Test (`pet-art.test.ts`): port sat-world's `pet-art.test.ts`, updated for the URL-free shape (assert `resolveSprite('cat','happy')?.frames` from the manifest; `resolveSprite('slime','happy')` → null; `resolveAccessories('cat',['cap'])` → one layer with `itemKey:'cap'`).

- [ ] **Step 4: `src/renderer/src/gamification/sprite-urls.ts`** — build hashed, base-correct URL maps with Vite's glob (works in dev *and* packaged Electron, unlike `/public` absolute paths):

```ts
const petPngs = import.meta.glob('../assets/pets/*/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const itemPngs = import.meta.glob('../assets/pets/items/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
import coinSvg from '../assets/coin.svg'

export const coinUrl = coinSvg as string

export function spriteUrl(species: string, state: string): string | undefined {
  return petPngs[`../assets/pets/${species}/${state}.png`]
}
export function itemUrl(key: string): string | undefined {
  return itemPngs[`../assets/pets/items/${key}.png`]
}
```

- [ ] **Step 5: Starter grant.** Add to `src/main/repositories/activity.ts`:

```ts
import { eggs as eggsTable, pets as petsTable } from '../db/schema'
// ...
/** First-run: if there's no pet, no egg, and no activity yet, grant one free incubating egg
 *  so studying immediately makes visible progress toward a first hatch. Idempotent. */
export async function ensureStarterGrant(db: DB): Promise<void> {
  const [pet] = await db.select({ id: petsTable.id }).from(petsTable).limit(1)
  const [egg] = await db.select({ id: eggsTable.id }).from(eggsTable).limit(1)
  const [act] = await db.select({ k: dailyActivity.dayKey }).from(dailyActivity).limit(1)
  if (pet || egg || act) return
  await db.insert(eggsTable).values({ status: 'incubating', acquiredAt: new Date() })
}
```
Extend `test/gamification/activity.repo.test.ts` with: `ensureStarterGrant` creates exactly one incubating egg on a fresh DB; a second call is a no-op; it does nothing once any activity/pet/egg exists.

- [ ] **Step 6: Run tests.** Run: `npm test`. Expected: green (sprite-urls.ts isn't imported by tests, so glob doesn't run under vitest).

- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(gamification): vendor six-animal sprites, URL resolver, starter egg grant"`

---

## Task 9: Pet + Coin components + animation CSS

**Files:** Create `src/renderer/src/components/Pet.tsx`, `src/renderer/src/components/Coin.tsx`; Modify `src/renderer/src/styles.css`.

- [ ] **Step 1: Pet animation CSS.** Append to `src/renderer/src/styles.css` (after `@import "tailwindcss";`) the keyframes from `sat-world/src/app/globals.css` lines 237–269 verbatim: `@keyframes pet-idle` + `.pet-idle`, `@keyframes pet-sprite`, `@keyframes pet-eating` + `.pet-eating`, `@keyframes treat-eat` + `.treat-eat`, and the `@media (prefers-reduced-motion: reduce)` block.

- [ ] **Step 2: `src/renderer/src/components/Pet.tsx`.** Port sat-world's `Pet` + `Treat`, swapping the URL source from `/pets/...` strings to the bundled resolver (`spriteUrl`/`itemUrl`), and dropping `SPRITE_VERSION`/`versioned()` (Vite hashes filenames → automatic cache-busting). Keep the strip animation, accessory layering, and the single-frame `Treat` overlay. Replace `next/image` eslint-disable comments (not applicable). Key differences from source:

```tsx
import type { CSSProperties } from 'react'
import { mouthAnchor, resolveAccessories, resolveSprite, type PetAction } from '../../../shared/gamification/pet-art'
import type { MoodLevel } from '../../../shared/gamification/types'
import { spriteUrl, itemUrl } from '../gamification/sprite-urls'

function Treat({ species, size }: { species: string; size: number }) {
  const a = mouthAnchor(species); if (!a) return null
  const s = Math.round(size * 0.3)
  return (
    <svg viewBox="0 0 24 24" className="treat-eat" aria-hidden style={{ position: 'absolute', left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: s, height: s }}>
      <circle cx="12" cy="12" r="11" fill="#d8a24a" stroke="#a9762a" strokeWidth="1.2" />
      <g fill="#5b3a1a"><circle cx="9" cy="8.5" r="1.7" /><circle cx="15.5" cy="11" r="1.7" /><circle cx="10.5" cy="15" r="1.7" /><circle cx="16" cy="16" r="1.3" /><circle cx="7.5" cy="13.5" r="1.2" /></g>
    </svg>
  )
}

export function Pet({ species, mood, equipped = [], size = 128, animate = true, action }: {
  species: string; mood: MoodLevel; equipped?: string[]; size?: number; animate?: boolean; action?: PetAction
}) {
  const sprite = resolveSprite(species, mood, action)
  const src = sprite && spriteUrl(sprite.species, sprite.state)
  if (!sprite || !src) return <div style={{ width: size, height: size }} aria-hidden />
  const accessories = resolveAccessories(species, equipped)
  const eating = action === 'eating'
  const animated = animate && sprite.frames > 1
  const idleDelay = `-${species.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 2400}ms`
  const motion = !animated && animate ? (eating ? 'pet-eating' : 'pet-idle') : ''
  const stripStyle: CSSProperties = animated
    ? { width: sprite.frames * size, height: size, ['--pet-strip-shift' as string]: `-${sprite.frames * size}px`, animation: `pet-sprite ${sprite.frames * sprite.durationMs}ms steps(${sprite.frames}) infinite` }
    : { width: size, height: size }
  return (
    <div className="relative" style={{ width: size, height: size }} aria-hidden>
      <div className={`relative h-full w-full ${animated ? 'overflow-hidden' : ''} ${motion}`} style={{ animationDelay: motion === 'pet-idle' ? idleDelay : undefined }}>
        <img src={src} alt="" className={`absolute left-0 top-0 max-w-none ${animated ? 'pet-sprite' : ''}`} style={stripStyle} />
      </div>
      {accessories.map((l, i) => {
        const url = itemUrl(l.itemKey); if (!url) return null
        const w = size * (l.anchor?.scale ?? 1)
        return <img key={i} src={url} alt="" className="absolute" style={{ left: `${(l.anchor?.x ?? 0.5) * 100}%`, top: `${(l.anchor?.y ?? 0.5) * 100}%`, width: w, height: w, transform: 'translate(-50%, -50%)' }} />
      })}
      {eating && sprite.frames <= 1 && <Treat species={species} size={size} />}
    </div>
  )
}
```

- [ ] **Step 3: `src/renderer/src/components/Coin.tsx`.**

```tsx
import { coinUrl } from '../gamification/sprite-urls'
export function Coin({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <img src={coinUrl} alt="" width={size} height={size} className={`inline-block shrink-0 align-[-0.2em] ${className}`} />
}
```

- [ ] **Step 4: Build.** Run: `npm run build`. Expected: renderer compiles; assets resolve via glob. (No unit test — visual; verified in Task 10's smoke.)

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(gamification): Pet + Coin components, sprite animation CSS"`

---

## Task 10: Dashboard (Home) + Nest screen + smoke

**Files:** Rewrite `src/renderer/src/pages/Home.tsx`; create `src/renderer/src/pages/Nest.tsx`; modify `src/renderer/src/App.tsx`.

- [ ] **Step 1: Add a Nest route.** In `App.tsx`'s `ROUTES`, add `nest: { label: 'Nest', component: Nest }` and import it. (Keeps the existing Home/Qbank/Content/Flashcards entries.)

- [ ] **Step 2: Rewrite `Home.tsx`** as the dashboard: load `window.freecat.gamification.getState()` on mount (with `.catch` fallback to a null/empty state), render the active pet (`<Pet species mood.level equipped />`), the greeting (profile name as today), and stat tiles: **Level** (`level.level`, with `into`/`toNext` as a small bar), **XP** (`xp`), **Coins** (`<Coin /> {coins}`), **Streak** (`{streak}🔥`), and a **Daily goal** ring (`daily.count`/`daily.goal`). Include a clearly-labeled dev-only button "Simulate study activity" that calls `gamification.recordActivity({ kind: 'dev.simulate', count: 5 })` then refetches state — this satisfies Foundation acceptance criterion 3 and lets Warren exercise the loop before any module exists. A "Visit Nest →" button switches the route to `nest` (lift a route setter or use a simple `window`-level event / shared state — simplest: pass `onNavigate` from `App` into pages, or keep Home/Nest both reading state and add a button that calls a passed `setRoute`). Implementer: thread a `navigate` prop from `App` to pages (minimal `App` change) rather than global state.

- [ ] **Step 3: Build `Nest.tsx`** — the collection/incubator/shop screen, all via `window.freecat.gamification.*`, each action followed by a `getState()` refetch; render `ServiceResult` errors inline (e.g. "Not enough coins"):
  - **Incubator:** if `egg`, show progress (`egg.progress`); if `egg.ready`, a **Hatch** button (`hatchEgg()`), else "incubating…"; if no egg, a **Buy egg** button (`buyEgg()`, price `shop.eggPrice`).
  - **Collection grid:** every pet in `collection` as a `<Pet>`; click → `setActivePet(id)`; show which is active; a rename field (`renamePet(id,name)`); equip/unequip owned accessories (`equipItem`/`unequipItem`).
  - **Shop:** **Buy treat** (`buyTreat()`, needs active pet), and the four `shop.items` with **Buy** (`buyItem(key)`, disabled if owned) — show price with `<Coin />`.

- [ ] **Step 4: Manual smoke (document the steps; run `npm run dev`).**
  1. App boots → Home shows the greeting, a daily-goal ring at 0/20, 0 coins, level 1, and (since Task 8's starter grant ran) an **incubating egg** visible in the Nest.
  2. Click **Simulate study activity** a few times → coins + XP climb, daily ring fills, streak shows 1, egg progress advances.
  3. After enough activity the egg flips to **ready** → **Hatch** in the Nest produces one of the six animals, shown active on Home with a mood.
  4. Buy/equip an accessory; buy a treat → the active pet plays the **eating** state briefly.

- [ ] **Step 5: Gold-standard e2e check (DB-level).** With `npm run dev` running, after clicking simulate, confirm the chain renderer→IPC→main→DB persisted by querying the dev DB: open `~/Library/Application Support/freecat/freecat.db` and verify `gamification_state.coins`/`.xp` > 0, a `coin_ledger` row with `reason='activity'`, and a `daily_activity` row for today. (Use any sqlite client or `npx drizzle-kit studio`.)

- [ ] **Step 6: Full suite + typecheck + build.** Run: `npm test && npx tsc --noEmit && npm run build`. Expected: all green.

- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(gamification): Home dashboard + Nest screen + activity simulation"`

---

## After all tasks

- [ ] Dispatch a final code-reviewer subagent over the whole branch (per subagent-driven-development).
- [ ] Update `docs/superpowers/specs/2026-06-20-foundation-design.md`: mark **C6 ✅ built**; note the deviations from sat-world (single-profile; `recordActivity` generalization; XP+coins; daily-goal replaces daily-clear; glob-imported sprites; slime dropped).
- [ ] Update charter §5.4 status if it tracks build state.
- [ ] Use `superpowers:finishing-a-development-branch`.

## Testing summary
- **Pure unit (Vitest):** economy, catalog (no slime), hatch, incubation, wellbeing (4-rung ladder + treat boost), dates, streak, level, pet-art.
- **Repository integration (in-memory libsql + migrations):** gamification-state (coins/xp/ledger/overdraft), recordActivity (coins+xp, egg→ready, pet refresh, daily-goal once, streak, no-pet/no-egg), pets/shop/nest (buy/hatch/active/equip ownership+slot, getGamificationState shape), starter grant idempotency.
- **IPC validation:** recordActivity/itemKey/petId/rename schemas.
- **Smoke + DB e2e:** boot → simulate activity → state persists through the full renderer→IPC→main→DB chain → hatch → equip.

## Risks & notes
- **Electron asset packaging:** the glob-import resolver is specifically chosen so sprites resolve in both `dev` and packaged builds (absolute `/public` paths break under `file://`). Verify in a packaged build during Task 8 of the eventual C8 packaging work.
- **libsql transactions:** no `SELECT … FOR UPDATE`; a single local profile + serialized IPC means the concurrency guards sat-world needed for multi-user Postgres are unnecessary — atomicity comes from `db.transaction`.
- **`CoinReason` single source:** define once (in `types.ts`), import everywhere (schema, dto) — don't redeclare.
- **tz:** day bucketing uses the local machine timezone (`appTz()`); fine for a single local user. If a "study after midnight" complaint ever surfaces, make it configurable on `profile`.
