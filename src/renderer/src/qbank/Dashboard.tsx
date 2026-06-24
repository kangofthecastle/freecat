import { useEffect, useState } from 'react'
import type { DashboardStats, TaxonomyNodeDto } from '../../../shared/dto'
import { buildTaxonomyTree, type TaxonomyTree } from './taxonomy-tree'
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
  const [tree, setTree] = useState<TaxonomyTree | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([window.freecat.qbank.getDashboard(), window.freecat.taxonomy.list()])
      .then(([s, nodes]: [DashboardStats, TaxonomyNodeDto[]]) => {
        if (!alive) return
        setStats(s)
        setTree(buildTaxonomyTree(nodes))
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

  const label = (code: string): string => tree?.titleByCode.get(code) ?? code

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

  const overallPct = stats ? accuracyPct(stats.overall.correct, stats.overall.answered) : null

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h2 className="text-3xl font-bold text-gray-800">Your performance</h2>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          label="Overall accuracy"
          value={overallPct === null ? '—' : `${overallPct}%`}
          sub={stats ? `${stats.overall.correct}/${stats.overall.answered}` : ''}
        />
        <StatTile label="Answered" value={stats ? String(stats.overall.answered) : '—'} />
        <StatTile label="Incorrect" value={stats ? String(stats.incorrectCount) : '—'} />
        <StatTile label="Flagged" value={stats ? String(stats.flaggedCount) : '—'} />
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-3 text-lg font-semibold text-gray-700">By section</h3>
        {stats && stats.bySection.length > 0 ? (
          <div className="space-y-3">
            {stats.bySection.map((s) => {
              const pct = accuracyPct(s.correct, s.answered)
              return (
                <div key={s.section}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium text-gray-700">{label(s.section)}</span>
                    <span className="text-gray-500">
                      {pct === null ? '—' : `${pct}%`} ({s.correct}/{s.answered})
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-[width]"
                      style={{ width: `${pct ?? 0}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-gray-500">No attempts yet — finish a session to see your sections.</p>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-1 text-lg font-semibold text-gray-700">By content category</h3>
        <p className="mb-3 text-sm text-gray-500">Tap a category to practice it.</p>
        {stats && stats.byContentCategory.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stats.byContentCategory.map((c) => {
              const pct = accuracyPct(c.correct, c.answered)
              return (
                <button
                  key={c.contentCategory}
                  type="button"
                  onClick={() => onScope({ scopeKind: 'content_category', scopeCode: c.contentCategory })}
                  className={`rounded-xl p-3 text-left ring-1 transition hover:brightness-95 ${heatTone(pct)}`}
                >
                  <p className="text-xs font-semibold">{c.contentCategory}</p>
                  <p className="truncate text-xs opacity-80">{label(c.contentCategory)}</p>
                  <p className="mt-1 text-lg font-bold">{pct === null ? '—' : `${pct}%`}</p>
                  <p className="text-xs opacity-70">
                    {c.correct}/{c.answered}
                  </p>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-gray-500">
            No content-category data yet — answer some science questions to fill this in.
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
