// @vitest-environment jsdom
// test/qbank/qbank-page.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import type {
  AvailabilityQuestionDto,
  DisciplineTreeDto,
  StartSessionInput,
  StartSessionResult,
  TagVocabEntry
} from '../../src/shared/dto'
import type { NavPayload } from '../../src/renderer/src/App'
import Qbank from '../../src/renderer/src/pages/Qbank'

// ── A minimal window.freecat stub covering exactly what Qbank + Composer touch. ──
type StartSession = (input: StartSessionInput) => Promise<StartSessionResult>

const DISCIPLINES: DisciplineTreeDto[] = [
  {
    discipline: 'chem-phys' as DisciplineTreeDto['discipline'],
    title: 'Chemical & Physical',
    topics: [
      { slug: 'acid-base', title: 'Acid–Base', aamcCodes: ['5A'] },
      { slug: 'thermo', title: 'Thermodynamics', aamcCodes: ['4A'] }
    ]
  }
]
const TAGS: TagVocabEntry[] = []

// 3 published questions: two acid-base (one previously incorrect), one thermo (flagged).
const AVAILABILITY: AvailabilityQuestionDto[] = [
  { id: 'q1', topic: 'acid-base', discipline: 'chem-phys', tags: ['aamc:5A'], incorrect: true, flagged: false },
  { id: 'q2', topic: 'acid-base', discipline: 'chem-phys', tags: ['aamc:5A'], incorrect: false, flagged: false },
  { id: 'q3', topic: 'thermo', discipline: 'chem-phys', tags: ['aamc:4A'], incorrect: false, flagged: true }
]

function sessionResult(over: Partial<StartSessionResult> = {}): StartSessionResult {
  return {
    sessionId: 1,
    mode: 'practice',
    questions: [
      {
        id: 'q1',
        topic: 'acid-base',
        section: 'CP' as StartSessionResult['questions'][number]['section'],
        passageId: null,
        stem: 'What is the pKa?',
        choices: ['a', 'b', 'c', 'd'],
        flagged: false
      }
    ],
    passages: {},
    ...over
  }
}

function stub(
  startSession: StartSession,
  availability: AvailabilityQuestionDto[] = AVAILABILITY,
  startDiagnostic: () => Promise<StartSessionResult> = async () => sessionResult({ mode: 'diagnostic' })
): void {
  const freecat = {
    taxonomy: {
      list: async () => DISCIPLINES,
      tags: async () => TAGS
    },
    qbank: {
      startSession,
      startDiagnostic,
      availability: async () => availability
    }
  }
  // @ts-expect-error partial bridge stub for tests
  globalThis.window.freecat = freecat
}

function payload(topicSlug?: string): NavPayload | undefined {
  return topicSlug ? { topicSlug } : undefined
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => cleanup())

describe('Qbank topic deep-link auto-start', () => {
  it('auto-starts a topic-scoped session EXACTLY ONCE under StrictMode', async () => {
    const calls: StartSessionInput[] = []
    const startSession = vi.fn(async (input: StartSessionInput) => {
      calls.push(input)
      return sessionResult()
    })
    stub(startSession)

    render(
      <StrictMode>
        <Qbank navPayload={payload('acid-base')} />
      </StrictMode>
    )

    // The session view renders once the auto-start resolves.
    await screen.findByText(/Question 1 of/i)
    // StrictMode double-invokes effects; the slug-keyed guard must fire startSession only once.
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(calls[0]).toMatchObject({ scopeKind: 'topic', scopeCode: 'acid-base', refine: 'all' })
  })

  it('shows the empty message and stays on the composer when the deep-link yields zero questions', async () => {
    const startSession = vi.fn(async () => sessionResult({ questions: [] }))
    stub(startSession)

    render(
      <StrictMode>
        <Qbank navPayload={payload('acid-base')} />
      </StrictMode>
    )

    // It surfaces the "no questions matched" notice instead of getting stuck on a blank session.
    await screen.findByText(/No questions matched/i)
    // And the composer is still present (its heading renders), i.e. we did not navigate into a session.
    expect(screen.getByText(/New practice session/i)).toBeTruthy()
    expect(screen.queryByText(/Question 1 of/i)).toBeNull()
    expect(startSession).toHaveBeenCalledTimes(1)
  })

  it('starts a NEW session when a second deep-link targets a DIFFERENT topic (in-place)', async () => {
    const calls: StartSessionInput[] = []
    const startSession = vi.fn(async (input: StartSessionInput) => {
      calls.push(input)
      return sessionResult({ sessionId: calls.length })
    })
    stub(startSession)

    const { rerender } = render(<Qbank navPayload={payload('acid-base')} />)
    await screen.findByText(/Question 1 of/i)
    expect(startSession).toHaveBeenCalledTimes(1)

    // A second deep-link to a different topic, with Qbank still mounted, must re-fire.
    rerender(<Qbank navPayload={payload('thermo')} />)
    await waitFor(() => expect(startSession).toHaveBeenCalledTimes(2))
    expect(calls[1]).toMatchObject({ scopeKind: 'topic', scopeCode: 'thermo' })
  })

  it('does NOT double-fire when the same-slug payload re-arrives (identity churn)', async () => {
    const startSession = vi.fn(async () => sessionResult())
    stub(startSession)

    const { rerender } = render(<Qbank navPayload={payload('acid-base')} />)
    await screen.findByText(/Question 1 of/i)
    expect(startSession).toHaveBeenCalledTimes(1)

    // A brand-new payload OBJECT but the SAME slug must not start a second session.
    rerender(<Qbank navPayload={{ topicSlug: 'acid-base' }} />)
    // Give any stray effect a chance to fire.
    await Promise.resolve()
    await Promise.resolve()
    expect(startSession).toHaveBeenCalledTimes(1)
  })
})

