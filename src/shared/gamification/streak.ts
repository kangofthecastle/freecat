import { dayKeyInTz, prevDayKey } from './dates'

/** Consecutive days with ≥1 activity. Today-with-zero does NOT break a live streak. */
export function streakDays(activeDayKeys: ReadonlySet<string>, now: Date, tz: string): number {
  let key = dayKeyInTz(now, tz)
  if (!activeDayKeys.has(key)) key = prevDayKey(key)
  let streak = 0
  while (activeDayKeys.has(key)) {
    streak++
    key = prevDayKey(key)
  }
  return streak
}
