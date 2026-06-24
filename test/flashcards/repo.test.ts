import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { writeCollection } from '../../src/main/flashcards/etl'
import { listDeckSets, listDecks, listCards, deleteDeckSet } from '../../src/main/repositories/flashcards'
import type { ParsedCollection } from '../../src/main/flashcards/parsed-collection'

const make = (n: number): ParsedCollection => ({
  noteTypes: [{ ankiId: 1, name: 'Basic', kind: 'standard', css: '', fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }] }],
  decks: [{ ankiId: 1, name: 'MCAT' }, { ankiId: 2, name: 'MCAT::Bio' }],
  notes: Array.from({ length: n }, (_, i) => ({ ankiId: 100 + i, guid: `g${i}`, noteTypeAnkiId: 1, fields: [`Q${i}`], tags: [], sortField: `Q${i}` })),
  cards: Array.from({ length: n }, (_, i) => ({ noteAnkiId: 100 + i, deckAnkiId: 2, ord: 0 }))
})

let db: DB
beforeEach(async () => { db = await createTestDb() })

describe('flashcards repository', () => {
  it('listDeckSets returns deck/card counts', async () => {
    await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: make(3) })
    const sets = await listDeckSets(db)
    expect(sets).toHaveLength(1)
    expect(sets[0]?.deckCount).toBe(2)
    expect(sets[0]?.cardCount).toBe(3)
  })

  it('listDecks builds the :: tree with per-deck card counts', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: make(2) })
    const tree = await listDecks(db, ds.id)
    expect(tree).toHaveLength(1)
    expect(tree[0]?.leafName).toBe('MCAT')
    expect(tree[0]?.children[0]?.leafName).toBe('Bio')
    expect(tree[0]?.children[0]?.cardCount).toBe(2)
  })

  it('listCards keyset-pages by id', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: make(5) })
    const bio = (await listDecks(db, ds.id))[0]?.children[0]
    if (!bio) throw new Error('no bio deck')
    const p1 = await listCards(db, { deckId: bio.deckId, limit: 2 })
    expect(p1.cards).toHaveLength(2)
    expect(p1.nextAfterId).not.toBeNull()
    const p2 = await listCards(db, { deckId: bio.deckId, afterId: p1.nextAfterId!, limit: 2 })
    expect(p2.cards[0]!.cardId).toBeGreaterThan(p1.cards[1]!.cardId)
    const p3 = await listCards(db, { deckId: bio.deckId, afterId: p2.nextAfterId!, limit: 2 })
    expect(p3.cards).toHaveLength(1)
    expect(p3.nextAfterId).toBeNull()
  })

  it('listCards reduces cloze markup in the preview to the answer text', async () => {
    const ds = await writeCollection(db, {
      sourceFilename: 'c.apkg', sourceFormat: 'legacy1',
      parsed: {
        noteTypes: [{ ankiId: 1, name: 'Cloze', kind: 'cloze', css: '', fields: [{ ord: 0, name: 'Text' }], templates: [{ ord: 0, name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}' }] }],
        decks: [{ ankiId: 1, name: 'D' }],
        notes: [{ ankiId: 100, guid: 'g', noteTypeAnkiId: 1, fields: ['{{c1::mitochondria::organelle}} is the powerhouse'], tags: [], sortField: '{{c1::mitochondria::organelle}} is the powerhouse' }],
        cards: [{ noteAnkiId: 100, deckAnkiId: 1, ord: 0 }]
      }
    })
    const deck = (await listDecks(db, ds.id))[0]
    if (!deck) throw new Error('no deck')
    const page = await listCards(db, { deckId: deck.deckId })
    expect(page.cards[0]?.preview).toBe('mitochondria is the powerhouse') // not the raw {{c1::…}} markup
  })

  it('listCards preview strips NESTED and multi cloze markup without leaving residue', async () => {
    const ds = await writeCollection(db, {
      sourceFilename: 'nested.apkg', sourceFormat: 'legacy1',
      parsed: {
        noteTypes: [{ ankiId: 1, name: 'Cloze', kind: 'cloze', css: '', fields: [{ ord: 0, name: 'Text' }], templates: [{ ord: 0, name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}' }] }],
        decks: [{ ankiId: 1, name: 'D' }],
        notes: [
          { ankiId: 100, guid: 'g1', noteTypeAnkiId: 1, fields: ['{{c1::outer {{c2::inner}}}}'], tags: [], sortField: '{{c1::outer {{c2::inner}}}}' },
          { ankiId: 101, guid: 'g2', noteTypeAnkiId: 1, fields: ['{{c1::aaa}} and {{c2::bbb}} and {{c1::ccc}}'], tags: [], sortField: '{{c1::aaa}} and {{c2::bbb}} and {{c1::ccc}}' }
        ],
        cards: [{ noteAnkiId: 100, deckAnkiId: 1, ord: 0 }, { noteAnkiId: 101, deckAnkiId: 1, ord: 0 }]
      }
    })
    const deck = (await listDecks(db, ds.id))[0]
    if (!deck) throw new Error('no deck')
    const previews = (await listCards(db, { deckId: deck.deckId })).cards.map((c) => c.preview)
    // nested: clean text, no stray '{{', '}}', or 'c2' residue
    expect(previews).toContain('outer inner')
    // multi-cloze on one line: every deletion's answer shown, none left as raw markup
    expect(previews).toContain('aaa and bbb and ccc')
    for (const p of previews) {
      expect(p).not.toContain('{{')
      expect(p).not.toContain('}}')
    }
  })

  it('deleteDeckSet removes the set + all children, and 404s the second time', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: make(2) })
    expect(await deleteDeckSet(db, ds.id)).toEqual({ ok: true, data: null })
    expect(await listDeckSets(db)).toHaveLength(0)
    expect(await deleteDeckSet(db, ds.id)).toEqual({ ok: false, error: 'deck-set-not-found' })
  })
})