describe('Qbank plan-session deep-link (qbankSession payload)', () => {
  it('starts the exact session the plan composed, once under StrictMode', async () => {
    const calls: StartSessionInput[] = []
    const startSession = vi.fn(async (input: StartSessionInput) => {
      calls.push(input)
      return sessionResult()
    })
    stub(startSession)
    const session: StartSessionInput = { scopeKind: 'mixed', refine: 'incorrect', count: 6 }

    render(
      <StrictMode>
        <Qbank navPayload={{ qbankSession: session }} />
      </StrictMode>
    )
    await screen.findByText(/Question 1 of/i)
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(calls[0]).toEqual(session)
  })

  it('a NEW payload object re-fires (re-clicking the same plan task works)', async () => {
    const startSession = vi.fn(async () => sessionResult())
    stub(startSession)

    const { rerender } = render(<Qbank navPayload={{ qbankSession: { scopeKind: 'mixed', refine: 'incorrect', count: 6 } }} />)
    await screen.findByText(/Question 1 of/i)
    expect(startSession).toHaveBeenCalledTimes(1)

    rerender(<Qbank navPayload={{ qbankSession: { scopeKind: 'mixed', refine: 'incorrect', count: 6 } }} />)
    await waitFor(() => expect(startSession).toHaveBeenCalledTimes(2))
  })
})

describe('Qbank diagnostic deep-link (qbankDiagnostic payload)', () => {
  it('starts the server-composed diagnostic once under StrictMode and shows the mode badge', async () => {
    const startSession = vi.fn(async () => sessionResult())
    const startDiagnostic = vi.fn(async () => sessionResult({ mode: 'diagnostic' }))
    stub(startSession, AVAILABILITY, startDiagnostic)

    render(
      <StrictMode>
        <Qbank navPayload={{ qbankDiagnostic: { start: true } }} />
      </StrictMode>
    )
    await screen.findByText(/Question 1 of/i)
    expect(startDiagnostic).toHaveBeenCalledTimes(1)
    expect(startSession).not.toHaveBeenCalled()
    // The session header carries the diagnostic badge.
    expect(screen.getByText('Diagnostic')).toBeTruthy()
  })

  it('an empty bank surfaces the diagnostic-specific empty message on the composer', async () => {
    const startDiagnostic = vi.fn(async () => sessionResult({ mode: 'diagnostic', questions: [] }))
    stub(vi.fn(async () => sessionResult()), AVAILABILITY, startDiagnostic)

    render(
      <StrictMode>
        <Qbank navPayload={{ qbankDiagnostic: { start: true } }} />
      </StrictMode>
    )
    await screen.findByText(/diagnostic needs at least a few published questions/i)
    expect(screen.queryByText(/Question 1 of/i)).toBeNull()
    expect(startDiagnostic).toHaveBeenCalledTimes(1)
  })
})

describe('Composer availability counts (sat-world pattern: one snapshot, live client math)', () => {
  it('shows per-scope counts and a sized Start button; clamps when fewer match than requested', async () => {
    stub(vi.fn(async () => sessionResult()))
    render(<Qbank />)

    // Default: mixed scope, refine all, count 10 → 3 available ⇒ sized start + clamp note.
    await screen.findByRole('button', { name: /Start 3 questions/i })
    expect(screen.getByText(/Only 3 questions match/i)).toBeTruthy()
    // Scope rows carry their counts (2 acid-base, 1 thermo).
    expect(screen.getByText('Acid–Base').parentElement?.textContent).toContain('2')
    expect(screen.getByText('Thermodynamics').parentElement?.textContent).toContain('1')
  })

  it('refine buttons carry counts; a zero-count refine is disabled with a reasoned empty state', async () => {
    stub(vi.fn(async () => sessionResult()))
    render(<Qbank />)
    const incorrectBtn = await screen.findByRole('button', { name: /Previously incorrect/i })
    expect(incorrectBtn.textContent).toContain('1')

    // Flagged has 1 (thermo) at mixed scope — but zero once availability says nothing is flagged.
    cleanup()
    stub(
      vi.fn(async () => sessionResult()),
      AVAILABILITY.map((q) => ({ ...q, flagged: false }))
    )
    render(<Qbank />)
    const flaggedBtn = await screen.findByRole('button', { name: /Flagged/i })
    await waitFor(() => expect((flaggedBtn as HTMLButtonElement).disabled).toBe(true))
  })

  it('start is blocked with a hint when the selection matches nothing', async () => {
    const startSession = vi.fn(async () => sessionResult())
    stub(startSession, [])
    render(<Qbank />)
    const btn = await screen.findByRole('button', { name: /Nothing matches/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/No questions.*in this scope yet/i)).toBeTruthy()
    expect(startSession).not.toHaveBeenCalled()
  })
})
