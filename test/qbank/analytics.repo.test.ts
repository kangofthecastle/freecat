import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { createSession } from '../../src/main/repositories/qbank-sessions'
import { recordAttempt } from '../../src/main/repositories/qbank-attempts'
import { toggleFlag } from '../../src/main/repositories/qbank-flags'
import { getCounts } from '../../src/main/repositories/qbank-analytics'

// The accuracy dashboard that used to be tested here (getDashboard) moved into the Stats module —
// its aggregation behavior (totals, groupings, AAMC double-count) is covered by
// test/stats/repository.test.ts. What remains here is the composer-count query.

const NOW = new Date('2026-06-22T12:00:00Z')
const later = (ms: number) => new Date(NOW.getTime() + ms)
let db: DB
beforeEach(async () => { db = await createTestDb() })

async function seedAttempts(): Promise<void> {
  const s = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 10, now: NOW })
  const sid = s.id
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-1', passageId: null, topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys', chosen: 'A', isCorrect: true, now: NOW })
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-2', passageId: null, topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys', chosen: 'B', isCorrect: false, now: later(1000) })
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-3', passageId: null, topic: 'physics.fluids', discipline: 'physics', section: 'chem-phys', chosen: 'A', isCorrect: true, now: later(2000) })
  await recordAttempt(db, { sessionId: sid, questionId: 'bb-1', passageId: null, topic: 'biochem.enzymes', discipline: 'biochem', section: 'bio-biochem', chosen: 'C', isCorrect: true, now: later(3000) })
}

describe('qbank-analytics repository', () => {
  it('getCounts reports latest-incorrect and flagged counts', async () => {
    await seedAttempts()
    await toggleFlag(db, 'cp-1', NOW)
    await toggleFlag(db, 'bb-1', NOW)
    const counts = await getCounts(db)
    // latest-incorrect: only cp-2 (cp-1/cp-3/bb-1 are correct)
    expect(counts.incorrectCount).toBe(1)
    expect(counts.flaggedCount).toBe(2)
  })

  it('getCounts on an empty db returns zeros', async () => {
    const counts = await getCounts(db)
    expect(counts.incorrectCount).toBe(0)
    expect(counts.flaggedCount).toBe(0)
  })
})
