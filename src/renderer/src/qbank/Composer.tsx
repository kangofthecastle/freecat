import { useEffect, useMemo, useState } from 'react'
import type { Refine, StartSessionInput, Tag, TagVocabEntry } from '../../../shared/dto'
import { buildScopeTree, parseScopeValue, scopeValue, type Scope, type ScopeTree } from './scope-tree'

/** A pre-selected scope, e.g. when the dashboard taps through into a topic. */
export type InitialScope = Scope

const LENGTHS = [5, 10, 20] as const

const REFINE_OPTIONS: { value: Refine; label: string }[] = [
  { value: 'all', label: 'All questions' },
  { value: 'incorrect', label: 'Previously incorrect' },
  { value: 'flagged', label: 'Flagged' }
]

export function Composer({
  initialScope,
  onStart
}: {
  initialScope?: InitialScope
  /** May be async (it calls startSession); the Composer disables Start while it is pending. */
  onStart: (input: StartSessionInput) => void | Promise<void>
}): React.JSX.Element {
  const [tree, setTree] = useState<ScopeTree | null>(null)
  const [tags, setTags] = useState<TagVocabEntry[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [starting, setStarting] = useState(false)

  const [scope, setScope] = useState<string>(scopeValue(initialScope ?? { scopeKind: 'mixed' }))
  const [refine, setRefine] = useState<Refine>('all')
  const [count, setCount] = useState<number>(10)
  /** Selected AAMC tag keys (`${vocab}:${code}`); ANDs with scope when non-empty. */
  const [selectedTagKeys, setSelectedTagKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    Promise.all([window.freecat.taxonomy.list(), window.freecat.taxonomy.tags()])
      .then(([disciplines, vocab]) => {
        if (!alive) return
        setTree(buildScopeTree(disciplines))
        setTags(vocab)
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

  // If a pre-scope arrives after first render (dashboard tap-through), honor it.
  useEffect(() => {
    if (initialScope) setScope(scopeValue(initialScope))
  }, [initialScope])

  const toggleTag = (key: string): void => {
    setSelectedTagKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const tagFilter = useMemo<Tag[]>(
    () => tags.filter((t) => selectedTagKeys.has(`${t.vocab}:${t.code}`)).map((t) => ({ vocab: t.vocab, code: t.code })),
    [tags, selectedTagKeys]
  )

  const start = async (): Promise<void> => {
    if (starting) return
    const parsed: Scope = parseScopeValue(scope)
    setStarting(true)
    try {
      await onStart({ ...parsed, refine, count, tagFilter })
    } finally {
      // If onStart navigated away this component is unmounting; the setState is a harmless no-op.
      setStarting(false)
    }
  }

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
        <p className="mt-1 text-sm text-gray-500">Choose a scope, then start.</p>
      </header>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-3 text-lg font-semibold text-gray-700">Scope</h3>
        <div className="space-y-3">
          <ScopeRadio
            name="scope"
            value={scopeValue({ scopeKind: 'mixed' })}
            current={scope}
            onChange={setScope}
            label="Mixed — all disciplines"
            strong
          />
          {tree?.disciplines.map((d) => (
            <div key={d.discipline} className="rounded-xl bg-gray-50 p-3">
              <ScopeRadio
                name="scope"
                value={scopeValue({ scopeKind: 'discipline', scopeCode: d.discipline })}
                current={scope}
                onChange={setScope}
                label={d.title}
                strong
              />
              {d.topics.length > 0 && (
                <div className="mt-2 grid grid-cols-1 gap-1.5 pl-5 sm:grid-cols-2">
                  {d.topics.map((t) => (
                    <ScopeRadio
                      key={t.slug}
                      name="scope"
                      value={scopeValue({ scopeKind: 'topic', scopeCode: t.slug })}
                      current={scope}
                      onChange={setScope}
                      label={t.title}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-1 text-lg font-semibold text-gray-700">AAMC content categories</h3>
        <p className="mb-3 text-sm text-gray-500">
          Optional — narrow the pool to questions tagged with any selected category.
        </p>
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => {
              const key = `${t.vocab}:${t.code}`
              const on = selectedTagKeys.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleTag(key)}
                  aria-pressed={on}
                  title={t.title}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    on
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {t.code}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No tag vocabulary available.</p>
        )}
        {selectedTagKeys.size > 0 && (
          <button
            type="button"
            onClick={() => setSelectedTagKeys(new Set())}
            className="mt-3 text-xs font-medium text-indigo-600 hover:underline"
          >
            Clear {selectedTagKeys.size} selected
          </button>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h3 className="mb-3 text-lg font-semibold text-gray-700">Refine</h3>
        <div className="flex flex-wrap gap-2">
          {REFINE_OPTIONS.map((opt) => (
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
        onClick={() => void start()}
        disabled={!tree || starting}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
      >
        {starting ? 'Starting…' : 'Start session'}
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
