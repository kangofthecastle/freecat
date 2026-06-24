// src/renderer/src/pages/Flashcards.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeckSetSummary, DeckNode, CardListItem } from '../../../shared/dto'
import type { PageProps } from '../App'
import { errorMessage } from '../gamification/labels'
import { CardViewer } from '../flashcards/CardViewer'

export default function Flashcards(_props: PageProps): React.JSX.Element {
  const [deckSets, setDeckSets] = useState<DeckSetSummary[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)

  const loadDeckSets = useCallback(async () => {
    try { setDeckSets(await window.freecat.flashcards.listDeckSets()) }
    catch (e) { console.error('listDeckSets failed', e); setDeckSets([]) }
  }, [])

  useEffect(() => { void loadDeckSets() }, [loadDeckSets])

  const onImport = useCallback(async () => {
    setImporting(true); setError(null)
    try {
      const res = await window.freecat.flashcards.importDeck()
      if (res.ok) await loadDeckSets()
      else if (res.error !== 'invalid') setError(errorMessage(res.error)) // 'invalid' = dialog canceled
    } catch (e) {
      console.error('import failed', e); setError('Import failed. Please try again.')
    } finally { setImporting(false) }
  }, [loadDeckSets])

  if (deckSets === null) return <div className="p-8 text-gray-400">Loading…</div>

  if (deckSets.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center p-16 text-center">
        <div className="text-6xl" aria-hidden>🗂️</div>
        <h2 className="mt-4 text-2xl font-bold text-gray-800">No decks yet</h2>
        <p className="mt-2 text-gray-500">Import an Anki deck package (.apkg or .colpkg) to start browsing your cards.</p>
        <ImportButton importing={importing} onImport={onImport} />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <aside className="w-72 shrink-0 overflow-auto border-r border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">Decks</h2>
          <ImportButton importing={importing} onImport={onImport} compact />
        </div>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <div className="space-y-4">
          {deckSets.map((ds) => (
            <DeckSetBlock
              key={ds.id}
              ds={ds}
              selectedDeckId={selectedDeckId}
              onSelectDeck={(id) => { setSelectedDeckId(id); setSelectedCardId(null) }}
              onDeleted={() => { setSelectedDeckId(null); setSelectedCardId(null); void loadDeckSets() }}
            />
          ))}
        </div>
      </aside>

      <section className="w-80 shrink-0 overflow-auto border-r border-gray-200">
        {selectedDeckId === null
          ? <p className="p-4 text-sm text-gray-400">Select a deck to see its cards.</p>
          : <CardList key={selectedDeckId} deckId={selectedDeckId} selectedCardId={selectedCardId} onSelect={setSelectedCardId} />}
      </section>

      <main className="flex-1 overflow-auto p-4">
        {selectedCardId === null
          ? <p className="p-4 text-sm text-gray-400">Select a card to preview it.</p>
          : <CardViewer cardId={selectedCardId} />}
      </main>
    </div>
  )
}

function ImportButton({ importing, onImport, compact = false }: { importing: boolean; onImport: () => void; compact?: boolean }): React.JSX.Element {
  return (
    <button
      onClick={onImport}
      disabled={importing}
      className={`rounded-lg bg-blue-600 font-medium text-white hover:bg-blue-700 disabled:opacity-50 ${compact ? 'px-2 py-1 text-xs' : 'mt-6 px-5 py-2.5'}`}
    >
      {importing ? 'Importing…' : compact ? '+ Import' : 'Import deck (.apkg/.colpkg)'}
    </button>
  )
}

function DeckSetBlock({ ds, selectedDeckId, onSelectDeck, onDeleted }: {
  ds: DeckSetSummary
  selectedDeckId: number | null
  onSelectDeck: (id: number) => void
  onDeleted: () => void
}): React.JSX.Element {
  const [decks, setDecks] = useState<DeckNode[] | null>(null)

  useEffect(() => {
    let active = true
    window.freecat.flashcards.listDecks(ds.id)
      .then((d) => { if (active) setDecks(d) })
      .catch((e) => { console.error('listDecks failed', e); if (active) setDecks([]) })
    return () => { active = false }
  }, [ds.id])

  const onDelete = useCallback(async () => {
    try { await window.freecat.flashcards.deleteDeckSet(ds.id) }
    catch (e) { console.error('deleteDeckSet failed', e) }
    finally { onDeleted() }
  }, [ds.id, onDeleted])

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-400" title={ds.sourceFilename}>{ds.sourceFilename}</span>
        <button onClick={onDelete} title="Delete this import" className="text-gray-300 hover:text-red-500">✕</button>
      </div>
      <div className="mt-1">
        {decks === null
          ? <p className="text-xs text-gray-300">Loading…</p>
          : decks.map((d) => <DeckRow key={d.deckId} node={d} depth={0} selectedDeckId={selectedDeckId} onSelectDeck={onSelectDeck} />)}
      </div>
    </div>
  )
}

