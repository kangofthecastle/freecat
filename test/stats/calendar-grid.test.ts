import { describe, expect, test } from 'vitest'
import { buildCalendarGrid, intensityLevel, weekStartKey } from '../../src/renderer/src/stats/calendar-grid'

describe('calendar-grid', () => {
  test('intensity levels: fixed thresholds 0 / ≤2 / ≤5 / ≤9 / 10+', () => {
    expect(intensityLevel(0)).toBe(0)
    expect(intensityLevel(2)).toBe(1)
    expect(intensityLevel(3)).toBe(2)
    expect(intensityLevel(9)).toBe(3)
    expect(intensityLevel(10)).toBe(4)
  })

  test('weekStartKey: Sunday-start week containing a Friday', () => {
    expect(weekStartKey('2026-07-17', 0)).toBe('2026-07-12') // Fri → preceding Sun
    expect(weekStartKey('2026-07-12', 0)).toBe('2026-07-12') // Sun → itself
  })

  test('grid geometry: last column holds today; later days flagged inFuture; intensities land', () => {
    const grid = buildCalendarGrid(new Map([['2026-07-16', 4]]), { todayKey: '2026-07-17', weeks: 4 })
    expect(grid.columns).toHaveLength(4)
    const last = grid.columns[3]!
    expect(last.weekStartKey).toBe('2026-07-12')
    const thursday = last.cells[4]!
    expect(thursday.dayKey).toBe('2026-07-16')
    expect(thursday.level).toBe(2)
    expect(thursday.inFuture).toBe(false)
    const saturday = last.cells[6]!
    expect(saturday.inFuture).toBe(true) // 07-18 is beyond today
    expect(grid.from).toBe('2026-06-21')
    expect(grid.to).toBe('2026-07-18')
  })

  test('month labels only where a month genuinely starts inside the window', () => {
    const grid = buildCalendarGrid(new Map(), { todayKey: '2026-07-17', weeks: 8 })
    // window spans late May → July: expect labels for Jun and Jul, none claiming column 0's May
    const labels = grid.monthLabels.map((m) => m.label)
    expect(labels).toContain('Jul')
    expect(grid.monthLabels.every((m) => m.colIndex >= 0)).toBe(true)
    expect(labels).not.toContain('May')
  })
})
