// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import type {
  ActivityResult, DisciplineTreeDto, PlanTaskDto, PlanView, SavePlanSettingsInput,
  SavePlanSettingsResult, ServiceResult, SetPlanTaskStatusInput, SetPlanTaskStatusResult
} from '../../src/shared/dto'
import { ok } from '../../src/shared/dto'
import { addDaysToKey } from '../../src/shared/gamification/dates'
import Plan from '../../src/renderer/src/pages/Plan'

afterEach(() => cleanup())

const TODAY = '2026-07-17'

const DISCIPLINES: DisciplineTreeDto[] = [
  { discipline: 'physics', title: 'Physics', topics: [] },
  { discipline: 'biochem', title: 'Biochemistry', topics: [] }
]

const task = (over: Partial<PlanTaskDto> = {}): PlanTaskDto => ({
  id: 1, day: TODAY, kind: 'questions', taxonomyRef: 'physics.mechanics', refine: null,
  title: 'Mechanics', targetCount: 6, minutes: 9, optional: false, status: 'pending',
  why: 'weakest scored topic', sortOrder: 0, ...over
})

function makeView(over: Partial<PlanView> = {}): PlanView {
  return {
    settings: {
      examDate: '2026-12-01', dailyBudgetMinutes: 60, dailyNewTarget: 10, masteryGoalPct: 60,
      finishBufferDays: 0, questionsStartDay: null, questionsFinishBufferDays: 0,
      newCardOrder: 'deck', onboardedAt: new Date('2026-07-01T00:00:00Z')
    },
    days: Array.from({ length: 7 }, (_, i) => ({ day: addDaysToKey(TODAY, i), tasks: [] })),
    prefs: [],
    progress: { streak: 3, completionRate: 0.8, onTrack: 'on-track', skipRate: 0.25 },
    triangle: {
      rampDays: 28, window: 100, introductionsNeeded: 500, requiredDailyNew: 5, reachableGoalPct: 60,
      dailyNewCeiling: 20, deckSize: 1000, introducedSoFar: 100, daysToFinish: 128
    },
    pool: { deckSize: 1000, introducedSoFar: 100, rampDays: 28, dailyNewCeiling: 20 },
    questions: { publishedTotal: 20, attemptedDistinct: 5 },
    behindPace: false,
    ...over
  }
}

interface StubHandles {
  get: () => PlanView
  saveSettings: ReturnType<typeof vi.fn>
  savePrefs: ReturnType<typeof vi.fn>
  setTaskStatus: ReturnType<typeof vi.fn>
}

function stub(opts: {
  view: () => PlanView
  saveSettings?: (input: SavePlanSettingsInput) => Promise<ServiceResult<SavePlanSettingsResult>>
  setTaskStatus?: (input: SetPlanTaskStatusInput) => Promise<ServiceResult<SetPlanTaskStatusResult>>
}): StubHandles {
  const saveSettings = vi.fn(
    opts.saveSettings ??
      (async () => ok<SavePlanSettingsResult>({ settings: makeView().settings, pacing: null }))
  )
  const savePrefs = vi.fn(async () => ok(null))
  const setTaskStatus = vi.fn(
    opts.setTaskStatus ??
      (async (input: SetPlanTaskStatusInput) =>
        ok<SetPlanTaskStatusResult>({ task: task({ id: input.taskId, status: input.status }), activity: null }))
  )
  const freecat = {
    plan: {
      get: async () => opts.view(),
      saveSettings,
      savePrefs,
      setTaskStatus,
      regenerate: async () => ok(null)
    },
    taxonomy: { list: async () => DISCIPLINES }
  }
  // @ts-expect-error partial bridge stub for tests
  globalThis.window.freecat = freecat
  return { get: opts.view, saveSettings, savePrefs, setTaskStatus }
}

