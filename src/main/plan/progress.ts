import { PLAN_CONFIG } from './config'
import { prevDayKey } from '../../shared/gamification/dates'

/**
 * Pure plan-progress helpers, ported from sat-world's `progress.ts` plus the roadmap's A5 fix:
 * skip-rate is COMPUTED AND SURFACED beside the streak so skipping-everything can never read as
 * perfection — information for the user, no enforcement (personal-scale variant).
 */

/** 'complete' = had ≥1 counted task and all counted tasks completed; 'incomplete' = had counted
 *  tasks, not all done; 'none' = no counted tasks that day. `expired`, `skipped`, and OPTIONAL
 *  (lesson) tasks are all excluded from the denominator — a skip is agency, not failure — but a day
 *  where everything was skipped is 'none', never 'complete'. */
export type DayOutcome = 'complete' | 'incomplete' | 'none'

export interface StatusLike {
  status: string
  optional?: boolean | null
}

const counts = (s: StatusLike): boolean => s.status !== 'expired' && s.status !== 'skipped' && s.optional !== true

export function dayOutcome(statuses: StatusLike[]): DayOutcome {
  const counted = statuses.filter(counts)
  if (!counted.length) return 'none'
  return counted.every((s) => s.status === 'completed') ? 'complete' : 'incomplete'
}

/**
 * Consecutive completed plan-days ending today (ported, with its two neutral cases): an unfinished
 * TODAY doesn't break the chain (the day isn't over) — it just isn't counted; a 'none' day neither
 * breaks nor increments. Any PAST 'incomplete' day ends the streak. Bounded by the oldest supplied day.
 */
export function planStreak(outcomeByDay: Map<string, DayOutcome>, todayKey: string): number {
  if (outcomeByDay.size === 0) return 0
  let minKey = todayKey
  for (const k of outcomeByDay.keys()) if (k < minKey) minKey = k
  let streak = 0
  for (let key = todayKey; key >= minKey; key = prevDayKey(key)) {
    const outcome = outcomeByDay.get(key) ?? 'none'
    if (outcome === 'complete') streak++
    else if (outcome === 'incomplete' && key !== todayKey) break
  }
  return streak
}

/** Trailing-window completion rate: completed ÷ counted. No counted tasks ⇒ null (absent, never 0/0). */
export function planCompletionRate(statuses: StatusLike[]): number | null {
  const counted = statuses.filter(counts)
  if (!counted.length) return null
  return counted.filter((s) => s.status === 'completed').length / counted.length
}

/**
 * Skip-rate (A5): skipped ÷ resolvable required tasks (skipped + counted). Sits BESIDE the streak in
 * any display — the streak excludes skips from its denominator, so this is the number that keeps it
 * honest. Null when nothing was resolvable.
 */
export function planSkipRate(statuses: StatusLike[]): number | null {
  const required = statuses.filter((s) => s.optional !== true && s.status !== 'expired')
  if (!required.length) return null
  return required.filter((s) => s.status === 'skipped').length / required.length
}

export type OnTrack = 'on-track' | 'neutral' | 'falling-behind'

/** ≥ onTrackAt ⇒ on-track, < fallingBehindAt ⇒ falling-behind, between ⇒ neutral; null rate ⇒ null. */
export function onTrackStatus(rate: number | null): OnTrack | null {
  if (rate == null) return null
  if (rate >= PLAN_CONFIG.onTrackAt) return 'on-track'
  if (rate < PLAN_CONFIG.fallingBehindAt) return 'falling-behind'
  return 'neutral'
}

/**
 * The statuses the on-track rate runs over (ported): the trailing `windowDays` ending YESTERDAY,
 * plus today only once today is fully complete — an in-progress today must never read as failure.
 */
export function onTrackWindowStatuses(
  statusesByDay: Map<string, StatusLike[]>,
  todayKey: string,
  windowDays = 7
): StatusLike[] {
  const out: StatusLike[] = []
  let key = todayKey
  for (let i = 0; i < windowDays; i++) {
    key = prevDayKey(key)
    out.push(...(statusesByDay.get(key) ?? []))
  }
  const todays = statusesByDay.get(todayKey) ?? []
  if (dayOutcome(todays) === 'complete') out.push(...todays)
  return out
}
