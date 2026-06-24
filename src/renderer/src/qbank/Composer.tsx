import { useEffect, useMemo, useState } from 'react'
import type {
  ComposerData,
  Refine,
  ScopeKind,
  StartSessionInput,
  TaxonomyNodeDto
} from '../../../shared/dto'
import { buildTaxonomyTree, type TaxonomyTree } from './taxonomy-tree'

/** A pre-selected scope, e.g. when the dashboard taps through into a content category. */
export interface InitialScope {
  scopeKind: ScopeKind
  scopeCode?: string
}

const LENGTHS = [5, 10, 20] as const

/** Encode a scope choice as a single radio value so the picker stays one flat list. */
function scopeValue(kind: ScopeKind, code?: string): string {
  return code ? `${kind}:${code}` : kind
}

function parseScopeValue(value: string): { scopeKind: ScopeKind; scopeCode?: string } {
  const idx = value.indexOf(':')
  if (idx === -1) return { scopeKind: value as ScopeKind }
  return { scopeKind: value.slice(0, idx) as ScopeKind, scopeCode: value.slice(idx + 1) }
}

export function Composer({
  initialScope,
  onStart
}: {
  initialScope?: InitialScope
  onStart: (input: StartSessionInput) => void
}): React.JSX.Element {
  const [tree, setTree] = useState<TaxonomyTree | null>(null)
  const [counts, setCounts] = useState<ComposerData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const [scope, setScope] = useState<string>(scopeValue(initialScope?.scopeKind ?? 'mixed', initialScope?.scopeCode))
  const [refine, setRefine] = useState<Refine>('all')
  const [count, setCount] = useState<number>(10)

  useEffect(() => {
    let alive = true
    Promise.all([window.freecat.taxonomy.list(), window.freecat.qbank.getComposerData()])
      .then(([nodes, data]: [TaxonomyNodeDto[], ComposerData]) => {
        if (!alive) return
        setTree(buildTaxonomyTree(nodes))
        setCounts(data)
        setLoadFailed(false)
      })
      .catch((e) => {
        console.error('Failed to load composer data', e)
        if (alive) setLoadFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  // If a pre-scope arrives after first render, honor it.
  useEffect(() => {
    if (initialScope) setScope(scopeValue(initialScope.scopeKind, initialScope.scopeCode))
  }, [initialScope])

  const start = (): void => {
    const { scopeKind, scopeCode } = parseScopeValue(scope)
    onStart({ scopeKind, scopeCode, refine, count })
  }

  const refineOptions = useMemo(
    (): { value: Refine; label: string }[] => [
      { value: 'all', label: 'All questions' },
      { value: 'incorrect', label: `Incorrect (${counts?.incorrectCount ?? 0})` },
      { value: 'flagged', label: `Flagged (${counts?.flaggedCount ?? 0})` }
    ],
    [counts]
  )

  if (loadFailed) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h2 className="text-2xl font-bold text-gray-800">New practice session</h2>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-800">
          We could not load the question bank just now. Please try again in a moment.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <header>
        <h2 className="text-3xl font-bold text-gray-800">New practice session</h2>
        <p className="mt-1 text-sm text-gray-500">
          {counts ? `${counts.totalQuestions} questions in the bank` : 'Loading…'}
        </p>
      </header>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-3 text-lg font-semibold text-gray-700">Scope</h3>
        <div className="space-y-3">
          <ScopeRadio
            name="scope"
            value="mixed"
            current={scope}
            onChange={setScope}
            label="Mixed — all sections"
          />
          {tree?.sections.map((section) => {
            const ccs = tree.contentCategoriesBySection.get(section.code) ?? []
            const skills = section.code === 'cars' ? tree.carsSkills : []
            return (
              <div key={section.id} className="rounded-xl bg-gray-50 p-3">
                <ScopeRadio
                  name="scope"
                  value={scopeValue('section', section.code)}
                  current={scope}
                  onChange={setScope}
                  label={section.title}
                  strong
                />
                {(ccs.length > 0 || skills.length > 0) && (
                  <div className="mt-2 grid grid-cols-1 gap-1.5 pl-5 sm:grid-cols-2">
                    {ccs.map((cc) => (
                      <ScopeRadio
                        key={cc.code}
                        name="scope"
                        value={scopeValue('content_category', cc.code)}
                        current={scope}
                        onChange={setScope}
                        label={cc.label}
                      />
                    ))}
                    {skills.map((sk) => (
                      <ScopeRadio
                        key={sk.code}
                        name="scope"
                        value={scopeValue('skill', sk.code)}
                        current={scope}
                        onChange={setScope}
                        label={sk.label}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-3 text-lg font-semibold text-gray-700">Refine</h3>
        <div className="flex flex-wrap gap-2">
          {refineOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRefine(opt.value)}
              aria-pressed={refine === opt.value}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                refine === opt.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-3 text-lg font-semibold text-gray-700">Length</h3>
        <div className="flex gap-2">
          {LENGTHS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              aria-pressed={count === n}
              className={`rounded-lg px-5 py-2 text-sm font-medium transition ${
                count === n
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-100'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={start}
        disabled={!tree}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
      >
        Start session
      </button>
    </div>
  )
}

function ScopeRadio({
  name,
  value,
  current,
  onChange,
  label,
  strong = false
}: {
  name: string
  value: string
  current: string
  onChange: (value: string) => void
  label: string
  strong?: boolean
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={(e) => onChange(e.target.value)}
        className="h-4 w-4 accent-blue-600"
      />
      <span className={strong ? 'font-semibold text-gray-800' : ''}>{label}</span>
    </label>
  )
}
