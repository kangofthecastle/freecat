import { sqliteTable, integer, text, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// Plan-owned tables (Module 5). Migrations here are additive-only and never touch another
// module's tables; other modules never write these.

/** Singleton (id = 1). All pacing knobs are USER-owned (no teacher track here, ever).
 *  `examDate` is a local dayKey; null = habit mode (plan still materializes from budget + FSRS dues
 *  + weakest topics — the triangle and questions pacing stay dormant). */
export const planSettings = sqliteTable('plan_settings', {
  id: integer('id').primaryKey(),
  examDate: text('exam_date'), // 'YYYY-MM-DD' local dayKey; null = no exam date yet
  dailyBudgetMinutes: integer('daily_budget_minutes').notNull().default(60),
  // Flashcards triangle: the user sets ONE of dailyNewTarget/masteryGoalPct; the other is derived
  // (pick-one-derive-the-other, never silently raising workload). Both null until first set.
  dailyNewTarget: integer('daily_new_target'),
  masteryGoalPct: integer('mastery_goal_pct'),
  finishBufferDays: integer('finish_buffer_days').notNull().default(0), // flashcards finish = exam − buffer
  // Questions track (self-paced): start day + finish buffer, defaults = start now / finish by exam.
  questionsStartDay: text('questions_start_day'),
  questionsFinishBufferDays: integer('questions_finish_buffer_days').notNull().default(0),
  newCardOrder: text('new_card_order').notNull().default('deck'), // 'deck' | 'shuffled' — consumed by the reviewer's new-card pick
  onboardedAt: integer('onboarded_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => [
  check('plan_settings_singleton', sql`${t.id} = 1`),
  check('plan_settings_budget_range', sql`${t.dailyBudgetMinutes} >= 0 AND ${t.dailyBudgetMinutes} <= 720`),
  check('plan_settings_goal_range', sql`${t.masteryGoalPct} IS NULL OR (${t.masteryGoalPct} >= 0 AND ${t.masteryGoalPct} <= 100)`),
  check('plan_settings_new_range', sql`${t.dailyNewTarget} IS NULL OR (${t.dailyNewTarget} >= 0 AND ${t.dailyNewTarget} <= 50)`),
  check('plan_settings_buffers_range', sql`${t.finishBufferDays} >= 0 AND ${t.finishBufferDays} <= 3650 AND ${t.questionsFinishBufferDays} >= 0 AND ${t.questionsFinishBufferDays} <= 3650`),
  check('plan_settings_order_enum', sql`${t.newCardOrder} IN ('deck','shuffled')`)
])

/** One materialized task. Regeneration replaces only `pending` rows on/after today — started /
 *  completed / skipped / expired history always survives (the ported sat-world invariant). A spaced
 *  mistake-review task is kind='questions' + refine='incorrect' (mapping straight onto qbank's
 *  existing refine option) with a null taxonomyRef. */
export const planTask = sqliteTable('plan_task', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  day: text('day').notNull(), // local dayKey the task belongs to
  kind: text('kind').notNull(), // 'flashcards' | 'questions' | 'lesson'
  taxonomyRef: text('taxonomy_ref'), // topic slug for questions/lesson; null = global (flashcards, mistake review)
  refine: text('refine'), // 'incorrect' = spaced mistake review; null = ordinary practice
  targetCount: integer('target_count').notNull(), // cards for flashcards, questions for questions, 1 for lesson
  minutes: integer('minutes').notNull(), // planner estimate (budget accounting)
  optional: integer('optional', { mode: 'boolean' }).notNull().default(false), // lessons only — budget-exempt
  status: text('status').notNull().default('pending'),
  why: text('why').notNull().default(''), // one-line rationale, composed by the pure planner
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => [
  index('plan_task_day_idx').on(t.day, t.sortOrder),
  index('plan_task_status_idx').on(t.status, t.day),
  check('plan_task_kind_enum', sql`${t.kind} IN ('flashcards','questions','lesson')`),
  check('plan_task_status_enum', sql`${t.status} IN ('pending','started','completed','skipped','expired')`)
])

/** Comfort + exclusion prefs, keyed by taxonomyRef — a DISCIPLINE key (comfort collected per
 *  discipline at onboarding, inherited by its topics) or a TOPIC slug (per-topic override).
 *  Comfort feeds planner priors ONLY — never Stats (the ported firewall). */
export const planTaxonomyPref = sqliteTable('plan_taxonomy_pref', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taxonomyRef: text('taxonomy_ref').notNull(),
  comfort: integer('comfort'), // 1–5 self-rating; null = unrated
  excluded: integer('excluded', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => [
  uniqueIndex('plan_taxonomy_pref_ref_idx').on(t.taxonomyRef),
  check('plan_taxonomy_pref_comfort_range', sql`${t.comfort} IS NULL OR (${t.comfort} >= 1 AND ${t.comfort} <= 5)`)
])

/** Durable "we already offered this lesson" marker — deliberately NOT a plan_task row, because
 *  pending tasks are rebuilt on every regeneration and the offer must survive that (the ported
 *  sat-world plan_lesson_offers reasoning). */
export const planLessonOffer = sqliteTable('plan_lesson_offer', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  lessonSlug: text('lesson_slug').notNull(),
  offeredAt: integer('offered_at', { mode: 'timestamp' }).notNull()
}, (t) => [uniqueIndex('plan_lesson_offer_slug_idx').on(t.lessonSlug)])

/** Durable "this plan day's bonus was already credited" marker (migration 0008). The `plan.day`
 *  gamification bonus fires on the FIRST full completion of a day's required tasks; un-completing
 *  and re-completing must not re-award, and task rows are rebuilt by regeneration — so the
 *  at-most-once-per-dayKey guarantee needs its own row, exactly like `plan_lesson_offer`. */
export const planDayAward = sqliteTable('plan_day_award', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  day: text('day').notNull(), // local dayKey of the completed plan day
  awardedAt: integer('awarded_at', { mode: 'timestamp' }).notNull()
}, (t) => [uniqueIndex('plan_day_award_day_idx').on(t.day)])

export type PlanSettingsRow = typeof planSettings.$inferSelect
export type PlanTaskRow = typeof planTask.$inferSelect
export type PlanTaxonomyPrefRow = typeof planTaxonomyPref.$inferSelect
export type PlanLessonOfferRow = typeof planLessonOffer.$inferSelect
