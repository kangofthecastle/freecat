import { sqliteTable, integer, text, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import type { CoinReason, Rarity } from '../../../shared/gamification/types'

// Singleton (id is always 1): the spendable coin balance + lifetime XP.
export const gamificationState = sqliteTable('gamification_state', {
  id: integer('id').primaryKey(),
  coins: integer('coins').notNull().default(0),
  xp: integer('xp').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => [
  check('gamification_state_singleton', sql`${t.id} = 1`),
  check('gamification_state_coins_nonneg', sql`${t.coins} >= 0`)
])

export const coinLedger = sqliteTable('coin_ledger', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  amount: integer('amount').notNull(), // + earn, - spend
  reason: text('reason').$type<CoinReason>().notNull(),
  kind: text('kind'), // activity source tag (e.g. 'qbank.answer'); null for non-activity rows
  taxonomyRef: text('taxonomy_ref'), // optional future per-topic analytics hook
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
  dayKey: text('day_key').primaryKey(), // 'YYYY-MM-DD' in APP_TZ
  count: integer('count').notNull().default(0),
  goalAwardedAt: integer('goal_awarded_at', { mode: 'timestamp' }) // set once the daily-goal bonus is granted
})

export type PetRow = typeof pets.$inferSelect
export type EggRow = typeof eggs.$inferSelect
