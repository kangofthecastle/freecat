// @vitest-environment jsdom
// test/flashcards/flashcards-page.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react'
import type { DeckSetSummary, DeckNode, CardListPage, CardView, ReviewCounts, ReviewQueueItem } from '../../src/shared/dto'

vi.mock('../../src/renderer/src/flashcards/mathjax-asset', () => ({ MATHJAX_SVG_SRC: '' }))
import Flashcards from '../../src/renderer/src/pages/Flashcards'

type Freecat = {
  flashcards: {
    listDeckSets: () => Promise<DeckSetSummary[]>
    listDecks: (id: number) => Promise<DeckNode[]>
    listCards: (input: { deckId: number; afterId?: number; limit?: number }) => Promise<CardListPage>
    getCard: (id: number) => Promise<{ ok: true; data: CardView } | { ok: false; error: string }>
    importDeck: () => Promise<{ ok: true; data: DeckSetSummary } | { ok: false; error: string }>
    deleteDeckSet: (id: number) => Promise<{ ok: true; data: null } | { ok: false; error: string }>
    reviewCounts: (id: number) => Promise<{ ok: true; data: ReviewCounts } | { ok: false; error: string }>
    nextReviewCard: (id: number) => Promise<{ ok: true; data: ReviewQueueItem } | { ok: false; error: string }>
    reviewCard: (input: { cardId: number; rating: number }) => Promise<{ ok: true; data: { activity: null } } | { ok: false; error: string }>
  }
}
function stub(over: Partial<Freecat['flashcards']> = {}): void {
  const base: Freecat['flashcards'] = {
    listDeckSets: async () => [],
    listDecks: async () => [],
    listCards: async () => ({ cards: [], nextAfterId: null }),
    getCard: async () => ({ ok: false, error: 'card-not-found' }),
    importDeck: async () => ({ ok: false, error: 'invalid' }),
    deleteDeckSet: async () => ({ ok: true, data: null }),
    reviewCounts: async () => ({ ok: false, error: 'deck-not-found' }),
    nextReviewCard: async () => ({ ok: true, data: { done: true, counts: { newRemaining: 0, learning: 0, due: 0 }, nextLearningDueMs: null } }),
    reviewCard: async () => ({ ok: true, data: { activity: null } })
  }
  // @ts-expect-error partial bridge stub
  globalThis.window.freecat = { flashcards: { ...base, ...over } }
}

afterEach(() => cleanup())
beforeEach(() => vi.restoreAllMocks())

const ds: DeckSetSummary = { id: 1, sourceFilename: 'deck.apkg', deckCount: 1, cardCount: 2, importedAt: new Date() }
const tree: DeckNode[] = [{ deckId: 10, name: 'MCAT', leafName: 'MCAT', cardCount: 2, children: [{ deckId: 11, name: 'MCAT::Bio', leafName: 'Bio', cardCount: 2, children: [] }] }]

