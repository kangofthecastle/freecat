import { describe, expect, test } from 'vitest'
import { advanceIncubation, incubationProgress, isReady } from '../../src/shared/gamification/incubation'
import { REWARDS_CONFIG } from '../../src/shared/gamification/config'

describe('incubation', () => {
  test('advance adds one point per activity', () => {
    expect(advanceIncubation(0)).toBe(1)
    expect(advanceIncubation(149)).toBe(150)
  })
  test('isReady at threshold', () => {
    expect(isReady(REWARDS_CONFIG.incubationThreshold - 1)).toBe(false)
    expect(isReady(REWARDS_CONFIG.incubationThreshold)).toBe(true)
    expect(isReady(REWARDS_CONFIG.incubationThreshold + 5)).toBe(true)
  })
  test('progress is a 0..1 fraction, clamped', () => {
    expect(incubationProgress(0)).toBe(0)
    expect(incubationProgress(75)).toBeCloseTo(0.5)
    expect(incubationProgress(150)).toBe(1)
    expect(incubationProgress(300)).toBe(1)
  })
})
