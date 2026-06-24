// test/flashcards/getcard.repo.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { writeCollection } from '../../src/main/flashcards/etl'
import { getCard, listDecks, listCards } from '../../src/main/repositories/flashcards'
import type { ParsedCollection } from '../../src/main/flashcards/parsed-collection'

// A deck-set with: a Basic note (image in Front), and a Cloze note (two c1 + one c2).
const collection: ParsedCollection = {
  noteTypes: [
    {
      ankiId: 1, name: 'Basic', kind: 'standard', css: '.card{color:red}',
      fields: [{ ord: 0, name: 'Front' }, { ord: 1, name: 'Back' }],
      templates: [{ ord: 0, name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }]
    },
    {
      ankiId: 2, name: 'Cloze', kind: 'cloze', css: '.cloze{font-weight:bold}',
      fields: [{ ord: 0, name: 'Text' }, { ord: 1, name: 'Extra' }],
      templates: [{ ord: 0, name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }]
    }
  ],
  decks: [{ ankiId: 1, name: 'Deck' }, { ankiId: 2, name: 'Deck::Sub' }],
  notes: [
    { ankiId: 100, guid: 'g1', noteTypeAnkiId: 1, fields: ['<img src="pic.png"> front', 'the back'], tags: ['tagA', 'tagB'], sortField: 'front' },
    { ankiId: 200, guid: 'g2', noteTypeAnkiId: 2, fields: ['{{c1::aaa}} and {{c2::bbb}} and {{c1::ccc}}', 'note'], tags: [], sortField: 'cloze' }
  ],
  // basic card (ord 0); two cloze cards: ord 0 (=c1) and ord 1 (=c2)
  cards: [
    { noteAnkiId: 100, deckAnkiId: 2, ord: 0 },
    { noteAnkiId: 200, deckAnkiId: 1, ord: 0 },
    { noteAnkiId: 200, deckAnkiId: 1, ord: 1 }
  ]
}

let db: DB
beforeEach(async () => { db = await createTestDb() })

async function seed(): Promise<void> {
  await writeCollection(db, {
    sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: collection,
    media: { 'pic.png': { hash: 'abc123def456', ext: '.png' } }
  })
}

describe('getCard', () => {
  it('404s an unknown card', async () => {
    await seed()
    expect(await getCard(db, 99999)).toEqual({ ok: false, error: 'card-not-found' })
  })

  it('returns a Basic card with fields, css, template, deck leaf, and referenced media', async () => {
    await seed()
    const sub = (await listDecks(db, 1))[0]?.children[0]
    if (!sub) throw new Error('no sub deck')
    const first = (await listCards(db, { deckId: sub.deckId })).cards[0]
    if (!first) throw new Error('no card')
    const res = await getCard(db, first.cardId)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const v = res.data
    expect(v.renderKind).toBe('basic')
    expect(v.css).toBe('.card{color:red}')
    expect(v.qfmt).toBe('{{Front}}')
    expect(v.noteTypeName).toBe('Basic')
    expect(v.deckName).toBe('Deck::Sub')
    expect(v.subdeckName).toBe('Sub')
    expect(v.templateName).toBe('Card 1')
    expect(v.clozeOrdinal).toBeNull()
    expect(v.tags).toEqual(['tagA', 'tagB'])
    expect(v.fields).toEqual([
      { name: 'Front', value: '<img src="pic.png"> front' },
      { name: 'Back', value: 'the back' }
    ])
    // only the media this card references, with its hash+ext for the protocol handler
    expect(v.media).toEqual([{ filename: 'pic.png', hash: 'abc123def456', ext: '.png' }])
  })

  it('maps a cloze card to its ordinal and the single ord-0 template', async () => {
    await seed()
    // both cloze cards live in deck ankiId 1 → our decks[0]
    const deckTop = (await listDecks(db, 1))[0]
    if (!deckTop) throw new Error('no top deck')
    const page = await listCards(db, { deckId: deckTop.deckId })
    const ordinals: (number | null)[] = []
    for (const c of page.cards) {
      const res = await getCard(db, c.cardId)
      if (res.ok) { ordinals.push(res.data.clozeOrdinal); expect(res.data.qfmt).toBe('{{cloze:Text}}') }
    }
    expect(ordinals.sort()).toEqual([1, 2]) // templateOrd 0 → ordinal 1, templateOrd 1 → ordinal 2
  })

  it('returns no media for a card that references none', async () => {
    await seed()
    const deckTop = (await listDecks(db, 1))[0]
    if (!deckTop) throw new Error('no top deck')
    const c = (await listCards(db, { deckId: deckTop.deckId })).cards[0]
    if (!c) throw new Error('no card')
    const res = await getCard(db, c.cardId)
    if (!res.ok) throw new Error('expected ok')
    expect(res.data.media).toEqual([])
  })

  it('extracts media referenced via CSS url() and srcset', async () => {
    await writeCollection(db, {
      sourceFilename: 'b.apkg', sourceFormat: 'legacy1',
      parsed: {
        noteTypes: [{ ankiId: 1, name: 'Basic', kind: 'standard', css: '.card{background:url(bg.png)}', fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }] }],
        decks: [{ ankiId: 1, name: 'D' }],
        notes: [{ ankiId: 100, guid: 'g', noteTypeAnkiId: 1, fields: ['<img srcset="hi.png 2x">'], tags: [], sortField: 'x' }],
        cards: [{ noteAnkiId: 100, deckAnkiId: 1, ord: 0 }]
      },
      media: { 'bg.png': { hash: 'b0', ext: '.png' }, 'hi.png': { hash: 'b1', ext: '.png' } }
    })
    const deck = (await listDecks(db, 1))[0]
    if (!deck) throw new Error('no deck')
    const c = (await listCards(db, { deckId: deck.deckId })).cards[0]
    if (!c) throw new Error('no card')
    const res = await getCard(db, c.cardId)
    if (!res.ok) throw new Error('expected ok')
    expect(res.data.media.map((m) => m.filename).sort()).toEqual(['bg.png', 'hi.png'])
  })
})
