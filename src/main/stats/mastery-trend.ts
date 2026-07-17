import type { SectionCode } from '../content/types'
import type { MasteryTrendDayDto } from '../../shared/dto'
import { dayKeyInTz, nextDayKey, addDaysToKey } from '../../shared/gamification/dates'
import { computeMastery, type MasteryAttempt } from './mastery'
import { STATS_CONFIG } from './config'

/** One attempt for the trend walk — the FULL attempt stream (not latest-only): which attempt is
 *  "latest" changes day by day, so the walk maintains its own as-of-day latest map. `flagged` is
 *  the CURRENT flag state applied to every day (flags carry no history), matching the live panel. */
export interface TrendAttempt {
  id: number
  questionId: string
  section: SectionCode
  isCorrect: boolean
  answeredAt: Date
  flagged: boolean
}

/**
 * As-of-day mastery per section (roadmap Phase 4) — recomputation, not snapshots: each day's value
 * is exactly what the live mastery panel would have shown at that day's end (same `computeMastery`,
 * latest-attempt-per-question as of that day). One sorted pass with an incremental latest map keeps
 * this O(days × distinctQuestions) — cheap at personal scale, which is why there is deliberately no
 * cache (the roadmap's "only if profiling says so").
 *
 * A section-day below the needs-data floor is null — a gap, never a fake score (ported rule). The
 * range starts at the LATER of (today − trendDays + 1) and the first attempt's day: leading
 * all-null days say nothing, and an empty attempt set yields an empty trend.
 */
export function buildMasteryTrend(
  attempts: TrendAttempt[],
  publishedBySection: Record<SectionCode, number>,
  todayKey: string,
  tz: string
): MasteryTrendDayDto[] {
  if (attempts.length === 0) return []
  const sorted = [...attempts].sort(
    (a, b) => a.answeredAt.getTime() - b.answeredAt.getTime() || a.id - b.id
  )
  const firstDay = dayKeyInTz(sorted[0]!.answeredAt, tz)
  const windowStart = addDaysToKey(todayKey, -(STATS_CONFIG.mastery.trendDays - 1))
  const fromKey = firstDay > windowStart ? firstDay : windowStart

  const latest = new Map<string, TrendAttempt>()
  let i = 0
  const out: MasteryTrendDayDto[] = []
  for (let day = fromKey; day <= todayKey; day = nextDayKey(day)) {
    // Fold in every attempt up to this day's end — the FIRST iteration also absorbs any history
    // older than the range start, so early points carry their full pre-window evidence.
    while (i < sorted.length && dayKeyInTz(sorted[i]!.answeredAt, tz) <= day) {
      const a = sorted[i]!
      latest.set(a.questionId, a) // ascending sort ⇒ later entries overwrite: latest as of `day`
      i++
    }
    // As-of instant for the recency decay: the day's UTC end. Off the local-tz day end by at most
    // the utc offset — hours against a 21-day τ, immaterial — keeping the walk pure string math.
    const asOf = new Date(`${day}T23:59:59.999Z`)
    const bySection = new Map<SectionCode, MasteryAttempt[]>()
    for (const a of latest.values()) {
      const arr = bySection.get(a.section) ?? []
      arr.push({ questionId: a.questionId, isCorrect: a.isCorrect, answeredAt: a.answeredAt, flagged: a.flagged })
      bySection.set(a.section, arr)
    }
    const sections = {} as Record<SectionCode, number | null>
    for (const section of Object.keys(publishedBySection) as SectionCode[]) {
      const r = computeMastery(bySection.get(section) ?? [], publishedBySection[section], asOf)
      sections[section] = r.needsData ? null : r.mastery
    }
    out.push({ day, sections })
  }
  return out
}
