import type { AamcAccuracy } from '../../../shared/dto'

function accuracyPct(correct: number, answered: number): number | null {
  return answered > 0 ? Math.round((correct / answered) * 100) : null
}

/** Accuracy tone, carried over from the absorbed qbank Dashboard. */
function heatTone(p: number | null): string {
  if (p === null) return 'bg-gray-50 text-gray-400 ring-gray-100'
  if (p >= 80) return 'bg-emerald-100 text-emerald-800 ring-emerald-200'
  if (p >= 60) return 'bg-lime-100 text-lime-800 ring-lime-200'
  if (p >= 40) return 'bg-amber-100 text-amber-800 ring-amber-200'
  return 'bg-red-100 text-red-800 ring-red-200'
}

export function AamcPanel({ aamc }: { aamc: AamcAccuracy[] }): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h3 className="mb-1 text-lg font-semibold text-gray-700">By AAMC content category</h3>
      <p className="mb-3 text-sm text-gray-500">
        Raw accuracy per category. A question tagged with two categories counts once in each.
      </p>
      {aamc.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {aamc.map((c) => {
            const p = accuracyPct(c.correct, c.answered)
            return (
              <div key={c.code} className={`rounded-xl p-3 ring-1 ${heatTone(p)}`}>
                <p className="text-xs font-semibold">{c.code}</p>
                <p className="truncate text-xs opacity-80" title={c.title}>
                  {c.title}
                </p>
                <p className="mt-1 text-lg font-bold">{p === null ? '—' : `${p}%`}</p>
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
  )
}
