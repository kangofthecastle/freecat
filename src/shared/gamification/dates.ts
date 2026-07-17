/** Calendar-day helpers for app-tz bucketing. Pure; tz passed explicitly. */

export function dayKeyInTz(date: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

const utcKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const parseKey = (key: string): [number, number, number] => key.split('-').map(Number) as [number, number, number]

export function prevDayKey(key: string): string {
  const [y, m, d] = parseKey(key)
  return utcKey(Date.UTC(y, m - 1, d - 1))
}

export function nextDayKey(key: string): string {
  const [y, m, d] = parseKey(key)
  return utcKey(Date.UTC(y, m - 1, d + 1))
}

/** `key` shifted by `n` calendar days (negative = earlier). Pure string→string, no tz involved. */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = parseKey(key)
  return utcKey(Date.UTC(y, m - 1, d + n))
}

/** Weekday of a day key: 0=Sun … 6=Sat. */
export function weekdayIndex(key: string): number {
  const [y, m, d] = parseKey(key)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
