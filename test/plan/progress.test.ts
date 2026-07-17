import { describe, expect, test } from 'vitest'
import {
  dayOutcome, planStreak, planCompletionRate, planSkipRate, onTrackStatus, onTrackWindowStatuses,
  type DayOutcome, type StatusLike
} from '../../src/main/plan/progress'

const s = (status: string, optional = false): StatusLike => ({ status, optional })

describe('dayOutcome', () => {
  test('complete / incomplete / none; skipped+expired+optional excluded from the denominator', () => {
    expect(dayOutcome([s('completed'), s('completed')])).toBe('complete')
    expect(dayOutcome([s('completed'), s('pending')])).toBe('incomplete')
    expect(dayOutcome([])).toBe('none')
    expect(dayOutcome([s('skipped'), s('expired')])).toBe('none') // all-skipped is never 'complete'
    expect(dayOutcome([s('completed'), s('skipped'), s('pending', true)])).toBe('complete')
  })
})

describe('planStreak (neutral today, neutral none-days)', () => {
  test('counts consecutive complete days; past incomplete breaks; none skips', () => {
    const outcomes = new Map<string, DayOutcome>([
      ['2026-07-17', 'incomplete'], // today, in progress — neutral
      ['2026-07-16', 'complete'],
      ['2026-07-15', 'none'], // rest day — neutral
      ['2026-07-14', 'complete'],
      ['2026-07-13', 'incomplete'] // breaks here
    ])
    expect(planStreak(outcomes, '2026-07-17')).toBe(2)
  })

  test('a complete today increments', () => {
    expect(planStreak(new Map([['2026-07-17', 'complete']]), '2026-07-17')).toBe(1)
    expect(planStreak(new Map(), '2026-07-17')).toBe(0)
  })
})

describe('planCompletionRate / planSkipRate (A5)', () => {
  test('rate over counted; null when nothing counted', () => {
    expect(planCompletionRate([s('completed'), s('pending')])).toBe(0.5)
    expect(planCompletionRate([s('skipped')])).toBe(null)
  })

  test('skip-rate keeps the streak honest: skipped ÷ resolvable required', () => {
    // 3 skips + 1 completion: completionRate reads a perfect 1.0, skipRate exposes the 0.75
    const statuses = [s('skipped'), s('skipped'), s('skipped'), s('completed')]
    expect(planCompletionRate(statuses)).toBe(1)
    expect(planSkipRate(statuses)).toBe(0.75)
    expect(planSkipRate([s('expired'), s('pending', true)])).toBe(null)
  })
})

describe('onTrack', () => {
  test('thresholds and the null (no badge) case', () => {
    expect(onTrackStatus(0.9)).toBe('on-track')
    expect(onTrackStatus(0.6)).toBe('neutral')
    expect(onTrackStatus(0.3)).toBe('falling-behind')
    expect(onTrackStatus(null)).toBe(null)
  })

  test('window excludes an in-progress today; includes a fully complete today', () => {
    const byDay = new Map<string, StatusLike[]>([
      ['2026-07-16', [s('completed')]],
      ['2026-07-17', [s('pending')]]
    ])
    expect(onTrackWindowStatuses(byDay, '2026-07-17')).toHaveLength(1)
    byDay.set('2026-07-17', [s('completed')])
    expect(onTrackWindowStatuses(byDay, '2026-07-17')).toHaveLength(2)
  })
})
