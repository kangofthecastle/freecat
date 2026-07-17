import { describe, expect, test } from 'vitest'
import { comfortToPrior, comfortNeedFactor, plannerShrunkMastery, UNRATED_PRIOR } from '../../src/main/plan/comfort'
import { PLAN_CONFIG } from '../../src/main/plan/config'

describe('comfort → planner priors (ported exactness)', () => {
  test('prior mapping 1→0.2 … 5→0.8; unrated/out-of-range → 0.5', () => {
    expect(comfortToPrior(1)).toBe(0.2)
    expect(comfortToPrior(2)).toBe(0.35)
    expect(comfortToPrior(3)).toBe(0.5)
    expect(comfortToPrior(4)).toBe(0.65)
    expect(comfortToPrior(5)).toBe(0.8)
    expect(comfortToPrior(null)).toBe(UNRATED_PRIOR)
    expect(comfortToPrior(undefined)).toBe(UNRATED_PRIOR)
  })

  test('need factor 1.5 − p0: comfort 1 → ×1.3, 5 → ×0.7, unrated → EXACTLY ×1.0', () => {
    expect(comfortNeedFactor(1)).toBeCloseTo(1.3, 12)
    expect(comfortNeedFactor(5)).toBeCloseTo(0.7, 12)
    expect(comfortNeedFactor(null)).toBe(1.0)
  })
})

describe('plannerShrunkMastery (closed-form prior swap)', () => {
  test("m' = m + k(p0'−p0)/(nEff+k), exact", () => {
    const k = PLAN_CONFIG.priorK
    // comfort 5 (p0' = 0.8) with 1 unit of evidence at m = 0.6
    expect(plannerShrunkMastery(0.6, 1, 5)).toBeCloseTo(0.6 + (k * 0.3) / (1 + k), 12)
  })

  test('unrated comfort changes nothing', () => {
    expect(plannerShrunkMastery(0.42, 3, null)).toBe(0.42)
  })

  test('evidence washes the prior out: large nEff ⇒ comfort barely moves mastery', () => {
    const light = plannerShrunkMastery(0.5, 0, 1)
    const heavy = plannerShrunkMastery(0.5, 100, 1)
    expect(Math.abs(light - 0.5)).toBeGreaterThan(Math.abs(heavy - 0.5))
    expect(Math.abs(heavy - 0.5)).toBeLessThan(0.01)
  })
})
