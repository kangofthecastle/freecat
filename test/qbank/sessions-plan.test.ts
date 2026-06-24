import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import type { ContentIndex, QuestionContent, PassageContent } from '../../src/main/content/types'
import { planSession, presentQuestion, summarize } from '../../src/main/qbank/sessions'
import { createSession } from '../../src/main/repositories/qbank-sessions'
import { recordAttempt } from '../../src/main/repositories/qbank-attempts'
import { toggleFlag } from '../../src/main/repositories/qbank-flags'
import type { ChoiceLetter } from '../../src/shared/dto'

const NOW = new Date('2026-06-22T12:00:00Z')

function q(id: string, over: Partial<QuestionContent> = {}): QuestionContent {
  return {
    id,
    topic: 'physics.mechanics',
    discipline: 'physics',
    section: 'chem-phys',
    tags: [{ vocab: 'aamc', code: '4A' }],
    passageId: null,
    stem: `stem ${id}`,
    choices: ['a', 'b', 'c', 'd'],
    correct: 'A',
    explanation: `why ${id}`,
    choiceExplanations: { B: 'nope' },
    ...over
  }
}

function makeIndex(): ContentIndex {
  const cpq1 = q('cp-q1')
  const cpq2 = q('cp-q2')
  const bbq1 = q('bb-q1', { topic: 'biochem.enzymes', discipline: 'biochem', section: 'bio-biochem', tags: [{ vocab: 'aamc', code: '1A' }], passageId: 'bb-p1', correct: 'B' })
  const bbq2 = q('bb-q2', { topic: 'biochem.enzymes', discipline: 'biochem', section: 'bio-biochem', tags: [{ vocab: 'aamc', code: '1A' }], passageId: 'bb-p1', correct: 'C' })
  const passage: PassageContent = {
    id: 'bb-p1',
    topic: 'biochem.enzymes',
    discipline: 'biochem',
    section: 'bio-biochem',
    passage: 'passage prose',
    questionIds: ['bb-q1', 'bb-q2']
  }
  const byId = new Map<string, QuestionContent>([
    ['cp-q1', cpq1], ['cp-q2', cpq2], ['bb-q1', bbq1], ['bb-q2', bbq2]
  ])
  return {
    byId,
    passagesById: new Map<string, PassageContent>([['bb-p1', passage]]),
    byTopic: new Map<string, string[]>([
      ['physics.mechanics', ['cp-q1', 'cp-q2']],
      ['biochem.enzymes', ['bb-q1', 'bb-q2']]
    ]),
    byDiscipline: new Map<string, string[]>([
      ['physics', ['cp-q1', 'cp-q2']],
      ['biochem', ['bb-q1', 'bb-q2']]
    ]),
    byTag: new Map<string, string[]>([
      ['aamc:4A', ['cp-q1', 'cp-q2']],
      ['aamc:1A', ['bb-q1', 'bb-q2']]
    ]),
    allQuestionIds: ['cp-q1', 'cp-q2', 'bb-q1', 'bb-q2'],
    errors: []
  }
}

// A deterministic rng that always returns 0 → Fisher–Yates keeps the original unit order.
const rng0 = () => 0

let db: DB
let index: ContentIndex
beforeEach(async () => { db = await createTestDb(); index = makeIndex() })

describe('presentQuestion', () => {
  it('returns the topic-axis shape with no answer key and flagged reflecting the set', () => {
    const flagged = new Set<string>(['cp-q1'])
    const presented = presentQuestion(q('cp-q1'), flagged)
    expect(presented).toEqual({
      id: 'cp-q1',
      topic: 'physics.mechanics',
      section: 'chem-phys',
      passageId: null,
      stem: 'stem cp-q1',
      choices: ['a', 'b', 'c', 'd'],
      flagged: true
    })
    // a clean object: no answer key, no retired AAMC fields
    expect(presented).not.toHaveProperty('correct')
    expect(presented).not.toHaveProperty('explanation')
    expect(presented).not.toHaveProperty('skill')
    expect(presented).not.toHaveProperty('contentCategory')
    // an unflagged id reflects false
    expect(presentQuestion(q('cp-q2'), flagged).flagged).toBe(false)
  })
})

