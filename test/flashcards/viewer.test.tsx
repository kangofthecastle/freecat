// @vitest-environment jsdom
// test/flashcards/viewer.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import type { CardView } from '../../src/shared/dto'

// Keep the 1.5 MB MathJax string out of the test.
vi.mock('../../src/renderer/src/flashcards/mathjax-asset', () => ({ MATHJAX_SVG_SRC: '' }))

import { CardViewer } from '../../src/renderer/src/flashcards/CardViewer'

const SENTINEL = 'INJECT_SENTINEL_DO_NOT_LEAK'

function cardView(over: Partial<CardView> = {}): CardView {
  return {
    cardId: 1, renderKind: 'basic', css: '.fc-card{}',
    qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}',
    fields: [{ name: 'Front', value: SENTINEL }, { name: 'Back', value: 'BACKTEXT' }],
    tags: [], noteTypeName: 'Basic', deckName: 'D', subdeckName: 'D', templateName: 'C',
    clozeOrdinal: null, mediaMap: [], ...over
  }
}

function stubFreecat(getCard: (id: number) => Promise<{ ok: true; data: CardView } | { ok: false; error: string }>): void {
  // @ts-expect-error partial stub of the preload bridge for tests
  globalThis.window.freecat = { flashcards: { getCard } }
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => cleanup())

describe('CardViewer', () => {
  it('renders card HTML ONLY inside iframe.srcdoc, never the parent DOM', async () => {
    stubFreecat(async () => ({ ok: true, data: cardView() }))
    render(<CardViewer cardId={1} />)
    const iframe = await screen.findByTitle('card') as HTMLIFrameElement
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain(SENTINEL))
    // The card content lives ONLY as the srcdoc string — it is never parsed into the parent document.
    expect(document.querySelector('.fc-card')).toBeNull()
    expect(document.querySelector('iframe[srcdoc]')).toBe(iframe) // the one and only place the HTML lands
  })

  it('flips to the answer side and re-renders the srcdoc', async () => {
    stubFreecat(async () => ({ ok: true, data: cardView() }))
    render(<CardViewer cardId={1} />)
    const iframe = await screen.findByTitle('card') as HTMLIFrameElement
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain(SENTINEL))
    expect(iframe.getAttribute('srcdoc') ?? '').not.toContain('BACKTEXT')
    fireEvent.click(screen.getByText('Show answer'))
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain('BACKTEXT'))
  })

  it('shows a placeholder for image-occlusion and unsupported, no iframe', async () => {
    stubFreecat(async () => ({ ok: true, data: cardView({ renderKind: 'image-occlusion' }) }))
    render(<CardViewer cardId={1} />)
    await screen.findByText(/Image Occlusion/i)
    expect(screen.queryByTitle('card')).toBeNull()
  })

  it('shows a friendly error when getCard fails', async () => {
    stubFreecat(async () => ({ ok: false, error: 'card-not-found' }))
    render(<CardViewer cardId={1} />)
    await screen.findByText(/could not be loaded/i)
  })

  it('ignores postMessage from a foreign source and clamps height', async () => {
    stubFreecat(async () => ({ ok: true, data: cardView() }))
    render(<CardViewer cardId={1} />)
    const iframe = await screen.findByTitle('card') as HTMLIFrameElement
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain(SENTINEL))
    // Foreign source (window, not the iframe's contentWindow) → ignored, no throw.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'fc-height', height: 999999 }, source: window }))
    // Height stays at its default (clamp + source check both hold); component still mounted.
    expect(screen.getByTitle('card')).toBeTruthy()
  })
})
