import { describe, expect, test } from 'vitest'
import { flashcardTriangle, validatePacing, habitPacing, questionsBehindPace } from '../../src/main/plan/pacing'

const BASE = { deckSize: 1000, introducedSoFar: 100, rampDays: 28, dailyNewCeiling: 20 }

describe('flashcardTriangle', () => {
  test('window = max(1, daysToFinish − rampDays); requiredDailyNew = ceil(needed / window)', () => {
    const tri = flashcardTriangle({ ...BASE, goalPct: 60, dailyNew: 0, daysToFinish: 128 })
    // goalTarget = 600, needed = 500, window = 100 ⇒ 5/day
    expect(tri.window).toBe(100)
    expect(tri.introductionsNeeded).toBe(500)
    expect(tri.requiredDailyNew).toBe(5)
  })

  test('inverse: reachableGoalPct floors and never over-promises', () => {
    const tri = flashcardTriangle({ ...BASE, goalPct: 0, dailyNew: 5, daysToFinish: 128 })
    // 100 + 5×100 = 600 of 1000 ⇒ exactly 60
    expect(tri.reachableGoalPct).toBe(60)
    const odd = flashcardTriangle({ ...BASE, goalPct: 0, dailyNew: 3, daysToFinish: 128 })
    // 100 + 300 = 400 of 1000 ⇒ 40; a 3.99×-style fraction must floor, not round
    expect(odd.reachableGoalPct).toBe(40)
  })

  test('window inside the ramp collapses to 1 (introduce everything now)', () => {
    const tri = flashcardTriangle({ ...BASE, goalPct: 30, dailyNew: 0, daysToFinish: 10 })
    expect(tri.window).toBe(1)
    expect(tri.requiredDailyNew).toBe(200) // 300 − 100 over a 1-day window — infeasible, visibly
  })

  test('goal already met ⇒ 0/day; empty deck ⇒ vacuous 100% reachable', () => {
    expect(flashcardTriangle({ ...BASE, introducedSoFar: 700, goalPct: 60, dailyNew: 0, daysToFinish: 128 }).requiredDailyNew).toBe(0)
    expect(flashcardTriangle({ ...BASE, deckSize: 0, goalPct: 50, dailyNew: 5, daysToFinish: 128 }).reachableGoalPct).toBe(100)
  })
})

describe('validatePacing (never silently raise workload)', () => {
  const V = { deckSize: 1000, introducedSoFar: 100, daysToFinish: 128, rampDays: 28, dailyNewCeiling: 20 }

  test('dailyNew edit is ALWAYS allowed and derives the goal', () => {
    const r = validatePacing({ ...V, edit: { field: 'dailyNew', value: 5 } })
    expect(r.ok).toBe(true)
    expect(r.derived).toEqual({ dailyNew: 5, goalPct: 60 })
  })

  test('dailyNew clamps to the ceiling', () => {
    const r = validatePacing({ ...V, edit: { field: 'dailyNew', value: 99 } })
    expect(r.ok).toBe(true)
    expect(r.derived.dailyNew).toBe(20)
  })

  test('feasible goal edit derives the required daily-new', () => {
    const r = validatePacing({ ...V, edit: { field: 'goalPct', value: 60 } })
    expect(r.ok).toBe(true)
    expect(r.derived).toEqual({ dailyNew: 5, goalPct: 60 })
  })

  test('infeasible goal is refused, reporting the over-ceiling count', () => {
    // 100% ⇒ needed 900 over window 100 ⇒ 9/day (fine at ceiling 20); shrink the window instead:
    const r = validatePacing({ ...V, daysToFinish: 60, edit: { field: 'goalPct', value: 100 } })
    // window = 32, needed = 900 ⇒ ceil(28.125) = 29 > 20
    expect(r.ok).toBe(false)
    expect(r.derived.dailyNew).toBe(29)
    expect(r.refusalReason).toContain('29')
    expect(r.refusalReason).toContain('20')
  })
})

describe('habitPacing (shared by engine persistence AND the live preview)', () => {
  test('dailyNew edit stores clamped; goal edit is refused and ECHOES the current pace, never 0', () => {
    expect(habitPacing({ field: 'dailyNew', value: 99 }, 20, null)).toEqual({ ok: true, derived: { dailyNew: 20, goalPct: 0 } })
    const refused = habitPacing({ field: 'goalPct', value: 80 }, 20, 12)
    expect(refused.ok).toBe(false)
    expect(refused.derived).toEqual({ dailyNew: 12, goalPct: 80 }) // preview keeps showing the real pace
    expect(refused.refusalReason).toContain('exam date')
  })
})

describe('questionsBehindPace', () => {
  const P = { publishedTotal: 100, startKey: '2026-07-01', finishKey: '2026-07-21', todayKey: '2026-07-11' }

  test('halfway through the window with well under half covered ⇒ behind', () => {
    expect(questionsBehindPace({ ...P, attemptedDistinct: 20 })).toBe(true) // 0.2 < 0.5 − 0.1
  })

  test('inside the slack band ⇒ not behind', () => {
    expect(questionsBehindPace({ ...P, attemptedDistinct: 45 })).toBe(false) // 0.45 ≥ 0.5 − 0.1
  })

  test('no exam date, unstarted window, or empty bank ⇒ never behind', () => {
    expect(questionsBehindPace({ ...P, attemptedDistinct: 0, finishKey: null })).toBe(false)
    expect(questionsBehindPace({ ...P, attemptedDistinct: 0, todayKey: '2026-06-20' })).toBe(false)
    expect(questionsBehindPace({ ...P, attemptedDistinct: 0, publishedTotal: 0 })).toBe(false)
  })
})
