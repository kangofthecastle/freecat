import { useCallback, useEffect, useState } from 'react'
import type { Outline, LessonStatus } from '../../../shared/dto'
import type { PageProps } from '../App'
import LessonReader from '../content/LessonReader'

export default function ContentReview({ navigate, navPayload }: PageProps): React.JSX.Element {
  const [outline, setOutline] = useState<Outline | null>(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState<string | null>(navPayload?.lessonSlug ?? null)

  const load = useCallback(async () => {
    try {
      setOutline(await window.freecat.contentReview.getOutline())
      setFailed(false)
    } catch (e) {
      console.error('Failed to load content outline', e)
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (navPayload?.lessonSlug) setActive(navPayload.lessonSlug)
  }, [navPayload])

  if (active) {
    return (
      <LessonReader
        slug={active}
        navigate={navigate}
        onBack={() => {
          setActive(null)
          void load()
        }}
      />
    )
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="flex items-center justify-between">
        <h2 className="text-3xl font-bold text-gray-800">Content Review</h2>
        {outline && (
          <span className="text-sm text-gray-500">
            {outline.completed} / {outline.total} lessons
          </span>
        )}
      </header>

      {failed && (
        <p className="mt-8 rounded-lg bg-amber-50 p-4 text-amber-800">
          We could not load your lessons just now.
        </p>
      )}

      <div className="mt-8 space-y-8">
        {outline?.groups.map((g) => (
          <section key={g.discipline}>
            <div className="flex items-baseline justify-between">
              <h3 className="text-xl font-semibold text-gray-800">{g.title}</h3>
              <span className="text-xs text-gray-400">
                {g.completed}/{g.total}
              </span>
            </div>
            <ul className="mt-3 divide-y divide-gray-100 rounded-xl bg-white ring-1 ring-gray-100">
              {g.lessons.map((l) => (
                <li key={l.slug}>
                  <button
                    disabled={!l.available}
                    onClick={() => setActive(l.slug)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      <StatusDot status={l.status} available={l.available} />
                      <span className="font-medium text-gray-800">{l.title}</span>
                    </span>
                    <span className="text-xs text-gray-400">
                      {!l.available
                        ? 'Coming soon'
                        : l.status === 'completed'
                          ? 'Completed'
                          : l.status === 'in-progress'
                            ? 'In progress'
                            : 'Start'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function StatusDot({ status, available }: { status: LessonStatus; available: boolean }): React.JSX.Element {
  const color = !available
    ? 'bg-gray-200'
    : status === 'completed'
      ? 'bg-emerald-500'
      : status === 'in-progress'
        ? 'bg-amber-400'
        : 'bg-gray-300'
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />
}
