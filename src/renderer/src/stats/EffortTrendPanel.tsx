import { useMemo } from 'react'
import type { EffortDayDto } from '../../../shared/dto'
import { displayEffort } from './insights'

export function EffortTrendPanel({ trend }: { trend: EffortDayDto[] }): React.JSX.Element {
  const max = useMemo(() => Math.max(1, ...trend.map((d) => d.points)), [trend])
  const any = trend.some((d) => d.points > 0)
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h3 className="mb-1 text-lg font-semibold text-gray-700">Effort</h3>
      <p className="mb-4 text-sm text-gray-500">
        Daily effort points, last {trend.length} days. Transparent arithmetic: a question is 3
        points, a flashcard 0.25, a completed lesson 10.
      </p>
      {!any ? (
        <p className="rounded-lg bg-gray-50 p-4 text-gray-500">No study events yet — the chart starts with your first one.</p>
      ) : (
        <div className="flex h-24 items-end gap-px" role="img" aria-label="Daily effort bar chart">
          {trend.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${displayEffort(d.points)} pts (${d.questions} Q · ${d.flashcardReviews} cards · ${d.lessonsCompleted} lessons)`}
              className={`min-w-[2px] flex-1 rounded-t-sm ${d.points > 0 ? 'bg-blue-400' : 'bg-gray-100'}`}
              style={{ height: `${Math.max(2, Math.round((d.points / max) * 100))}%` }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