describe('Flashcards page', () => {
  it('shows the empty state with an import button when there are no decks', async () => {
    stub()
    render(<Flashcards />)
    await screen.findByText(/No decks yet/i)
    expect(screen.getByText(/Import deck/i)).toBeTruthy()
  })

  it('renders the deck tree, lists cards on select, and previews a card', async () => {
    const card: CardView = {
      cardId: 100, renderKind: 'basic', css: '', qfmt: '{{Front}}', afmt: '{{Back}}',
      fields: [{ name: 'Front', value: 'HELLOQ' }, { name: 'Back', value: 'B' }], tags: [],
      noteTypeName: 'Basic', deckName: 'MCAT::Bio', subdeckName: 'Bio', templateName: 'C', clozeOrdinal: null, mediaMap: []
    }
    stub({
      listDeckSets: async () => [ds],
      listDecks: async () => tree,
      listCards: async () => ({ cards: [{ cardId: 100, renderKind: 'basic', preview: 'a preview' }], nextAfterId: null }),
      getCard: async () => ({ ok: true, data: card })
    })
    render(<Flashcards />)
    fireEvent.click(await screen.findByText(/Bio/)) // button text is "Bio (2)" — regex matches the leaf
    fireEvent.click(await screen.findByText(/a preview/))
    const iframe = await screen.findByTitle('card') as HTMLIFrameElement
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain('HELLOQ'))
  })

  it('does not show the previous deck\'s cards after switching decks (CardList remounts on deck change)', async () => {
    // Two sibling decks, each with a distinct card preview.
    const twoDecks: DeckNode[] = [
      { deckId: 10, name: 'A', leafName: 'A', cardCount: 1, children: [] },
      { deckId: 20, name: 'B', leafName: 'B', cardCount: 1, children: [] }
    ]
    stub({
      listDeckSets: async () => [ds],
      listDecks: async () => twoDecks,
      listCards: async ({ deckId }) => deckId === 10
        ? { cards: [{ cardId: 1, renderKind: 'basic', preview: 'ALPHA-CARD' }], nextAfterId: null }
        : { cards: [{ cardId: 2, renderKind: 'basic', preview: 'BETA-CARD' }], nextAfterId: null }
    })
    render(<Flashcards />)
    fireEvent.click(await screen.findByText(/^A$/))
    await screen.findByText('ALPHA-CARD')
    // Switch to deck B: the remount means deck A's card is never present in deck B's painted list.
    fireEvent.click(screen.getByText(/^B$/))
    await screen.findByText('BETA-CARD')
    expect(screen.queryByText('ALPHA-CARD')).toBeNull()
  })

  it('double-clicking "Load more" before the response commits does not append the page twice', async () => {
    const singleDeck: DeckNode[] = [{ deckId: 10, name: 'A', leafName: 'A', cardCount: 3, children: [] }]
    // First page resolves immediately (has a nextAfterId so "Load more" renders); the SECOND page
    // (afterId=1) is gated on a deferred promise so we can fire two clicks before it commits.
    let releasePage2: (p: CardListPage) => void = () => {}
    const page2 = new Promise<CardListPage>((res) => { releasePage2 = res })
    let page2Calls = 0
    stub({
      listDeckSets: async () => [ds],
      listDecks: async () => singleDeck,
      listCards: async ({ afterId }) => {
        if (afterId === undefined) return { cards: [{ cardId: 1, renderKind: 'basic', preview: 'CARD-1' }], nextAfterId: 1 }
        page2Calls++
        return page2 // afterId === 1: stays pending until released
      }
    })
    render(<Flashcards />)
    fireEvent.click(await screen.findByText(/^A$/))
    const loadMore = await screen.findByText('Load more')
    // Fire BOTH clicks inside one act() batch so React does not commit loading=true (→ disabled) between
    // them — this reproduces the pre-commit double-click race the guard defends against (a separate
    // fireEvent per click would flush the disabled state in between, hiding the bug). The Set guard on
    // the in-flight cursor is what dedupes the second same-cursor call.
    await act(async () => { fireEvent.click(loadMore); fireEvent.click(loadMore) })
    releasePage2({ cards: [{ cardId: 2, renderKind: 'basic', preview: 'CARD-2' }], nextAfterId: null })
    await screen.findByText('CARD-2')
    expect(page2Calls).toBe(1) // the duplicate same-cursor click never reached the backend
    expect(screen.getAllByText('CARD-2')).toHaveLength(1) // and the page was appended exactly once
  })

  it('refreshes the deck list after a successful import', async () => {
    let sets: DeckSetSummary[] = []
    stub({
      listDeckSets: async () => sets,
      importDeck: async () => { sets = [ds]; return { ok: true, data: ds } }
    })
    render(<Flashcards />)
    fireEvent.click(await screen.findByText(/Import deck/i))
    await screen.findByText('deck.apkg')
  })

  it('deleting an import requires an inline confirm (✕ arms, Cancel disarms, Delete deletes)', async () => {
    let deletes = 0
    let sets: DeckSetSummary[] = [ds]
    stub({
      listDeckSets: async () => sets,
      listDecks: async () => tree,
      deleteDeckSet: async () => { deletes++; sets = []; return { ok: true, data: null } }
    })
    render(<Flashcards />)
    // First click only arms the confirm.
    fireEvent.click(await screen.findByTitle('Delete this import'))
    expect(deletes).toBe(0)
    // Cancel disarms without deleting.
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Delete')).toBeNull()
    expect(deletes).toBe(0)
    // Arm again and confirm: the set is deleted and the list refreshes to empty.
    fireEvent.click(screen.getByTitle('Delete this import'))
    fireEvent.click(screen.getByText('Delete'))
    await screen.findByText(/No decks yet/i)
    expect(deletes).toBe(1)
  })

  it('shows a Study button with counts for a selected deck, enters the review session, and Exit returns to browse', async () => {
    let countsCalls = 0
    stub({
      listDeckSets: async () => [ds],
      listDecks: async () => tree,
      reviewCounts: async () => { countsCalls++; return { ok: true, data: { newRemaining: 5, learning: 1, due: 2 } } },
      nextReviewCard: async () => ({ ok: true, data: { done: true, counts: { newRemaining: 5, learning: 1, due: 2 }, nextLearningDueMs: null } })
    })
    render(<Flashcards />)
    fireEvent.click(await screen.findByText(/Bio/))
    const studyBtn = await screen.findByText('Study')
    expect((studyBtn.closest('button') as HTMLButtonElement).disabled).toBe(false)
    await screen.findByText('5 new')
    expect(countsCalls).toBe(1)

    fireEvent.click(studyBtn)
    await screen.findByText('Nothing to study right now') // ReviewSession took over the main pane
    expect(screen.queryByText('Select a card to preview it.')).toBeNull()

    fireEvent.click(screen.getAllByText('Exit')[0]!)
    await screen.findByText('Select a card to preview it.') // back to browse
    expect(countsCalls).toBe(2) // onExit refetched counts
  })

  it('a stale reviewCounts response for a previous deck cannot overwrite the current deck counts', async () => {
    const twoDecks: DeckNode[] = [
      { deckId: 10, name: 'A', leafName: 'A', cardCount: 1, children: [] },
      { deckId: 20, name: 'B', leafName: 'B', cardCount: 1, children: [] }
    ]
    // Deck A's counts are gated on a deferred promise so they resolve AFTER deck B's (which resolve now).
    let releaseA: (r: { ok: true; data: ReviewCounts }) => void = () => {}
    const countsA = new Promise<{ ok: true; data: ReviewCounts }>((res) => { releaseA = res })
    stub({
      listDeckSets: async () => [ds],
      listDecks: async () => twoDecks,
      reviewCounts: async (id) => (id === 10 ? countsA : { ok: true, data: { newRemaining: 3, learning: 0, due: 0 } })
    })
    render(<Flashcards />)
    // Select A (its fetch stays pending), then quickly switch to B (its fetch resolves → B's counts paint).
    fireEvent.click(await screen.findByText(/^A$/))
    fireEvent.click(screen.getByText(/^B$/))
    await screen.findByText('3 new') // deck B's counts
    // Now deck A's late response arrives with different counts — the request-token guard must discard it.
    await act(async () => { releaseA({ ok: true, data: { newRemaining: 7, learning: 0, due: 0 } }) })
    expect(screen.getByText('3 new')).toBeTruthy()
    expect(screen.queryByText('7 new')).toBeNull() // the stale deck-A counts never landed
  })

  it('clicking the already-selected deck row while studying exits the session AND refreshes counts', async () => {
    let countsCalls = 0
    stub({
      listDeckSets: async () => [ds],
      listDecks: async () => tree,
      reviewCounts: async () => { countsCalls++; return { ok: true, data: { newRemaining: 5, learning: 1, due: 2 } } },
      nextReviewCard: async () => ({ ok: true, data: { done: true, counts: { newRemaining: 5, learning: 1, due: 2 }, nextLearningDueMs: null } })
    })
    render(<Flashcards />)
    const bioRow = await screen.findByText(/Bio/) // sidebar deck row (captured before the session header exists)
    fireEvent.click(bioRow)
    fireEvent.click(await screen.findByText('Study'))
    await screen.findByText('Nothing to study right now') // in the review session
    await waitFor(() => expect(countsCalls).toBe(1)) // the initial select fetched once

    // Re-click the SAME sidebar row: selectedDeckId doesn't change (the counts effect won't refire), so
    // the exit path must refetch counts by hand — mirroring the Exit button.
    fireEvent.click(bioRow)
    await screen.findByText('Select a card to preview it.') // exited back to browse
    await waitFor(() => expect(countsCalls).toBe(2)) // same-deck exit refreshed counts
  })

  it('disables the Study button and labels it "Nothing to study" when all counts are zero', async () => {
    stub({
      listDeckSets: async () => [ds],
      listDecks: async () => tree,
      reviewCounts: async () => ({ ok: true, data: { newRemaining: 0, learning: 0, due: 0 } })
    })
    render(<Flashcards />)
    fireEvent.click(await screen.findByText(/Bio/))
    const btn = await screen.findByText('Nothing to study')
    expect((btn.closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('treats a reviewCounts {ok:false} as no counts (disabled Study button)', async () => {
    stub({
      listDeckSets: async () => [ds],
      listDecks: async () => tree,
      reviewCounts: async () => ({ ok: false, error: 'deck-not-found' })
    })
    render(<Flashcards />)
    fireEvent.click(await screen.findByText(/Bio/))
    const btn = await screen.findByText('Nothing to study')
    expect((btn.closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
