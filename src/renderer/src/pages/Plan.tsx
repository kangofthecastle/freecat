import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageProps } from '../App'
import type { ActivityResult, PlanTaskDto, PlanTaskStatus, PlanView } from '../../../shared/dto'
import { REWARDS_CONFIG } from '../../../shared/gamification/config'
import { dayNumberOfKey } from '../../../shared/gamification/dates'
import { errorMessage } from '../gamification/labels'
import { OnboardingWizard } from '../plan/OnboardingWizard'
import { PlanSettings } from '../plan/PlanSettings'
import { ProgressStrip } from '../plan/ProgressStrip'
import { WeekStrip } from '../plan/WeekStrip'
import { TaskList } from '../plan/TaskList'
import type { DisciplineRef } from '../plan/ComfortEditor'

export default function Plan(props: PageProps): React.JSX.Element {
  const { navigate } = props
  const [view, setView] = useState<PlanView | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [disciplines, setDisciplines] = useState<DisciplineRef[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(null) // null = today
  const [celebration, setCelebration] = useState<ActivityResult | null>(null)
  const [nudgeDismissed, setNudgeDismissed] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Overlapping loads (rapid Done/Skip clicks each refetch) may resolve out of order over IPC;
  // only the newest request may land, or a stale snapshot would visually revert the later click.
  const loadReqRef = useRef(0)
  const load = useCallback(async (): Promise<void> => {
    const reqId = ++loadReqRef.current
    try {
      const next = await window.freecat.plan.get()
      if (reqId !== loadReqRef.current) return
      setView(next)
      setLoadFailed(false)
    } catch (e) {
      console.error('Failed to load plan', e)
      if (reqId === loadReqRef.current) setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
    window.freecat.taxonomy
      .list()
      .then((tree) => setDisciplines(tree.map((d) => ({ key: d.discipline, title: d.title }))))
      .catch((e) => console.error('Failed to load taxonomy for plan', e))
  }, [load])

  const setStatus = useCallback(
    async (task: PlanTaskDto, status: Exclude<PlanTaskStatus, 'expired'>): Promise<void> => {
      try {
        const res = await window.freecat.plan.setTaskStatus({ taskId: task.id, status })
        if (res.ok) {
          setActionError(null)
          if (res.data.activity) setCelebration(res.data.activity)
          else if (status !== 'completed') setCelebration(null)
        } else {
          // e.g. not-found when a debounced regeneration replaced the task under this click.
          setActionError(errorMessage(res.error))
        }
      } catch (e) {
        console.error('setTaskStatus failed', e)
        setActionError('That change did not save just now. Please try again.')
      } finally {
        await load()
      }
    },
    [load]
  )

  /** Deep-link into the module that does the work; a pending task flips to 'started' on the way.
   *  Fire-and-forget by design (navigation must not wait on the write) — remounting Plan reloads
   *  fresh state, so the worst failure mode is a task still showing its pre-click label. */
  const openTask = useCallback(
    (task: PlanTaskDto): void => {
      if (task.status === 'pending') {
        window.freecat.plan
          .setTaskStatus({ taskId: task.id, status: 'started' })
          .catch((e) => console.error('mark-started failed', e))
      }
      if (task.kind === 'flashcards') {
        navigate?.('flashcards')
      } else if (task.kind === 'lesson' && task.taxonomyRef) {
        navigate?.('content', { lessonSlug: task.taxonomyRef })
      } else if (task.refine === 'incorrect') {
        navigate?.('qbank', { qbankSession: { scopeKind: 'mixed', refine: 'incorrect', count: task.targetCount } })
      } else if (task.taxonomyRef) {
        navigate?.('qbank', {
          qbankSession: { scopeKind: 'topic', scopeCode: task.taxonomyRef, refine: 'all', count: task.targetCount }
        })
      }
    },
    [navigate]
  )

  if (loadFailed) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h2 className="text-3xl font-bold text-gray-800">Plan</h2>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-800">
          We could not load your plan just now.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Try again
          </button>
        </p>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h2 className="text-3xl font-bold text-gray-800">Plan</h2>
        <p className="mt-4 text-gray-500">Loading…</p>
      </div>
    )
  }

  const todayKey = view.days[0]?.day ?? ''

  // The wizard stays mounted for its whole flow: it saves nothing until its final step, so no
  // intermediate refetch can flip `onboardedAt` and unmount it mid-flow (the sat-world PR #35
  // onboarding regression this guards against).
  if (view.settings.onboardedAt == null) {
    return (
      <OnboardingWizard
        pool={view.pool}
        todayKey={todayKey}
        disciplines={disciplines}
        initial={view.settings}
        onDone={() => void load()}
      />
    )
  }

  const activeDay = selectedDay != null && view.days.some((d) => d.day === selectedDay) ? selectedDay : todayKey
  const dayEntry = view.days.find((d) => d.day === activeDay)
  // Straight dayKey subtraction — the triangle's daysToFinish is buffer-shifted AND clamped at 0,
  // so reconstructing from it overstates the countdown in the final pre-exam days.
  const daysToExam = view.settings.examDate != null ? dayNumberOfKey(view.settings.examDate) - dayNumberOfKey(todayKey) : null

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-800">Plan</h2>
          {view.settings.examDate != null && (
            <p className="mt-0.5 text-sm text-gray-400">
              Exam {view.settings.examDate}
              {daysToExam != null && daysToExam >= 0 ? ` · ${daysToExam} days out` : ''}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          aria-pressed={showSettings}
          className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          {showSettings ? '← Back to plan' : '⚙ Settings'}
        </button>
      </header>

      {showSettings ? (
        disciplines.length > 0 ? (
          <PlanSettings
            view={view}
            disciplines={disciplines}
            onSaved={load}
            onClose={() => setShowSettings(false)}
          />
        ) : (
          // The panel seeds its comfort/exclusion drafts from `disciplines` at mount; mounting it
          // before they load would lock in empty drafts and a later Save would wipe stored ratings.
          <p className="text-gray-500">Loading…</p>
        )
      ) : (
        <>
          <ProgressStrip progress={view.progress} />

          {actionError && (
            <p role="alert" className="flex items-center justify-between rounded-xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-100">
              {actionError}
              <button type="button" onClick={() => setActionError(null)} className="text-amber-500 hover:text-amber-700" aria-label="Dismiss error">
                ✕
              </button>
            </p>
          )}

          {celebration && (
            <div
              role="status"
              className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200"
            >
              <p className="text-sm font-medium text-emerald-800">
                🎉 Plan day complete! +{REWARDS_CONFIG.planDayBonus * REWARDS_CONFIG.coinsPerActivity} coins · +
                {REWARDS_CONFIG.planDayBonus * REWARDS_CONFIG.xpPerActivity} XP
                {celebration.goalJustMet ? ' · daily goal met!' : ''}
              </p>
              <button type="button" onClick={() => setCelebration(null)} className="text-emerald-600 hover:text-emerald-800" aria-label="Dismiss">
                ✕
              </button>
            </div>
          )}

          {view.behindPace && !nudgeDismissed && (
            <div className="flex items-start justify-between gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
              <p className="text-sm text-amber-800">
                You're a little behind your questions pace — {view.questions.attemptedDistinct.toLocaleString()} of{' '}
                {view.questions.publishedTotal.toLocaleString()} attempted so far. No drama: a few extra questions a day
                closes the gap, and today's plan already leans that way.
              </p>
              <button type="button" onClick={() => setNudgeDismissed(true)} className="text-amber-500 hover:text-amber-700" aria-label="Dismiss pace nudge">
                ✕
              </button>
            </div>
          )}

          <WeekStrip days={view.days} selected={activeDay} onSelect={setSelectedDay} />

          <TaskList tasks={dayEntry?.tasks ?? []} isToday={activeDay === todayKey} onOpen={openTask} onStatus={(t, s) => void setStatus(t, s)} />
        </>
      )}
    </div>
  )
}