function DeckRow({ node, depth, selectedDeckId, onSelectDeck }: {
  node: DeckNode
  depth: number
  selectedDeckId: number | null
  onSelectDeck: (id: number) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
        {hasChildren
          ? <button onClick={() => setOpen(!open)} className="w-4 shrink-0 text-gray-400" aria-label={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
          : <span className="w-4 shrink-0" />}
        <button
          onClick={() => onSelectDeck(node.deckId)}
          className={`flex-1 truncate rounded px-2 py-1 text-left text-sm ${selectedDeckId === node.deckId ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
        >
          {node.leafName} <span className="text-xs opacity-60">({node.cardCount})</span>
        </button>
      </div>
      {hasChildren && open && node.children.map((c) => (
        <DeckRow key={c.deckId} node={c} depth={depth + 1} selectedDeckId={selectedDeckId} onSelectDeck={onSelectDeck} />
      ))}
    </div>
  )
}

function CardList({ deckId, selectedCardId, onSelect }: {
  deckId: number
  selectedCardId: number | null
  onSelect: (id: number) => void
}): React.JSX.Element {
  const [cards, setCards] = useState<CardListItem[]>([])
  const [nextAfterId, setNextAfterId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  // Bumped on every deck switch; an in-flight request whose id no longer matches is discarded so a
  // slow response for a previous deck can't overwrite/append onto the current deck's list (IPC
  // responses are not order-guaranteed).
  const reqIdRef = useRef(0)
  // Tracks the `after` cursors with a request in flight. reqIdRef only changes on a deck switch, so it
  // does NOT de-dupe two same-deck "Load more" clicks for the same cursor (a double-click before the
  // disabled={loading} re-render commits): both would append the identical page → duplicate rows + a
  // React duplicate-key warning. Guarding on the cursor itself dedupes those concurrent same-page calls.
  const inFlightAfterRef = useRef(new Set<number | null>())

  const loadPage = useCallback(async (after: number | null) => {
    if (inFlightAfterRef.current.has(after)) return // a request for this same page is already running
    inFlightAfterRef.current.add(after)
    const reqId = reqIdRef.current
    setLoading(true)
    try {
      const page = await window.freecat.flashcards.listCards({ deckId, afterId: after ?? undefined, limit: 50 })
      if (reqId !== reqIdRef.current) return // a newer deck selection superseded this request
      setCards((prev) => (after === null ? page.cards : [...prev, ...page.cards]))
      setNextAfterId(page.nextAfterId)
    } catch (e) { console.error('listCards failed', e) }
    finally {
      inFlightAfterRef.current.delete(after)
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [deckId])

  useEffect(() => { reqIdRef.current += 1; inFlightAfterRef.current.clear(); setCards([]); setNextAfterId(null); setLoading(false); void loadPage(null) }, [deckId, loadPage])

  if (cards.length === 0 && !loading) return <p className="p-4 text-sm text-gray-400">No cards in this deck.</p>

  return (
    <ul className="divide-y divide-gray-100">
      {cards.map((c) => (
        <li key={c.cardId}>
          <button
            onClick={() => onSelect(c.cardId)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left ${selectedCardId === c.cardId ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
          >
            <RenderKindBadge kind={c.renderKind} />
            <span className="flex-1 truncate text-sm text-gray-700">{c.preview || '(empty)'}</span>
          </button>
        </li>
      ))}
      {nextAfterId !== null && (
        <li className="p-2">
          <button
            onClick={() => void loadPage(nextAfterId)}
            disabled={loading}
            className="w-full rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </li>
      )}
    </ul>
  )
}

function RenderKindBadge({ kind }: { kind: CardListItem['renderKind'] }): React.JSX.Element {
  const cls: Record<CardListItem['renderKind'], string> = {
    basic: 'bg-emerald-100 text-emerald-700',
    cloze: 'bg-violet-100 text-violet-700',
    'image-occlusion': 'bg-amber-100 text-amber-700',
    unsupported: 'bg-gray-100 text-gray-500'
  }
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cls[kind]}`}>{kind === 'image-occlusion' ? 'IO' : kind}</span>
}
