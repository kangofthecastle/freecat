import { useCallback, useMemo, useState } from 'react'
import type {
  AnswerResult,
  ChoiceLetter,
  PresentedQuestion,
  SessionSummary,
  StartSessionResult,
  SubmitAnswerResult
} from '../../../shared/dto'
import { PassagePane } from './PassagePane'
import { QuestionView } from './QuestionView'

/** The cached payload handed to the summary screen: the questions plus per-question results. */
export interface SessionRecord {
  summary: SessionSummary
  questions: PresentedQuestion[]
  answers: Record<string, AnswerResult>
  mode: string // session mode, so the summary can speak diagnostic-appropriately
}

export function Session({
  session,
  renderExplanation,
  onComplete
}: {
  session: StartSessionResult
  /** Task 23 supplies the real Explanation here; threaded through QuestionView. */
  renderExplanation: (question: PresentedQuestion, answer: AnswerResult) => React.ReactNode
  onComplete: (record: SessionRecord) => void
}): React.JSX.Element {
  const [index, setIndex] = useState(0)
  /** questionId -> the full AnswerResult, cached so the summary/review can show explanations. */
  const [answers, setAnswers] = useState<Record<string, AnswerResult>>({})
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = session.questions.length
  const current = session.questions[index]
  const isLast = index === total - 1

  const submit = useCallback(
    async (questionId: string, choice: ChoiceLetter): Promise<SubmitAnswerResult | null> => {
      try {
        const res = await window.freecat.qbank.submitAnswer({
          sessionId: session.sessionId,
          questionId,
          choice
        })
        if (!res.ok) {
          console.error('submitAnswer rejected', res.error)
          return null
        }
        const result = res.data
        // Cache the full result by questionId (contract: summary IPC returns score + rows only).
        setAnswers((prev) => ({
          ...prev,
          [questionId]: {
            correct: result.correct,
            correctChoice: result.correctChoice,
            explanation: result.explanation,
            choiceExplanations: result.choiceExplanations
          }
        }))
        return result
      } catch (e) {
        console.error('submitAnswer threw', e)
        return null
      }
    },
    [session.sessionId]
  )

  const finish = useCallback(async (): Promise<void> => {
    setFinishing(true)
    setError(null)
    try {
      const summary = await window.freecat.qbank.completeSession(session.sessionId)
      onComplete({ summary, questions: session.questions, answers, mode: session.mode })
    } catch (e) {
      console.error('completeSession threw', e)
      setError('We could not finish the session. Please try again.')
      setFinishing(false)
    }
  }, [session.sessionId, session.questions, answers, onComplete])

  // Returns finish()'s promise on the last unit so QuestionView's advance latch is held
  // until completion settles and released (re-enabling Finish) if it fails.
  const next = useCallback((): void | Promise<void> => {
    if (isLast) {
      return finish()
    }
    setIndex((i) => i + 1)
  }, [isLast, finish])

  const passage = useMemo(
    () => (current?.passageId ? session.passages[current.passageId] : undefined),
    [current, session.passages]
  )

  if (!current) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <p className="rounded-lg bg-amber-50 p-4 text-amber-800">
          This session has no questions. The bank may be empty — add content and try again.
        </p>
      </div>
    )
  }

  const body = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {session.mode === 'diagnostic' && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
              Diagnostic
            </span>
          )}
          <p className="text-sm font-medium text-gray-500">
            Question {index + 1} of {total}
          </p>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-blue-500 transition-[width]"
            style={{ width: `${total > 0 ? ((index + 1) / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      <QuestionView
        key={current.id}
        question={current}
        answer={answers[current.id] ?? null}
        onSubmit={submit}
        onNext={next}
        nextLabel={isLast ? (finishing ? 'Finishing…' : 'Finish') : 'Next'}
        renderExplanation={renderExplanation}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )

  return (
    <div className="mx-auto max-w-5xl p-8">
      {passage ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PassagePane passage={passage} />
          {body}
        </div>
      ) : (
        <div className="mx-auto max-w-2xl">{body}</div>
      )}
    </div>
  )
}
