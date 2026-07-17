import { describe, it, expect } from 'vitest'
import { buildMasteryTrend, type TrendAttempt } from '../../src/main/stats/mastery-trend'
import { STATS_CONFIG } from '../../src/main/stats/config'
import { addDaysToKey } from '../../src/shared/gamification/dates'
import type { SectionCode } from '../../src/main/content/types'

const TZ = 'UTC'
const TODAY = '2026-07-17'
const PUBLISHED: Record<SectionCode, number> = { 'chem-phys': 10, 'bio-biochem': 10, 'psych-soc': 10 }

let nextId = 1
function ta(
  questionId: string,
  day: string,
  isCorrect: boolean,
  over: Partial<TrendAttempt> = {}
): TrendAttempt {
  return {
    id: nextId++,
    questionId,
    section: 'chem-phys',
    isCorrect,
    answeredAt: new Date(`${day}T12:00:00Z`),
    flagged: false,
    ...over
  }
}

describe('buildMasteryTrend', () => {
  it('no attempts ⇒ empty trend (nothing to say)', () => {
    expect(buildMasteryTrend([], PUBLISHED, TODAY, TZ)).toEqual([])
  })

  it('range runs from the FIRST attempt day through today, one entry per day', () => {
    const trend = buildMasteryTrend([ta('q1', '2026-07-15', true)], PUBLISHED, TODAY, TZ)
    expect(trend.map((d) => d.day)).toEqual(['2026-07-15', '2026-07-16', '2026-07-17'])
  })

  it('a section stays null (needs data) until its evidence clears the floor; others stay null throughout', () => {
    // One attempt: nEff ≈ 1 < needsDataNEff(2) ⇒ null. Three attempts (fresh) ⇒ ≈3 ⇒ scored.
    const attempts = [
      ta('q1', '2026-07-15', true),
      ta('q2', '2026-07-16', true),
      ta('q3', '2026-07-16', true)
    ]
    const trend = buildMasteryTrend(attempts, PUBLISHED, TODAY, TZ)
    expect(trend[0]!.sections['chem-phys']).toBeNull() // only q1 so far
    expect(trend[1]!.sections['chem-phys']).not.toBeNull() // all three landed
    // Sections without any attempts never invent a score.
    for (const d of trend) {
      expect(d.sections['bio-biochem']).toBeNull()
      expect(d.sections['psych-soc']).toBeNull()
    }
  })

  it('as-of-day: a later correction lifts the line only FROM its day (latest-attempt-per-question per day)', () => {
    const attempts = [
      // Background evidence so the section clears needsData from day one.
      ta('bg1', '2026-07-13', true),
      ta('bg2', '2026-07-13', true),
      ta('bg3', '2026-07-13', true),
      // q4 answered wrong on the 13th, corrected on the 16th.
      ta('q4', '2026-07-13', false),
      ta('q4', '2026-07-16', true)
    ]
    const trend = buildMasteryTrend(attempts, PUBLISHED, TODAY, TZ)
    const at = (day: string): number => trend.find((d) => d.day === day)!.sections['chem-phys']!
    // Before the correction the wrong attempt is q4's latest; after, the correct one replaces it.
    expect(at('2026-07-15')).toBeLessThan(at('2026-07-16'))
    // And the pre-correction days matched what the live panel would have said then: 3/4 correct-ish.
    expect(at('2026-07-14')).toBeCloseTo(at('2026-07-15'), 1)
  })

  it('caps the range at trendDays but still folds OLDER history into the earliest point', () => {
    const old = ta('q-old', '2025-12-01', true) // far outside the window
    const recent = ta('q-new', TODAY, true)
    const trend = buildMasteryTrend([old, recent], PUBLISHED, TODAY, TZ)
    expect(trend).toHaveLength(STATS_CONFIG.mastery.trendDays)
    expect(trend[0]!.day).toBe(addDaysToKey(TODAY, -(STATS_CONFIG.mastery.trendDays - 1)))
    // The old attempt exists in the earliest day's latest-map (decayed to near-zero weight, so the
    // section is still below the needs-data floor — null, not a fake score).
    expect(trend[0]!.sections['chem-phys']).toBeNull()
  })

  it('a flagged-correct latest attempt carries half weight, exactly like the live panel', () => {
    const base = [
      ta('q1', '2026-07-16', true),
      ta('q2', '2026-07-16', true),
      ta('q3', '2026-07-16', true)
    ]
    const unflagged = buildMasteryTrend([...base, ta('q4', '2026-07-16', true)], PUBLISHED, TODAY, TZ)
    const flagged = buildMasteryTrend(
      [...base, ta('q4', '2026-07-16', true, { flagged: true })],
      PUBLISHED,
      TODAY,
      TZ
    )
    const last = (t: typeof unflagged): number => t[t.length - 1]!.sections['chem-phys']!
    expect(last(flagged)).toBeLessThan(last(unflagged))
  })
})
