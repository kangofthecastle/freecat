import { useCallback, useEffect, useState } from 'react'
import type { GamificationState, PetView, ServiceResult } from '../../../shared/dto'
import type { Item } from '../../../shared/gamification/types'
import type { PageProps } from '../App'
import { Pet } from '../components/Pet'
import { Coin } from '../components/Coin'
import { errorMessage, petLabel } from '../gamification/labels'

export default function Nest(_props: PageProps): React.JSX.Element {
  const [state, setState] = useState<GamificationState | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  /** Keyed inline error copy, e.g. errors['treat'] or errors['item:cap']. */
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [justAte, setJustAte] = useState(false)

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
    void refresh()
  }, [refresh])

  /**
   * Runs a mutating gamification action, then refetches. On `{ok:false}` it records a friendly
   * message under `errorKey`; on success it clears that key. Returns the result for callers that
   * need the payload (e.g. hatch).
   */
  const run = useCallback(
    async <T,>(errorKey: string, action: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T> | null> => {
      setBusy(true)
      try {
        const res = await action()
        setErrors((prev) => {
          const next = { ...prev }
          if (res.ok) delete next[errorKey]
          else next[errorKey] = errorMessage(res.error)
          return next
        })
        return res
      } catch (e) {
        console.error(`Action ${errorKey} threw`, e)
        setErrors((prev) => ({ ...prev, [errorKey]: 'Something went wrong. Please try again.' }))
        return null
      } finally {
        await refresh()
        setBusy(false)
      }
    },
    [refresh]
  )

  const buyTreat = useCallback(async () => {
    const res = await run('treat', () => window.freecat.gamification.buyTreat())
    if (res?.ok) {
      setJustAte(true)
      window.setTimeout(() => setJustAte(false), 2200)
    }
  }, [run])

  if (loadFailed && !state) {
    return (
      <div className="p-8">
        <h2 className="text-2xl font-bold">Nest</h2>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-800">
          We could not load your Nest just now. Please try again in a moment.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <h2 className="text-3xl font-bold text-gray-800">Nest</h2>

      <Incubator state={state} busy={busy} error={errors.incubator} run={run} />
      <Collection state={state} busy={busy} errors={errors} run={run} />
      <Shop
        state={state}
        busy={busy}
        errors={errors}
        run={run}
        buyTreat={buyTreat}
        justAte={justAte}
      />
    </div>
  )
}

/** Shape of the `run` helper threaded into sections. */
type RunFn = <T>(errorKey: string, action: () => Promise<ServiceResult<T>>) => Promise<ServiceResult<T> | null>

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h3 className="mb-4 text-lg font-semibold text-gray-700">{title}</h3>
      {children}
    </section>
  )
}

function InlineError({ message }: { message?: string }): React.JSX.Element | null {
  if (!message) return null
  return <p className="mt-2 text-sm text-red-600">{message}</p>
}

