import { asc, eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { qbankAttempt, type QbankAttemptRow } from '../db/schema'
import type { ChoiceLetter } from '../../shared/dto'

export interface RecordAttemptParams {
  sessionId: number
  questionId: string
  passageId: string | null
  topic: string // denormalized primary topic slug
  discipline: string // denormalized discipline key
  section: string // derived MCAT section
  chosen: ChoiceLetter
  isCorrect: boolean
  timeMs?: number | null
  now: Date
}

export async function recordAttempt(db: DB, p: RecordAttemptParams): Promise<QbankAttemptRow> {
  const [row] = await db.insert(qbankAttempt).values({
    sessionId: p.sessionId,
    questionId: p.questionId,
    passageId: p.passageId,
    topic: p.topic,
    discipline: p.discipline,
    section: p.section,
    chosen: p.chosen,
    isCorrect: p.isCorrect,
    timeMs: p.timeMs ?? null,
    answeredAt: p.now
  }).returning()
  if (!row) throw new Error('recordAttempt failed to insert')
  return row
}

export async function getSessionAttempts(db: DB, sessionId: number): Promise<QbankAttemptRow[]> {
  return db.select().from(qbankAttempt)
    .where(eq(qbankAttempt.sessionId, sessionId))
    .orderBy(asc(qbankAttempt.answeredAt), asc(qbankAttempt.id))
}

/** Questions whose MOST RECENT attempt (by answeredAt, then id) was wrong. Computed in JS. */
export async function latestIncorrectQuestionIds(db: DB): Promise<string[]> {
  const rows = await db
    .select({ questionId: qbankAttempt.questionId, isCorrect: qbankAttempt.isCorrect })
    .from(qbankAttempt)
    .orderBy(asc(qbankAttempt.answeredAt), asc(qbankAttempt.id))
  // Iterating in chronological order, the last write per questionId wins.
  const latest = rows.reduce<Map<string, boolean>>((acc, r) => {
    acc.set(r.questionId, r.isCorrect)
    return acc
  }, new Map())
  return [...latest.entries()].filter(([, isCorrect]) => !isCorrect).map(([id]) => id)
}
