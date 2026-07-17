import { PLAN_CONFIG } from './config'

/**
 * Per-track minute allocation — ported from sat-world's `allocateTrackBudget`, tracks renamed for
 * FreeCAT (vocab→flashcards, practice→questions; no mocks, ever). Pure + DB-free. Splits the day's
 * minutes into per-track caps that feed the planner's greedy fill.
 *
 * Ported rules:
 *  (a) Flashcards floor: never squeezed below the SRS due load (the schedule is already optimal).
 *  (b) Questions behind pace ⇒ mistake share ×0.5 (floored at min sizing); freed minutes flow to questions.
 *  (c) Unused share spills to questions (or back to flashcards' appetite when questions are gated off).
 *  (d) The total never exceeds budgetMinutes.
 */

export interface TrackBudgetInput {
  budgetMinutes: number
  flashcards?: { dueMinutes: number; newMinutes: number; capMinutes: number }
  mistakes?: { eligibleMinutes: number; shareCap: number; minMinutes?: number }
  questions?: { enabled: boolean; behindPace: boolean }
}

export interface TrackBudget {
  flashcards: number
  mistakes: number
  questions: number
}

export function allocateTrackBudget(input: TrackBudgetInput): TrackBudget {
  const budget = Math.max(0, input.budgetMinutes)
  if (budget === 0) return { flashcards: 0, mistakes: 0, questions: 0 }

  const f = input.flashcards
  const m = input.mistakes
  const questionsEnabled = input.questions?.enabled === true

  // Flashcards: floor = SRS due load, appetite = the day's introducible work, cap = flashcardsMaxMinutes.
  const dueMinutes = f ? Math.max(0, f.dueMinutes) : 0
  const newMinutes = f ? Math.max(0, f.newMinutes) : 0
  const appetite = Math.min(dueMinutes + newMinutes, budget)
  const capMinutes = f ? Math.max(0, f.capMinutes) : 0
  const floor = Math.min(dueMinutes, budget) // (a) never below the due load
  let flashcards = f ? Math.min(Math.max(floor, Math.min(appetite, capMinutes)), budget) : 0
  let remaining = budget - flashcards

  // Mistakes: its share cap, halved and floored when questions are behind pace (b); bounded by
  // what's actually eligible and by the remaining budget.
  let mistakes = 0
  if (m && remaining > 0) {
    const share = Math.max(0, m.shareCap)
    const minFloor = Math.min(Math.max(0, m.minMinutes ?? 0), share)
    const behind = questionsEnabled && input.questions?.behindPace === true
    const target = behind ? Math.max(share * 0.5, minFloor) : share
    mistakes = Math.min(target, Math.max(0, m.eligibleMinutes), remaining)
    remaining -= mistakes
  }

  // Remainder (c)/(d): to questions when the track has started; otherwise spill back to flashcards'
  // appetite (extra beyond that is a genuine rest gap).
  let questions = 0
  if (questionsEnabled) {
    questions = remaining
  } else {
    const spill = Math.min(remaining, Math.max(0, appetite - flashcards))
    flashcards += spill
  }

  return { flashcards, mistakes, questions }
}

/** Convenience: the mistake-review share cap for a day, in minutes. */
export function mistakeShareCap(budgetMinutes: number): number {
  return budgetMinutes * PLAN_CONFIG.mistakeReviewBudgetShare
}
