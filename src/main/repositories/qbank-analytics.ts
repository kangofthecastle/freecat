import type { DB } from '../db/client'
import { latestIncorrectQuestionIds } from './qbank-attempts'
import { listFlaggedIds } from './qbank-flags'

// The accuracy dashboard that used to live here (getDashboard) moved into the Stats module
// (src/main/repositories/stats.ts) when Stats absorbed the qbank Dashboard — one analytics
// surface, not two. What remains is session-composer material, not analytics.

/** Counts backing the composer's refine options (practice incorrect / flagged). */
export async function getCounts(db: DB): Promise<{ incorrectCount: number; flaggedCount: number }> {
  const incorrect = await latestIncorrectQuestionIds(db)
  const flagged = await listFlaggedIds(db)
  return { incorrectCount: incorrect.length, flaggedCount: flagged.length }
}
