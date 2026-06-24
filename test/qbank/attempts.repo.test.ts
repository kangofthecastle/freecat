import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { createSession } from '../../src/main/repositories/qbank-sessions'
import { recordAttempt, getSessionAttempts, latestIncorrectQuestionIds } from '../../src/main/repositories/qbank-attempts'

const NOW = new Date('2026-06-22T12:00:00Z')
const later = (ms: number) => new Date(NOW.getTime() + ms)
let db: DB
beforeEach(async () => { db = await createTestDb() })

async function newSession(): Promise<number> {
  const s = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 10, now: NOW })
  return s.id
}

describe('qbank-attempts repository', () => {
  it('recordAttempt round-trips with denormalized section/contentCategory/skill', async () => {
    const sessionId = await newSession()
    const a = await recordAttempt(db, {
      sessionId, questionId: 'cp-1', passageId: null,
      section: 'chem-phys', contentCategory: '4A', skill: null,
      chosen: 'A', isCorrect: true, timeMs: 4200, now: NOW
    })
    expect(a.id).toBeGreaterThan(0)
    expect(a.sessionId).toBe(sessionId)
    expect(a.questionId).toBe('cp-1')
    expect(a.passageId).toBeNull()
    expect(a.section).toBe('chem-phys')
    expect(a.contentCategory).toBe('4A')
    expect(a.skill).toBeNull()
    expect(a.chosen).toBe('A')
    expect(a.isCorrect).toBe(true)
    expect(a.timeMs).toBe(4200)
    expect(a.answeredAt.getTime()).toBe(NOW.getTime())
  })

  it('recordAttempt stores a CARS attempt with skill set and contentCategory null; timeMs optional', async () => {
    const sessionId = await newSession()
    const a = await recordAttempt(db, {
      sessionId, questionId: 'cars-1', passageId: 'cars-p1',
      section: 'cars', contentCategory: null, skill: 'reasoning-within-text',
      chosen: 'C', isCorrect: false, now: NOW
    })
    expect(a.passageId).toBe('cars-p1')
    expect(a.skill).toBe('reasoning-within-text')
    expect(a.contentCategory).toBeNull()
    expect(a.timeMs).toBeNull()
  })

  it('getSessionAttempts returns only that session\'s attempts', async () => {
    const s1 = await newSession()
    const s2 = await newSession()
    await recordAttempt(db, { sessionId: s1, questionId: 'q1', passageId: null, section: 'bio-biochem', contentCategory: '1A', skill: null, chosen: 'A', isCorrect: true, now: NOW })
    await recordAttempt(db, { sessionId: s2, questionId: 'q2', passageId: null, section: 'bio-biochem', contentCategory: '1A', skill: null, chosen: 'B', isCorrect: false, now: NOW })
    const a1 = await getSessionAttempts(db, s1)
    expect(a1).toHaveLength(1)
    expect(a1[0]?.questionId).toBe('q1')
  })

  it('latestIncorrectQuestionIds: wrong-then-right is excluded; wrong-only is included', async () => {
    const sessionId = await newSession()
    // q-fixed: wrong first, then right later → NOT incorrect
    await recordAttempt(db, { sessionId, questionId: 'q-fixed', passageId: null, section: 'psych-soc', contentCategory: '6A', skill: null, chosen: 'B', isCorrect: false, now: NOW })
    await recordAttempt(db, { sessionId, questionId: 'q-fixed', passageId: null, section: 'psych-soc', contentCategory: '6A', skill: null, chosen: 'A', isCorrect: true, now: later(1000) })
    // q-wrong: only ever wrong → incorrect
    await recordAttempt(db, { sessionId, questionId: 'q-wrong', passageId: null, section: 'psych-soc', contentCategory: '6A', skill: null, chosen: 'D', isCorrect: false, now: later(2000) })
    // q-right: only ever right → NOT incorrect
    await recordAttempt(db, { sessionId, questionId: 'q-right', passageId: null, section: 'psych-soc', contentCategory: '6A', skill: null, chosen: 'A', isCorrect: true, now: later(3000) })
    const ids = await latestIncorrectQuestionIds(db)
    expect(ids).toContain('q-wrong')
    expect(ids).not.toContain('q-fixed')
    expect(ids).not.toContain('q-right')
  })

  it('latestIncorrectQuestionIds: right-then-wrong is included (most-recent wins)', async () => {
    const sessionId = await newSession()
    await recordAttempt(db, { sessionId, questionId: 'q-regress', passageId: null, section: 'chem-phys', contentCategory: '4A', skill: null, chosen: 'A', isCorrect: true, now: NOW })
    await recordAttempt(db, { sessionId, questionId: 'q-regress', passageId: null, section: 'chem-phys', contentCategory: '4A', skill: null, chosen: 'B', isCorrect: false, now: later(1000) })
    expect(await latestIncorrectQuestionIds(db)).toContain('q-regress')
  })
})
