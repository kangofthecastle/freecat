import { describe, expect, test } from 'vitest'
import { allocateTrackBudget, mistakeShareCap } from '../../src/main/plan/track-budget'

describe('allocateTrackBudget (ported rules)', () => {
  test('back-compat shape: nothing behind pace, all tracks live ⇒ flashcards capped, mistakes at share, rest to questions', () => {
    const b = allocateTrackBudget({
      budgetMinutes: 60,
      flashcards: { dueMinutes: 10, newMinutes: 6, capMinutes: 20 },
      mistakes: { eligibleMinutes: 30, shareCap: mistakeShareCap(60), minMinutes: 7.5 },
      questions: { enabled: true, behindPace: false }
    })
    expect(b.flashcards).toBe(16) // appetite (16) under the cap
    expect(b.mistakes).toBe(24) // 60 × 0.4 share
    expect(b.questions).toBe(20) // remainder
  })

  test('(a) flashcards never squeezed below the SRS due load, even over the cap', () => {
    const b = allocateTrackBudget({
      budgetMinutes: 60,
      flashcards: { dueMinutes: 35, newMinutes: 0, capMinutes: 20 },
      questions: { enabled: true, behindPace: false }
    })
    expect(b.flashcards).toBe(35) // due-load floor beats the 20-minute cap
  })

  test('(b) behind pace halves the mistake share, floored at min sizing; freed minutes reach questions', () => {
    const onPace = allocateTrackBudget({
      budgetMinutes: 60,
      mistakes: { eligibleMinutes: 60, shareCap: 24, minMinutes: 7.5 },
      questions: { enabled: true, behindPace: false }
    })
    const behind = allocateTrackBudget({
      budgetMinutes: 60,
      mistakes: { eligibleMinutes: 60, shareCap: 24, minMinutes: 7.5 },
      questions: { enabled: true, behindPace: true }
    })
    expect(onPace.mistakes).toBe(24)
    expect(behind.mistakes).toBe(12)
    expect(behind.questions).toBe(onPace.questions + 12)
  })

  test('(c) with questions gated off, the remainder spills back only up to flashcards appetite', () => {
    const b = allocateTrackBudget({
      budgetMinutes: 60,
      flashcards: { dueMinutes: 10, newMinutes: 20, capMinutes: 20 },
      questions: { enabled: false, behindPace: false }
    })
    expect(b.questions).toBe(0)
    expect(b.flashcards).toBe(30) // cap 20 lifted by spill up to the 30-minute appetite, not to 60
  })

  test('(d) totals never exceed budget; zero budget ⇒ all zero', () => {
    const b = allocateTrackBudget({
      budgetMinutes: 15,
      flashcards: { dueMinutes: 10, newMinutes: 10, capMinutes: 20 },
      mistakes: { eligibleMinutes: 60, shareCap: 6 },
      questions: { enabled: true, behindPace: false }
    })
    expect(b.flashcards + b.mistakes + b.questions).toBeLessThanOrEqual(15)
    expect(allocateTrackBudget({ budgetMinutes: 0 })).toEqual({ flashcards: 0, mistakes: 0, questions: 0 })
  })
})
