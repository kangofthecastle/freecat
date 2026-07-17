/** Pure GitHub-style activity-calendar geometry, ported from sat-world's `calendar-grid.ts`:
 *  bucket day intensities into levels, lay days out as weekday-rows × week-columns, and derive
 *  month labels. DB-free and tz-agnostic — it operates on 'YYYY-MM-DD' local dayKeys already
 *  produced upstream (the module's single time convention). */

import { addDaysToKey, weekdayIndex } from '../../../shared/gamification/dates'

export type CalendarLevel = 0 | 1 | 2 | 3 | 4

export interface CalendarCell {
  dayKey: string
  intensity: number
  level: CalendarLevel
  inFuture: boolean // beyond `todayKey` — rendered as an empty placeholder, not a zero
}

export interface CalendarColumn {
  weekStartKey: string
  cells: CalendarCell[] // length 7, indexed by weekday offset from weekStartsOn
}

export interface MonthLabel {
  colIndex: number
  label: string
}

export interface CalendarGrid {
  columns: CalendarColumn[]
  monthLabels: MonthLabel[]
  weekdayLabels: string[] // length 7, aligned to the rows
  from: string
  to: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A month label spans ~2 narrow week columns — suppress any label this close to the previous one. */
const MIN_LABEL_GAP = 2

/** Month index 0–11 straight off the 'YYYY-MM-DD' key — no Date round-trip needed. */
const monthOf = (key: string): number => Number(key.slice(5, 7)) - 1

/** The key of the week-start on/before `key`, given the first weekday (0=Sun, 1=Mon). */
export function weekStartKey(key: string, weekStartsOn: 0 | 1): string {
  const offset = (weekdayIndex(key) - weekStartsOn + 7) % 7
  return addDaysToKey(key, -offset)
}

/** Bucket a raw intensity (daily_activity count) into a 0–4 heat level. Fixed thresholds keep the
 *  ramp stable over time and cheap to reason about; 0 means "no activity", not "future". */
export function intensityLevel(n: number): CalendarLevel {
  if (n <= 0) return 0
  if (n <= 2) return 1
  if (n <= 5) return 2
  if (n <= 9) return 3
  return 4
}

/**
 * Build the calendar grid ending at the week containing `todayKey`, spanning `weeks` columns,
 * left→old to right→new. Days after `todayKey` are `inFuture` (the rest of the current week
 * renders as empty placeholders). Intensities come from `byDay`; absent days are level 0.
 */
export function buildCalendarGrid(
  byDay: ReadonlyMap<string, number>,
  opts: { todayKey: string; weeks: number; weekStartsOn?: 0 | 1 }
): CalendarGrid {
  const weekStartsOn = opts.weekStartsOn ?? 0
  const weeks = Math.max(1, Math.floor(opts.weeks))
  const lastColStart = weekStartKey(opts.todayKey, weekStartsOn)
  const firstColStart = addDaysToKey(lastColStart, -(weeks - 1) * 7)

  const columns: CalendarColumn[] = []
  const monthLabels: MonthLabel[] = []
  // Seed month tracking from the week BEFORE the window, so column 0 is only labeled when it
  // genuinely starts a month; labels keep ≥ MIN_LABEL_GAP columns apart so they can't collide.
  let prevMonth = monthOf(addDaysToKey(firstColStart, -7))
  let lastLabelCol = -Infinity

  for (let c = 0; c < weeks; c++) {
    const weekStart = addDaysToKey(firstColStart, c * 7)
    const cells: CalendarCell[] = []
    for (let r = 0; r < 7; r++) {
      const dayKey = addDaysToKey(weekStart, r)
      const intensity = byDay.get(dayKey) ?? 0
      cells.push({ dayKey, intensity, level: intensityLevel(intensity), inFuture: dayKey > opts.todayKey })
    }
    columns.push({ weekStartKey: weekStart, cells })

    const month = monthOf(weekStart)
    if (month !== prevMonth) {
      if (c - lastLabelCol > MIN_LABEL_GAP) {
        monthLabels.push({ colIndex: c, label: MONTHS[month]! })
        lastLabelCol = c
      }
      prevMonth = month
    }
  }

  const weekdayLabels = Array.from({ length: 7 }, (_, r) => WEEKDAYS[(r + weekStartsOn) % 7]!)
  return {
    columns,
    monthLabels,
    weekdayLabels,
    from: firstColStart,
    to: addDaysToKey(lastColStart, 6)
  }
}
