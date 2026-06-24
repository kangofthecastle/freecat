import { useEffect, useMemo, useState } from 'react'
import type { DashboardStats, TopicAccuracy } from '../../../shared/dto'
import { buildScopeTree, type ScopeTree } from './scope-tree'
import type { InitialScope } from './Composer'

function accuracyPct(correct: number, answered: number): number | null {
  return answered > 0 ? Math.round((correct / answered) * 100) : null
}

/** Map an accuracy percentage to a heatmap tone (null = not yet practiced). */
function heatTone(pct: number | null): string {
  if (pct === null) return 'bg-gray-50 text-gray-400 ring-gray-100'
  if (pct >= 80) return 'bg-emerald-100 text-emerald-800 ring-emerald-200'
  if (pct >= 60) return 'bg-lime-100 text-lime-800 ring-lime-200'
  if (pct >= 40) return 'bg-amber-100 text-amber-800 ring-amber-200'
  return 'bg-red-100 text-red-800 ring-red-200'
}

export function Dashboard({ onScope }: { onScope: (scope: InitialScope) => void }): React.JSX.Element {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [tree, setTree] = useState<ScopeTree | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([window.freecat.qbank.dashboard(), window.freecat.taxonomy.list()])
      .then(([s, disciplines]) => {
        if (!alive) return
        setStats(s)
        setTree(buildScopeTree(disciplines))
        setLoadFailed(false)
      })
      .catch((e) => {
        console.error('Failed to load dashboard', e)
        if (alive) setLoadFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  // topic slug -> its accuracy row, so the discipline→topic tree can overlay scores.
  const topicAccuracy = useMemo(
    (): Map<string, TopicAccuracy> => new Map((stats?.byTopic ?? []).map((t) => [t.topic, t])),
    [stats]
  )

  if (loadFailed) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h2 className="text-2xl font-bold text-gray-800">Your performance</h2>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-800">
          We could not load your performance just now. Please try again in a moment.
        </p>
      </div>
    )
  }

  const overallPct = stats ? accuracyPct(stats.totalCorrect, stats.totalAnswered) : null

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h2 className="text-3xl font-bold text-gray-800">Your performance</h2>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile
          label="Overall accuracy"
          value={overallPct === null ? '—' : `${overallPct}%`}
          sub={stats ? `${stats.totalCorrect}/${stats.totalAnswered}` : ''}
        />
        <StatTile label="Answered" value={stats ? String(stats.totalAnswered) : '—'} />
        <StatTile label="Correct" value={stats ? String(stats.totalCorrect) : '—'} />
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-1 text-lg font-semibold text-gray-700">By discipline & topic</h3>
        <p className="mb-3 text-sm text-gray-500">Tap a topic to practice it.</p>
        {tree && stats ? (
          <div className="space-y-5">
            {tree.disciplines.map((d) => {
              const dStats = stats.byDiscipline.find((x) => x.discipline === d.discipline)
              const dPct = dStats ? accuracyPct(dStats.correct, dStats.answered) : null
              return (
                <div key={d.discipline}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-semibold text-gray-800">{d.title}</span>
                    <span className="text-sm text-gray-500">
                      {dPct === null ? 'Not started' : `${dPct}%`}
                      {dStats && dStats.answered > 0 ? ` (${dStats.correct}/${dStats.answered})` : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {d.topics.map((t) => {
                      const acc = topicAccuracy.get(t.slug)
                      const pct = acc ? accuracyPct(acc.correct, acc.answered) : null
                      return (
                        <button
                          key={t.slug}
                          type="button"
                          onClick={() => onScope({ scopeKind: 'topic', scopeCode: t.slug })}
                          className={`rounded-xl p-3 text-left ring-1 transition hover:brightness-95 ${heatTone(pct)}`}
                        >
                          <p className="truncate text-xs font-semibold" title={t.title}>
                            {t.title}
                          </p>
                          <p className="mt-1 text-lg font-bold">{pct === null ? '—' : `${pct}%`}</p>
                          <p className="text-xs opacity-70">
                            {acc ? `${acc.correct}/${acc.answered}` : 'no attempts'}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-gray-500">Loading…</p>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-1 text-lg font-semibold text-gray-700">By AAMC content category</h3>
        {stats && stats.byAamc.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stats.byAamc.map((c) => {
              const pct = accuracyPct(c.correct, c.answered)
              return (
                <div key={c.code} className={`rounded-xl p-3 ring-1 ${heatTone(pct)}`}>
                  <p className="text-xs font-semibold">{c.code}</p>
                  <p className="truncate text-xs opacity-80" title={c.title}>
                    {c.title}
                  </p>
                  <p className="mt-1 text-lg font-bold">{pct === null ? '—' : `${pct}%`}</p>
                  <p className="text-xs opacity-70">
                    {c.correct}/{c.answered}
                  </p>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-gray-500">
            No content-category data yet — answer some tagged questions to fill this in.
          </p>
        )}
      </section>
    </div>
  )
}

function StatTile({
  label,
  value,
  sub
}: {
  label: string
  value: string
  sub?: string
}): React.JSX.Element {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-2xl font-bold text-gray-800">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}
