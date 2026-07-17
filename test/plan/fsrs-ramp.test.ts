import { describe, expect, test } from 'vitest'
import { createEmptyCard, type Card } from 'ts-fsrs'
import { computeRampDays, MASTERY_INTERVAL_DAYS } from '../../src/main/plan/fsrs-ramp'
import { SCHEDULER, Rating } from '../../src/main/flashcards/fsrs'

/** Independent hand-walk of the app's scheduler (the same validation style sat-world used: never
 *  trust the derivation, re-run the real scheduler). */
function walkToInterval(threshold: number): number {
  const t0 = new Date('2010-06-01T00:00:00.000Z')
  let card: Card = createEmptyCard(t0)
  let reviewAt = t0
  for (let i = 0; i < 1000; i++) {
    const { card: next } = SCHEDULER.next(card, reviewAt, Rating.Good)
    if (next.scheduled_days >= threshold) {
      return Math.round((reviewAt.getTime() - t0.getTime()) / 86_400_000)
    }
    card = next
    reviewAt = next.due
  }
  throw new Error('never reached threshold')
}

describe('computeRampDays (FSRS re-derivation of the pacing ramp)', () => {
  test('matches an independent walk of the live scheduler at the mastery threshold', () => {
    expect(computeRampDays()).toBe(walkToInterval(MASTERY_INTERVAL_DAYS))
  })

  test('is a sane whole number of days for default FSRS parameters', () => {
    const ramp = computeRampDays()
    expect(Number.isInteger(ramp)).toBe(true)
    expect(ramp).toBeGreaterThan(0)
    expect(ramp).toBeLessThan(120) // a default-parameter scheduler reaches 21d within months, not years
  })

  test('monotonic: a higher mastery threshold never shortens the ramp', () => {
    expect(computeRampDays(42)).toBeGreaterThanOrEqual(computeRampDays(21))
    expect(computeRampDays(7)).toBeLessThanOrEqual(computeRampDays(21))
  })

  test('deterministic across calls (fuzz is disabled app-wide; result is cached)', () => {
    expect(computeRampDays()).toBe(computeRampDays())
  })
})
