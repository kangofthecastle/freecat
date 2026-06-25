import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import type { ContentIndex, QuestionContent } from '../../src/main/content/types'
import type { Tag } from '../../src/shared/dto'
import { createSession } from '../../src/main/repositories/qbank-sessions'
import { recordAttempt } from '../../src/main/repositories/qbank-attempts'
import { toggleFlag } from '../../src/main/repositories/qbank-flags'
import { getCounts, getDashboard } from '../../src/main/repositories/qbank-analytics'

const NOW = new Date('2026-06-22T12:00:00Z')
const later = (ms: number) => new Date(NOW.getTime() + ms)
let db: DB
beforeEach(async () => { db = await createTestDb() })

function q(id: string, topic: string, discipline: string, section: string, tags: Tag[]): QuestionContent {
  return {
    id, topic, discipline: discipline as QuestionContent['discipline'], section: section as QuestionContent['section'],
    tags, passageId: null, stem: `stem ${id}`, choices: ['a', 'b', 'c', 'd'],
    correct: 'A', explanation: 'e', choiceExplanations: {}
  }
}

/** Content index whose `byId` carries the AAMC tags the dashboard aggregates over.
 *  cp-2 carries TWO AAMC tags (4A + 4B) — exercises the intended double-count.
 *  cp-1 also carries a non-AAMC tag (kaplan:K1) — exercises the `vocab !== 'aamc'` guard. */
function makeIndex(): ContentIndex {
  const byId = new Map<string, QuestionContent>([
    ['cp-1', q('cp-1', 'physics.mechanics', 'physics', 'chem-phys', [{ vocab: 'aamc', code: '4A' }, { vocab: 'kaplan', code: 'K1' }])],
    ['cp-2', q('cp-2', 'physics.mechanics', 'physics', 'chem-phys', [{ vocab: 'aamc', code: '4A' }, { vocab: 'aamc', code: '4B' }])],
    ['cp-3', q('cp-3', 'physics.fluids', 'physics', 'chem-phys', [{ vocab: 'aamc', code: '4B' }])],
    ['bb-1', q('bb-1', 'biochem.enzymes', 'biochem', 'bio-biochem', [{ vocab: 'aamc', code: '1A' }])]
  ])
  return {
    byId, passagesById: new Map(),
    byTopic: new Map(), byDiscipline: new Map(), byTag: new Map(),
    allQuestionIds: [...byId.keys()], errors: []
  }
}

async function seedAttempts(): Promise<void> {
  const s = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 10, now: NOW })
  const sid = s.id
  // physics / physics.mechanics: 2 attempts, 1 correct
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-1', passageId: null, topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys', chosen: 'A', isCorrect: true, now: NOW })
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-2', passageId: null, topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys', chosen: 'B', isCorrect: false, now: later(1000) })
  // physics / physics.fluids: 1 attempt, correct
  await recordAttempt(db, { sessionId: sid, questionId: 'cp-3', passageId: null, topic: 'physics.fluids', discipline: 'physics', section: 'chem-phys', chosen: 'A', isCorrect: true, now: later(2000) })
  // biochem / biochem.enzymes: 1 attempt, correct
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

  it('getDashboard aggregates totals, by discipline, by topic, by AAMC (with double-count), and latest-incorrect', async () => {
    const index = makeIndex()
    await seedAttempts()
    await toggleFlag(db, 'cp-1', NOW)
    const d = await getDashboard(db, index)

    expect(d.totalAnswered).toBe(4)
    expect(d.totalCorrect).toBe(3)

    // --- by discipline (SQL group-by on the discipline column) ---
    const physics = d.byDiscipline.find((r) => r.discipline === 'physics')
    const biochem = d.byDiscipline.find((r) => r.discipline === 'biochem')
    expect(physics).toMatchObject({ discipline: 'physics', answered: 3, correct: 2 })
    expect(biochem).toMatchObject({ discipline: 'biochem', answered: 1, correct: 1 })
    expect(physics?.title).toBe('Physics')
    expect(biochem?.title).toBe('Biochemistry')
    expect(d.byDiscipline).toHaveLength(2)

    // --- by topic (SQL group-by on the topic column, titled via the taxonomy) ---
    const mech = d.byTopic.find((r) => r.topic === 'physics.mechanics')
    const fluids = d.byTopic.find((r) => r.topic === 'physics.fluids')
    const enzymes = d.byTopic.find((r) => r.topic === 'biochem.enzymes')
    expect(mech).toMatchObject({ topic: 'physics.mechanics', discipline: 'physics', answered: 2, correct: 1 })
    expect(fluids).toMatchObject({ topic: 'physics.fluids', discipline: 'physics', answered: 1, correct: 1 })
    expect(enzymes).toMatchObject({ topic: 'biochem.enzymes', discipline: 'biochem', answered: 1, correct: 1 })
    expect(mech?.title).toBe('Mechanics: Motion, Force, Work & Energy')
    expect(enzymes?.title).toBe('Enzymes')
    expect(d.byTopic).toHaveLength(3)

    // --- by AAMC (JS over index.byId tags); cp-2 has TWO tags → contributes to BOTH 4A and 4B ---
    const a4A = d.byAamc.find((r) => r.code === '4A')
    const a4B = d.byAamc.find((r) => r.code === '4B')
    const a1A = d.byAamc.find((r) => r.code === '1A')
    // 4A: cp-1 (correct) + cp-2 (wrong) → answered 2, correct 1
    expect(a4A).toEqual({ code: '4A', title: 'Translational motion, forces, work, energy, and equilibrium', answered: 2, correct: 1 })
    // 4B: cp-2 (wrong, its second tag) + cp-3 (correct) → answered 2, correct 1
    expect(a4B).toEqual({ code: '4B', title: 'Importance of fluids for circulation, gas movement, and gas exchange', answered: 2, correct: 1 })
    // 1A: bb-1 (correct) → answered 1, correct 1
    expect(a1A).toEqual({ code: '1A', title: 'Structure and function of proteins and their constituent amino acids', answered: 1, correct: 1 })
    expect(d.byAamc).toHaveLength(3)
    // non-AAMC vocab guard: cp-1's kaplan:K1 tag is NOT bucketed (only vocab 'aamc' counts).
    expect(d.byAamc.find((r) => r.code === 'K1')).toBeUndefined()
    expect(d.byAamc.some((r) => r.title === 'kaplan:K1')).toBe(false)
    // documented double-count: the four attempts' tag occurrences sum to 5 (cp-2 counted twice,
    // and cp-1's kaplan tag excluded — otherwise this would be 6).
    expect(d.byAamc.reduce((n, r) => n + r.answered, 0)).toBe(5)

    // latestIncorrectQuestionIds unchanged: only cp-2 was last-wrong
    expect(d.latestIncorrectQuestionIds).toEqual(['cp-2'])
  })

  it('getDashboard on an empty db returns zeros and empty groups', async () => {
    const d = await getDashboard(db, makeIndex())
    expect(d.totalAnswered).toBe(0)
    expect(d.totalCorrect).toBe(0)
    expect(d.byDiscipline).toEqual([])
    expect(d.byTopic).toEqual([])
    expect(d.byAamc).toEqual([])
    expect(d.latestIncorrectQuestionIds).toEqual([])
  })
})
