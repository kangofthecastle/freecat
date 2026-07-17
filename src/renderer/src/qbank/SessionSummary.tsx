import { useMemo, useState } from 'react'
import type {
  AnswerResult,
  ChoiceLetter,
  PresentedQuestion,
  SessionSummary as SessionSummaryDto,
  SessionSummaryRow
} from '../../../shared/dto'
import type { NavPayload, RouteKey } from '../App'
import { ChoiceList } from './ChoiceList'
import { Explanation } from './Explanation'
import { Markdown } from './Markdown'

export function SessionSummary({
  summary,
  questions,
  answers,
  onNewSession,
  onViewStats,
  diagnostic = false,
  navigate
}: {
  summary: SessionSummaryDto
  questions: PresentedQuestion[]
  /** Cached per-question results (questionId -> AnswerResult). */
  answers: Record<string, AnswerResult>
  onNewSession: () => void
  onViewStats: () => void
  /** True after a diagnostic session — adds the "your plan now has evidence" framing. */
  diagnostic?: boolean
  /** Optional: threaded into each review's Explanation so post-session review keeps the
   *  "Review the lesson" cross-link (matches the live session's renderExplanation). */
  navigate?: (key: RouteKey, payload?: NavPayload) => void
}): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)

  const questionById = useMemo(
    () => new Map(questions.map((q) => [q.id, q])),
    [questions]
  )

  const pct = summary.total > 0 ? Math.round((summary.correct / summary.total) * 100) : 0

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <header className="rounded-2xl bg-gradient-to-b from-sky-50 to-white p-8 text-center ring-1 ring-sky-100">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {diagnostic ? 'Diagnostic complete' : 'Session complete'}
        </p>
        <p className="mt-2 text-5xl font-bold text-gray-800">
          {summary.correct}
          <span className="text-2xl text-gray-400"> / {summary.total}</span>
        </p>
        <p className="mt-1 text-lg font-medium text-blue-600">{pct}% correct</p>
        <div className="mx-auto mt-4 h-2 w-64 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
        {diagnostic && (
          <p className="mx-auto mt-4 max-w-md text-sm text-gray-500">
            Your plan and stats now start from this evidence instead of guesses — the next
            regeneration already reflects it.
          </p>
        )}
      </header>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold text-gray-700">Review</h3>
        {summary.rows.length === 0 ? (
          <p className="text-gray-500">No questions to review.</p>
        ) : (
          summary.rows.map((row, i) => {
            const question = questionById.get(row.questionId)
            const answer = answers[row.questionId] ?? null
            const isOpen = open === row.questionId
            return (
              <div key={row.questionId} className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-100">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : row.questionId)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-gray-50"
                >
                  <span
                    // WCAG 1.4.1: the glyph + color must also carry a text alternative for AT.
                    role="img"
                    aria-label={row.isCorrect ? 'Correct' : 'Incorrect'}
                    title={row.isCorrect ? 'Correct' : 'Incorrect'}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      row.isCorrect ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {row.isCorrect ? '✓' : '✗'}
                  </span>
                  <span className="flex-1 text-sm font-medium text-gray-700">Question {i + 1}</span>
                  <span className="text-sm text-gray-400">Your answer: {row.chosen}</span>
                  <span className="text-gray-300">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="space-y-4 border-t border-gray-100 p-4">
                    {question ? (
                      <ReviewBody question={question} answer={answer} row={row} navigate={navigate} />
                    ) : (
                      <p className="text-sm text-gray-500">Question detail is unavailable.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onNewSession}
          className="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          New session
        </button>
        <button
          type="button"
          onClick={onViewStats}
          className="rounded-lg bg-white px-5 py-2.5 font-semibold text-gray-700 ring-1 ring-gray-300 transition hover:bg-gray-100"
        >
          View stats
        </button>
      </div>
    </div>
  )
}

function ReviewBody({
  question,
  answer,
  row,
  navigate
}: {
  question: PresentedQuestion
  answer: AnswerResult | null
  row: SessionSummaryRow
  navigate?: (key: RouteKey, payload?: NavPayload) => void
}): React.JSX.Element {
  const chosen: ChoiceLetter = row.chosen
  return (
    <>
      <Markdown>{question.stem}</Markdown>
      <ChoiceList
        choices={question.choices}
        selected={chosen}
        onSelect={() => {}}
        locked
        correctChoice={answer?.correctChoice ?? null}
      />
      {answer && <Explanation question={question} answer={answer} navigate={navigate} />}
    </>
  )
}
