import { useMemo } from 'react'
import { buildCalendarGrid, type CalendarLevel } from './calendar-grid'

const LEVEL_CLASS: Record<CalendarLevel, string> = {
  0: 'bg-gray-100',
  1: 'bg-emerald-200',
  2: 'bg-emerald-300',
  3: 'bg-emerald-500',
  4: 'bg-emerald-700'
}

export function HeatmapPanel({
  byDay,
  todayKey,
  weeks
}: {
  byDay: Record<string, number>
  todayKey: string
  weeks: number
}): React.JSX.Element {
  const grid = useMemo(
    () => buildCalendarGrid(new Map(Object.entries(byDay)), { todayKey, weeks }),
    [byDay, todayKey, weeks]
  )
  const any = Object.keys(byDay).length > 0
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h3 className="mb-1 text-lg font-semibold text-gray-700">Activity</h3>
      <p className="mb-4 text-sm text-gray-500">
        Every day you studied — the same counter your pet already gets fed by.
      </p>
      {!any && (
        <p className="mb-3 rounded-lg bg-gray-50 p-4 text-gray-500">
          The grid fills in as you study — reviews, questions, and lessons all count.
        </p>
      )}
      <div className="overflow-x-auto">
        <div className="inline-block">
          <div className="mb-1 flex gap-[3px] pl-8 text-[10px] text-gray-400">
            {grid.columns.map((col, i) => {
              const label = grid.monthLabels.find((m) => m.colIndex === i)
              return (
                <span key={col.weekStartKey} className="w-[11px] shrink-0">
                  {label?.label ?? ''}
                </span>
              )
            })}
          </div>
          <div className="flex gap-[3px]">
            <div className="mr-1 flex w-7 flex-col gap-[3px] text-[10px] text-gray-400">
              {grid.weekdayLabels.map((w, i) => (
                <span key={w} className="h-[11px] leading-[11px]">
                  {i % 2 === 1 ? w : ''}
                </span>
              ))}
            </div>
            {grid.columns.map((col) => (
              <div key={col.weekStartKey} className="flex flex-col gap-[3px]">
                {col.cells.map((cell) => (
                  <div
                    key={cell.dayKey}
                    title={cell.inFuture ? undefined : `${cell.dayKey}: ${cell.intensity} activities`}
                    className={`h-[11px] w-[11px] rounded-[2px] ${
                      cell.inFuture ? 'bg-transparent' : LEVEL_CLASS[cell.level]
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
