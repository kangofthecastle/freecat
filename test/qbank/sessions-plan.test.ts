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
// A deterministic rng that replays a fixed sequence (one draw per Fisher–Yates step).
const seqRng = (vals: number[]): (() => number) => {
  let k = 0
  return () => vals[k++] ?? 0
}

/** A single passage whose two sub-questions carry DIFFERENT AAMC tags (bb-q1=4A, bb-q2=1A).
 *  Used to pin passage-atomicity under a tag filter that matches only one sibling. */
function makeSplitTagPassageIndex(): ContentIndex {
  const bbq1 = q('bb-q1', { topic: 'biochem.enzymes', discipline: 'biochem', section: 'bio-biochem', tags: [{ vocab: 'aamc', code: '4A' }], passageId: 'bb-p1', correct: 'B' })
  const bbq2 = q('bb-q2', { topic: 'biochem.enzymes', discipline: 'biochem', section: 'bio-biochem', tags: [{ vocab: 'aamc', code: '1A' }], passageId: 'bb-p1', correct: 'C' })
  const passage: PassageContent = {
    id: 'bb-p1', topic: 'biochem.enzymes', discipline: 'biochem', section: 'bio-biochem',
    passage: 'split-tag passage', questionIds: ['bb-q1', 'bb-q2']
  }
  return {
    byId: new Map<string, QuestionContent>([['bb-q1', bbq1], ['bb-q2', bbq2]]),
    passagesById: new Map<string, PassageContent>([['bb-p1', passage]]),
    byTopic: new Map<string, string[]>([['biochem.enzymes', ['bb-q1', 'bb-q2']]]),
    byDiscipline: new Map<string, string[]>([['biochem', ['bb-q1', 'bb-q2']]]),
    // byTag reflects the split: each sibling under its own tag only.
    byTag: new Map<string, string[]>([['aamc:4A', ['bb-q1']], ['aamc:1A', ['bb-q2']]]),
    allQuestionIds: ['bb-q1', 'bb-q2'],
    errors: []
  }
}

/** Four standalone questions in a fixed first-seen order — each is its own unit, so the
 *  presented order is exactly the shuffled unit order (no passage grouping to obscure it). */
