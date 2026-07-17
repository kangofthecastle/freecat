import type { PlanTaskDto, PlanTaskStatus } from '../../../shared/dto'

/**
 * One day's task list. Today's tasks carry actions (start/complete/skip and undo); future days are
 * a read-only preview — the planner re-materializes them nightly from fresh evidence, so acting on
 * a speculative day would just be arguing with a forecast.
 */
export function TaskList({
  tasks,
  isToday,
  onOpen,
  onStatus
}: {
  tasks: PlanTaskDto[]
  isToday: boolean
  /** Deep-link into the module that does the work (also marks a pending task 'started'). */
  onOpen: (task: PlanTaskDto) => void
  onStatus: (task: PlanTaskDto, status: Exclude<PlanTaskStatus, 'expired'>) => void
}): React.JSX.Element {
  if (tasks.length === 0) {
    return (
      <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-400 ring-1 ring-gray-100">
        {isToday
          ? 'Nothing planned today. Import decks or add content, or lower your budget — the plan fills in from whatever you study.'
          : 'Nothing planned for this day yet.'}
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} isToday={isToday} onOpen={onOpen} onStatus={onStatus} />
      ))}
    </ul>
  )
}

const KIND_META: Record<PlanTaskDto['kind'], { icon: string; verb: string }> = {
  flashcards: { icon: '🗂️', verb: 'Review' },
  questions: { icon: '❓', verb: 'Practice' },
  lesson: { icon: '📖', verb: 'Read' }
}

function TaskCard({
  task,
  isToday,
  onOpen,
  onStatus
}: {
  task: PlanTaskDto
  isToday: boolean
  onOpen: (task: PlanTaskDto) => void
  onStatus: (task: PlanTaskDto, status: Exclude<PlanTaskStatus, 'expired'>) => void
}): React.JSX.Element {
  const meta = KIND_META[task.kind]
  const resolved = task.status === 'completed' || task.status === 'skipped'
  const count =
    task.kind === 'lesson' ? null : `${task.targetCount} ${task.kind === 'flashcards' ? 'cards' : 'questions'}`

  return (
    <li
      className={`rounded-xl p-4 ring-1 transition ${
        task.status === 'completed'
          ? 'bg-emerald-50/60 ring-emerald-100'
          : task.status === 'skipped'
            ? 'bg-gray-50 opacity-60 ring-gray-100'
            : task.optional
              ? 'bg-violet-50/50 ring-violet-100'
              : 'bg-white ring-gray-100'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-gray-800">
            <span aria-hidden>{meta.icon}</span>
            <span className={task.status === 'skipped' ? 'line-through' : ''}>{task.title}</span>
            {task.optional && (
              <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700">
                optional
              </span>
            )}
            {task.status === 'started' && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700">
                in progress
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">{task.why}</p>
          <p className="mt-1 text-xs text-gray-400">
            {count ? `${count} · ` : ''}~{task.minutes} min
          </p>
        </div>

        {isToday && (
          <div className="flex shrink-0 items-center gap-1.5">
            {!resolved && (
              <>
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  {task.status === 'started' ? 'Resume' : meta.verb}
                </button>
                {/* No manual Done for lessons: completion belongs to Content Review (it writes
                    lesson_progress + credits the lesson activity); once read, the next
                    regeneration resolves this offer. A plan-side Done would fake completion. */}
                {task.kind !== 'lesson' && (
                  <button
                    type="button"
                    onClick={() => onStatus(task, 'completed')}
                    title="Mark done"
                    className="rounded-lg bg-emerald-100 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200"
                  >
                    ✓ Done
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onStatus(task, 'skipped')}
                  title="Skip — the plan will re-route this work, not resurrect it today"
                  className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  Skip
                </button>
              </>
            )}
            {resolved && (
              <>
                {task.status === 'completed' && <span className="text-sm font-semibold text-emerald-600">Done ✓</span>}
                {task.status === 'skipped' && <span className="text-xs text-gray-400">Skipped</span>}
                <button
                  type="button"
                  onClick={() => onStatus(task, 'pending')}
                  className="rounded px-2 py-1 text-xs text-gray-400 underline hover:text-gray-600"
                >
                  Undo
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
