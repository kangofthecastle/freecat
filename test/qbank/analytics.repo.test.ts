import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { createSession } from '../../src/main/repositories/qbank-sessions'
import { recordAttempt } from '../../src/main/repositories/qbank-attempts'
import { toggleFlag } from '../../src/main/repositories/qbank-flags'
import { getAvailability } from '../../src/main/repositories/qbank-analytics'
import type { ContentIndex, QuestionContent } from '../../src/main/content/types'

// The accuracy dashboard that used to be tested here (getDashboard) moved into the Stats module —
// its aggregation behavior (totals, groupings, AAMC double-count) is covered by
// test/stats/repository.test.ts. What remains here is the composer's availability snapshot
// (which subsumed the old getCounts — incorrect/flagged totals are a fold over its rows).

const NOW = new Date('2026-06-22T12:00:00Z')
const later = (ms: number) => new Date(NOW.getTime() + ms)
let db: DB
beforeEach(async () => { db = await createTestDb() })

function q(id: string, topic: string, discipline: string, tags: QuestionContent['tags']): QuestionContent {
  return {
    id, topic, discipline: discipline as QuestionContent['discipline'], section: 'chem-phys',
    tags, passageId: null, stem: 's', choices: ['a', 'b', 'c', 'd'],
    correct: 'A', explanation: 'e', choiceExplanations: {}
  }
}

function makeIndex(): ContentIndex {
  const questions = [
    q('cp-1', 'physics.mechanics', 'physics', [{ vocab: 'aamc', code: '4A' }]),
    q('cp-2', 'physics.mechanics', 'physics', []),
    q('cp-3', 'physics.fluids', 'physics', [{ vocab: 'aamc', code: '4B' }]),
    q('bb-1', 'biochem.enzymes', 'biochem', [])
  ]
  const byId = new Map(questions.map((x) => [x.id, x]))
  return {
    byId, passagesById: new Map(), byTopic: new Map(), byDiscipline: new Map(), byTag: new Map(),
    allQuestionIds: [...byId.keys()], errors: []
  }
}

async function seedAttempts(): Promise<void> {
  const s = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 10, now: NOW })
  const sid = s.id
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-1', passageId: null, topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys', chosen: 'A', isCorrect: true, now: NOW })
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-2', passageId: null, topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys', chosen: 'B', isCorrect: false, now: later(1000) })
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-3', passageId: null, topic: 'physics.fluids', discipline: 'physics', section: 'chem-phys', chosen: 'A', isCorrect: true, now: later(2000) })
  await recordAttempt(db, { sessionId: sid, questionId: 'bb-1', passageId: null, topic: 'biochem.enzymes', discipline: 'biochem', section: 'bio-biochem', chosen: 'C', isCorrect: true, now: later(3000) })
}

describe('qbank-analytics repository', () => {
  it('getAvailability marks latest-incorrect and flagged per published question, with joined tag keys', async () => {
    await seedAttempts()
    await toggleFlag(db, 'cp-1', NOW)
    await toggleFlag(db, 'bb-1', NOW)
    const rows = await getAvailability(db, makeIndex())
    expect(rows).toHaveLength(4)
    const byId = new Map(rows.map((r) => [r.id, r]))
    // latest-incorrect: only cp-2 (cp-1/cp-3/bb-1 are correct)
    expect(rows.filter((r) => r.incorrect).map((r) => r.id)).toEqual(['cp-2'])
    expect(rows.filter((r) => r.flagged).map((r) => r.id).sort()).toEqual(['bb-1', 'cp-1'])
    expect(byId.get('cp-1')).toMatchObject({ topic: 'physics.mechanics', discipline: 'physics', tags: ['aamc:4A'] })
    expect(byId.get('cp-2')?.tags).toEqual([])
  })

  it('getAvailability on an empty db reports every question available with nothing incorrect/flagged', async () => {
    const rows = await getAvailability(db, makeIndex())
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => !r.incorrect && !r.flagged)).toBe(true)
  })
})
