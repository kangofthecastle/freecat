/**
 * Discipline comfort ratings (1 = shaky … 5 = solid), shared by the onboarding wizard and the
 * settings panel. These feed the PLANNER's priors only — never Stats (the ported firewall) — which
 * is why the copy says "nudges your plan", not "your score". The settings panel also exposes the
 * exclusion toggle; the wizard keeps onboarding to the one question that matters.
 */
export interface DisciplineRef {
  key: string
  title: string
}

const COMFORT_LABELS = ['Shaky', 'Unsure', 'OK', 'Good', 'Solid'] as const

export function ComfortEditor({
  disciplines,
  comfort,
  onComfort,
  excluded,
  onToggleExcluded
}: {
  disciplines: DisciplineRef[]
  comfort: Record<string, number | null>
  onComfort: (key: string, value: number | null) => void
  /** Present only in the settings panel — the wizard never offers exclusion. */
  excluded?: Record<string, boolean>
  onToggleExcluded?: (key: string) => void
}): React.JSX.Element {
  return (
    <ul className="divide-y divide-gray-100 rounded-xl bg-white ring-1 ring-gray-100">
      {disciplines.map((d) => {
        const rating = comfort[d.key] ?? null
        const isExcluded = excluded?.[d.key] === true
        return (
          <li key={d.key} className={`flex items-center justify-between gap-3 px-4 py-3 ${isExcluded ? 'opacity-50' : ''}`}>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{d.title}</span>
            <span className="flex items-center gap-1" role="radiogroup" aria-label={`${d.title} comfort`}>
              {COMFORT_LABELS.map((label, i) => {
                const value = i + 1
                const active = rating === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={label}
                    title={label}
                    // Clicking the active rating clears it back to unrated.
                    onClick={() => onComfort(d.key, active ? null : value)}
                    className={`h-8 w-8 rounded-full text-xs font-semibold transition ${
                      active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {value}
                  </button>
                )
              })}
            </span>
            {onToggleExcluded && (
              <button
                type="button"
                onClick={() => onToggleExcluded(d.key)}
                className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
                  isExcluded ? 'bg-gray-200 text-gray-600' : 'text-gray-400 hover:bg-gray-100'
                }`}
                title={isExcluded ? 'Excluded from the plan — click to include' : 'Exclude from the plan'}
              >
                {isExcluded ? 'Excluded' : 'Exclude'}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
