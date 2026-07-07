// @vitest-environment jsdom
// test/flashcards/review-session.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react'
import type { CardView, ReviewQueueItem, ReviewCardResult, ReviewRating } from '../../src/shared/dto'

vi.mock('../../src/renderer/src/flashcards/mathjax-asset', () => ({ MATHJAX_SVG_SRC: '' }))
import { ReviewSession } from '../../src/renderer/src/flashcards/ReviewSession'

function cardView(over: Partial<CardView> = {}): CardView {
  return {
    cardId: 1, renderKind: 'basic', css: '',
    qfmt: '{{Front}}', afmt: '{{Front}}<hr>{{Back}}',
    fields: [{ name: 'Front', value: 'QSIDE' }, { name: 'Back', value: 'ASIDE' }],
    tags: [], noteTypeName: 'Basic', deckName: 'D', subdeckName: 'D', templateName: 'C',
    clozeOrdinal: null, mediaMap: [], ...over
  }
}

const preview = { again: '<1m', hard: '6m', good: '10m', easy: '4d' }

function cardItem(cardId: number, counts = { newRemaining: 3, learning: 1, due: 2 }): ReviewQueueItem {
  return { done: false, card: cardView({ cardId }), counts, preview }
}
function doneItem(nextLearningDueMs: number | null = null, counts = { newRemaining: 0, learning: 0, due: 0 }): ReviewQueueItem {
  return { done: true, counts, nextLearningDueMs }
}

type NextFn = () => Promise<{ ok: true; data: ReviewQueueItem } | { ok: false; error: string }>
type RateFn = (input: { cardId: number; rating: ReviewRating }) => Promise<{ ok: true; data: ReviewCardResult } | { ok: false; error: string }>

function stub(over: { nextReviewCard?: NextFn; reviewCard?: RateFn } = {}): void {
  const base = {
    nextReviewCard: (async () => ({ ok: true, data: doneItem() })) as NextFn,
    reviewCard: (async () => ({ ok: true, data: { activity: null } })) as RateFn
  }
  // @ts-expect-error partial bridge stub
  globalThis.window.freecat = { flashcards: { ...base, ...over } }
}

afterEach(() => cleanup())
beforeEach(() => vi.restoreAllMocks())

