import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import type { ContentIndex, PassageContent, QuestionContent, Difficulty } from '../../src/main/content/types'
import { planDiagnosticSession } from '../../src/main/qbank/sessions'
import { getSession } from '../../src/main/repositories/qbank-sessions'
import { DIAGNOSTIC_CONFIG } from '../../src/shared/qbank/diagnostic'
import { DISCIPLINES } from '../../src/main/db/seed/taxonomy-data'
import type { DisciplineKey } from '../../src/shared/dto'

const NOW = new Date('2026-07-17T12:00:00Z')
// Constant-0 rng ⇒ every Fisher–Yates is the identity permutation (repo-wide convention).
const rng0 = (): number => 0

function q(
  id: string,
  discipline: DisciplineKey,
  topic: string,
  over: Partial<QuestionContent> = {}
): QuestionContent {
  return {
    id,
    topic,
    discipline,
    section: 'chem-phys',
    tags: [],
    difficulty: 'medium' as Difficulty,
    passageId: null,
    stem: `stem ${id}`,
    choices: ['a', 'b', 'c', 'd'],
    correct: 'A',
    explanation: 'e',
    choiceExplanations: {},
    ...over
  }
}

/** Assemble a ContentIndex from explicit questions/passages (same shape the loader builds). */
function makeIndex(questions: QuestionContent[], passages: PassageContent[] = []): ContentIndex {
  const byId = new Map(questions.map((x) => [x.id, x]))
  const byTopic = new Map<string, string[]>()
  const byDiscipline = new Map<string, string[]>()
  for (const x of questions) {
    byTopic.set(x.topic, [...(byTopic.get(x.topic) ?? []), x.id])
    byDiscipline.set(x.discipline, [...(byDiscipline.get(x.discipline) ?? []), x.id])
  }
  return {
    byId,
    passagesById: new Map(passages.map((p) => [p.id, p])),
    byTopic,
    byDiscipline,
    byTag: new Map(),
    allQuestionIds: questions.map((x) => x.id),
    errors: []
  }
}

let db: DB
beforeEach(async () => {
  db = await createTestDb()
})

