import type { FlashcardLoadDto } from '../../shared/dto'
import { addDaysToKey, dayKeyInTz } from '../../shared/gamification/dates'
import { STATS_CONFIG } from './config'

/** The scheduling fields the summary needs — a projection of card_scheduling rows. Pure + DB-free. */
export interface SchedulingSnapshot {
  state: number // ts-fsrs State enum: 1 Learning, 2 Review, 3 Relearning (0 New never persisted)
  due: Date
  introducedDay: string
  lapses: number
}

/** A review_log projection. */
export interface ReviewSnapshot {
  rating: number // 1 Again · 2 Hard · 3 Good · 4 Easy
  reviewedAt: Date
}

/**
 * Describe the FSRS queue: what's due, when, and how reviews have been going. FreeCAT-original
 * (sat-world had no FSRS) and deliberately descriptive — it reports the queue, it never forecasts
 * (forecasting is the Plan module's pacing triangle, Phase 2).
 *
 * Day bucketing uses local dayKeys throughout; overdue cards clamp into today's bar rather than
 * rendering misleading past-day bars.
 */
export function summarizeFlashcards(
  scheduling: SchedulingSnapshot[],
  reviews: ReviewSnapshot[],
  now: Date,
  tz: string
): FlashcardLoadDto {
  const cfg = STATS_CONFIG.flashcards
  const todayKey = dayKeyInTz(now, tz)

  let dueNow = 0
  let introducedToday = 0
  let lapsesTotal = 0
  const states = { learning: 0, review: 0, relearning: 0 }
  const dueCounts = new Map<string, number>()
  for (const s of scheduling) {
    if (s.due.getTime() <= now.getTime()) dueNow++
    if (s.introducedDay === todayKey) introducedToday++
    lapsesTotal += s.lapses
    if (s.state === 1) states.learning++
    else if (s.state === 2) states.review++
    else if (s.state === 3) states.relearning++
    const dueKey = dayKeyInTz(s.due, tz)
    const bucket = dueKey < todayKey ? todayKey : dueKey // overdue clamps into today
    dueCounts.set(bucket, (dueCounts.get(bucket) ?? 0) + 1)
  }
  const dueByDay: { day: string; count: number }[] = []
  for (let i = 0; i < cfg.dueHorizonDays; i++) {
    const day = addDaysToKey(todayKey, i)
    dueByDay.push({ day, count: dueCounts.get(day) ?? 0 })
  }

  let again7 = 0
  let total7 = 0
  let again30 = 0
  let total30 = 0
  const startShort = addDaysToKey(todayKey, -(cfg.againRateWindows.short - 1))
  const startLong = addDaysToKey(todayKey, -(cfg.againRateWindows.long - 1))
  for (const r of reviews) {
    const key = dayKeyInTz(r.reviewedAt, tz)
    if (key > todayKey) continue // defensive: clock skew never counts future reviews
    if (key >= startLong) {
      total30++
      if (r.rating === 1) again30++
      if (key >= startShort) {
        total7++
        if (r.rating === 1) again7++
      }
    }
  }

  return {
    totalCards: scheduling.length,
    dueNow,
    dueByDay,
    states,
    introducedToday,
    againRate7d: total7 > 0 ? again7 / total7 : null,
    againRate30d: total30 > 0 ? again30 / total30 : null,
    lapsesTotal
  }
}
