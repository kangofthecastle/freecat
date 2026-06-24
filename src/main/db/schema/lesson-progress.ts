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