describe('ReviewSession', () => {
  it('happy path: question -> show answer -> rate Good -> next card -> done with reviewed count', async () => {
    let call = 0
    const rated: { cardId: number; rating: ReviewRating }[] = []
    stub({
      nextReviewCard: async () => {
        call++
        if (call === 1) return { ok: true, data: cardItem(1) }
        if (call === 2) return { ok: true, data: doneItem() }
        throw new Error('unexpected extra call')
      },
      reviewCard: async (input) => { rated.push(input); return { ok: true, data: { activity: null } } }
    })
    render(<ReviewSession deckId={10} deckName="MCAT::Bio" onExit={() => {}} />)

    const iframe = await screen.findByTitle('card') as HTMLIFrameElement
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain('QSIDE'))
    expect(iframe.getAttribute('srcdoc') ?? '').not.toContain('ASIDE')

    fireEvent.click(screen.getByText('Show answer'))
    await waitFor(() => expect((screen.getByTitle('card') as HTMLIFrameElement).getAttribute('srcdoc') ?? '').toContain('ASIDE'))

    fireEvent.click(screen.getByText('Good'))
    await screen.findByText('Session complete')
    await screen.findByText('1 reviewed this session')
    expect(rated).toEqual([{ cardId: 1, rating: 3 }])
  })

  it('latches rating buttons: two rapid clicks in one act() call reviewCard once', async () => {
    let rateCalls = 0
    let releaseRate: (v: { ok: true; data: ReviewCardResult }) => void = () => {}
    const gate = new Promise<{ ok: true; data: ReviewCardResult }>((res) => { releaseRate = res })
    stub({
      nextReviewCard: async () => ({ ok: true, data: cardItem(1) }),
      reviewCard: async () => { rateCalls++; return gate }
    })
    render(<ReviewSession deckId={10} deckName="Deck" onExit={() => {}} />)
    await screen.findByTitle('card')
    fireEvent.click(screen.getByText('Show answer'))
    const goodBtn = await screen.findByText('Good')

    // Fire both clicks inside one act() batch so the synchronous ref guard (not the async state
    // commit) is what dedupes the second click — mirrors the CardList "Load more" double-click test.
    await act(async () => { fireEvent.click(goodBtn); fireEvent.click(goodBtn) })
    expect(rateCalls).toBe(1)
    releaseRate({ ok: true, data: { activity: null } })
  })

  it('done state with nextLearningDueMs shows the return-in note and Check again', async () => {
    let call = 0
    stub({
      nextReviewCard: async () => {
        call++
        return call === 1
          ? { ok: true, data: doneItem(5 * 60 * 1000) }
          : { ok: true, data: doneItem(null) }
      }
    })
    render(<ReviewSession deckId={10} deckName="Deck" onExit={() => {}} />)
    await screen.findByText('Nothing to study right now')
    await screen.findByText(/Cards return in ~5m/)
    fireEvent.click(screen.getByText('Check again'))
    await waitFor(() => expect(screen.queryByText(/Cards return in/)).toBeNull())
  })

  it('a not-due result on rating submit silently advances without incrementing reviewed', async () => {
    let call = 0
    stub({
      nextReviewCard: async () => {
        call++
        if (call === 1) return { ok: true, data: cardItem(1) }
        return { ok: true, data: doneItem() }
      },
      reviewCard: async () => ({ ok: false, error: 'not-due' })
    })
    render(<ReviewSession deckId={10} deckName="Deck" onExit={() => {}} />)
    await screen.findByTitle('card')
    fireEvent.click(screen.getByText('Show answer'))
    fireEvent.click(await screen.findByText('Again'))
    await screen.findByText('Nothing to study right now') // reviewed stayed 0 → empty-entry copy
    expect(screen.queryByText(/reviewed this session/)).toBeNull()
  })

  it('keyboard: Space reveals the answer, "3" rates Good', async () => {
    const rated: { cardId: number; rating: ReviewRating }[] = []
    let call = 0
    stub({
      nextReviewCard: async () => {
        call++
        return call === 1 ? { ok: true, data: cardItem(1) } : { ok: true, data: doneItem() }
      },
      reviewCard: async (input) => { rated.push(input); return { ok: true, data: { activity: null } } }
    })
    render(<ReviewSession deckId={10} deckName="Deck" onExit={() => {}} />)
    await screen.findByTitle('card')
    fireEvent.keyDown(window, { key: ' ' })
    await waitFor(() => expect((screen.getByTitle('card') as HTMLIFrameElement).getAttribute('srcdoc') ?? '').toContain('ASIDE'))
    fireEvent.keyDown(window, { key: '3' })
    await waitFor(() => expect(rated).toEqual([{ cardId: 1, rating: 3 }]))
  })

  it('shows an empty state with 0 reviewed when the session is done on entry', async () => {
    stub({ nextReviewCard: async () => ({ ok: true, data: doneItem() }) })
    render(<ReviewSession deckId={10} deckName="Deck" onExit={() => {}} />)
    await screen.findByText('Nothing to study right now')
    expect(screen.queryByText(/reviewed this session/)).toBeNull()
  })

  it('an IPC throw on rating shows an inline error with Retry that re-attempts the same rating', async () => {
    let rateCalls = 0
    let call = 0
    stub({
      nextReviewCard: async () => {
        call++
        return call === 1 ? { ok: true, data: cardItem(1) } : { ok: true, data: doneItem() }
      },
      reviewCard: async () => {
        rateCalls++
        if (rateCalls === 1) throw new Error('network down')
        return { ok: true, data: { activity: null } }
      }
    })
    render(<ReviewSession deckId={10} deckName="Deck" onExit={() => {}} />)
    await screen.findByTitle('card')
    fireEvent.click(screen.getByText('Show answer'))
    fireEvent.click(await screen.findByText('Easy'))
    const retry = await screen.findByText('Retry')
    expect(rateCalls).toBe(1)
    fireEvent.click(retry)
    await screen.findByText('Session complete')
    expect(rateCalls).toBe(2)
  })

  it('ignores a modifier chord: Cmd+1 while the answer is showing does NOT rate', async () => {
    const rated: { cardId: number; rating: ReviewRating }[] = []
    let call = 0
    stub({
      nextReviewCard: async () => {
        call++
        return call === 1 ? { ok: true, data: cardItem(1) } : { ok: true, data: doneItem() }
      },
      reviewCard: async (input) => { rated.push(input); return { ok: true, data: { activity: null } } }
    })
    render(<ReviewSession deckId={10} deckName="Deck" onExit={() => {}} />)
    await screen.findByTitle('card')
    fireEvent.click(screen.getByText('Show answer'))
    await screen.findByText('Good') // answer side is showing (ratings visible)

    // A modifier chord is an OS/browser shortcut, never a review action.
    fireEvent.keyDown(window, { key: '1', metaKey: true })
    fireEvent.keyDown(window, { key: '3', ctrlKey: true })
    // A plain digit still rates, proving the handler is otherwise live.
    fireEvent.keyDown(window, { key: '3' })
    await waitFor(() => expect(rated).toEqual([{ cardId: 1, rating: 3 }]))
  })

  it('does not hijack Enter aimed at a focused button: reveal is not triggered', async () => {
    const onExit = vi.fn()
    stub({ nextReviewCard: async () => ({ ok: true, data: cardItem(1) }) })
    render(<ReviewSession deckId={10} deckName="Deck" onExit={onExit} />)
    await screen.findByTitle('card')
    // Focus the Exit button (an interactive element) and press Enter: the window handler must bail so
    // the browser can natively activate the button, rather than swallowing it into a reveal.
    const exitBtn = screen.getAllByText('Exit')[0]!.closest('button') as HTMLButtonElement
    exitBtn.focus()
    fireEvent.keyDown(exitBtn, { key: 'Enter' })
    // Still on the question side — the answer was not revealed.
    expect(screen.getByText('Show answer')).toBeTruthy()
    expect(screen.queryByText('Good')).toBeNull()
  })

  it('calls Exit handler', async () => {
    stub({ nextReviewCard: async () => ({ ok: true, data: doneItem() }) })
    const onExit = vi.fn()
    render(<ReviewSession deckId={10} deckName="Deck" onExit={onExit} />)
    await screen.findByText('Nothing to study right now')
    fireEvent.click(screen.getAllByText('Exit')[0]!)
    expect(onExit).toHaveBeenCalled()
  })
})
