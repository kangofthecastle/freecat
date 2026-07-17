import { createEmptyCard, type Card } from 'ts-fsrs'
import { SCHEDULER, Rating } from '../flashcards/fsrs'

/** A card is "on a mastery trajectory" once its scheduled interval first reaches this many days —
 *  scheduler-agnostic threshold, carried over from the sat-world triangle. */
export const MASTERY_INTERVAL_DAYS = 21

const DAY_MS = 86_400_000

const cache = new Map<number, number>()

/**
 * Days from a card's FIRST review until its interval first reaches `masteryInterval` — the FSRS
 * re-derivation of sat-world's SM-2 `rampDays` walk (roadmap: locked decision). There is no closed
 * form over FSRS's weights, so this SIMULATES the app's EXACT scheduler (`SCHEDULER` from the
 * flashcards module — fuzz off, short-term on): rate Good at every due time from a fresh card and
 * count the days until a review yields a >= 21-day interval. Because it runs the live scheduler
 * config, retuning FSRS parameters retunes the triangle automatically — the same property the
 * sat-world derivation had, achieved by simulation instead of a closed-form walk.
 *
 * Deterministic (fuzz is disabled app-wide) and cheap (a handful of `next()` calls), computed once
 * per threshold and cached for the process lifetime.
 */
export function computeRampDays(masteryInterval: number = MASTERY_INTERVAL_DAYS): number {
  const hit = cache.get(masteryInterval)
  if (hit != null) return hit

  const t0 = new Date('2000-01-01T12:00:00.000Z') // fixed epoch — the walk is relative, wall-clock irrelevant
  let card: Card = createEmptyCard(t0)
  let reviewAt = t0
  let result: number | null = null
  for (let guard = 0; guard < 1000; guard++) {
    const { card: next } = SCHEDULER.next(card, reviewAt, Rating.Good)
    if (next.scheduled_days >= masteryInterval) {
      // The review that PRODUCED the >= threshold interval happened `reviewAt − t0` after introduction.
      result = Math.round((reviewAt.getTime() - t0.getTime()) / DAY_MS)
      break
    }
    card = next
    reviewAt = next.due
  }
  if (result == null) {
    // The scheduler never reached the threshold within 1000 Good reviews — impossible with any sane
    // FSRS config; fail loudly rather than plan against a fabricated ramp.
    throw new Error(`computeRampDays: interval never reached ${masteryInterval}d`)
  }
  cache.set(masteryInterval, result)
  return result
}
