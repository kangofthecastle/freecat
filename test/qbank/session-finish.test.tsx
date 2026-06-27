// @vitest-environment jsdom
// test/qbank/session-finish.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type {
  StartSessionResult,
  SubmitAnswerInput,
  SubmitAnswerResult
} from '../../src/shared/dto'
import { Session } from '../../src/renderer/src/qbank/Session'

afterEach(() => cleanup())
beforeEach(() => vi.restoreAllMocks())

function singleQuestionSession(): StartSessionResult {
  return {
    sessionId: 7,
    mode: 'practice',
    questions: [
      {
        id: 'q1',
        topic: 'acid-base',
        section: 'CP' as StartSessionResult['questions'][number]['section'],
        passageId: null,
        stem: 'Only question',
        choices: ['choice-a', 'choice-b', 'choice-c', 'choice-d'],
        flagged: false
      }
    ],
    passages: {}
  }
}

const answerResult: SubmitAnswerResult = {
  correct: true,
  correctChoice: 'A',
  explanation: 'because',
  choiceExplanations: {},
  activity: null
}

describe('Session Finish failure handling (no dead-end)', () => {
  it('re-enables the Finish button (and surfaces an error) when completeSession rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const submitAnswer = vi.fn(async (_input: SubmitAnswerInput) => ({
      ok: true as const,
      data: answerResult
    }))
    const completeSession = vi.fn(async () => {
      throw new Error('boom')
    })
    // @ts-expect-error partial bridge stub for tests
    globalThis.window.freecat = { qbank: { submitAnswer, completeSession } }

    const onComplete = vi.fn()
    render(
      <Session
        session={singleQuestionSession()}
        renderExplanation={() => <div data-testid="explanation">explanation</div>}
        onComplete={onComplete}
      />
    )

    // Pick choice A, then submit so the question locks (explanation + Finish render).
    fireEvent.click(screen.getByText('choice-a'))
    fireEvent.click(screen.getByText('Submit answer'))
    const finish = (await screen.findByText('Finish')).closest('button') as HTMLButtonElement

    // Finish → completeSession rejects.
    fireEvent.click(finish)
    expect(completeSession).toHaveBeenCalledTimes(1)

    // The dead-end guard: after the rejection settles the Finish button must NOT stay disabled,
    // and a retry-able error message is shown.
    await screen.findByText(/could not finish the session/i)
    await waitFor(() => expect(finish.disabled).toBe(false))
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByText('Finish')).toBeTruthy() // label reset from "Finishing…"

    // And it is genuinely actionable again: a second click re-invokes completeSession.
    fireEvent.click(finish)
    await waitFor(() => expect(completeSession).toHaveBeenCalledTimes(2))
  })
})
