import { useState } from 'react'
import type { PlanView, SavePlanSettingsInput } from '../../../shared/dto'
import type { PacingEdit } from '../../../shared/plan/pacing'
import { TrianglePicker } from './TrianglePicker'
import { ComfortEditor, type DisciplineRef } from './ComfortEditor'
import { clampInt } from './int-input'

/**
 * The full settings panel: everything the wizard collects plus the knobs it deliberately skips
 * (buffers, questions window, new-card order, exclusions). Drafts are local; Save issues one
 * `saveSettings` (+ one `savePrefs` when ratings changed) and closes on success. A pacing refusal
 * keeps the panel open with the engine's reason — other fields still saved (engine semantics).
 */
export function PlanSettings({
  view,
  disciplines,
  onSaved,
  onClose
}: {
  view: PlanView
  disciplines: DisciplineRef[]
  onSaved: () => Promise<void> | void
  onClose: () => void
}): React.JSX.Element {
  const s = view.settings
  const todayKey = view.days[0]?.day ?? ''
  const [examDate, setExamDate] = useState<string | null>(s.examDate)
  const [budget, setBudget] = useState(s.dailyBudgetMinutes)
  const [finishBufferDays, setFinishBufferDays] = useState(s.finishBufferDays)
  const [questionsStartDay, setQuestionsStartDay] = useState<string | null>(s.questionsStartDay)
  const [questionsFinishBufferDays, setQuestionsFinishBufferDays] = useState(s.questionsFinishBufferDays)
  const [newCardOrder, setNewCardOrder] = useState(s.newCardOrder)
  const [pacingEdit, setPacingEdit] = useState<PacingEdit | null>(null)

  const initialComfort: Record<string, number | null> = {}
  const initialExcluded: Record<string, boolean> = {}
  for (const d of disciplines) {
    const pref = view.prefs.find((p) => p.taxonomyRef === d.key)
    initialComfort[d.key] = pref?.comfort ?? null
    initialExcluded[d.key] = pref?.excluded ?? false
  }
  const [comfort, setComfort] = useState(initialComfort)
  const [excluded, setExcluded] = useState(initialExcluded)
  const [prefsDirty, setPrefsDirty] = useState(false)

  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setSaving(true)
    setNotice(null)
    try {
      const input: SavePlanSettingsInput = {
        examDate,
        dailyBudgetMinutes: budget,
        finishBufferDays,
        questionsStartDay,
        questionsFinishBufferDays,
        newCardOrder
      }
      if (pacingEdit) input.pacingEdit = pacingEdit
      const res = await window.freecat.plan.saveSettings(input)
      if (!res.ok) {
        setNotice('Could not save just now. Please try again.')
        return
      }
      if (prefsDirty) {
        const rows = disciplines.map((d) => ({
          taxonomyRef: d.key,
          comfort: comfort[d.key] ?? null,
          excluded: excluded[d.key] ?? false
        }))
        const prefRes = await window.freecat.plan.savePrefs(rows)
        if (!prefRes.ok) {
          setNotice('Settings saved, but comfort ratings did not — please retry.')
          await onSaved()
          return
        }
      }
      await onSaved()
      if (res.data.pacing && !res.data.pacing.ok) {
        // Everything else saved; the pacing goal was refused — stay open and show why.
        setPacingEdit(null)
        setNotice(res.data.pacing.refusalReason ?? 'That pacing goal is not reachable.')
        return
      }
      onClose()
    } catch (e) {
      console.error('plan settings save threw', e)
      setNotice('Could not save just now. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const numInput = (value: number, set: (n: number) => void, max: number): React.JSX.Element => (
    <input
      type="number"
      min={0}
      max={max}
      value={value}
      onChange={(e) => set(clampInt(e.target.value, max))}
      className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-gray-800"
    />
  )

  return (
    <div className="space-y-6">
      {notice && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {notice}
        </p>
      )}

      <section className="rounded-2xl bg-white p-6 ring-1 ring-gray-100">
        <h3 className="font-semibold text-gray-800">Exam & budget</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Exam date</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="date"
                value={examDate ?? ''}
                onChange={(e) => setExamDate(e.target.value || null)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-gray-800"
              />
              {examDate && (
                <button type="button" onClick={() => setExamDate(null)} className="text-xs text-gray-400 underline">
                  clear
                </button>
              )}
            </div>
            <span className="mt-1 block text-xs text-gray-400">
              Moving it closer re-derives your goal down — never your daily workload up.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Daily budget (minutes)</span>
            <div className="mt-1">{numInput(budget, setBudget, 720)}</div>
          </label>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-gray-100">
        <h3 className="font-semibold text-gray-800">Flashcard pacing</h3>
        <div className="mt-4">
          <TrianglePicker
            pool={view.pool}
            todayKey={todayKey}
            examDate={examDate}
            finishBufferDays={finishBufferDays}
            current={{ dailyNewTarget: s.dailyNewTarget, masteryGoalPct: s.masteryGoalPct }}
            edit={pacingEdit}
            onEdit={setPacingEdit}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Finish buffer (days before exam)</span>
            <div className="mt-1">{numInput(finishBufferDays, setFinishBufferDays, 3650)}</div>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">New-card order</span>
            <div className="mt-1 flex gap-2">
              {(['deck', 'shuffled'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setNewCardOrder(o)}
                  aria-pressed={newCardOrder === o}
                  className={`rounded-lg px-3 py-2 text-sm font-medium capitalize ${
                    newCardOrder === o ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </label>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-gray-100">
        <h3 className="font-semibold text-gray-800">Questions window</h3>
        <p className="mt-1 text-xs text-gray-400">
          {view.questions.attemptedDistinct.toLocaleString()} of {view.questions.publishedTotal.toLocaleString()} bank
          questions attempted.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Start day</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="date"
                value={questionsStartDay ?? ''}
                onChange={(e) => setQuestionsStartDay(e.target.value || null)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-gray-800"
              />
              {questionsStartDay && (
                <button type="button" onClick={() => setQuestionsStartDay(null)} className="text-xs text-gray-400 underline">
                  clear
                </button>
              )}
            </div>
            <span className="mt-1 block text-xs text-gray-400">Blank = from your first attempt.</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Finish buffer (days before exam)</span>
            <div className="mt-1">{numInput(questionsFinishBufferDays, setQuestionsFinishBufferDays, 3650)}</div>
          </label>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-gray-100">
        <h3 className="font-semibold text-gray-800">Discipline comfort</h3>
        <p className="mt-1 text-xs text-gray-400">
          Nudges the planner's starting point only — Stats never sees these. Excluded disciplines get
          no planned practice.
        </p>
        <div className="mt-4">
          <ComfortEditor
            disciplines={disciplines}
            comfort={comfort}
            onComfort={(key, value) => {
              setComfort((c) => ({ ...c, [key]: value }))
              setPrefsDirty(true)
            }}
            excluded={excluded}
            onToggleExcluded={(key) => {
              setExcluded((e) => ({ ...e, [key]: !e[key] }))
              setPrefsDirty(true)
            }}
          />
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
