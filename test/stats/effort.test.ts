import { describe, expect, test } from 'vitest'
import { effortPoints, bucketByDay, buildEffortTrend } from '../../src/main/stats/effort'
import { addDaysToKey, weekdayIndex } from '../../src/shared/gamification/dates'

describe('effortPoints', () => {
  test('transparent arithmetic: questions×3 + reviews×0.25 + lessons×10', () => {
    expect(effortPoints({ questions: 2, flashcardReviews: 8, lessonsCompleted: 1 })).toBe(2 * 3 + 8 * 0.25 + 10)
    expect(effortPoints({ questions: 0, flashcardReviews: 0, lessonsCompleted: 0 })).toBe(0)
  })
})

describe('bucketByDay', () => {
  test('buckets on the LOCAL calendar day of the given tz — the module time convention', () => {
    // 2026-07-17T03:00Z is still 2026-07-16 in Los Angeles (UTC-7 in July)
    const t = new Date('2026-07-17T03:00:00Z')
    expect([...bucketByDay([t], 'America/Los_Angeles').keys()]).toEqual(['2026-07-16'])
    expect([...bucketByDay([t], 'UTC').keys()]).toEqual(['2026-07-17'])
  })
})

describe('buildEffortTrend', () => {
  test('zero-fills the whole range oldest→newest and sums per-day points', () => {
    const trend = buildEffortTrend(
      {
        questionTimes: [new Date('2026-07-15T10:00:00Z'), new Date('2026-07-15T11:00:00Z')],
        reviewTimes: [new Date('2026-07-16T10:00:00Z')],
        lessonTimes: []
      },
      '2026-07-14',
      '2026-07-17',
      'UTC'
    )
    expect(trend.map((d) => d.day)).toEqual(['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17'])
    expect(trend[0]).toMatchObject({ questions: 0, flashcardReviews: 0, lessonsCompleted: 0, points: 0 })
    expect(trend[1]).toMatchObject({ questions: 2, points: 6 })
    expect(trend[2]).toMatchObject({ flashcardReviews: 1, points: 0.25 })
  })
})

describe('dayKey helpers (added for Stats)', () => {
  test('addDaysToKey crosses month/year boundaries', () => {
    expect(addDaysToKey('2026-07-17', 1)).toBe('2026-07-18')
    expect(addDaysToKey('2026-07-17', -17)).toBe('2026-06-30')
    expect(addDaysToKey('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDaysToKey('2026-02-28', 1)).toBe('2026-03-01') // not a leap year
  })

  test('weekdayIndex: 2026-07-17 is a Friday', () => {
    expect(weekdayIndex('2026-07-17')).toBe(5)
    expect(weekdayIndex('2026-07-19')).toBe(0) // Sunday
  })
})
