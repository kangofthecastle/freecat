import { describe, it, expect } from 'vitest'
import { dayKeyInTz, prevDayKey, nextDayKey } from '../../src/shared/gamification/dates'

describe('date helpers', () => {
  it('formats a tz day key as YYYY-MM-DD', () => {
    expect(dayKeyInTz(new Date('2026-06-08T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-06-07')
    expect(dayKeyInTz(new Date('2026-06-08T03:00:00Z'), 'UTC')).toBe('2026-06-08')
  })
  it('steps days', () => {
    expect(prevDayKey('2026-06-01')).toBe('2026-05-31')
    expect(nextDayKey('2026-06-30')).toBe('2026-07-01')
  })
})