describe('onboarding wizard', () => {
  it('renders instead of the dashboard until onboarded; one save at the very end (unmount-regression guard)', async () => {
    let current = makeView()
    current.settings.onboardedAt = null
    const handles = stub({
      view: () => current,
      // Like the real engine: once settings save with onboarded:true, the next get() is onboarded.
      saveSettings: async () => {
        current = makeView()
        return ok<SavePlanSettingsResult>({ settings: current.settings, pacing: null })
      }
    })

    render(<Plan />)
    await screen.findByText('Set up your plan')

    // Step 0: exam date.
    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: '2026-12-01' } })
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    // Step 1: pacing (leave untouched — optional). NOTHING may have been saved yet.
    await screen.findByText(/New cards \/ day/)
    expect(handles.saveSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    // Step 2: comfort — rate Physics a 2.
    await screen.findByText('Physics')
    fireEvent.click(screen.getAllByRole('radio', { name: 'Unsure' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    // Step 3: budget → finish.
    fireEvent.click(await screen.findByRole('button', { name: /Start planning/ }))

    await waitFor(() => expect(handles.saveSettings).toHaveBeenCalledTimes(1))
    expect(handles.saveSettings).toHaveBeenCalledWith({ examDate: '2026-12-01', dailyBudgetMinutes: 60, onboarded: true })
    expect(handles.savePrefs).toHaveBeenCalledWith([{ taxonomyRef: 'physics', comfort: 2, excluded: false }])

    // The parent swaps to the dashboard only via onDone → refetch.
    await screen.findByText('Plan streak')
  })

  it('an infeasible live goal blocks Continue on the pacing step', async () => {
    const current = makeView()
    current.settings.onboardedAt = null
    stub({ view: () => current })
    render(<Plan />)
    await screen.findByText('Set up your plan')

    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: addDaysToKey(TODAY, 10) } })
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    // 10 days out with a 28-day ramp ⇒ window collapses to 1; 100% needs 900/day ≫ ceiling 20.
    fireEvent.change(await screen.findByLabelText('Mastery goal %'), { target: { value: '100' } })
    await screen.findByRole('alert')
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('plan dashboard', () => {
  it('A5: the skip-rate renders beside the streak', async () => {
    stub({ view: () => makeView() })
    render(<Plan />)
    const tile = (await screen.findByText('Plan streak')).parentElement!
    expect(tile.textContent).toContain('3')
    expect(tile.textContent).toContain('25% skipped')
  })

  it('completing the day surfaces the plan.day celebration from the setTaskStatus ride-back', async () => {
    const activity: ActivityResult = {
      streak: 4, daily: { count: 20, goal: 20, met: true }, eggBecameReady: false, goalJustMet: false
    }
    const t = task()
    const view = makeView()
    view.days[0]!.tasks = [t]
    const handles = stub({
      view: () => view,
      setTaskStatus: async (input) => ok({ task: task({ status: input.status }), activity })
    })
    render(<Plan />)

    fireEvent.click(await screen.findByRole('button', { name: /Done/ }))
    await screen.findByText(/Plan day complete/)
    expect(handles.setTaskStatus).toHaveBeenCalledWith({ taskId: t.id, status: 'completed' })
  })

  it('opening a topic task marks it started and deep-links the planner-sized qbank session', async () => {
    const view = makeView()
    view.days[0]!.tasks = [task()]
    const handles = stub({ view: () => view })
    const navigate = vi.fn()
    render(<Plan navigate={navigate} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Practice' }))
    expect(navigate).toHaveBeenCalledWith('qbank', {
      qbankSession: { scopeKind: 'topic', scopeCode: 'physics.mechanics', refine: 'all', count: 6 }
    })
    await waitFor(() => expect(handles.setTaskStatus).toHaveBeenCalledWith({ taskId: 1, status: 'started' }))
  })

  it('a mistake-review task deep-links refine:incorrect at mixed scope', async () => {
    const view = makeView()
    view.days[0]!.tasks = [task({ kind: 'questions', taxonomyRef: null, refine: 'incorrect', title: 'Mistake review', targetCount: 5 })]
    stub({ view: () => view })
    const navigate = vi.fn()
    render(<Plan navigate={navigate} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Practice' }))
    expect(navigate).toHaveBeenCalledWith('qbank', {
      qbankSession: { scopeKind: 'mixed', refine: 'incorrect', count: 5 }
    })
  })

  it('the behind-pace nudge shows the coverage facts and dismisses', async () => {
    stub({ view: () => makeView({ behindPace: true }) })
    render(<Plan />)
    await screen.findByText(/behind your questions pace/)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss pace nudge' }))
    expect(screen.queryByText(/behind your questions pace/)).toBeNull()
  })
})