function makeFourStandaloneIndex(): ContentIndex {
  const ids = ['s1', 's2', 's3', 's4']
  const byId = new Map<string, QuestionContent>(ids.map((id) => [id, q(id)]))
  return {
    byId,
    passagesById: new Map<string, PassageContent>(),
    byTopic: new Map<string, string[]>([['physics.mechanics', [...ids]]]),
    byDiscipline: new Map<string, string[]>([['physics', [...ids]]]),
    byTag: new Map<string, string[]>([['aamc:4A', [...ids]]]),
    allQuestionIds: [...ids],
    errors: []
  }
}

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

  it('Fisher–Yates actually permutes under a fixed non-zero rng (pins j = i - floor(rng*(i+1)))', async () => {
    // Units start [s1,s2,s3,s4]. The shuffle draws once per i = 3,2,1:
    //   i=3, r=0.5 → j = 3 - floor(0.5*4)=3-2=1 → swap(3,1): [s1,s4,s3,s2]
    //   i=2, r=0.5 → j = 2 - floor(0.5*3)=2-1=1 → swap(2,1): [s1,s3,s4,s2]
    //   i=1, r=0.5 → j = 1 - floor(0.5*2)=1-1=0 → swap(1,0): [s3,s1,s4,s2]
    // Expected order: s3,s1,s4,s2 — distinct from identity (s1,s2,s3,s4), so a no-op
    // shuffle fails; and distinct from the j=floor(rng*(i+1)) off-by-one (which yields
    // s1,s4,s2,s3), so the exact index math is pinned.
    const fourIndex = makeFourStandaloneIndex()
    const r = await planSession(
      fourIndex, db,
      { scopeKind: 'mixed', refine: 'all', count: 4 },
      { now: NOW, rng: seqRng([0.5, 0.5, 0.5]) }
    )
    expect(r.questions.map((x) => x.id)).toEqual(['s3', 's1', 's4', 's2'])
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

  it("refine:'incorrect' restricts to the latest-incorrect question ids (engine wiring)", async () => {
    // Seed attempts: cp-q1 last-wrong, cp-q2 last-right → latestIncorrect = [cp-q1].
    const session = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 2, now: NOW })
    await recordAttempt(db, {
      sessionId: session.id, questionId: 'cp-q1', passageId: null,
      topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys',
      chosen: 'B' as ChoiceLetter, isCorrect: false, now: NOW
    })
    await recordAttempt(db, {
      sessionId: session.id, questionId: 'cp-q2', passageId: null,
      topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys',
      chosen: 'A' as ChoiceLetter, isCorrect: true, now: NOW
    })
    const r = await planSession(index, db, { scopeKind: 'mixed', refine: 'incorrect', count: 10 }, { now: NOW, rng: rng0 })
    // Only the last-wrong question survives the refine; the correct one is excluded.
    expect(r.questions.map((x) => x.id)).toEqual(['cp-q1'])
  })

  it('tagFilter keeps questions carrying at least one selected tag', async () => {
    // physics.mechanics questions carry aamc:4A → matching tag keeps them.
    const r = await planSession(
      index, db,
      { scopeKind: 'topic', scopeCode: 'physics.mechanics', refine: 'all', count: 10, tagFilter: [{ vocab: 'aamc', code: '4A' }] },
      { now: NOW, rng: rng0 }
    )
    expect(r.questions.map((x) => x.id)).toEqual(['cp-q1', 'cp-q2'])
  })

  it('tagFilter excludes questions lacking every selected tag', async () => {
    // physics.mechanics questions carry aamc:4A but NOT aamc:1A → filtered out.
    const r = await planSession(
      index, db,
      { scopeKind: 'topic', scopeCode: 'physics.mechanics', refine: 'all', count: 10, tagFilter: [{ vocab: 'aamc', code: '1A' }] },
      { now: NOW, rng: rng0 }
    )
    expect(r.questions).toEqual([])
  })

  it('tagFilter passes a question with ANY one of several selected tags', async () => {
    // Union semantics: cp-q* match via 4A even though they lack 1A.
    const r = await planSession(
      index, db,
      { scopeKind: 'topic', scopeCode: 'physics.mechanics', refine: 'all', count: 10, tagFilter: [{ vocab: 'aamc', code: '1A' }, { vocab: 'aamc', code: '4A' }] },
      { now: NOW, rng: rng0 }
    )
    expect(r.questions.map((x) => x.id)).toEqual(['cp-q1', 'cp-q2'])
  })

  it('an empty tagFilter is a no-op (whole scope retained)', async () => {
    const r = await planSession(
      index, db,
      { scopeKind: 'topic', scopeCode: 'physics.mechanics', refine: 'all', count: 10, tagFilter: [] },
      { now: NOW, rng: rng0 }
    )
    expect(r.questions.map((x) => x.id)).toEqual(['cp-q1', 'cp-q2'])
  })

  it('a tagFilter matching ONE passage sibling still presents the whole passage (atomicity)', async () => {
    // Passage bb-p1's two sub-questions carry DIFFERENT tags: bb-q1=4A, bb-q2=1A.
    const idx = makeSplitTagPassageIndex()
    // Filter on 1A matches only bb-q2, but the WHOLE passage rides along.
    const onlyQ2 = await planSession(
      idx, db,
      { scopeKind: 'discipline', scopeCode: 'biochem', refine: 'all', count: 10, tagFilter: [{ vocab: 'aamc', code: '1A' }] },
      { now: NOW, rng: rng0 }
    )
    expect(onlyQ2.questions.map((x) => x.id)).toEqual(['bb-q1', 'bb-q2'])
    expect(Object.keys(onlyQ2.passages)).toEqual(['bb-p1'])

    // Symmetric: filtering on 4A (matches only bb-q1) also yields the whole passage.
    const onlyQ1 = await planSession(
      idx, db,
      { scopeKind: 'discipline', scopeCode: 'biochem', refine: 'all', count: 10, tagFilter: [{ vocab: 'aamc', code: '4A' }] },
      { now: NOW, rng: rng0 }
    )
    expect(onlyQ1.questions.map((x) => x.id)).toEqual(['bb-q1', 'bb-q2'])

    // A tag matching NEITHER sibling keeps the passage out entirely.
    const neither = await planSession(
      idx, db,
      { scopeKind: 'discipline', scopeCode: 'biochem', refine: 'all', count: 10, tagFilter: [{ vocab: 'aamc', code: '7A' }] },
      { now: NOW, rng: rng0 }
    )
    expect(neither.questions).toEqual([])
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
