import { describe, expect, test } from 'vitest'
import {
  classifyFingerprints, timeBaselines, fingerprintEvidence, selectRecencyWindow,
  type FingerprintAttempt
} from '../../src/main/stats/fingerprints'

const NOW = new Date('2026-07-17T12:00:00Z')
const at = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000)

let nextId = 1
const att = (over: Partial<FingerprintAttempt> = {}): FingerprintAttempt => ({
  id: nextId++,
  questionId: `q${nextId}`,
  topic: 'physics.mechanics',
  section: 'chem-phys',
  chosen: 'A',
  isCorrect: true,
  timeMs: 60_000,
  answeredAt: at(0),
  ...over
})

/** Five timed correct attempts at 60s establish a section baseline (median 60s). */
const baselineFiller = (): FingerprintAttempt[] =>
  Array.from({ length: 5 }, (_, i) => att({ questionId: `bl${i}`, timeMs: 60_000, isCorrect: true }))

describe('timeBaselines', () => {
  test('per-section median from attempts with a recorded time; below-minimum sections absent', () => {
    const base = timeBaselines(baselineFiller())
    expect(base.get('chem-phys')).toBe(60_000)
    expect(base.has('psych-soc')).toBe(false)
    // 4 timed attempts is under the minimum ⇒ no baseline
    expect(timeBaselines(baselineFiller().slice(0, 4)).has('chem-phys')).toBe(false)
  })

  test('null timeMs joins nothing — untimed attempts never feed baselines', () => {
    const untimed = Array.from({ length: 10 }, (_, i) => att({ questionId: `u${i}`, timeMs: null }))
    expect(timeBaselines(untimed).size).toBe(0)
  })
})

describe('classifyFingerprints', () => {
  test('repeated distractor: same wrong letter ≥2× on one question, across attempts', () => {
    const attempts = [
      ...baselineFiller(),
      att({ questionId: 'rd', chosen: 'C', isCorrect: false, answeredAt: at(10) }),
      att({ questionId: 'rd', chosen: 'C', isCorrect: false, answeredAt: at(5) })
    ]
    const [fp] = classifyFingerprints(attempts, [])
    expect(fp!.dominantMode).toBe('repeated_distractor')
    expect(fingerprintEvidence(fp!)).toContain('same wrong answer')
  })

  test('careless-fast vs slow-wrong via the section median; priority favors the specific', () => {
    const attempts = [
      ...baselineFiller(),
      att({ questionId: 'fast', isCorrect: false, timeMs: 20_000 }), // < 0.5×60s
      att({ questionId: 'slow', isCorrect: false, timeMs: 100_000 }) // > 1.5×60s
    ]
    const [fp] = classifyFingerprints(attempts, [])
    expect(fp!.counts.careless_fast).toBe(1)
    expect(fp!.counts.slow_wrong).toBe(1)
    // tie at 1 each ⇒ dominance priority order picks slow_wrong over careless_fast
    expect(fp!.dominantMode).toBe('slow_wrong')
  })

  test('no baseline ⇒ time buckets inactive, errors fall through to standard', () => {
    const attempts = [
      att({ questionId: 'x', isCorrect: false, timeMs: 5_000 }) // absurdly fast, but no baseline
    ]
    const [fp] = classifyFingerprints(attempts, [])
    expect(fp!.dominantMode).toBe('standard')
  })

  test('untimed latest attempt never gets a time-based mode, even with a baseline', () => {
    const attempts = [...baselineFiller(), att({ questionId: 'nt', isCorrect: false, timeMs: null })]
    const [fp] = classifyFingerprints(attempts, [])
    expect(fp!.counts.standard).toBe(1)
    expect(fp!.counts.careless_fast).toBe(0)
  })

  test('only the LATEST attempt per question is classified; a later correct clears the miss', () => {
    const attempts = [
      att({ questionId: 'fixed', isCorrect: false, chosen: 'B', answeredAt: at(60) }),
      att({ questionId: 'fixed', isCorrect: true, chosen: 'A', answeredAt: at(1) })
    ]
    const [fp] = classifyFingerprints(attempts, [])
    expect(fp!.totalErrors).toBe(0)
    expect(fp!.dominantMode).toBe(null)
  })

  test('timestamp collision falls back to row-id tie-break', () => {
    const t = at(30)
    const attempts = [
      att({ id: 1000, questionId: 'tie', isCorrect: false, chosen: 'B', answeredAt: t }),
      att({ id: 1001, questionId: 'tie', isCorrect: true, chosen: 'A', answeredAt: t })
    ]
    const [fp] = classifyFingerprints(attempts, [])
    expect(fp!.totalErrors).toBe(0) // id 1001 (correct) wins
  })

  test('unsure-correct: correct + currently flagged counts separately, never as an error', () => {
    const attempts = [att({ questionId: 'uc', isCorrect: true })]
    const [fp] = classifyFingerprints(attempts, ['uc'])
    expect(fp!.unsureCorrectCount).toBe(1)
    expect(fp!.totalErrors).toBe(0)
    expect(fingerprintEvidence(fp!)).toContain('flagged as unsure')
  })

  test('groups by topic and sorts by slug', () => {
    const attempts = [
      att({ questionId: 'a', topic: 'physics.mechanics', isCorrect: false }),
      att({ questionId: 'b', topic: 'biochem.enzymes', isCorrect: false })
    ]
    const fps = classifyFingerprints(attempts, [])
    expect(fps.map((f) => f.topic)).toEqual(['biochem.enzymes', 'physics.mechanics'])
  })
})

