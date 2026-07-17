import type { EffortDayDto } from '../../shared/dto'
import { dayKeyInTz, nextDayKey } from '../../shared/gamification/dates'
import { STATS_CONFIG } from './config'

/** The raw effort inputs for one day. Doubles as the day's breakdown in the DTO. Pure + DB-free. */
export interface EffortBreakdown {
  questions: number
  flashcardReviews: number
  lessonsCompleted: number
}

/** points = questions×3 + flashcardReviews×0.25 + lessonsCompleted×10 — transparent arithmetic,
 *  weights (and rationale) in STATS_CONFIG.effort. Unrounded; the UI rounds for display. */
export function effortPoints(b: EffortBreakdown): number {
  const w = STATS_CONFIG.effort
  return (
    b.questions * w.questionPoints +
    b.flashcardReviews * w.flashcardReviewPoints +
    b.lessonsCompleted * w.lessonPoints
  )
}

/** Bucket raw event timestamps into local dayKeys. */
export function bucketByDay(times: Date[], tz: string): Map<string, number> {
  const byDay = new Map<string, number>()
  for (const t of times) {
    const key = dayKeyInTz(t, tz)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }
  return byDay
}

/**
 * Zero-filled per-day effort series over [fromKey, toKey], oldest→newest. Zero-filling matters:
 * a skipped day renders as a flat zero, never a gap the eye reads as "no data". All windowing is
 * whole local calendar days — the module's single time convention.
 */
export function buildEffortTrend(
  events: { questionTimes: Date[]; reviewTimes: Date[]; lessonTimes: Date[] },
  fromKey: string,
  toKey: string,
  tz: string
): EffortDayDto[] {
  const q = bucketByDay(events.questionTimes, tz)
  const fc = bucketByDay(events.reviewTimes, tz)
  const ls = bucketByDay(events.lessonTimes, tz)
  const out: EffortDayDto[] = []
  for (let day = fromKey; day <= toKey; day = nextDayKey(day)) {
    const b: EffortBreakdown = {
      questions: q.get(day) ?? 0,
      flashcardReviews: fc.get(day) ?? 0,
      lessonsCompleted: ls.get(day) ?? 0
    }
    out.push({ day, ...b, points: effortPoints(b) })
  }
  return out
}
