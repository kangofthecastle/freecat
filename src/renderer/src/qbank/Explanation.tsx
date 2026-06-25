import { useEffect, useState } from 'react'
import type { AnswerResult, ChoiceLetter, LessonRef, PresentedQuestion } from '../../../shared/dto'
import type { NavPayload, RouteKey } from '../App'
import { LETTERS } from './ChoiceList'
import { Markdown } from './Markdown'

/**
 * Shown after submit. The correct/your-wrong-pick highlighting lives in ChoiceList (locked mode);
 * this block adds the verdict banner, the main rationale, per-choice "why it's wrong" notes, a
 * persistent Flag toggle (qbank.toggleFlag), and — when `navigate` is supplied and this question's
 * topic has an authored lesson — a "Review the lesson" cross-link back into Content Review.
 */
export function Explanation({
  question,
  answer,
  navigate
}: {
  question: PresentedQuestion
  answer: AnswerResult
  /** Optional: when present, enables the outbound "Review the lesson" link (Qbank closes over App's navigate). */
  navigate?: (key: RouteKey, payload?: NavPayload) => void
}): React.JSX.Element {
  const [flagged, setFlagged] = useState(question.flagged)
  const [flagBusy, setFlagBusy] = useState(false)
  const [flagError, setFlagError] = useState<string | null>(null)
  // Resolved lazily from the question's topic; null until resolved / when no lesson exists.
  const [lesson, setLesson] = useState<LessonRef | null>(null)

  useEffect(() => {
    if (!navigate) return
    let alive = true
    setLesson(null)
    window.freecat.contentReview
      .lessonForTaxonomy(question.topic)
      .then((ref) => {
        if (alive) setLesson(ref)
      })
      .catch((e) => {
        console.error('lessonForTaxonomy threw', e)
        if (alive) setLesson(null)
      })
    return () => {
      alive = false
    }
  }, [navigate, question.topic])

  const toggleFlag = async (): Promise<void> => {
    setFlagBusy(true)
    setFlagError(null)
    try {
      const res = await window.freecat.qbank.toggleFlag(question.id)
      if (res.ok) setFlagged(res.data.flagged)
      else {
        console.error('toggleFlag rejected', res.error)
        setFlagError('Could not update the flag.')
      }
    } catch (e) {
      console.error('toggleFlag threw', e)
      setFlagError('Could not update the flag.')
    } finally {
      setFlagBusy(false)
    }
  }

  const rationales = LETTERS.map((letter): { letter: ChoiceLetter; text: string } | null => {
    const text = answer.choiceExplanations[letter]
    return text ? { letter, text } : null
  }).filter((x): x is { letter: ChoiceLetter; text: string } => x !== null)

  return (
    <div
      className={`space-y-4 rounded-2xl border-l-4 p-5 ${
        answer.correct ? 'border-emerald-400 bg-emerald-50/60' : 'border-red-400 bg-red-50/60'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-lg font-bold ${answer.correct ? 'text-emerald-700' : 'text-red-700'}`}>
          {answer.correct ? '✓ Correct' : '✗ Incorrect'}
          <span className="ml-2 text-sm font-medium text-gray-500">
            Answer: {answer.correctChoice}
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {navigate && lesson && (
            <button
              type="button"
              onClick={() => navigate('content', { lessonSlug: lesson.slug })}
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-blue-700 ring-1 ring-blue-300 transition hover:bg-blue-50"
            >
              Review the lesson
            </button>
          )}
          <button
            type="button"
            onClick={() => void toggleFlag()}
            disabled={flagBusy}
            aria-pressed={flagged}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              flagged
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-white text-amber-700 ring-1 ring-amber-300 hover:bg-amber-50'
            }`}
          >
            {flagged ? '★ Flagged' : '☆ Flag'}
          </button>
        </div>
      </div>
      {flagError && <p className="text-sm text-red-600">{flagError}</p>}

      <div className="rounded-xl bg-white/70 p-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Explanation</p>
        <Markdown>{answer.explanation}</Markdown>
      </div>

      {rationales.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Why the others are wrong</p>
          {rationales.map((r) => (
            <div key={r.letter} className="flex gap-3 rounded-lg bg-white/70 p-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600">
                {r.letter}
              </span>
              <div className="min-w-0 flex-1">
                <Markdown className="[&_p]:m-0">{r.text}</Markdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