describe('selectRecencyWindow (Phase 4 adaptive widening)', () => {
  const TZ = 'UTC'
  const TODAY = '2026-07-17'
  const CFG = { windowDays: 60, minWindowAttempts: 20 }
  const onDay = (day: string, id: number): { id: number; answeredAt: Date } => ({
    id,
    answeredAt: new Date(`${day}T12:00:00Z`)
  })
  const days = (n: number, from: string, perDay = 1): { id: number; answeredAt: Date }[] => {
    const out: { id: number; answeredAt: Date }[] = []
    let id = 1
    let day = from
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < perDay; k++) out.push(onDay(day, id++))
      day = day < '2027' ? `${day.slice(0, 8)}${String(Number(day.slice(8)) + 1).padStart(2, '0')}` : day
    }
    return out
  }

  test('enough recent attempts ⇒ the configured window stands, older history excluded', () => {
    const recent = days(20, '2026-07-01') // 20 attempts inside 60d
    const old = [onDay('2026-01-01', 999)]
    const w = selectRecencyWindow([...old, ...recent], TODAY, TZ, CFG)
    expect(w.widened).toBe(false)
    expect(w.days).toBe(60)
    expect(w.attempts).toHaveLength(20)
  })

  test('thin window with older history ⇒ widens in whole days to the Nth-most-recent attempt', () => {
    // 5 recent + 30 attempts ~100 days back: the 20th-most-recent lands on an old day.
    const recent = days(5, '2026-07-13')
    const old = days(1, '2026-04-01', 30) // all 30 on 2026-04-01 (107 days before today)
    const w = selectRecencyWindow([...old, ...recent], TODAY, TZ, CFG)
    expect(w.widened).toBe(true)
    expect(w.days).toBe(108) // 2026-04-01 .. 2026-07-17 inclusive
    expect(w.attempts).toHaveLength(35) // whole-day widening keeps every attempt of the anchor day
  })

  test('all history already inside the window ⇒ never widened, however thin', () => {
    const w = selectRecencyWindow(days(3, '2026-07-15'), TODAY, TZ, CFG)
    expect(w.widened).toBe(false)
    expect(w.days).toBe(60)
    expect(w.attempts).toHaveLength(3)
  })

  test('fewer than N attempts overall ⇒ widens to all of history', () => {
    const recent = days(2, '2026-07-16')
    const old = days(3, '2026-03-01')
    const w = selectRecencyWindow([...old, ...recent], TODAY, TZ, CFG)
    expect(w.widened).toBe(true)
    expect(w.attempts).toHaveLength(5)
  })
})
