import type { DB } from '../db/client'
import type { ContentIndex } from '../content/types'
import type { AvailabilityQuestionDto } from '../../shared/dto'
import { latestIncorrectQuestionIds } from './qbank-attempts'
import { listFlaggedIds } from './qbank-flags'

// The accuracy dashboard that used to live here (getDashboard) moved into the Stats module
// (src/main/repositories/stats.ts) when Stats absorbed the qbank Dashboard — one analytics
// surface, not two. What remains is session-composer material, not analytics.

/**
 * The composer's availability snapshot: one row per published question with exactly the facts the
 * eligibility filter in `planSession` uses (scope keys, tag keys, latest-incorrect, flagged). The
 * renderer counts matches for any scope × refine × tag combination with pure client arithmetic —
 * the sat-world composer pattern: one snapshot at load, zero round-trips per control change, and
 * the user can never compose a session that Start will refuse.
 *
 * (Subsumes the old `getCounts` — incorrect/flagged totals are one fold over these rows.)
 */
export async function getAvailability(db: DB, index: ContentIndex): Promise<AvailabilityQuestionDto[]> {
  const [incorrect, flagged] = await Promise.all([latestIncorrectQuestionIds(db), listFlaggedIds(db)])
  const incorrectSet = new Set(incorrect)
  const flaggedSet = new Set(flagged)
  return index.allQuestionIds.flatMap((id) => {
    const q = index.byId.get(id)
    if (!q) return []
    return [{
      id,
      topic: q.topic,
      discipline: q.discipline,
      tags: q.tags.map((t) => `${t.vocab}:${t.code}`),
      incorrect: incorrectSet.has(id),
      flagged: flaggedSet.has(id)
    }]
  })
}
