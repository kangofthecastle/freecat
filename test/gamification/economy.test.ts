import { describe, expect, test } from 'vitest'
import { canAfford, coinsForActivity } from '../../src/shared/gamification/economy'
import { REWARDS_CONFIG } from '../../src/shared/gamification/config'

describe('coinsForActivity', () => {
  test('awards the configured per-activity coins', () => {
    expect(coinsForActivity()).toBe(REWARDS_CONFIG.coinsPerActivity)
  })
})

describe('canAfford', () => {
  test('true when balance ≥ price', () => {
    expect(canAfford(100, 100)).toBe(true)
    expect(canAfford(101, 100)).toBe(true)
  })
  test('false when balance < price', () => {
    expect(canAfford(99, 100)).toBe(false)
  })
})