describe('planSession', () => {
  it('is deterministic under a fixed rng and persists a session (mixed → all)', async () => {
    const r = await planSession(index, db, { scopeKind: 'mixed', refine: 'all', count: 2 }, { now: NOW, rng: rng0 })
    expect(r.sessionId).toBeGreaterThan(0)
    expect(r.mode).toBe('tutor')
    expect(r.questions.map((x) => x.id)).toEqual(['cp-q1', 'cp-q2'])
    expect(r.questions[0]?.topic).toBe('physics.mechanics')
    // no answer key leaks
    expect(r.questions[0]).not.toHaveProperty('correct')
    expect(r.questions[0]).not.toHaveProperty('explanation')
    expect(r.questions[0]?.choices).toHaveLength(4)
    expect(r.passages).toEqual({})
  })

  it("scope 'topic' selects only that topic's question ids", async () => {
    const r = await planSession(index, db, { scopeKind: 'topic', scopeCode: 'physics.mechanics', refine: 'all', count: 10 }, { now: NOW, rng: rng0 })
    expect(r.questions.map((x) => x.id)).toEqual(['cp-q1', 'cp-q2'])
  })

  it("scope 'discipline' selects only that discipline's question ids", async () => {
    const r = await planSession(index, db, { scopeKind: 'discipline', scopeCode: 'biochem', refine: 'all', count: 10 }, { now: NOW, rng: rng0 })
    // biochem is the passage; selecting it pulls the whole passage's ordered ids
    expect(r.questions.map((x) => x.id)).toEqual(['bb-q1', 'bb-q2'])
  })

  it('pulls a passage question whole (sibling included) even when count is 1', async () => {
    const r = await planSession(index, db, { scopeKind: 'discipline', scopeCode: 'biochem', refine: 'all', count: 1 }, { now: NOW, rng: rng0 })
    expect(r.questions.map((x) => x.id)).toEqual(['bb-q1', 'bb-q2'])
    expect(Object.keys(r.passages)).toEqual(['bb-p1'])
    expect(r.passages['bb-p1']).toEqual({ id: 'bb-p1', passage: 'passage prose' })
  })

  it("an unknown scope code yields no eligible questions", async () => {
    const r = await planSession(index, db, { scopeKind: 'topic', scopeCode: 'does.not-exist', refine: 'all', count: 10 }, { now: NOW, rng: rng0 })
    expect(r.questions).toEqual([])
  })

  it("refine:'flagged' restricts to flagged ids", async () => {
    await toggleFlag(db, 'cp-q2', NOW) // flag exactly one standalone
    const r = await planSession(index, db, { scopeKind: 'mixed', refine: 'flagged', count: 10 }, { now: NOW, rng: rng0 })
    expect(r.questions.map((x) => x.id)).toEqual(['cp-q2'])
  })
})

describe('summarize', () => {
  it('returns total/correct/rows from the session attempts', async () => {
    const session = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 2, now: NOW })
    await recordAttempt(db, {
      sessionId: session.id, questionId: 'cp-q1', passageId: null,
      topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys',
      chosen: 'A' as ChoiceLetter, isCorrect: true, now: NOW
    })
    await recordAttempt(db, {
      sessionId: session.id, questionId: 'cp-q2', passageId: null,
      topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys',
      chosen: 'B' as ChoiceLetter, isCorrect: false, now: NOW
    })
    const s = await summarize(db, session.id)
    expect(s.sessionId).toBe(session.id)
    expect(s.total).toBe(2)
    expect(s.correct).toBe(1)
    expect(s.rows).toEqual([
      { questionId: 'cp-q1', chosen: 'A', isCorrect: true },
      { questionId: 'cp-q2', chosen: 'B', isCorrect: false }
    ])
  })
})
