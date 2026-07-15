import { describe, it, expect } from 'vitest'
import { applyRating, previewIntervals, humanizeInterval, toFsrsCard, State, Rating, type SchedulingRowValues } from '../../src/main/flashcards/fsrs'

const now = new Date('2026-07-07T12:00:00.000Z')

// Persist an applyRating result back into the row shape a later review would read (mirrors what the
// repo stores), so we can chain reviews without a DB.
function persist(next: SchedulingRowValues): SchedulingRowValues {
  return { ...next }
}

describe('fsrs scheduling', () => {
  it('a new card (no row) becomes Learning on its first rating', () => {
    const { next, log } = applyRating(null, Rating.Good, now)
    expect(next.state).toBe(State.Learning)
    expect(next.reps).toBe(1)
    expect(next.lapses).toBe(0)
    expect(log.stateBefore).toBe(State.New) // the card was New when reviewed
    expect(log.rating).toBe(Rating.Good)
    expect(next.due.getTime()).toBeGreaterThan(now.getTime()) // scheduled into the future
  })

  it('Good then Good graduates to Review with a multi-day interval', () => {
    const first = applyRating(null, Rating.Good, now)
    expect(first.next.state).toBe(State.Learning)
    // Second Good at the moment it comes due → graduates out of the learning ladder.
    const at = first.next.due
    const second = applyRating(persist(first.next), Rating.Good, at)
    expect(second.next.state).toBe(State.Review)
    expect(second.next.scheduledDays).toBeGreaterThanOrEqual(1)
    expect(second.next.due.getTime()).toBeGreaterThan(at.getTime())
  })

  it('Again from Review sends the card to Relearning and increments lapses', () => {
    // Graduate to Review first (Good, Good), then fail it.
    let row = applyRating(null, Rating.Good, now).next
    let t = row.due
    row = applyRating(persist(row), Rating.Good, t).next
    expect(row.state).toBe(State.Review)
    t = row.due
    const lapsed = applyRating(persist(row), Rating.Again, t)
    expect(lapsed.next.state).toBe(State.Relearning)
    expect(lapsed.next.lapses).toBe(1)
    expect(lapsed.log.stateBefore).toBe(State.Review)
  })

  it('preview strings are humanized and ordered Again < Good < Easy for a new card', () => {
    const p = previewIntervals(null, now)
    expect(p.good).toBe('10m') // default 1m/10m short-term ladder
    expect(p.hard).toMatch(/^\d+m$/)
    expect(p.again).toMatch(/^(<1m|\d+m)$/)
    expect(p.easy).toMatch(/^\d+d$/) // Easy on a new card jumps to a multi-day interval
  })

  it('is deterministic with fuzz disabled (identical inputs → identical schedule)', () => {
    const a = applyRating(null, Rating.Good, now)
    const b = applyRating(null, Rating.Good, now)
    expect(a.next).toEqual(b.next)
    expect(previewIntervals(null, now)).toEqual(previewIntervals(null, now))
  })

  it('humanizeInterval promotes a value that rounds up to the next unit boundary', () => {
    const SEC = 1000, MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000
    // Boundary cases: rounding must happen before the unit label is picked, so these promote a unit.
    expect(humanizeInterval(59 * MIN + 30 * SEC)).toBe('1h') // 59m30s rounds to 60m → "1h", not "60m"
    expect(humanizeInterval(23.7 * HOUR)).toBe('1d')         // 23.7h rounds to 24h → "1d", not "24h"
    // Plain mid-range case per unit (no promotion).
    expect(humanizeInterval(30 * SEC)).toBe('<1m')
    expect(humanizeInterval(6 * MIN)).toBe('6m')
    expect(humanizeInterval(3 * HOUR)).toBe('3h')
    expect(humanizeInterval(4 * DAY)).toBe('4d')
  })

  it('toFsrsCard rehydrates a persisted row (null → an empty New card)', () => {
    expect(toFsrsCard(null, now).state).toBe(State.New)
    const { next } = applyRating(null, Rating.Good, now)
    const card = toFsrsCard(next, now)
    expect(card.state).toBe(State.Learning)
    expect(card.reps).toBe(1)
  })
})
