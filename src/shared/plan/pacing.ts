/**
 * Flashcard pacing triangle — ported from sat-world's `vocabTriangle`, with `rampDays` supplied by
 * the FSRS simulation (main's `fsrs-ramp.ts`) instead of an SM-2 interval walk. Pure + DB-free.
 *
 * Lives in `shared/` (like the gamification economy math) because BOTH processes run it: the main
 * process persists through it (`savePlanSettings` is authoritative), and the onboarding wizard /
 * settings panel run the SAME functions synchronously for live pick-one-derive-the-other feedback —
 * one implementation, so the preview can never disagree with what a save will do.
 *
 * The triangle couples three user-facing quantities once an exam date fixes the finish date:
 *   introductionsNeeded ── requiredDailyNew(goalPct) ──▶ dailyNew
 *                       ◀── reachableGoalPct(dailyNew) ──
 * The schedulable promise is INTRODUCTIONS (never mastery itself — cards lapse): a card must be
 * introduced `rampDays` before the finish date to have time to climb to a ≥21-day interval.
 */

export interface TriangleInput {
  deckSize: number // reviewable cards across all imported decks
  introducedSoFar: number // cards with a scheduling row
  goalPct: number // 0–100, the mastery-goal input to derive requiredDailyNew from
  dailyNew: number // the daily-new input to derive reachableGoalPct from
  daysToFinish: number // whole days from today to finishDate (examDate − buffer)
  rampDays: number // from computeRampDays() — passed in so this stays pure and test-cheap
  dailyNewCeiling: number // the reviewer's real per-day limit (NEW_PER_DAY) — never promise past it
}

export interface Triangle {
  rampDays: number
  /** Effective pacing window = max(1, daysToFinish − rampDays); never 0 so we never divide by zero
   *  and a window at/inside the ramp collapses to "introduce everything now" (which then trips the
   *  ceiling refusal). */
  window: number
  introductionsNeeded: number // max(0, ceil(goalPct/100 × deckSize) − introducedSoFar)
  /** New cards/day required to introduce them all within the window. RAW (may exceed the ceiling —
   *  that is how infeasibility is detected); 0 when the goal is already met. */
  requiredDailyNew: number
  /** Goal % reachable at `dailyNew` — the inverse derivation, floored (never over-promise). */
  reachableGoalPct: number
  dailyNewCeiling: number
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** The one clamp for a user-entered daily-new count — every write path (triangle validation AND the
 *  habit-mode direct store) goes through here, so the ceiling rule can never fork. */
export function clampDailyNew(value: number, ceiling: number): number {
  return clamp(Math.round(value), 0, ceiling)
}

export function flashcardTriangle(input: TriangleInput): Triangle {
  const { deckSize, introducedSoFar, rampDays, dailyNewCeiling } = input
  const window = Math.max(1, input.daysToFinish - rampDays)

  const goalPct = clamp(input.goalPct, 0, 100)
  const dailyNew = clamp(input.dailyNew, 0, dailyNewCeiling)

  const goalTarget = Math.ceil((goalPct / 100) * Math.max(0, deckSize))
  const introductionsNeeded = Math.max(0, goalTarget - Math.max(0, introducedSoFar))
  const requiredDailyNew = Math.ceil(introductionsNeeded / window)

  const reachableIntros = Math.max(0, introducedSoFar) + dailyNew * window
  const reachableGoalPct = deckSize <= 0 ? 100 : clamp(Math.floor((reachableIntros / deckSize) * 100), 0, 100)

  return { rampDays, window, introductionsNeeded, requiredDailyNew, reachableGoalPct, dailyNewCeiling }
}

export type PacingEdit =
  | { field: 'dailyNew'; value: number }
  | { field: 'goalPct'; value: number }

export interface ValidatePacingInput {
  deckSize: number
  introducedSoFar: number
  daysToFinish: number
  rampDays: number
  dailyNewCeiling: number
  edit: PacingEdit
}

export interface PacingResult {
  ok: boolean
  derived: { dailyNew: number; goalPct: number }
  refusalReason?: string
}

/**
 * The single pure validator (ported rule intact): editing `dailyNew` derives the goal DOWN and is
 * ALWAYS allowed — never silently raise the user's workload. Only a `goalPct` edit can be refused,
 * and only when the required daily-new count exceeds the reviewer's ceiling; the refusal still
 * reports the over-ceiling count so the UI can show it.
 */
export function validatePacing(input: ValidatePacingInput): PacingResult {
  const { deckSize, introducedSoFar, daysToFinish, rampDays, dailyNewCeiling, edit } = input
  const base = { deckSize, introducedSoFar, daysToFinish, rampDays, dailyNewCeiling }

  if (edit.field === 'dailyNew') {
    const tri = flashcardTriangle({ ...base, goalPct: 0, dailyNew: edit.value })
    const dailyNew = clamp(edit.value, 0, dailyNewCeiling)
    return { ok: true, derived: { dailyNew, goalPct: tri.reachableGoalPct } }
  }

  const tri = flashcardTriangle({ ...base, goalPct: edit.value, dailyNew: 0 })
  const goalPct = clamp(edit.value, 0, 100)
  if (tri.requiredDailyNew > dailyNewCeiling) {
    return {
      ok: false,
      derived: { dailyNew: tri.requiredDailyNew, goalPct },
      refusalReason: `${goalPct}% by the finish date needs ${tri.requiredDailyNew} new cards/day (max ${dailyNewCeiling}/day)`
    }
  }
  return { ok: true, derived: { dailyNew: tri.requiredDailyNew, goalPct } }
}
