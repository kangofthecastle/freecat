import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import type { ContentIndex, QuestionContent } from '../../src/main/content/types'
import type { Tag } from '../../src/shared/dto'
import { createSession } from '../../src/main/repositories/qbank-sessions'
import { recordAttempt } from '../../src/main/repositories/qbank-attempts'
import { toggleFlag } from '../../src/main/repositories/qbank-flags'
import { getStatsOverview } from '../../src/main/repositories/stats'
import {
  cardScheduling, reviewLog, lessonProgress, dailyActivity,
  deckSets, decks, noteTypes, notes, cards
} from '../../src/main/db/schema'

const NOW = new Date('2026-07-17T12:00:00Z')
const TZ = 'UTC' // fixed tz so dayKeys are deterministic regardless of the test machine
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

let db: DB
beforeEach(async () => {
  db = await createTestDb()
})

function q(id: string, topic: string, discipline: string, section: string, tags: Tag[]): QuestionContent {
  return {
    id, topic, discipline: discipline as QuestionContent['discipline'], section: section as QuestionContent['section'],
    tags, passageId: null, stem: `stem ${id}`, choices: ['a', 'b', 'c', 'd'],
    correct: 'A', explanation: 'e', choiceExplanations: {}
  }
}

/** Published pool: 2 mechanics, 2 fluids, 1 enzymes. cp-2 carries two AAMC tags (double-count). */
function makeIndex(): ContentIndex {
  const byId = new Map<string, QuestionContent>([
    ['cp-1', q('cp-1', 'physics.mechanics', 'physics', 'chem-phys', [{ vocab: 'aamc', code: '4A' }, { vocab: 'kaplan', code: 'K1' }])],
    ['cp-2', q('cp-2', 'physics.mechanics', 'physics', 'chem-phys', [{ vocab: 'aamc', code: '4A' }, { vocab: 'aamc', code: '4B' }])],
    ['cp-3', q('cp-3', 'physics.fluids', 'physics', 'chem-phys', [{ vocab: 'aamc', code: '4B' }])],
    ['old-1', q('old-1', 'physics.fluids', 'physics', 'chem-phys', [])],
    ['bb-1', q('bb-1', 'biochem.enzymes', 'biochem', 'bio-biochem', [{ vocab: 'aamc', code: '1A' }])]
  ])
  const byTopic = new Map<string, string[]>([
    ['physics.mechanics', ['cp-1', 'cp-2']],
    ['physics.fluids', ['cp-3', 'old-1']],
    ['biochem.enzymes', ['bb-1']]
  ])
  return {
    byId, passagesById: new Map(), byTopic,
    byDiscipline: new Map(), byTag: new Map(),
    allQuestionIds: [...byId.keys()], errors: []
  }
}

