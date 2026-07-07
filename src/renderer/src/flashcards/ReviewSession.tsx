// src/renderer/src/flashcards/ReviewSession.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardView, RatingPreview, ReviewCounts, ReviewRating } from '../../../shared/dto'
import { errorMessage } from '../gamification/labels'
import { CardFrame } from './CardFrame'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'card'; card: CardView; preview: RatingPreview; side: 'question' | 'answer' }
  | { kind: 'done'; nextLearningDueMs: number | null }

const RATING_LABELS: { rating: ReviewRating; label: string; colorClass: string }[] = [
  { rating: 1, label: 'Again', colorClass: 'bg-red-600 hover:bg-red-700' },
  { rating: 2, label: 'Hard', colorClass: 'bg-amber-600 hover:bg-amber-700' },
  { rating: 3, label: 'Good', colorClass: 'bg-emerald-600 hover:bg-emerald-700' },
  { rating: 4, label: 'Easy', colorClass: 'bg-blue-600 hover:bg-blue-700' }
]

/** A study session for one deck (subtree): serves due/new/learning cards one at a time via
 *  `nextReviewCard`, applies ratings via `reviewCard`, and tracks a session-local reviewed count.
 *  Renders CardFrame for the actual card content (the iframe is the only place engine output lands). */
export function ReviewSession({ deckId, deckName, onExit }: {
  deckId: number
  deckName: string
  onExit: () => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [counts, setCounts] = useState<ReviewCounts | null>(null)
  const [reviewed, setReviewed] = useState(0)
  const [ratingPending, setRatingPending] = useState(false)
  const [ratingError, setRatingError] = useState<{ rating: ReviewRating; message: string } | null>(null)

  // Latest-value ref so the window keydown listener (attached once) never reads stale state. Assigned
  // directly during render (not in a useEffect): an effect-based sync runs after commit, which races a
  // keydown fired the instant the DOM updates (e.g. right after an RTL findBy resolves) — this ref must
  // already reflect the just-rendered phase by the time that commit lands.
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  // Synchronous submit guard: a ref (not state) so two rating clicks fired inside the same event-loop
  // tick / act() batch are deduped even though the setRatingPending(true) commit hasn't landed yet
  // (mirrors the CardList "Load more" double-click guard).
  const pendingRatingRef = useRef(false)

  const fetchNext = useCallback(async () => {
    try {
      const res = await window.freecat.flashcards.nextReviewCard(deckId)
      if (!res.ok) { setPhase({ kind: 'error', message: errorMessage(res.error) }); return }
      const item = res.data
      setCounts(item.counts)
      setPhase(item.done
        ? { kind: 'done', nextLearningDueMs: item.nextLearningDueMs }
        : { kind: 'card', card: item.card, preview: item.preview, side: 'question' })
    } catch (e) {
      console.error('nextReviewCard failed', e)
      setPhase({ kind: 'error', message: 'Could not load the next card.' })
    }
  }, [deckId])

  useEffect(() => { void fetchNext() }, [fetchNext])

  const reveal = useCallback(() => {
    setPhase((p) => (p.kind === 'card' && p.side === 'question' ? { ...p, side: 'answer' } : p))
  }, [])

  const submitRating = useCallback(async (rating: ReviewRating) => {
    if (pendingRatingRef.current) return
    const current = phaseRef.current
    if (current.kind !== 'card' || current.side !== 'answer') return
    pendingRatingRef.current = true
    setRatingPending(true)
    setRatingError(null)
    const cardId = current.card.cardId
    try {
      const res = await window.freecat.flashcards.reviewCard({ cardId, rating })
      // ok → an applied rating, count it. {ok:false} (not-due / card-not-found) means the card was
      // superseded (e.g. a duplicate submit) — just advance silently, no error, no double count.
      if (res.ok) setReviewed((r) => r + 1)
      await fetchNext()
    } catch (e) {
      console.error('reviewCard failed', e)
      setRatingError({ rating, message: 'Could not save your rating.' })
    } finally {
      pendingRatingRef.current = false
      setRatingPending(false)
    }
  }, [fetchNext])

  // Space/Enter reveals the answer; 1-4 rate once the answer is showing. Attached on window (no
  // single element owns focus for this session) and skipped while typing in a form field.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const current = phaseRef.current
      if (current.kind !== 'card') return
      if (current.side === 'question') {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal() }
        return
      }
      if (pendingRatingRef.current) return
      const rating = ({ '1': 1, '2': 2, '3': 3, '4': 4 } as Record<string, ReviewRating>)[e.key]
      if (rating) { e.preventDefault(); void submitRating(rating) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [reveal, submitRating])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SessionHeader deckName={deckName} counts={counts} onExit={onExit} />
      <div className="flex-1 overflow-auto p-4">
        {phase.kind === 'loading' && <div role="status" className="p-6 text-gray-400">Loading…</div>}

        {phase.kind === 'error' && (
          <div role="alert" className="rounded-lg bg-amber-50 p-6 text-amber-800">
            <p>{phase.message}</p>
            <button onClick={() => void fetchNext()} className="mt-3 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700">
              Try again
            </button>
          </div>
        )}

        {phase.kind === 'done' && (
          <DoneState reviewed={reviewed} nextLearningDueMs={phase.nextLearningDueMs} onCheckAgain={() => void fetchNext()} onExit={onExit} />
        )}

        {phase.kind === 'card' && (
          <div className="flex flex-col gap-3">
            <CardFrame view={phase.card} side={phase.side} />
            {phase.side === 'question' ? (
              <button
                onClick={reveal}
                className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Show answer
              </button>
            ) : (
              <>
                <div className="flex gap-2">
                  {RATING_LABELS.map(({ rating, label, colorClass }) => (
                    <button
                      key={rating}
                      onClick={() => void submitRating(rating)}
                      disabled={ratingPending}
                      className={`flex flex-1 flex-col items-center rounded px-3 py-2 text-white disabled:opacity-50 ${colorClass}`}
                    >
                      <span className="text-sm font-semibold">{label}</span>
                      <span className="text-xs opacity-90">{phase.preview[label.toLowerCase() as keyof RatingPreview]}</span>
                    </button>
                  ))}
                </div>
                {ratingError && (
                  <div role="alert" className="flex items-center gap-2 text-sm text-red-600">
                    <span>{ratingError.message}</span>
                    <button
                      onClick={() => void submitRating(ratingError.rating)}
                      className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SessionHeader({ deckName, counts, onExit }: {
  deckName: string
  counts: ReviewCounts | null
  onExit: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-gray-200 p-3">
      <div className="flex items-center gap-3">
        <h2 className="font-bold text-gray-800">{deckName}</h2>
        {counts && (
          <div className="flex gap-1 text-xs">
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">{counts.newRemaining} new</span>
            <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">{counts.learning} learning</span>
            <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">{counts.due} due</span>
          </div>
        )}
      </div>
      <button onClick={onExit} className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Exit</button>
    </div>
  )
}

function DoneState({ reviewed, nextLearningDueMs, onCheckAgain, onExit }: {
  reviewed: number
  nextLearningDueMs: number | null
  onCheckAgain: () => void
  onExit: () => void
}): React.JSX.Element {
  const emptyEntry = reviewed === 0
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center p-16 text-center">
      <div className="text-5xl" aria-hidden>{emptyEntry ? '📭' : '🎉'}</div>
      <h3 className="mt-4 text-xl font-bold text-gray-800">{emptyEntry ? 'Nothing to study right now' : 'Session complete'}</h3>
      {!emptyEntry && <p className="mt-2 text-gray-500">{reviewed} reviewed this session</p>}
      {nextLearningDueMs != null && (
        <p className="mt-2 text-sm text-gray-500">
          Cards return in ~{Math.ceil(nextLearningDueMs / 60000)}m
          <button onClick={onCheckAgain} className="ml-2 rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200">
            Check again
          </button>
        </p>
      )}
      <button onClick={onExit} className="mt-6 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Exit
      </button>
    </div>
  )
}
