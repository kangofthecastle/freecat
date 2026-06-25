import { useState } from 'react'
import type {
  AnswerResult,
  ChoiceLetter,
  PresentedQuestion,
  SubmitAnswerResult
} from '../../../shared/dto'
import { ChoiceList } from './ChoiceList'
import { Markdown } from './Markdown'

export interface QuestionViewProps {
  question: PresentedQuestion
  /** A cached result if this question was already answered (e.g. navigating back). */
  answer: AnswerResult | null
  /** Calls qbank.submitAnswer; returns the result (or null on failure) so the view can cache it. */
  onSubmit: (questionId: string, choice: ChoiceLetter) => Promise<SubmitAnswerResult | null>
  /** Advance to the next unit; rendered once an answer exists. On the last unit this
   *  resolves the completion call, so it may return a promise the view awaits. */
  onNext: () => void | Promise<void>
  /** Label for the advance button (e.g. 'Next' or 'Finish' on the last unit). */
  nextLabel: string
  /** Renders the post-answer explanation block; Task 23 supplies the real component. */
  renderExplanation: (question: PresentedQuestion, answer: AnswerResult) => React.ReactNode
}

export function QuestionView({
  question,
  answer,
  onSubmit,
  onNext,
  nextLabel,
  renderExplanation
}: QuestionViewProps): React.JSX.Element {
  const [selected, setSelected] = useState<ChoiceLetter | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const locked = answer !== null

  const submit = async (): Promise<void> => {
    if (!selected || locked || submitting) return
    setSubmitting(true)
    setError(null)
    const result = await onSubmit(question.id, selected)
    setSubmitting(false)
    if (!result) setError('We could not record that answer. Please try again.')
  }

  // Guard against a rapid double-click on Next/Finish: the last unit's onNext kicks off
  // completeSession, and firing it twice would create a duplicate completion request.
  // The latch is released once onNext settles so a FAILED completion re-enables Finish
  // (a successful advance unmounts this view, so the reset is a no-op there).
  const advance = async (): Promise<void> => {
    if (advancing) return
    setAdvancing(true)
    try {
      await onNext()
    } finally {
      setAdvancing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <Markdown>{question.stem}</Markdown>
      </div>

      <ChoiceList
        choices={question.choices}
        selected={locked ? null : selected}
        onSelect={setSelected}
        locked={locked}
        correctChoice={answer?.correctChoice ?? null}
      />

      {!locked ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!selected || submitting}
            className="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit answer'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <>
          {renderExplanation(question, answer)}
          <button
            type="button"
            onClick={() => void advance()}
            disabled={advancing}
            className="rounded-lg bg-gray-800 px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-gray-900 disabled:opacity-50"
          >
            {nextLabel}
          </button>
        </>
      )}
    </div>
  )
}
