import { describe, expect, test } from 'vitest'
import { moodFromState } from '../../src/shared/gamification/wellbeing'

const LA = 'America/Los_Angeles'
const NOW = new Date('2026-06-08T17:00:00Z')
const sameDay = new Date('2026-06-08T15:00:00Z')
const oneDayAgo = new Date('2026-06-07T17:00:00Z')
const threeDaysAgo = new Date('2026-06-05T17:00:00Z')

describe('moodFromState', () => {
  test('studied today → full happiness, happy', () => {
    expect(moodFromState(100, sameDay, null, NOW, LA)).toEqual({ value: 100, level: 'happy' })
  })
  test('decays 20/day since last study', () => {
    expect(moodFromState(100, oneDayAgo, null, NOW, LA).value).toBe(80)
    expect(moodFromState(100, threeDaysAgo, null, NOW, LA).value).toBe(40)
  })
  test('floors at 25, never lower (never dies)', () => {
    expect(moodFromState(100, new Date('2026-05-01T17:00:00Z'), null, NOW, LA).value).toBe(25)
  })
  test('mood ladder: happy ≥85, sleeping ≥70, sad ≥50, else angry', () => {
    expect(moodFromState(85, sameDay, null, NOW, LA).level).toBe('happy')
    expect(moodFromState(84, sameDay, null, NOW, LA).level).toBe('sleeping')
    expect(moodFromState(70, sameDay, null, NOW, LA).level).toBe('sleeping')
    expect(moodFromState(69, sameDay, null, NOW, LA).level).toBe('sad')
    expect(moodFromState(50, sameDay, null, NOW, LA).level).toBe('sad')
    expect(moodFromState(49, sameDay, null, NOW, LA).level).toBe('angry')
  })
  test('treat adds a decaying boost within 12h, capped at 100', () => {
    const twoDaysAgo = new Date('2026-06-06T17:00:00Z')
    expect(moodFromState(100, twoDaysAgo, new Date(NOW.getTime()), NOW, LA).value).toBe(85)
    expect(moodFromState(100, twoDaysAgo, new Date(NOW.getTime() - 6 * 3600 * 1000), NOW, LA).value).toBe(73)
    expect(moodFromState(100, twoDaysAgo, new Date(NOW.getTime() - 13 * 3600 * 1000), NOW, LA).value).toBe(60)
    expect(moodFromState(100, twoDaysAgo, new Date(NOW.getTime() - 12 * 3600 * 1000), NOW, LA).value).toBe(60)
    expect(moodFromState(100, twoDaysAgo, new Date(NOW.getTime() + 3600 * 1000), NOW, LA).value).toBe(60)
  })
  test('treat never pushes above 100', () => {
    expect(moodFromState(100, sameDay, NOW, NOW, LA).value).toBe(100)
  })
})
