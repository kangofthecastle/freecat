import { describe, it, expect, beforeEach, vi } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import type { ContentIndex, QuestionContent, PassageContent } from '../../src/main/content/types'
import { gradeAndRecord, type RecordActivityFn } from '../../src/main/qbank/sessions'
import { createSession } from '../../src/main/repositories/qbank-sessions'
import { getSessionAttempts } from '../../src/main/repositories/qbank-attempts'
import type { ActivityResult, ServiceResult } from '../../src/shared/dto'
import { ok } from '../../src/shared/dto'

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
    choiceExplanations: { B: 'B is wrong', C: 'C is wrong' },
    ...over
  }
}

function makeIndex(): ContentIndex {
  const byId = new Map<string, QuestionContent>([
    ['cp-q1', q('cp-q1')],
    ['bb-q1', q('bb-q1', { topic: 'biochem.enzymes', discipline: 'biochem', section: 'bio-biochem', tags: [{ vocab: 'aamc', code: '1A' }], passageId: 'bb-p1', correct: 'C' })]
  ])
  const passage: PassageContent = { id: 'bb-p1', topic: 'biochem.enzymes', discipline: 'biochem', section: 'bio-biochem', passage: 'prose', questionIds: ['bb-q1'] }
  return {
    byId,
    passagesById: new Map<string, PassageContent>([['bb-p1', passage]]),
    byTopic: new Map<string, string[]>([['physics.mechanics', ['cp-q1']], ['biochem.enzymes', ['bb-q1']]]),
    byDiscipline: new Map<string, string[]>([['physics', ['cp-q1']], ['biochem', ['bb-q1']]]),
    byTag: new Map<string, string[]>([['aamc:4A', ['cp-q1']], ['aamc:1A', ['bb-q1']]]),
    allQuestionIds: ['cp-q1', 'bb-q1'],
    errors: []
  }
}

const ACTIVITY: ActivityResult = { streak: 1, daily: { count: 1, goal: 30, met: false }, eggBecameReady: false, goalJustMet: false }
// recordActivity's signature is (db, params), so the params live at mock.calls[i][1].
const fakeRecord = vi.fn(async (..._args: Parameters<RecordActivityFn>): Promise<ServiceResult<ActivityResult>> => ok(ACTIVITY))

let db: DB
let index: ContentIndex
let sessionId: number
beforeEach(async () => {
  db = await createTestDb()
  index = makeIndex()
  fakeRecord.mockClear()
  const s = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 2, now: NOW })
  sessionId = s.id
})

describe('gradeAndRecord', () => {
  it('records a correct attempt (denormalized topic/discipline) and returns the answer key + activity', async () => {
    const r = await gradeAndRecord(index, db, { sessionId, questionId: 'cp-q1', choice: 'A', timeMs: 1500 },
      { now: NOW, recordActivityFn: fakeRecord })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.correct).toBe(true)
    expect(r.data.correctChoice).toBe('A')
    expect(r.data.explanation).toBe('why cp-q1')
    expect(r.data.choiceExplanations).toEqual({ B: 'B is wrong', C: 'C is wrong' })
    expect(r.data.activity).toEqual(ACTIVITY)

    // attempt persisted with denormalized taxonomy fields
    const [att] = await getSessionAttempts(db, sessionId)
    expect(att?.questionId).toBe('cp-q1')
    expect(att?.passageId).toBeNull()
    expect(att?.topic).toBe('physics.mechanics')
    expect(att?.discipline).toBe('physics')
    expect(att?.section).toBe('chem-phys')
    expect(att?.chosen).toBe('A')
    expect(att?.isCorrect).toBe(true)
    expect(att?.timeMs).toBe(1500)

    // gamification fired with the question's topic as taxonomyRef
    expect(fakeRecord).toHaveBeenCalledTimes(1)
    expect(fakeRecord.mock.calls[0]?.[1]).toMatchObject({ kind: 'qbank.answer', taxonomyRef: 'physics.mechanics', now: NOW })
    expect(fakeRecord.mock.calls[0]?.[1].taxonomyRef).toBe('physics.mechanics')
  })

  it('uses the question topic as taxonomyRef and denormalizes passageId for a passage question', async () => {
    const r = await gradeAndRecord(index, db, { sessionId, questionId: 'bb-q1', choice: 'C' },
      { now: NOW, recordActivityFn: fakeRecord })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.correct).toBe(true)
    const [att] = await getSessionAttempts(db, sessionId)
    expect(att?.passageId).toBe('bb-p1')
    expect(att?.topic).toBe('biochem.enzymes')
    expect(att?.discipline).toBe('biochem')
    expect(att?.section).toBe('bio-biochem')
    expect(fakeRecord.mock.calls[0]?.[1].taxonomyRef).toBe('biochem.enzymes')
  })

  it('returns correct:false for a wrong choice', async () => {
    const r = await gradeAndRecord(index, db, { sessionId, questionId: 'cp-q1', choice: 'B' },
      { now: NOW, recordActivityFn: fakeRecord })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.correct).toBe(false)
    expect(r.data.correctChoice).toBe('A')
  })

  it('returns err(not-found) for an unknown question id (no attempt, no activity)', async () => {
    const r = await gradeAndRecord(index, db, { sessionId, questionId: 'nope', choice: 'A' },
      { now: NOW, recordActivityFn: fakeRecord })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe('not-found')
    expect(await getSessionAttempts(db, sessionId)).toHaveLength(0)
    expect(fakeRecord).not.toHaveBeenCalled()
  })

  it('still returns ok with activity:null when recordActivityFn throws (gamification failure swallowed)', async () => {
    const throwing = vi.fn(async (..._args: Parameters<RecordActivityFn>): Promise<ServiceResult<ActivityResult>> => { throw new Error('boom') })
    const r = await gradeAndRecord(index, db, { sessionId, questionId: 'cp-q1', choice: 'A' },
      { now: NOW, recordActivityFn: throwing })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.correct).toBe(true)
    expect(r.data.activity).toBeNull()
    // the attempt is still recorded (gamification is a side-effect, not part of attempt atomicity)
    expect(await getSessionAttempts(db, sessionId)).toHaveLength(1)
  })

  it('returns activity:null when recordActivityFn returns a non-ok result', async () => {
    const notOk = vi.fn(async (..._args: Parameters<RecordActivityFn>): Promise<ServiceResult<ActivityResult>> => ({ ok: false, error: 'invalid' }))
    const r = await gradeAndRecord(index, db, { sessionId, questionId: 'cp-q1', choice: 'A' },
      { now: NOW, recordActivityFn: notOk })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.activity).toBeNull()
  })

  it('does not re-award gamification on a replayed submit for the same (session, question)', async () => {
    await gradeAndRecord(index, db, { sessionId, questionId: 'cp-q1', choice: 'A' }, { now: NOW, recordActivityFn: fakeRecord })
    // A replayed/duplicate submit upserts the attempt (still one row) but must NOT credit activity again.
    const second = await gradeAndRecord(index, db, { sessionId, questionId: 'cp-q1', choice: 'B' }, { now: NOW, recordActivityFn: fakeRecord })
    expect(second.ok).toBe(true)
    expect(await getSessionAttempts(db, sessionId)).toHaveLength(1)
    expect(fakeRecord).toHaveBeenCalledTimes(1)
  })
})
