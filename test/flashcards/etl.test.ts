import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { writeCollection } from '../../src/main/flashcards/etl'
import { decks, cards, noteTypes } from '../../src/main/db/schema'
import type { ParsedCollection } from '../../src/main/flashcards/parsed-collection'

let db: DB
beforeEach(async () => { db = await createTestDb() })

const sample: ParsedCollection = {
  noteTypes: [
    { ankiId: 100, name: 'Basic', kind: 'standard', css: '.x{}', fields: [{ ord: 0, name: 'Front' }, { ord: 1, name: 'Back' }], templates: [{ ord: 0, name: 'C1', qfmt: '{{Front}}', afmt: '{{Back}}' }] },
    { ankiId: 200, name: 'Cloze', kind: 'cloze', css: '', fields: [{ ord: 0, name: 'Text' }], templates: [{ ord: 0, name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}' }] }
  ],
  decks: [{ ankiId: 1, name: 'MCAT' }, { ankiId: 2, name: 'MCAT::Bio' }],
  notes: [
    { ankiId: 10, guid: 'g1', noteTypeAnkiId: 100, fields: ['F', 'B'], tags: ['t'], sortField: 'F' },
    { ankiId: 11, guid: 'g2', noteTypeAnkiId: 200, fields: ['{{c1::a}} {{c2::b}}'], tags: [], sortField: '' }
  ],
  cards: [{ noteAnkiId: 10, deckAnkiId: 2, ord: 0 }, { noteAnkiId: 11, deckAnkiId: 2, ord: 0 }, { noteAnkiId: 11, deckAnkiId: 2, ord: 1 }]
}

describe('writeCollection (ETL)', () => {
  it('materializes deck set, decks (+ parent links), classified note types, notes, one row per card', async () => {
    const summary = await writeCollection(db, { sourceFilename: 'd.apkg', sourceFormat: 'legacy1', parsed: sample })
    expect(summary.deckCount).toBe(2)
    expect(summary.cardCount).toBe(3)

    const allDecks = await db.select().from(decks)
    const mcat = allDecks.find((d) => d.name === 'MCAT')
    expect(allDecks.find((d) => d.name === 'MCAT::Bio')?.parentDeckId).toBe(mcat?.id)

    expect((await db.select().from(noteTypes).where(eq(noteTypes.kind, 'cloze')))[0]?.renderKind).toBe('cloze')

    const allCards = await db.select().from(cards)
    expect(allCards).toHaveLength(3)
    expect(allCards.filter((c) => c.renderKind === 'cloze')).toHaveLength(2)
    expect(allCards.map((c) => c.templateOrd).sort()).toEqual([0, 0, 1])
  })
})