function Incubator({
  state,
  busy,
  error,
  run
}: {
  state: GamificationState | null
  busy: boolean
  error?: string
  run: RunFn
}): React.JSX.Element {
  const egg = state?.egg
  const eggPrice = state?.shop.eggPrice ?? 0

  return (
    <Section title="Incubator">
      {egg ? (
        <div className="flex items-center gap-6">
          <div className="text-6xl" aria-hidden>
            {egg.ready ? '🐣' : '🥚'}
          </div>
          <div className="flex-1">
            <div className="mb-1 flex justify-between text-sm text-gray-500">
              <span>{egg.ready ? 'Ready to hatch!' : 'Incubating…'}</span>
              <span>{Math.round(egg.progress * 100)}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-[width] ${egg.ready ? 'bg-emerald-500' : 'bg-amber-400'}`}
                style={{ width: `${Math.round(egg.progress * 100)}%` }}
              />
            </div>
            {egg.ready && (
              <button
                onClick={() => void run('incubator', () => window.freecat.gamification.hatchEgg())}
                disabled={busy}
                className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                Hatch
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-gray-500">No egg incubating. Buy one to start growing a new friend.</p>
          <button
            onClick={() => void run('incubator', () => window.freecat.gamification.buyEgg())}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            Buy egg
            <span className="flex items-center gap-1">
              <Coin /> {eggPrice}
            </span>
          </button>
        </div>
      )}
      <InlineError message={error} />
    </Section>
  )
}

function Collection({
  state,
  busy,
  errors,
  run
}: {
  state: GamificationState | null
  busy: boolean
  errors: Record<string, string>
  run: RunFn
}): React.JSX.Element {
  const collection = state?.collection ?? []

  return (
    <Section title="Collection">
      {collection.length === 0 ? (
        <p className="text-gray-500">No pets yet. Hatch your incubating egg to meet your first friend!</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {collection.map((pet) => (
            <CollectionCard key={pet.id} pet={pet} busy={busy} error={errors[`pet:${pet.id}`]} run={run} />
          ))}
        </div>
      )}

      {state?.activePet && (
        <ActivePetControls
          pet={state.activePet}
          ownedItemKeys={state.ownedItemKeys}
          items={state.shop.items}
          busy={busy}
          errors={errors}
          run={run}
        />
      )}
    </Section>
  )
}

function CollectionCard({
  pet,
  busy,
  error,
  run
}: {
  pet: PetView
  busy: boolean
  error?: string
  run: RunFn
}): React.JSX.Element {
  const select = (): void => {
    if (pet.isActive) return
    void run(`pet:${pet.id}`, () => window.freecat.gamification.setActivePet(pet.id))
  }
  return (
    <div
      onClick={select}
      role={pet.isActive ? undefined : 'button'}
      tabIndex={pet.isActive ? undefined : 0}
      onKeyDown={(e) => {
        if (!pet.isActive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          select()
        }
      }}
      aria-pressed={pet.isActive}
      className={`flex flex-col items-center rounded-xl p-3 ring-1 transition ${
        pet.isActive
          ? 'bg-blue-50 ring-2 ring-blue-400'
          : `cursor-pointer ring-gray-100 hover:bg-gray-50 ${busy ? 'pointer-events-none opacity-60' : ''}`
      }`}
    >
      <Pet species={pet.species} mood={pet.mood.level} equipped={pet.equipped} size={96} />
      <p className="mt-2 text-center text-sm font-medium text-gray-700">{petLabel(pet)}</p>
      {pet.isActive && <span className="mt-0.5 text-xs font-semibold text-blue-600">Active</span>}
      <InlineError message={error} />
    </div>
  )
}

function ActivePetControls({
  pet,
  ownedItemKeys,
  items,
  busy,
  errors,
  run
}: {
  pet: PetView
  ownedItemKeys: string[]
  items: Item[]
  busy: boolean
  errors: Record<string, string>
  run: RunFn
}): React.JSX.Element {
  const [draftName, setDraftName] = useState(pet.name ?? '')

  // Keep the field in sync when the active pet changes (e.g. selecting a different pet).
  useEffect(() => {
    setDraftName(pet.name ?? '')
  }, [pet.id, pet.name])

  const ownedItems = items.filter((i) => ownedItemKeys.includes(i.key))

  return (
    <div className="mt-6 rounded-xl bg-gray-50 p-4">
      <p className="mb-3 text-sm font-semibold text-gray-600">
        Customize <span className="text-blue-600">{petLabel(pet)}</span>
      </p>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void run(`rename:${pet.id}`, () =>
            window.freecat.gamification.renamePet(pet.id, draftName.trim())
          )
        }}
      >
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Name your pet"
          maxLength={24}
          className="w-48 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || draftName.trim().length === 0}
          className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          Rename
        </button>
      </form>
      <InlineError message={errors[`rename:${pet.id}`]} />

      {ownedItems.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Accessories</p>
          <div className="flex flex-wrap gap-2">
            {ownedItems.map((item) => {
              const equipped = pet.equipped.includes(item.key)
              return (
                <button
                  key={item.key}
                  disabled={busy}
                  onClick={() =>
                    void run(`equip:${item.key}`, () =>
                      equipped
                        ? window.freecat.gamification.unequipItem(pet.id, item.key)
                        : window.freecat.gamification.equipItem(pet.id, item.key)
                    )
                  }
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                    equipped
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {equipped ? `Remove ${item.name}` : `Equip ${item.name}`}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Shop({
  state,
  busy,
  errors,
  run,
  buyTreat,
  justAte
}: {
  state: GamificationState | null
  busy: boolean
  errors: Record<string, string>
  run: RunFn
  buyTreat: () => void
  justAte: boolean
}): React.JSX.Element {
  const treatPrice = state?.shop.treatPrice ?? 0
  const items = state?.shop.items ?? []
  const owned = state?.ownedItemKeys ?? []
  const activePet = state?.activePet ?? null

  return (
    <Section title="Shop">
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-amber-50 p-4">
        {activePet && justAte && (
          <Pet
            species={activePet.species}
            mood={activePet.mood.level}
            equipped={activePet.equipped}
            size={72}
            action="eating"
          />
        )}
        <div className="flex-1">
          <p className="font-medium text-gray-700">Treat</p>
          <p className="text-sm text-gray-500">Feed your active pet to lift its mood.</p>
        </div>
        <button
          onClick={buyTreat}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 font-medium text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          Buy treat
          <span className="flex items-center gap-1">
            <Coin /> {treatPrice}
          </span>
        </button>
      </div>
      <InlineError message={errors.treat} />

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {items.map((item) => (
          <ShopItem
            key={item.key}
            item={item}
            owned={owned.includes(item.key)}
            busy={busy}
            error={errors[`buy:${item.key}`]}
            run={run}
          />
        ))}
      </div>
    </Section>
  )
}

function ShopItem({
  item,
  owned,
  busy,
  error,
  run
}: {
  item: Item
  owned: boolean
  busy: boolean
  error?: string
  run: RunFn
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center rounded-xl p-3 text-center ring-1 ring-gray-100">
      <p className="text-sm font-medium text-gray-700">{item.name}</p>
      <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
        <Coin /> {item.price}
      </p>
      <button
        onClick={() => void run(`buy:${item.key}`, () => window.freecat.gamification.buyItem(item.key))}
        disabled={owned || busy}
        className={`mt-2 w-full rounded-lg px-3 py-1.5 text-sm font-medium transition ${
          owned
            ? 'cursor-default bg-gray-100 text-gray-400'
            : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
        }`}
      >
        {owned ? 'Owned' : 'Buy'}
      </button>
      <InlineError message={error} />
    </div>
  )
}
