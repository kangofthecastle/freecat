// test/flashcards/card-view.test.ts
import { describe, it, expect } from 'vitest'
import { toCardView, mediaUrl } from '../../src/main/flashcards/card-view'
import type { CardSource } from '../../src/main/repositories/flashcards'

const source: CardSource = {
  cardId: 7, deckSetId: 3, renderKind: 'basic', css: 'x', qfmt: 'q', afmt: 'a',
  fields: [{ name: 'Front', value: 'F' }], tags: ['t'], noteTypeName: 'Basic',
  deckName: 'D::S', subdeckName: 'S', templateName: 'C1', clozeOrdinal: null,
  media: [{ filename: 'a b.png', hash: 'aa', ext: '.png' }]
}

describe('mediaUrl', () => {
  it('URL-encodes the filename under the token host', () => {
    expect(mediaUrl('tok', 'a b.png')).toBe('freecat-media://tok/a%20b.png')
  })
})

describe('toCardView', () => {
  it('drops deckSetId/hash and builds tokenized media urls', () => {
    const v = toCardView(source, 'tok123')
    expect(v).toEqual({
      cardId: 7, renderKind: 'basic', css: 'x', qfmt: 'q', afmt: 'a',
      fields: [{ name: 'Front', value: 'F' }], tags: ['t'], noteTypeName: 'Basic',
      deckName: 'D::S', subdeckName: 'S', templateName: 'C1', clozeOrdinal: null,
      mediaMap: [{ filename: 'a b.png', url: 'freecat-media://tok123/a%20b.png' }]
    })
    expect('deckSetId' in v).toBe(false)
  })
})
