import { useState } from 'react'
import type { PlanPoolDto, PlanSettingsDto, SavePlanSettingsInput } from '../../../shared/dto'
import type { PacingEdit } from '../../../shared/plan/pacing'
import { DIAGNOSTIC_CONFIG } from '../../../shared/qbank/diagnostic'
import { TrianglePicker, pacingOutcome } from './TrianglePicker'
import { ComfortEditor, type DisciplineRef } from './ComfortEditor'
import { clampInt } from './int-input'

/**
 * The four-step plan setup: exam date → flashcard pacing → discipline comfort → daily budget,
 * then a post-save diagnostic offer (cold-start calibration; entirely optional).
 *
 * Everything is LOCAL STATE until the final step, which issues exactly one `saveSettings` call
 * (plus one `savePrefs` for rated disciplines) and only then tells the parent to refetch. This is
 * the deliberate defense against the onboarding-unmount-on-save regression sat-world hit in its
 * PR #35: no intermediate save can flip `onboardedAt` and cause the parent to swap this component
 * out from under the user mid-flow. Abandoning the wizard persists nothing. (The offer screen
 * renders AFTER everything is committed — abandoning it loses nothing either.)
 */
export function OnboardingWizard({
  pool,
  todayKey,
  disciplines,
  initial,
  onDone,
  onDiagnostic
}: {
  pool: PlanPoolDto
  todayKey: string
  disciplines: DisciplineRef[]
  initial: PlanSettingsDto
  onDone: () => void
  /** Navigate to the auto-started diagnostic session (settings are already saved by then). */
  onDiagnostic: () => void
}): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [examDate, setExamDate] = useState<string | null>(initial.examDate)
  const [pacingEdit, setPacingEdit] = useState<PacingEdit | null>(null)
  const [comfort, setComfort] = useState<Record<string, number | null>>({})
  const [budget, setBudget] = useState(initial.dailyBudgetMinutes)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Everything saved; showing the optional diagnostic offer. The parent is NOT told to refetch
  // yet (that would swap this wizard out for the dashboard from under the offer screen).
  const [finished, setFinished] = useState(false)

  const outcome = pacingOutcome({
    pool, todayKey, examDate, finishBufferDays: initial.finishBufferDays,
    currentDailyNew: initial.dailyNewTarget, edit: pacingEdit
  })
  // A refused (infeasible) goal blocks Continue; an untouched picker doesn't — pacing is optional.
  const pacingBlocked = outcome != null && !outcome.ok

  const finish = async (): Promise<void> => {
    setSaving(true)
    setSaveError(null)
    try {
      // Two-phase when a pacing edit exists: settings+pacing first, `onboarded` only once the
      // engine ACCEPTS the pacing. savePlanSettings persists non-pacing fields even on a refusal,
      // so a single combined call would mark onboarding done and this wizard would never reappear
      // after a restart — breaking "abandoning the wizard persists no finished onboarding".
      const base: SavePlanSettingsInput = { examDate, dailyBudgetMinutes: budget }
      if (pacingEdit) base.pacingEdit = pacingEdit
      else base.onboarded = true
      const res = await window.freecat.plan.saveSettings(base)
      if (!res.ok) {
        setSaveError('Could not save your plan settings just now. Please try again.')
        return
      }
      if (res.data.pacing && !res.data.pacing.ok) {
        // The engine is authoritative; if it refuses what the live preview allowed (the pool moved
        // under us), send the user back to the pacing step with the engine's reason.
        setSaveError(res.data.pacing.refusalReason ?? 'That pacing goal is not reachable.')
        setStep(1)
        return
      }
      if (pacingEdit) {
        const onboardRes = await window.freecat.plan.saveSettings({ onboarded: true })
        if (!onboardRes.ok) {
          setSaveError('Could not save your plan settings just now. Please try again.')
          return
        }
      }
      const prefRows = Object.entries(comfort)
        .filter(([, v]) => v != null)
        .map(([taxonomyRef, v]) => ({ taxonomyRef, comfort: v, excluded: false }))
      if (prefRows.length > 0) {
        const prefRes = await window.freecat.plan.savePrefs(prefRows)
        // Settings (incl. onboarded) are already committed — a prefs failure downgrades to a
        // console note; comfort is editable any time in Plan settings.
        if (!prefRes.ok) console.error('savePrefs failed during onboarding', prefRes.error)
      }
      setFinished(true)
    } catch (e) {
      console.error('onboarding save threw', e)
      setSaveError('Could not save your plan settings just now. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const steps = ['Exam date', 'Flashcards', 'Comfort', 'Budget']

  if (finished) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-gray-100">
          <h2 className="text-3xl font-bold text-gray-800">Your plan is ready 🎉</h2>
          <p className="mx-auto mt-3 max-w-md text-gray-600">
            Want to calibrate it first? A quick diagnostic — about {DIAGNOSTIC_CONFIG.targetTotal}{' '}
            questions across every discipline — gives the plan real evidence to start from instead
            of guesses.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onDiagnostic}
              className="rounded-lg bg-violet-600 px-5 py-2.5 font-semibold text-white hover:bg-violet-700"
            >
              Start diagnostic
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-lg bg-gray-100 px-5 py-2.5 font-semibold text-gray-600 hover:bg-gray-200"
            >
              Skip for now
            </button>
          </div>
          <p className="mt-4 text-xs text-gray-400">
            Totally optional — the plan self-corrects as you practice either way.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h2 className="text-3xl font-bold text-gray-800">Set up your plan</h2>
      <ol className="mt-4 flex gap-2" aria-label="Setup steps">
        {steps.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
            }`}
          >
            {s}
          </li>
        ))}
      </ol>

      {saveError && (
        <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {saveError}
        </p>
      )}

      <div className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-gray-100">
        {step === 0 && (
          <div className="space-y-4">
            <p className="text-gray-600">
              When is your MCAT? Everything paces backward from this — and you can change it any
              time.
            </p>
            <input
              type="date"
              min={todayKey}
              value={examDate ?? ''}
              onChange={(e) => setExamDate(e.target.value || null)}
              aria-label="Exam date"
              className="rounded-lg border border-gray-200 px-3 py-2 text-gray-800"
            />
            <p className="text-sm text-gray-400">
              No date yet? Leave it blank — the plan runs in habit mode (daily structure, no
              countdown) until you set one.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-gray-600">
              How should flashcards pace? Set either number — the other follows. The plan will never
              raise this on its own.
            </p>
            <TrianglePicker
              pool={pool}
              todayKey={todayKey}
              examDate={examDate}
              finishBufferDays={initial.finishBufferDays}
              current={{ dailyNewTarget: initial.dailyNewTarget, masteryGoalPct: initial.masteryGoalPct }}
              edit={pacingEdit}
              onEdit={setPacingEdit}
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-gray-600">
              How comfortable do you feel with each area? This only nudges where the plan starts —
              your real results take over as you practice. Skip anything you're unsure about.
            </p>
            <ComfortEditor
              disciplines={disciplines}
              comfort={comfort}
              onComfort={(key, value) => setComfort((c) => ({ ...c, [key]: value }))}
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-gray-600">About how many minutes a day do you want to study?</p>
            <div className="flex items-center gap-2">
              {[30, 45, 60, 90, 120].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setBudget(m)}
                  aria-pressed={budget === m}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    budget === m ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {m}m
                </button>
              ))}
              <input
                type="number"
                min={0}
                max={720}
                value={budget}
                onChange={(e) => setBudget(clampInt(e.target.value, 720))}
                aria-label="Daily budget minutes"
                className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-gray-800"
              />
            </div>
            <p className="text-sm text-gray-400">
              The plan fills this budget from FSRS reviews first, then your weakest topics. Lessons
              it suggests are always extra, never counted against it.
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || saving}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 disabled:invisible"
        >
          ← Back
        </button>
        {step < steps.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={step === 1 && pacingBlocked}
            className="rounded-lg bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Continue →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void finish()}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Start planning'}
          </button>
        )}
      </div>
    </div>
  )
}
