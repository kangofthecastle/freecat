import { describe, expect, test } from 'vitest'
import { computeMastery, type MasteryAttempt } from '../../src/main/stats/mastery'
import { STATS_CONFIG } from '../../src/main/stats/config'

// Golden vectors adapted from sat-world's mastery.test.ts (identical semantics minus the
// difficulty map and exam-only branch). Divergence from these values is a red flag, not rounding.

const NOW = new Date('2026-07-17T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

const att = (over: Partial<MasteryAttempt> = {}): MasteryAttempt => ({
  questionId: 'q1', isCorrect: true, answeredAt: daysAgo(0), flagged: false, ...over
})

describe('computeMastery', () => {
  test('zero attempts ⇒ prior 0.5, nEff 0, needsData, not stale (nothing to be stale from)', () => {
    const r = computeMastery([], 10, NOW)
    expect(r.mastery).toBe(0.5)
    expect(r.nEff).toBe(0)
    expect(r.coverage).toBe(0)
    expect(r.needsData).toBe(true)
    expect(r.stale).toBe(false)
    expect(r.attempted).toBe(0)
  })

  test('more-recent correct ⇒ higher mastery than the same correct long ago', () => {
    const recent = computeMastery([att({ answeredAt: daysAgo(0) })], 10, NOW)
    const old = computeMastery([att({ answeredAt: daysAgo(60) })], 10, NOW)
    expect(recent.mastery).toBeGreaterThan(old.mastery)
    expect(recent.nEff).toBeGreaterThan(old.nEff)
  })

  test('decay drifts an untouched topic toward the 0.5 prior — decay halves per ~15d of τ=21', () => {
    const near = computeMastery([att({ answeredAt: daysAgo(1) })], 10, NOW)
    const far = computeMastery([att({ answeredAt: daysAgo(120) })], 10, NOW)
    expect(Math.abs(far.mastery - 0.5)).toBeLessThan(Math.abs(near.mastery - 0.5))
    // exact decay check at age = τ: w = exp(-1)
    const atTau = computeMastery([att({ answeredAt: daysAgo(21) })], 10, NOW)
    expect(atTau.nEff).toBeCloseTo(Math.exp(-1), 10)
  })

  test('flagged correct scores below unflagged correct (half evidence weight)', () => {
    const unflagged = computeMastery([att({ flagged: false })], 10, NOW)
    const flagged = computeMastery([att({ flagged: true })], 10, NOW)
    expect(flagged.mastery).toBeLessThan(unflagged.mastery)
    expect(flagged.nEff).toBeCloseTo(unflagged.nEff * STATS_CONFIG.mastery.flaggedCorrectWeight, 10)
  })

  test('flag discount only applies to correct — flagged incorrect is undiscounted', () => {
    const flaggedWrong = computeMastery([att({ isCorrect: false, flagged: true })], 10, NOW)
    const unflaggedWrong = computeMastery([att({ isCorrect: false, flagged: false })], 10, NOW)
    expect(flaggedWrong.mastery).toBeCloseTo(unflaggedWrong.mastery, 12)
    expect(flaggedWrong.nEff).toBeCloseTo(unflaggedWrong.nEff, 12)
  })

  test('stale boundary: strictly older than stalenessDays', () => {
    const fresh = computeMastery([att({ answeredAt: daysAgo(3) })], 10, NOW)
    const atLimit = computeMastery([att({ answeredAt: daysAgo(STATS_CONFIG.mastery.stalenessDays) })], 10, NOW)
    const past = computeMastery([att({ answeredAt: daysAgo(STATS_CONFIG.mastery.stalenessDays + 1) })], 10, NOW)
    expect(fresh.stale).toBe(false)
    expect(atLimit.stale).toBe(false) // exactly at the threshold is not yet stale (strict >)
    expect(past.stale).toBe(true)
  })

  test('needsData boundary at n_eff = 2 (strict <)', () => {
    const two = computeMastery([att({ questionId: 'q1' }), att({ questionId: 'q2' })], 10, NOW)
    expect(two.nEff).toBeCloseTo(2, 10)
    expect(two.needsData).toBe(false)
    expect(computeMastery([att()], 10, NOW).needsData).toBe(true)
  })

  test('coverage = distinct attempted / published, clamped; zero published never divides', () => {
    expect(computeMastery([att({ questionId: 'q1' }), att({ questionId: 'q2' })], 8, NOW).coverage).toBe(0.25)
    expect(computeMastery([att({ questionId: 'q1' }), att({ questionId: 'q2' })], 1, NOW).coverage).toBe(1)
    expect(computeMastery([att()], 0, NOW).coverage).toBe(0)
  })

  test('exact hand-computed case: 2 fresh correct at age 0 ⇒ (2 + 3·0.5)/(2 + 3) = 0.7', () => {
    const r = computeMastery([att({ questionId: 'q1' }), att({ questionId: 'q2' })], 4, NOW)
    expect(r.mastery).toBeCloseTo(0.7, 12)
    expect(r.nEff).toBeCloseTo(2, 12)
    expect(r.coverage).toBe(0.5)
  })

  test('exact hand-computed case: one flagged correct at 21d ⇒ w = e⁻¹·0.5', () => {
    const w = Math.exp(-1) * 0.5
    const r = computeMastery([att({ flagged: true, answeredAt: daysAgo(21) })], 4, NOW)
    expect(r.nEff).toBeCloseTo(w, 10)
    expect(r.mastery).toBeCloseTo((w + 3 * 0.5) / (w + 3), 10)
  })

  test('difficultyWeight passthrough scales evidence (defaults to 1.0)', () => {
    const base = computeMastery([att()], 10, NOW)
    const heavy = computeMastery([att({ difficultyWeight: 2 })], 10, NOW)
    expect(heavy.nEff).toBeCloseTo(base.nEff * 2, 10)
    expect(heavy.mastery).toBeGreaterThan(base.mastery)
  })

  test('union-rollup property: recomputing over concatenated streams sums evidence mass', () => {
    // asymmetric evidence (2 vs 1 attempts) so union and child-average genuinely diverge
    const a = [att({ questionId: 'q1' }), att({ questionId: 'q2' })]
    const b = [att({ questionId: 'q3', isCorrect: false })]
    const union = computeMastery([...a, ...b], 8, NOW) // (2 + 1.5)/(3 + 3) ≈ 0.583
    expect(union.nEff).toBeCloseTo(computeMastery(a, 4, NOW).nEff + computeMastery(b, 4, NOW).nEff, 10)
    // and is NOT the average of child mastery values (the failure mode the spec forbids)
    const avg = (computeMastery(a, 4, NOW).mastery + computeMastery(b, 4, NOW).mastery) / 2
    expect(union.mastery).not.toBeCloseTo(avg, 4)
  })
})
