import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { createSession } from '../../src/main/repositories/qbank-sessions'
import { recordAttempt } from '../../src/main/repositories/qbank-attempts'
import { toggleFlag } from '../../src/main/repositories/qbank-flags'
import { getCounts, getDashboard } from '../../src/main/repositories/qbank-analytics'

const NOW = new Date('2026-06-22T12:00:00Z')
const later = (ms: number) => new Date(NOW.getTime() + ms)
let db: DB
beforeEach(async () => { db = await createTestDb() })

async function seedAttempts(): Promise<void> {
  const s = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 10, now: NOW })
  const sid = s.id
  // chem-phys / 4A: 2 attempts, 1 correct
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-1', passageId: null, section: 'chem-phys', contentCategory: '4A', skill: null, chosen: 'A', isCorrect: true, now: NOW })
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-2', passageId: null, section: 'chem-phys', contentCategory: '4A', skill: null, chosen: 'B', isCorrect: false, now: later(1000) })
  // bio-biochem / 1A: 1 attempt, correct
  await recordAttempt(db, { sessionId: sid, questionId: 'bb-1', passageId: null, section: 'bio-biochem', contentCategory: '1A', skill: null, chosen: 'C', isCorrect: true, now: later(2000) })
  // cars (skill, no contentCategory): 1 attempt, wrong
  await recordAttempt(db, { sessionId: sid, questionId: 'cars-1', passageId: 'cars-p1', section: 'cars', contentCategory: null, skill: 'reasoning-within-text', chosen: 'D', isCorrect: false, now: later(3000) })
}

describe('qbank-analytics repository', () => {
  it('getCounts reports latest-incorrect and flagged counts', async () => {
    await seedAttempts()
    await toggleFlag(db, 'cp-1', NOW)
    await toggleFlag(db, 'bb-1', NOW)
    const counts = await getCounts(db)
    // latest-incorrect: cp-2 and cars-1 (cp-1/bb-1 are correct)
    expect(counts.incorrectCount).toBe(2)
    expect(counts.flaggedCount).toBe(2)
  })

  it('getDashboard aggregates overall, by section, by content category, plus counts', async () => {
    await seedAttempts()
    await toggleFlag(db, 'cars-1', NOW)
    const d = await getDashboard(db)

    expect(d.overall).toEqual({ answered: 4, correct: 2 })

    const cp = d.bySection.find((r) => r.section === 'chem-phys')
    const bb = d.bySection.find((r) => r.section === 'bio-biochem')
    const cars = d.bySection.find((r) => r.section === 'cars')
    expect(cp).toEqual({ section: 'chem-phys', answered: 2, correct: 1 })
    expect(bb).toEqual({ section: 'bio-biochem', answered: 1, correct: 1 })
    expect(cars).toEqual({ section: 'cars', answered: 1, correct: 0 })

    // content_category groups exclude the CARS (null) attempt
    const cc4a = d.byContentCategory.find((r) => r.contentCategory === '4A')
    const cc1a = d.byContentCategory.find((r) => r.contentCategory === '1A')
    expect(cc4a).toEqual({ contentCategory: '4A', answered: 2, correct: 1 })
    expect(cc1a).toEqual({ contentCategory: '1A', answered: 1, correct: 1 })
    expect(d.byContentCategory).toHaveLength(2) // null content_category is not a group

    expect(d.flaggedCount).toBe(1)
    expect(d.incorrectCount).toBe(2) // cp-2 + cars-1
  })

  it('getDashboard on an empty db returns zeros and empty groups', async () => {
    const d = await getDashboard(db)
    expect(d.overall).toEqual({ answered: 0, correct: 0 })
    expect(d.bySection).toEqual([])
    expect(d.byContentCategory).toEqual([])
    expect(d.flaggedCount).toBe(0)
    expect(d.incorrectCount).toBe(0)
  })
})
