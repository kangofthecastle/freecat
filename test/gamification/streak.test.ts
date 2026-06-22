import { describe, it, expect } from 'vitest'
import { streakDays } from '../../src/shared/gamification/streak'

const TZ = 'UTC'
const NOW = new Date('2026-06-22T12:00:00Z')

describe('streakDays', () => {
  it('counts consecutive active days ending today', () => {
    expect(streakDays(new Set(['2026-06-22', '2026-06-21', '2026-06-20']), NOW, TZ)).toBe(3)
  })
  it('today-with-zero does not break a live streak', () => {
    expect(streakDays(new Set(['2026-06-21', '2026-06-20']), NOW, TZ)).toBe(2)
  })
  it('a gap ends the streak', () => {
    expect(streakDays(new Set(['2026-06-22', '2026-06-20']), NOW, TZ)).toBe(1)
  })
  it('no activity → 0', () => {
    expect(streakDays(new Set(), NOW, TZ)).toBe(0)
  })
})
