// @vitest-environment jsdom
// test/flashcards/flashcards-page.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import type { DeckSetSummary, DeckNode, CardListPage, CardView } from '../../src/shared/dto'

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
  }
}
function stub(over: Partial<Freecat['flashcards']> = {}): void {
  const base: Freecat['flashcards'] = {
    listDeckSets: async () => [],
    listDecks: async () => [],
    listCards: async () => ({ cards: [], nextAfterId: null }),
    getCard: async () => ({ ok: false, error: 'card-not-found' }),
    importDeck: async () => ({ ok: false, error: 'invalid' }),
    deleteDeckSet: async () => ({ ok: true, data: null })
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
})
