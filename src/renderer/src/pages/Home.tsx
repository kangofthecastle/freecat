import { useCallback, useEffect, useState } from 'react'
import type { GamificationState } from '../../../shared/dto'
import type { PageProps } from '../App'
import { Pet } from '../components/Pet'
import { Coin } from '../components/Coin'
import { petLabel } from '../gamification/labels'

export default function Home({ navigate }: PageProps): React.JSX.Element {
  const [name, setName] = useState<string>('…')
  const [state, setState] = useState<GamificationState | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [simulating, setSimulating] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await window.freecat.gamification.getState()
      setState(next)
      setLoadFailed(false)
    } catch (e) {
      console.error('Failed to load gamification state', e)
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    window.freecat.profile
      .get()
      .then((p) => setName(p.displayName))
      .catch((err) => {
        console.error('Failed to load profile', err)
        setName('Student')
      })
    void refresh()
  }, [refresh])

  const simulate = useCallback(async () => {
    setSimulating(true)
    try {
      const res = await window.freecat.gamification.recordActivity({ kind: 'dev.simulate', count: 5 })
      if (!res.ok) console.error('Simulate failed', res.error)
    } catch (e) {
      console.error('Simulate threw', e)
    } finally {
      await refresh()
      setSimulating(false)
    }
  }, [refresh])

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-3xl font-bold text-gray-800">Welcome back, {name}</h2>
        <button
          onClick={() => navigate?.('nest')}
          className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white shadow-sm transition hover:bg-blue-700"
        >
          Visit Nest →
        </button>
      </header>

      {loadFailed && !state ? (
        <p className="mt-8 rounded-lg bg-amber-50 p-4 text-amber-800">
          We could not load your study progress just now. It will appear here once it is available.
        </p>
      ) : (
        <>
          <section className="mt-8 flex flex-col items-center rounded-2xl bg-gradient-to-b from-sky-50 to-white p-8 ring-1 ring-sky-100">
            {state?.activePet ? (
              <>
                <Pet
                  species={state.activePet.species}
                  mood={state.activePet.mood.level}
                  equipped={state.activePet.equipped}
                  size={180}
                />
                <p className="mt-3 text-xl font-semibold text-gray-800">{petLabel(state.activePet)}</p>
                <p className="text-sm capitalize text-gray-400">feeling {state.activePet.mood.level}</p>
              </>
            ) : (
              <div className="flex flex-col items-center py-6 text-center">
                <div className="text-6xl" aria-hidden>
                  🥚
                </div>
                <p className="mt-4 max-w-sm text-gray-500">
                  Your first egg is incubating — keep studying to hatch it!
                </p>
              </div>
            )}
          </section>

          <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Level" value={state ? String(state.level.level) : '—'}>
              {state && (
                <ProgressBar
                  value={state.level.into}
                  max={state.level.into + state.level.toNext}
                  className="mt-2"
                />
              )}
            </StatTile>

            <StatTile label="XP" value={state ? state.xp.toLocaleString() : '—'} />

            <StatTile label="Coins" value="">
              <div className="flex items-center gap-1.5 text-2xl font-bold text-gray-800">
                <Coin size={22} />
                {state ? state.coins.toLocaleString() : '—'}
              </div>
            </StatTile>

            <StatTile label="Streak" value="">
              <div className="flex items-center gap-1 text-2xl font-bold text-gray-800">
                <span aria-hidden>🔥</span>
                {state ? state.streak : '—'}
              </div>
            </StatTile>

            <DailyGoalTile daily={state?.daily} />
          </section>

          {import.meta.env.DEV && (
            <section className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Dev tools</p>
              <button
                onClick={simulate}
                disabled={simulating}
                className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {simulating ? 'Simulating…' : 'Simulate study activity'}
              </button>
              <p className="mt-2 text-xs text-gray-400">
                Records 5 activity items so you can exercise the reward loop before study modules exist.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function StatTile({
  label,
  value,
  children
}: {
  label: string
  value: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      {value !== '' && <p className="mt-0.5 text-2xl font-bold text-gray-800">{value}</p>}
      {children}
    </div>
  )
}

function ProgressBar({
  value,
  max,
  className = ''
}: {
  value: number
  max: number
  className?: string
}): React.JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-gray-100 ${className}`}>
      <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  )
}

function DailyGoalTile({
  daily
}: {
  daily: GamificationState['daily'] | undefined
}): React.JSX.Element {
  const met = daily?.met ?? false
  return (
    <div
      className={`rounded-xl p-4 shadow-sm ring-1 transition ${
        met ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-gray-100'
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Daily goal</p>
      <p className={`mt-0.5 text-2xl font-bold ${met ? 'text-emerald-700' : 'text-gray-800'}`}>
        {daily ? `${daily.count}/${daily.goal}` : '—'}
        {met && <span className="ml-1 text-base">✓</span>}
      </p>
      {daily && (
        <ProgressBar
          value={daily.count}
          max={daily.goal}
          className={`mt-2 ${met ? '[&>div]:bg-emerald-500' : ''}`}
        />
      )}
    </div>
  )
}
