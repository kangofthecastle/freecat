import type { PlanPoolDto } from '../../../shared/dto'
import { habitPacing, validatePacing, type PacingEdit, type PacingResult } from '../../../shared/plan/pacing'
import { addDaysToKey, dayNumberOfKey } from '../../../shared/gamification/dates'
import { clampInt } from './int-input'

/**
 * The pick-one-derive-the-other flashcard pacing editor, shared by the onboarding wizard and the
 * settings panel. It runs the SAME `validatePacing` the main process persists through (shared
 * module), so the live preview can never disagree with what a save will do. State lives in the
 * parent as a single `PacingEdit | null` — "which field the user last touched, and its value" —
 * which is exactly the shape `savePlanSettings` accepts.
 */
export interface TrianglePickerProps {
  pool: PlanPoolDto
  todayKey: string
  examDate: string | null // null = habit mode: only the daily-new field is editable
  finishBufferDays: number
  /** The persisted pair, shown until the user touches a field. */
  current: { dailyNewTarget: number | null; masteryGoalPct: number | null }
  edit: PacingEdit | null
  onEdit: (edit: PacingEdit) => void
}

/** The live outcome for an edit, or null when nothing has been touched yet. Exported so the wizard
 *  can gate its "Continue" button on feasibility with the identical computation. Both branches call
 *  the shared engine functions — nothing here re-derives pacing rules. */
export function pacingOutcome(
  props: Pick<TrianglePickerProps, 'pool' | 'todayKey' | 'examDate' | 'finishBufferDays' | 'edit'> & {
    currentDailyNew: number | null
  }
): PacingResult | null {
  const { pool, todayKey, examDate, finishBufferDays, edit } = props
  if (!edit) return null
  if (examDate == null) return habitPacing(edit, pool.dailyNewCeiling, props.currentDailyNew)
  const finishKey = addDaysToKey(examDate, -finishBufferDays)
  const daysToFinish = Math.max(0, dayNumberOfKey(finishKey) - dayNumberOfKey(todayKey))
  return validatePacing({
    deckSize: pool.deckSize,
    introducedSoFar: pool.introducedSoFar,
    daysToFinish,
    rampDays: pool.rampDays,
    dailyNewCeiling: pool.dailyNewCeiling,
    edit
  })
}

export function TrianglePicker(props: TrianglePickerProps): React.JSX.Element {
  const { pool, examDate, current, edit, onEdit } = props
  const outcome = pacingOutcome({ ...props, currentDailyNew: current.dailyNewTarget })

  if (pool.deckSize === 0) {
    return (
      <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
        No flashcard decks imported yet. Import a deck on the Flashcards page and set your pacing
        here any time — the plan works fine without it for now.
      </p>
    )
  }

  // What each field shows: the touched field shows the user's (already-clamped) value; the other
  // shows the derived answer only when the edit is VALID — a refused edit must never overwrite the
  // untouched field's persisted value with a placeholder. Before any touch, both show settings.
  const shownDailyNew =
    edit?.field === 'dailyNew' ? edit.value : outcome?.ok ? outcome.derived.dailyNew : current.dailyNewTarget
  const shownGoal =
    edit?.field === 'goalPct' ? edit.value : outcome?.ok ? outcome.derived.goalPct : current.masteryGoalPct

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">New cards / day</span>
          <input
            type="number"
            min={0}
            max={pool.dailyNewCeiling}
            value={shownDailyNew ?? ''}
            onChange={(e) => onEdit({ field: 'dailyNew', value: clampInt(e.target.value, pool.dailyNewCeiling) })}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-800"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Mastery goal %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={shownGoal ?? ''}
            disabled={examDate == null}
            onChange={(e) => onEdit({ field: 'goalPct', value: clampInt(e.target.value, 100) })}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-800 disabled:bg-gray-50 disabled:text-gray-400"
          />
        </label>
      </div>

      {examDate == null && (
        <p className="text-xs text-gray-500">
          No exam date, so there is nothing to pace a goal against — set the daily-new count you
          want to keep up.
        </p>
      )}

      {outcome && !outcome.ok && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {outcome.refusalReason}
        </p>
      )}
      {outcome?.ok && examDate != null && (
        <p className="text-sm text-emerald-700">
          {outcome.derived.dailyNew} new cards/day reaches {outcome.derived.goalPct}% of your deck by
          the finish date.
        </p>
      )}

      <p className="text-xs text-gray-400">
        {pool.introducedSoFar.toLocaleString()}/{pool.deckSize.toLocaleString()} cards introduced ·
        a card needs ~{pool.rampDays} days of reviews to mature · max {pool.dailyNewCeiling} new/day
      </p>
    </div>
  )
}
