// @vitest-environment jsdom
// test/qbank/qbank-page.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import type {
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

function stub(startSession: StartSession): void {
  const freecat = {
    taxonomy: {
      list: async () => DISCIPLINES,
      tags: async () => TAGS
    },
    qbank: {
      startSession
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
