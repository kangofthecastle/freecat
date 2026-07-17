import { useMemo } from 'react'
import type { FlashcardLoadDto } from '../../../shared/dto'
import { pct } from './insights'

export function FlashcardsPanel({ load }: { load: FlashcardLoadDto }): React.JSX.Element {
  const maxDue = useMemo(() => Math.max(1, ...load.dueByDay.map((d) => d.count)), [load])
  if (load.totalCards === 0) {
    return (
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-1 text-lg font-semibold text-gray-700">Flashcards</h3>
        <p className="rounded-lg bg-gray-50 p-4 text-gray-500">
          No cards in rotation yet — import a deck and start reviewing to see the queue here.
        </p>
      </section>
    )
  }
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h3 className="mb-1 text-lg font-semibold text-gray-700">Flashcards</h3>
      <p className="mb-4 text-sm text-gray-500">
        What the scheduler has queued — a description of the week ahead, not a forecast.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Due now" value={String(load.dueNow)} />
        <Mini label="Introduced today" value={String(load.introducedToday)} />
        <Mini
          label="Again rate (7d)"
          value={load.againRate7d === null ? '—' : pct(load.againRate7d)}
          sub={load.againRate30d === null ? undefined : `30d: ${pct(load.againRate30d)}`}
        />
        <Mini
          label="In rotation"
          value={String(load.totalCards)}
          sub={`${load.states.learning} learning · ${load.states.review} review · ${load.states.relearning} relearning`}
        />
      </div>
      <div className="flex items-end gap-2" role="img" aria-label="Cards due over the next seven days">
        {load.dueByDay.map((d, i) => (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-16 w-full items-end">
              <div
                title={`${d.day}: ${d.count} due`}
                className={`w-full rounded-t ${d.count > 0 ? 'bg-blue-400' : 'bg-gray-100'}`}
                style={{ height: `${Math.max(3, Math.round((d.count / maxDue) * 100))}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-400">{i === 0 ? 'today' : d.day.slice(5)}</span>
            <span className="text-xs font-semibold text-gray-600">{d.count}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div className="rounded-xl bg-gray-50 p-3 ring-1 ring-gray-100">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-lg font-bold text-gray-800">{value}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  )
}
