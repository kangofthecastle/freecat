import { describe, expect, test } from 'vitest'
import { summarizeFlashcards, type SchedulingSnapshot, type ReviewSnapshot } from '../../src/main/stats/flashcard-load'

const NOW = new Date('2026-07-17T12:00:00Z')
const TZ = 'UTC'
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000)

const sched = (over: Partial<SchedulingSnapshot> = {}): SchedulingSnapshot => ({
  state: 2, due: hoursFromNow(1), introducedDay: '2026-07-01', lapses: 0, ...over
})
const rev = (over: Partial<ReviewSnapshot> = {}): ReviewSnapshot => ({
  rating: 3, reviewedAt: NOW, ...over
})

describe('summarizeFlashcards', () => {
  test('empty rotation', () => {
    const s = summarizeFlashcards([], [], NOW, TZ)
    expect(s.totalCards).toBe(0)
    expect(s.dueNow).toBe(0)
    expect(s.againRate7d).toBe(null)
    expect(s.dueByDay).toHaveLength(7)
  })

  test('dueNow counts due <= now; overdue clamps into today\'s bar', () => {
    const s = summarizeFlashcards(
      [
        sched({ due: hoursFromNow(-30) }), // overdue (yesterday) — clamps into today
        sched({ due: hoursFromNow(-1) }),
        sched({ due: hoursFromNow(6) }), // later today, not due yet
        sched({ due: hoursFromNow(30) }) // tomorrow
      ],
      [], NOW, TZ
    )
    expect(s.dueNow).toBe(2)
    expect(s.dueByDay[0]).toMatchObject({ day: '2026-07-17', count: 3 })
    expect(s.dueByDay[1]).toMatchObject({ day: '2026-07-18', count: 1 })
  })

  test('day bucketing respects the local tz across midnight', () => {
    // 2026-07-18T03:00Z is still 2026-07-17 in Los Angeles — same-day bar there, tomorrow in UTC
    const due = new Date('2026-07-18T03:00:00Z')
    const utc = summarizeFlashcards([sched({ due })], [], NOW, 'UTC')
    const la = summarizeFlashcards([sched({ due })], [], new Date('2026-07-17T19:00:00Z'), 'America/Los_Angeles')
    expect(utc.dueByDay[1]!.count).toBe(1)
    expect(la.dueByDay[0]!.day).toBe('2026-07-17')
    expect(la.dueByDay[0]!.count).toBe(1)
  })

  test('states, introducedToday, lapses', () => {
    const s = summarizeFlashcards(
      [
        sched({ state: 1 }),
        sched({ state: 2, lapses: 3 }),
        sched({ state: 3, introducedDay: '2026-07-17' })
      ],
      [], NOW, TZ
    )
    expect(s.states).toEqual({ learning: 1, review: 1, relearning: 1 })
    expect(s.introducedToday).toBe(1)
    expect(s.lapsesTotal).toBe(3)
  })

  test('again rates over 7d/30d local-day windows; reviews outside stay out', () => {
    const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)
    const s = summarizeFlashcards(
      [],
      [
        rev({ rating: 1, reviewedAt: daysAgo(0) }), // in both windows
        rev({ rating: 3, reviewedAt: daysAgo(3) }), // in both
        rev({ rating: 1, reviewedAt: daysAgo(20) }), // 30d only
        rev({ rating: 3, reviewedAt: daysAgo(40) }) // outside both
      ],
      NOW, TZ
    )
    expect(s.againRate7d).toBeCloseTo(1 / 2, 10)
    expect(s.againRate30d).toBeCloseTo(2 / 3, 10)
    expect(s.reviewsPerDay).toHaveLength(30)
    expect(s.reviewsPerDay.at(-1)).toMatchObject({ day: '2026-07-17', count: 1 })
  })
})
