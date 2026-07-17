import { describe, expect, test } from 'vitest'
import {
  priority, eligibleMistakes, materializeDay, whyLine,
  type PlanTopic, type MistakeCandidate, type MaterializeDayInput
} from '../../src/main/plan/planner'
import { PLAN_CONFIG, examWeight } from '../../src/main/plan/config'

const topic = (over: Partial<PlanTopic> = {}): PlanTopic => ({
  topic: 'physics.mechanics',
  title: 'Mechanics',
  discipline: 'physics',
  disciplineTitle: 'Physics',
  mastery: 0.5,
  needsData: false,
  stale: false,
  coverage: 0.5,
  publishedCount: 20,
  dominantMode: null,
  lessonAvailable: false,
  lessonCompleted: false,
  ...over
})

const dayInput = (over: Partial<MaterializeDayInput> = {}): MaterializeDayInput => ({
  day: '2026-07-17',
  budgetMinutes: 60,
  topics: [],
  dueCardCount: 0,
  newCardCount: 0,
  mistakeCandidates: [],
  questionsStarted: true,
  behindPace: false,
  ...over
})

describe('examWeight', () => {
  test('sums to 1.0 across all disciplines (comparable priorities everywhere)', () => {
    const total = ['gen-chem', 'o-chem', 'physics', 'biology', 'biochem', 'behavioral-sci']
      .map(examWeight)
      .reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  test('unknown discipline gets the faint fallback, not zero', () => {
    expect(examWeight('astrology')).toBe(PLAN_CONFIG.examWeightFallback)
  })
})

describe('priority (ported formula)', () => {
  test('hand-computed: weak topic = examWeight × (1 − mastery), no boosts', () => {
    const t = topic({ mastery: 0.3, coverage: 0.5 })
    expect(priority(t)).toBeCloseTo(examWeight('physics') * 0.7, 12)
  })

  test('needs-data need is comfort-aware: comfort 1 studies sooner than comfort 5', () => {
    const low = priority(topic({ needsData: true, coverage: 0.5, comfort: 1 }))
    const high = priority(topic({ needsData: true, coverage: 0.5, comfort: 5 }))
    const unrated = priority(topic({ needsData: true, coverage: 0.5 }))
    expect(low).toBeGreaterThan(unrated)
    expect(high).toBeLessThan(unrated)
    expect(unrated).toBeCloseTo(examWeight('physics') * PLAN_CONFIG.needsDataNeed, 12)
  })

  test('staleness and exploration boosts multiply; behindPace scales exploration only', () => {
    const base = priority(topic({ mastery: 0.5, coverage: 0.1 }))
    expect(base).toBeCloseTo(examWeight('physics') * 0.5 * PLAN_CONFIG.explorationBoost, 12)
    const scaled = priority(topic({ mastery: 0.5, coverage: 0.1 }), PLAN_CONFIG.behindPaceExplorationScale)
    expect(scaled).toBeCloseTo(base * PLAN_CONFIG.behindPaceExplorationScale, 12)
    const stale = priority(topic({ mastery: 0.5, coverage: 0.5, stale: true }))
    expect(stale).toBeCloseTo(examWeight('physics') * 0.5 * PLAN_CONFIG.stalenessBoost, 12)
  })
})

describe('eligibleMistakes (spaced gap; flagged always joins)', () => {
  const c = (over: Partial<MistakeCandidate>): MistakeCandidate => ({
    questionId: 'q', topic: 't', daysSinceMiss: null, flagged: false, ...over
  })

  test('a miss enters review only after spacedGapDays; flagged bypasses the gap', () => {
    const out = eligibleMistakes([
      c({ questionId: 'young', daysSinceMiss: PLAN_CONFIG.spacedGapDays - 1 }),
      c({ questionId: 'ripe', daysSinceMiss: PLAN_CONFIG.spacedGapDays }),
      c({ questionId: 'flagged-young', daysSinceMiss: 0, flagged: true }),
      c({ questionId: 'flagged-only', daysSinceMiss: null, flagged: true })
    ])
    expect(out.map((x) => x.questionId)).toEqual(['ripe', 'flagged-young', 'flagged-only'])
  })
})

describe('materializeDay', () => {
  test('zero budget ⇒ empty day', () => {
    expect(materializeDay(dayInput({ budgetMinutes: 0, dueCardCount: 50 }))).toEqual([])
  })

  test('flashcards first: sized on due + new, capped at flashcardsMaxMinutes', () => {
    const [task] = materializeDay(dayInput({ dueCardCount: 30, newCardCount: 10 }))
    expect(task!.kind).toBe('flashcards')
    expect(task!.targetCount).toBe(40)
    // 30×6s + 10×18s = 6 min raw ⇒ under the cap
    expect(task!.minutes).toBe(6)
    const [huge] = materializeDay(dayInput({ dueCardCount: 500, newCardCount: 0 }))
    expect(huge!.minutes).toBe(PLAN_CONFIG.flashcardsMaxMinutes)
  })

  test('habit mode IS the same path: no exam-date input exists here — a day with dues and topics plans both', () => {
    const tasks = materializeDay(dayInput({ dueCardCount: 10, topics: [topic()] }))
    expect(tasks.map((t) => t.kind)).toEqual(['flashcards', 'questions'])
  })

  test('mistake review materializes at ≥ minEligible as a questions task with refine=incorrect', () => {
    const candidates: MistakeCandidate[] = Array.from({ length: 6 }, (_, i) => ({
      questionId: `q${i}`, topic: 'physics.mechanics', daysSinceMiss: 5, flagged: false
    }))
    const tasks = materializeDay(dayInput({ mistakeCandidates: candidates, topics: [] }))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ kind: 'questions', refine: 'incorrect', taxonomyRef: null, targetCount: 6 })
    // below the threshold ⇒ no task
    expect(materializeDay(dayInput({ mistakeCandidates: candidates.slice(0, 4) }))).toEqual([])
  })

  test('topic practice ranks by priority, drops excluded/empty topics, and caps task count', () => {
    const topics = [
      topic({ topic: 'a.weak', title: 'Weak', mastery: 0.2 }),
      topic({ topic: 'b.strong', title: 'Strong', mastery: 0.9 }),
      topic({ topic: 'c.excluded', mastery: 0.1, excluded: true }),
      topic({ topic: 'd.unpublished', mastery: 0.1, publishedCount: 0 }),
      topic({ topic: 'e.mid', title: 'Mid', mastery: 0.5 }),
      topic({ topic: 'f.mid2', title: 'Mid2', mastery: 0.55 })
    ]
    const tasks = materializeDay(dayInput({ topics }))
    const refs = tasks.map((t) => t.taxonomyRef)
    expect(refs).not.toContain('c.excluded')
    expect(refs).not.toContain('d.unpublished')
    expect(tasks).toHaveLength(PLAN_CONFIG.maxQuestionTasksPerDay)
    expect(refs[0]).toBe('a.weak') // weakest first
    expect(tasks[0]!.targetCount).toBe(PLAN_CONFIG.questionsPerTask)
    expect(tasks[0]!.why).toBe(whyLine(topics[0]!))
  })

  test('targetCount clamps to the topic\'s published pool', () => {
    const [t] = materializeDay(dayInput({ topics: [topic({ publishedCount: 2 })] }))
    expect(t!.targetCount).toBe(2)
  })

  test('questions gate: before the track start, no practice materializes (flashcards unaffected)', () => {
    const tasks = materializeDay(dayInput({ questionsStarted: false, dueCardCount: 5, topics: [topic()] }))
    expect(tasks.map((t) => t.kind)).toEqual(['flashcards'])
  })

  test('lesson offers: one-time offer and repeated-distractor reteach, optional and budget-exempt', () => {
    const offered = topic({ topic: 'a.new', title: 'New', mastery: 0.2, lessonAvailable: true, offerLesson: true })
    const reteach = topic({
      topic: 'b.trap', title: 'Trap', mastery: 0.25, lessonAvailable: true, offerLesson: false,
      dominantMode: 'repeated_distractor'
    })
    const noLesson = topic({ topic: 'c.plain', mastery: 0.3 })
    const tasks = materializeDay(dayInput({ topics: [offered, reteach, noLesson] }))
    const lessons = tasks.filter((t) => t.kind === 'lesson')
    expect(lessons).toHaveLength(2)
    expect(lessons.every((l) => l.optional)).toBe(true)
    expect(lessons.map((l) => l.taxonomyRef).sort()).toEqual(['a.new', 'b.trap'])
    // each lesson precedes its practice task
    const order = tasks.map((t) => `${t.kind}:${t.taxonomyRef}`)
    expect(order.indexOf('lesson:a.new')).toBeLessThan(order.indexOf('questions:a.new'))
  })

  test('completed lesson never re-offers', () => {
    const t = topic({ lessonAvailable: true, lessonCompleted: true, offerLesson: false, dominantMode: 'repeated_distractor' })
    const tasks = materializeDay(dayInput({ topics: [t] }))
    expect(tasks.filter((x) => x.kind === 'lesson')).toHaveLength(0)
  })

  test('greedy fill: stops after the first required task crossing the budget; optionals are exempt', () => {
    const topics = [
      topic({ topic: 'a.t', title: 'A', mastery: 0.1, lessonAvailable: true, offerLesson: true }),
      topic({ topic: 'b.t', title: 'B', mastery: 0.2 }),
      topic({ topic: 'c.t', title: 'C', mastery: 0.3 })
    ]
    // 9-minute budget: lesson (optional, exempt) + first 9-min practice task crosses at the end ⇒ stop.
    const tasks = materializeDay(dayInput({ budgetMinutes: 9, topics }))
    expect(tasks.map((t) => `${t.kind}:${t.taxonomyRef}`)).toEqual(['lesson:a.t', 'questions:a.t'])
  })

  test('usedMinutes discounts the budget (a regen respects work already done today)', () => {
    const tasks = materializeDay(dayInput({ topics: [topic()], usedMinutes: 60 }))
    expect(tasks).toEqual([])
  })

  test('same-day skip guards: skipped topics and kinds never resurrect', () => {
    const candidates: MistakeCandidate[] = Array.from({ length: 6 }, (_, i) => ({
      questionId: `q${i}`, topic: 'z.other', daysSinceMiss: 5, flagged: false
    }))
    const tasks = materializeDay(
      dayInput({
        dueCardCount: 10,
        topics: [topic({ topic: 'a.skipped' }), topic({ topic: 'b.kept', title: 'Kept', mastery: 0.4 })],
        mistakeCandidates: candidates,
        skippedTopics: ['a.skipped'],
        skippedKinds: ['flashcards', 'mistakes']
      })
    )
    expect(tasks.some((t) => t.kind === 'flashcards')).toBe(false)
    expect(tasks.some((t) => t.refine === 'incorrect')).toBe(false)
    expect(tasks.some((t) => t.taxonomyRef === 'a.skipped')).toBe(false)
    expect(tasks.some((t) => t.taxonomyRef === 'b.kept')).toBe(true)
  })
})