async function seed(): Promise<void> {
  // Ancient session (outside the 60d fingerprint window; still mastery evidence, decayed).
  const s0 = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 10, now: daysAgo(70) })
  await recordAttempt(db, { sessionId: s0.id, questionId: 'old-1', passageId: null, topic: 'physics.fluids', discipline: 'physics', section: 'chem-phys', chosen: 'B', isCorrect: false, timeMs: 60_000, now: daysAgo(70) })

  // Two recent sessions so cp-2 can miss twice on the same letter (repeated distractor).
  const s1 = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 10, now: hoursAgo(2) })
  await recordAttempt(db, { sessionId: s1.id, questionId: 'cp-2', passageId: null, topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys', chosen: 'C', isCorrect: false, timeMs: 60_000, now: hoursAgo(2) })
  const s2 = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 10, now: NOW })
  await recordAttempt(db, { sessionId: s2.id, questionId: 'cp-1', passageId: null, topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys', chosen: 'A', isCorrect: true, timeMs: 60_000, now: NOW })
  await recordAttempt(db, { sessionId: s2.id, questionId: 'cp-2', passageId: null, topic: 'physics.mechanics', discipline: 'physics', section: 'chem-phys', chosen: 'C', isCorrect: false, timeMs: 60_000, now: NOW })
  await recordAttempt(db, { sessionId: s2.id, questionId: 'cp-3', passageId: null, topic: 'physics.fluids', discipline: 'physics', section: 'chem-phys', chosen: 'A', isCorrect: true, timeMs: 60_000, now: NOW })
  await recordAttempt(db, { sessionId: s2.id, questionId: 'bb-1', passageId: null, topic: 'biochem.enzymes', discipline: 'biochem', section: 'bio-biochem', chosen: 'A', isCorrect: true, timeMs: 45_000, now: NOW })

  // bb-1 is correct but flagged: unsure-correct signal + half-weight mastery evidence.
  await toggleFlag(db, 'bb-1', NOW)

  // Flashcards: minimal real chain (FKs are enforced), then two scheduled cards.
  await db.insert(deckSets).values({ id: 1, sourceFilename: 'test.apkg', sourceFormat: 'legacy2', importedAt: NOW })
  await db.insert(decks).values({ id: 1, deckSetId: 1, ankiDeckId: 1, name: 'Deck', parentDeckId: null })
  await db.insert(noteTypes).values({ id: 1, deckSetId: 1, ankiNotetypeId: 1, name: 'Basic', kind: 'standard', css: '', renderKind: 'basic' })
  await db.insert(notes).values({ id: 1, deckSetId: 1, noteTypeId: 1, ankiGuid: 'g1', fieldsJson: ['f', 'b'], tags: [], sortField: 'f' })
  await db.insert(cards).values([
    { id: 1, deckSetId: 1, noteId: 1, deckId: 1, templateOrd: 0, renderKind: 'basic', createdAt: NOW },
    { id: 2, deckSetId: 1, noteId: 1, deckId: 1, templateOrd: 1, renderKind: 'basic', createdAt: NOW }
  ])
  await db.insert(cardScheduling).values([
    { cardId: 1, deckSetId: 1, deckId: 1, state: 2, due: hoursAgo(1), stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: 2, lapses: 1, lastReviewAt: hoursAgo(1), introducedDay: '2026-07-17' },
    { cardId: 2, deckSetId: 1, deckId: 1, state: 1, due: new Date(NOW.getTime() + 30 * 3_600_000), stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 1, reps: 1, lapses: 0, lastReviewAt: NOW, introducedDay: '2026-07-10' }
  ])
  await db.insert(reviewLog).values([
    { cardId: 1, deckSetId: 1, rating: 1, stateBefore: 2, dueAfter: NOW, stabilityAfter: 1, difficultyAfter: 5, elapsedDays: 0, scheduledDays: 0, reviewedAt: NOW },
    { cardId: 1, deckSetId: 1, rating: 3, stateBefore: 2, dueAfter: NOW, stabilityAfter: 1, difficultyAfter: 5, elapsedDays: 0, scheduledDays: 1, reviewedAt: hoursAgo(1) },
    { cardId: 2, deckSetId: 1, rating: 3, stateBefore: 1, dueAfter: NOW, stabilityAfter: 1, difficultyAfter: 5, elapsedDays: 0, scheduledDays: 1, reviewedAt: daysAgo(20) }
  ])

  // A completed lesson + heatmap activity.
  await db.insert(lessonProgress).values({ lessonSlug: 'gen-chem.atomic-theory', completedAt: daysAgo(10), lastViewedAt: daysAgo(10), countedForReward: true })
  await db.insert(dailyActivity).values([
    { dayKey: '2026-07-17', count: 3 },
    { dayKey: '2026-07-10', count: 12 }
  ])
}

describe('getStatsOverview', () => {
  it('empty db renders an honest zero overview — every panel has a defined empty shape', async () => {
    const o = await getStatsOverview(db, makeIndex(), { now: NOW, tz: TZ })
    expect(o.totals).toEqual({ answered: 0, correct: 0, distinctQuestions: 0, reviews: 0, lessonsCompleted: 0 })
    expect(o.sections).toHaveLength(3)
    for (const s of o.sections) {
      expect(s.mastery.needsData).toBe(true)
      expect(s.mastery.stale).toBe(false)
    }
    expect(o.fingerprints).toEqual([])
    expect(o.pacing.every((p) => p.medianMs === null)).toBe(true)
    expect(o.effortTrend).toHaveLength(90)
    expect(o.effortTrend.every((d) => d.points === 0)).toBe(true)
    expect(o.heatmap.byDay).toEqual({})
    expect(o.aamc).toEqual([])
    expect(o.flashcards.totalCards).toBe(0)
  })

  it('assembles the full overview from seeded raw tables', async () => {
    await seed()
    const o = await getStatsOverview(db, makeIndex(), { now: NOW, tz: TZ })

    // ── totals: 6 attempt rows (cp-2 twice), 5 distinct questions ──
    expect(o.totals).toEqual({ answered: 6, correct: 3, distinctQuestions: 5, reviews: 3, lessonsCompleted: 1 })

    // ── mastery tree ──
    const cp = o.sections.find((s) => s.section === 'chem-phys')!
    const physics = cp.disciplines.find((d) => d.discipline === 'physics')!
    const mech = physics.topics.find((t) => t.topic === 'physics.mechanics')!
    const fluids = physics.topics.find((t) => t.topic === 'physics.fluids')!

    // mechanics: latest cp-1 correct (w=1) + latest cp-2 wrong (w=1) ⇒ nEff 2, mastery (1+1.5)/5 = 0.5
    expect(mech.title).toBe('Mechanics: Motion, Force, Work & Energy')
    expect(mech.mastery.nEff).toBeCloseTo(2, 5)
    expect(mech.mastery.needsData).toBe(false)
    expect(mech.mastery.mastery).toBeCloseTo(0.5, 5)
    expect(mech.mastery.coverage).toBe(1) // 2 of 2 published
    expect(mech.mastery.stale).toBe(false)

    // fluids: cp-3 correct fresh (w=1) + old-1 wrong 70d ago (w=e^(-70/21)≈0.036) ⇒ needsData
    expect(fluids.mastery.attempted).toBe(2)
    expect(fluids.mastery.needsData).toBe(true)

    // discipline rollup = union recompute: nEff sums across member topics (never an average)
    expect(physics.mastery.nEff).toBeCloseTo(mech.mastery.nEff + fluids.mastery.nEff, 5)
    expect(physics.mastery.published).toBe(4)

    // section rollup: only physics has attempts in chem-phys, so the union equals it
    expect(cp.mastery.nEff).toBeCloseTo(physics.mastery.nEff, 5)

    // flagged-correct half weight: bb-1 alone ⇒ nEff 0.5
    const bb = o.sections.find((s) => s.section === 'bio-biochem')!
    const enzymes = bb.disciplines.find((d) => d.discipline === 'biochem')!.topics.find((t) => t.topic === 'biochem.enzymes')!
    expect(enzymes.mastery.nEff).toBeCloseTo(0.5, 5)

    // ── fingerprints: cp-2 missed twice on 'C' ⇒ repeated distractor on mechanics ──
    const fpMech = o.fingerprints.find((f) => f.topic === 'physics.mechanics')!
    expect(fpMech.mode).toBe('repeated_distractor')
    expect(fpMech.discipline).toBe('physics')
    expect(fpMech.evidence).toContain('same wrong answer')
    // bb-1: correct-but-flagged surfaces as an unsure-correct row with no error mode
    const fpEnz = o.fingerprints.find((f) => f.topic === 'biochem.enzymes')!
    expect(fpEnz.mode).toBe(null)
    expect(fpEnz.unsureCorrect).toBe(1)
    // old-1's 70-day-old miss is outside the window ⇒ no fluids fingerprint
    expect(o.fingerprints.find((f) => f.topic === 'physics.fluids')).toBeUndefined()

    // ── pacing: 4 timed chem-phys attempts in window < 5 minimum ⇒ median withheld ──
    const paceCp = o.pacing.find((p) => p.section === 'chem-phys')!
    expect(paceCp.timedCount).toBe(4)
    expect(paceCp.medianMs).toBe(null)
    expect(paceCp.referenceMs).toBeGreaterThan(0)

    // ── effort trend: today = 5 recent questions ... plus 2 reviews ⇒ 15.5 points ──
    expect(o.effortTrend).toHaveLength(90)
    const today = o.effortTrend.at(-1)!
    expect(today.day).toBe('2026-07-17')
    expect(today).toMatchObject({ questions: 5, flashcardReviews: 2, lessonsCompleted: 0 })
    expect(today.points).toBeCloseTo(5 * 3 + 2 * 0.25, 10)
    const lessonDay = o.effortTrend.find((d) => d.day === '2026-07-07')!
    expect(lessonDay).toMatchObject({ lessonsCompleted: 1, points: 10 })

    // ── heatmap straight off daily_activity ──
    expect(o.heatmap.todayKey).toBe('2026-07-17')
    expect(o.heatmap.byDay['2026-07-17']).toBe(3)
    expect(o.heatmap.byDay['2026-07-10']).toBe(12)

    // ── AAMC accuracy counts every attempt row, tags double-count, non-aamc vocab excluded ──
    const a4A = o.aamc.find((a) => a.code === '4A')!
    expect(a4A).toMatchObject({ answered: 3, correct: 1 }) // cp-1 + cp-2×2
    expect(o.aamc.find((a) => a.code === 'K1')).toBeUndefined()

    // ── flashcards ──
    expect(o.flashcards.totalCards).toBe(2)
    expect(o.flashcards.dueNow).toBe(1)
    expect(o.flashcards.states).toEqual({ learning: 1, review: 1, relearning: 0 })
    expect(o.flashcards.introducedToday).toBe(1)
    expect(o.flashcards.lapsesTotal).toBe(1)
    expect(o.flashcards.againRate7d).toBeCloseTo(0.5, 10)
  })
})