describe('planDiagnosticSession', () => {
  it('hits the target with a spread across every discipline, capped per discipline, mode persisted', async () => {
    // 4 medium standalones in each of the 6 disciplines (24 total).
    const questions = DISCIPLINES.flatMap((d) =>
      [1, 2, 3, 4].map((n) => q(`${d.slug}-${n}`, d.slug, `${d.slug}.topic`))
    )
    const result = await planDiagnosticSession(makeIndex(questions), db, { now: NOW, rng: rng0 })

    expect(result.mode).toBe('diagnostic')
    expect(result.questions).toHaveLength(DIAGNOSTIC_CONFIG.targetTotal)
    const perDiscipline = new Map<string, number>()
    for (const question of result.questions) {
      const d = question.id.slice(0, question.id.lastIndexOf('-'))
      perDiscipline.set(d, (perDiscipline.get(d) ?? 0) + 1)
    }
    // Round-robin: every discipline contributes, none past the cap.
    expect(perDiscipline.size).toBe(DISCIPLINES.length)
    for (const n of perDiscipline.values()) {
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(DIAGNOSTIC_CONFIG.perDisciplineCap)
    }

    const row = await getSession(db, result.sessionId)
    expect(row).toMatchObject({
      mode: 'diagnostic',
      scopeKind: 'mixed',
      scopeCode: null,
      refine: 'all',
      requestedCount: DIAGNOSTIC_CONFIG.targetTotal
    })
  })

  it('prefers mid-difficulty questions before easy/hard ones', async () => {
    const questions = [
      q('physics-e1', 'physics', 'physics.mechanics', { difficulty: 'easy' }),
      q('physics-e2', 'physics', 'physics.mechanics', { difficulty: 'easy' }),
      q('physics-m1', 'physics', 'physics.mechanics'),
      q('physics-m2', 'physics', 'physics.fluids'),
      q('physics-m3', 'physics', 'physics.fluids'),
      q('physics-h1', 'physics', 'physics.fluids', { difficulty: 'hard' })
    ]
    const result = await planDiagnosticSession(makeIndex(questions), db, { now: NOW, rng: rng0 })
    // Only physics has content; cap 3 ⇒ exactly the three mediums, none of the easy/hard.
    expect(result.questions.map((x) => x.id).sort()).toEqual(['physics-m1', 'physics-m2', 'physics-m3'])
  })

  it('spreads picks across topics within a discipline (round-robin, not depth-first)', async () => {
    const questions = [
      q('physics-a1', 'physics', 'physics.mechanics'),
      q('physics-a2', 'physics', 'physics.mechanics'),
      q('physics-a3', 'physics', 'physics.mechanics'),
      q('physics-b1', 'physics', 'physics.fluids')
    ]
    const result = await planDiagnosticSession(makeIndex(questions), db, { now: NOW, rng: rng0 })
    // Cap 3 with 2 topics available ⇒ the single fluids question must be among the picks.
    expect(result.questions.map((x) => x.topic)).toContain('physics.fluids')
  })

  it('degrades gracefully on a thin bank — takes whatever exists, never blocks', async () => {
    const questions = [q('biochem-1', 'biochem', 'biochem.enzymes'), q('biochem-2', 'biochem', 'biochem.enzymes')]
    const result = await planDiagnosticSession(makeIndex(questions), db, { now: NOW, rng: rng0 })
    expect(result.questions).toHaveLength(2)
  })

  it('an empty bank still records the session row and returns zero questions', async () => {
    const result = await planDiagnosticSession(makeIndex([]), db, { now: NOW, rng: rng0 })
    expect(result.questions).toHaveLength(0)
    expect((await getSession(db, result.sessionId))?.mode).toBe('diagnostic')
  })

  it('falls back to a WHOLE passage when a discipline has no standalone questions (atomicity)', async () => {
    const sub = (n: number): QuestionContent =>
      q(`bio-p${n}`, 'biology', 'biology.cells', { passageId: 'bio-pass-1' })
    const passage: PassageContent = {
      id: 'bio-pass-1',
      topic: 'biology.cells',
      discipline: 'biology',
      section: 'bio-biochem',
      passage: 'prose',
      questionIds: ['bio-p1', 'bio-p2', 'bio-p3', 'bio-p4']
    }
    const result = await planDiagnosticSession(
      makeIndex([sub(1), sub(2), sub(3), sub(4)], [passage]),
      db,
      { now: NOW, rng: rng0 }
    )
    // All four siblings ride along (overshooting the per-discipline cap of 3 — atomicity wins)…
    expect(result.questions.map((x) => x.id)).toEqual(['bio-p1', 'bio-p2', 'bio-p3', 'bio-p4'])
    // …and the passage prose ships with them.
    expect(result.passages['bio-pass-1']).toBeTruthy()
  })

  it('prefers standalones over passages when both exist in a discipline', async () => {
    const standalone = [1, 2, 3].map((n) => q(`o-chem-s${n}`, 'o-chem', 'o-chem.reactions'))
    const sub = q('o-chem-p1', 'o-chem', 'o-chem.reactions', { passageId: 'oc-pass' })
    const passage: PassageContent = {
      id: 'oc-pass',
      topic: 'o-chem.reactions',
      discipline: 'o-chem',
      section: 'chem-phys',
      passage: 'prose',
      questionIds: ['o-chem-p1']
    }
    const result = await planDiagnosticSession(makeIndex([...standalone, sub], [passage]), db, {
      now: NOW,
      rng: rng0
    })
    // Cap 3 filled entirely by standalones; the passage never gets pulled in.
    expect(result.questions.map((x) => x.id).sort()).toEqual(['o-chem-s1', 'o-chem-s2', 'o-chem-s3'])
    expect(result.passages).toEqual({})
  })
})
