import { sqliteTable, integer, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
import type { ChoiceLetter } from '../../../shared/dto'

// A composed practice session. `mode` is 'tutor' for v1; a timed block drops in later with no migration.
export const qbankSession = sqliteTable('qbank_session', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mode: text('mode').notNull().default('tutor'), // 'tutor' | 'timed' (future)
  scopeKind: text('scope_kind').notNull(), // 'mixed' | 'discipline' | 'topic'
  scopeCode: text('scope_code'), // topic slug or discipline key when scoped, else null
  refine: text('refine').notNull().default('all'), // 'all' | 'incorrect' | 'flagged'
  requestedCount: integer('requested_count').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' })
})

// One graded answer. Taxonomy tags are denormalized at answer time so the dashboard is pure SQL.
export const qbankAttempt = sqliteTable('qbank_attempt', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id').notNull().references(() => qbankSession.id),
  questionId: text('question_id').notNull(),
  passageId: text('passage_id'), // null for standalone
  topic: text('topic').notNull(), // denormalized primary topic slug
  discipline: text('discipline').notNull(), // denormalized discipline key
  section: text('section').notNull(), // denormalized for SQL analytics
  chosen: text('chosen').$type<ChoiceLetter>().notNull(), // 'A'..'D'
  isCorrect: integer('is_correct', { mode: 'boolean' }).notNull(),
  timeMs: integer('time_ms'),
  answeredAt: integer('answered_at', { mode: 'timestamp' }).notNull()
}, (t) => [
  index('qbank_attempt_session_idx').on(t.sessionId),
  index('qbank_attempt_question_idx').on(t.questionId),
  index('qbank_attempt_section_idx').on(t.section),
  index('qbank_attempt_topic_idx').on(t.topic),
  index('qbank_attempt_discipline_idx').on(t.discipline)
])

// A per-question flag toggle (one row per flagged question).
export const qbankFlag = sqliteTable('qbank_flag', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionId: text('question_id').notNull(),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
}, (t) => [uniqueIndex('qbank_flag_question_idx').on(t.questionId)])

export type QbankSessionRow = typeof qbankSession.$inferSelect
export type QbankAttemptRow = typeof qbankAttempt.$inferSelect
export type QbankFlagRow = typeof qbankFlag.$inferSelect
