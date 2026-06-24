import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { writeCollection } from '../../src/main/flashcards/etl'
import { listDecks } from '../../src/main/repositories/flashcards'
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

  it('links a three-level deck path (A::B::C) and a sibling branch (A::X) by full joined name', async () => {
    await writeCollection(db, {
      sourceFilename: 'tree.apkg', sourceFormat: 'legacy1',
      parsed: {
        noteTypes: [{ ankiId: 1, name: 'Basic', kind: 'standard', css: '', fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }] }],
        decks: [
          { ankiId: 1, name: 'A' }, { ankiId: 2, name: 'A::B' }, { ankiId: 3, name: 'A::B::C' }, { ankiId: 4, name: 'A::X' }
        ],
        notes: [],
        cards: []
      }
    })
    const all = await db.select().from(decks)
    const byName = new Map(all.map((d) => [d.name, d]))
    const a = byName.get('A'); const ab = byName.get('A::B'); const abc = byName.get('A::B::C'); const ax = byName.get('A::X')
    if (!a || !ab || !abc || !ax) throw new Error('missing deck')
    expect(a.parentDeckId).toBeNull()
    expect(ab.parentDeckId).toBe(a.id)       // A::B → A (not collapsed off-by-one)
    expect(abc.parentDeckId).toBe(ab.id)     // A::B::C → A::B
    expect(ax.parentDeckId).toBe(a.id)       // sibling branch A::X → A

    // And the repo nests them three deep under A, with X as a second child of A.
    const roots = await listDecks(db, 1)
    expect(roots.map((r) => r.leafName)).toEqual(['A'])
    const rootA = roots[0]
    if (!rootA) throw new Error('no root A')
    expect(rootA.children.map((c) => c.leafName).sort()).toEqual(['B', 'X'])
    const nodeB = rootA.children.find((c) => c.leafName === 'B')
    expect(nodeB?.children.map((c) => c.leafName)).toEqual(['C'])
  })
})
