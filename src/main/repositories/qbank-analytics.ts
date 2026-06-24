import { sql, isNotNull, count } from 'drizzle-orm'
import type { DB } from '../db/client'
import { qbankAttempt } from '../db/schema'
import type { DashboardStats, SectionAccuracy, CategoryAccuracy } from '../../shared/dto'
import { latestIncorrectQuestionIds } from './qbank-attempts'
import { listFlaggedIds } from './qbank-flags'

// SUM(is_correct) over a boolean column counts the true rows; coalesce guards the empty-set NULL.
const correctExpr = sql<number>`coalesce(sum(${qbankAttempt.isCorrect}), 0)`

export async function getCounts(db: DB): Promise<{ incorrectCount: number; flaggedCount: number }> {
  const incorrect = await latestIncorrectQuestionIds(db)
  const flagged = await listFlaggedIds(db)
  return { incorrectCount: incorrect.length, flaggedCount: flagged.length }
}

export async function getDashboard(db: DB): Promise<DashboardStats> {
  const [overallRow] = await db
    .select({ answered: count(), correct: correctExpr })
    .from(qbankAttempt)
  const overall = { answered: overallRow?.answered ?? 0, correct: Number(overallRow?.correct ?? 0) }

  const sectionRows = await db
    .select({ section: qbankAttempt.section, answered: count(), correct: correctExpr })
    .from(qbankAttempt)
    .groupBy(qbankAttempt.section)
  const bySection: SectionAccuracy[] = sectionRows.map((r) => ({
    section: r.section, answered: r.answered, correct: Number(r.correct)
  }))

  const categoryRows = await db
    .select({ contentCategory: qbankAttempt.contentCategory, answered: count(), correct: correctExpr })
    .from(qbankAttempt)
    .where(isNotNull(qbankAttempt.contentCategory))
    .groupBy(qbankAttempt.contentCategory)
  const byContentCategory: CategoryAccuracy[] = categoryRows.map((r) => ({
    contentCategory: r.contentCategory ?? '', answered: r.answered, correct: Number(r.correct)
  }))

  const { incorrectCount, flaggedCount } = await getCounts(db)
  return { overall, bySection, byContentCategory, flaggedCount, incorrectCount }
}
