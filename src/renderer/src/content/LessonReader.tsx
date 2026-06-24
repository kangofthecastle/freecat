import { useCallback, useEffect, useState } from 'react'
import type { LessonDetail, LessonStatus, ActivityResult } from '../../../shared/dto'
import type { RouteKey, NavPayload } from '../App'

interface Props {
  slug: string
  navigate?: (key: RouteKey, payload?: NavPayload) => void
  onBack: () => void
}

export default function LessonReader({ slug, navigate, onBack }: Props): React.JSX.Element {
  const [lesson, setLesson] = useState<LessonDetail | null>(null)
  const [status, setStatus] = useState<LessonStatus>('not-started')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setFailed(false)
    setLesson(null)
    window.freecat.contentReview
      .getLesson(slug)
      .then((l) => {
        if (!alive) return
        if (!l) {
          setFailed(true)
          return
        }
        setLesson(l)
        setStatus(l.status)
      })
      .catch((e) => {
        console.error('Failed to load lesson', e)
        if (alive) setFailed(true)
      })
    void window.freecat.contentReview.markViewed(slug).catch((e) => console.error('markViewed failed', e))
    return () => {
      alive = false
    }
  }, [slug])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const toggleComplete = useCallback(
    async (completed: boolean) => {
      setBusy(true)
      try {
        const res = await window.freecat.contentReview.markComplete(slug, completed)
        if (res.ok) {
          setStatus(res.data.status)
          if (res.data.activity) setToast(buildToast(res.data.activity))
        } else {
          console.error('markComplete failed', res.error)
        }
      } catch (e) {
        console.error('markComplete threw', e)
      } finally {
        setBusy(false)
      }
    },
    [slug]
  )

  const practiceAvailable =
    typeof (window.freecat as unknown as { qbank?: { questionsForTaxonomy?: unknown } }).qbank
      ?.questionsForTaxonomy === 'function'

  if (failed) {
    return (
      <div className="p-8">
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
          ← Content Review
        </button>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-800">Could not load this lesson.</p>
      </div>
    )
  }
  if (!lesson) return <div className="p-8 text-gray-400">Loading…</div>

  const completed = status === 'completed'
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
            ← Content Review
          </button>
          <h2 className="text-lg font-semibold text-gray-800">{lesson.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={busy}
            aria-pressed={completed}
            onClick={() => toggleComplete(!completed)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
              completed
                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {completed ? '✓ Completed' : 'Mark complete'}
          </button>
          <button
            disabled={!practiceAvailable}
            title={practiceAvailable ? 'Practice this topic in Qbank' : 'Practice coming soon'}
            onClick={() => navigate?.('qbank', { topicSlug: slug })}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Practice this topic →
          </button>
        </div>
      </header>

      <iframe
        title={lesson.title}
        srcDoc={lesson.html}
        sandbox="allow-scripts"
        className="min-h-0 flex-1 bg-white"
      />

      {lesson.aamcCategories.length > 0 && (
        <footer className="border-t border-gray-100 px-6 py-2 text-xs text-gray-400">
          AAMC categories: {lesson.aamcCategories.join(', ')}
        </footer>
      )}

      {toast && (
        <div role="status" className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

function buildToast(a: ActivityResult): string {
  const parts = ['Lesson complete! 🎉']
  if (a.goalJustMet) parts.push('Daily goal met!')
  if (a.eggBecameReady) parts.push('Your egg is ready to hatch!')
  parts.push(`🔥 ${a.streak}-day streak`)
  return parts.join('  ·  ')
}
