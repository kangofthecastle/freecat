import type { PlanTaskDto } from '../../../shared/dto'
import { weekdayIndex } from '../../../shared/gamification/dates'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

type DayEntry = { day: string; tasks: PlanTaskDto[] }

/** Required (non-optional, non-expired) tasks — the same set the streak and the plan.day bonus
 *  count, so the strip's "done" state matches what the engine will call a complete day. */
const required = (tasks: PlanTaskDto[]): PlanTaskDto[] =>
  tasks.filter((t) => !t.optional && t.status !== 'expired' && t.status !== 'skipped')

function chipState(tasks: PlanTaskDto[]): 'done' | 'partial' | 'open' | 'empty' {
  const req = required(tasks)
  if (req.length === 0) return 'empty'
  const completed = req.filter((t) => t.status === 'completed').length
  if (completed === req.length) return 'done'
  return completed > 0 ? 'partial' : 'open'
}

export function WeekStrip({
  days,
  selected,
  onSelect
}: {
  days: DayEntry[]
  selected: string
  onSelect: (day: string) => void
}): React.JSX.Element {
  return (
    <div className="flex gap-2">
      {days.map((d, i) => {
        const state = chipState(d.tasks)
        const minutes = d.tasks.filter((t) => !t.optional).reduce((sum, t) => sum + t.minutes, 0)
        const active = d.day === selected
        return (
          <button
            key={d.day}
            type="button"
            onClick={() => onSelect(d.day)}
            aria-current={active ? 'date' : undefined}
            className={`flex-1 rounded-xl p-2 text-center ring-1 transition ${
              active ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white ring-gray-100 hover:bg-gray-50'
            }`}
          >
            <p className={`text-xs font-semibold uppercase tracking-wide ${active ? 'text-blue-100' : 'text-gray-400'}`}>
              {i === 0 ? 'Today' : WEEKDAYS[weekdayIndex(d.day)]}
            </p>
            <p className="text-sm font-bold">
              {state === 'done' ? '✓' : state === 'empty' ? '—' : `${minutes}m`}
            </p>
            <span
              aria-hidden
              className={`mx-auto mt-1 block h-1.5 w-1.5 rounded-full ${
                state === 'done'
                  ? 'bg-emerald-400'
                  : state === 'partial'
                    ? 'bg-amber-400'
                    : state === 'open'
                      ? active
                        ? 'bg-white/60'
                        : 'bg-gray-300'
                      : 'bg-transparent'
              }`}
            />
          </button>
        )
      })}
    </div>
  )
}
