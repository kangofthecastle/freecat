// test/flashcards/schema.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { deckSets, decks, noteTypes, notes, cards } from '../../src/main/db/schema'

let db: DB
beforeEach(async () => { db = await createTestDb() })

describe('flashcards schema', () => {
  it('round-trips a deck set with json fields/tags and a derived card', async () => {
    const [ds] = await db.insert(deckSets).values({ sourceFilename: 'x.apkg', sourceFormat: 'legacy1' }).returning()
    if (!ds) throw new Error('no deck set')
    const [d] = await db.insert(decks).values({ deckSetId: ds.id, ankiDeckId: 1, name: 'Default', parentDeckId: null }).returning()
    const [nt] = await db.insert(noteTypes).values({ deckSetId: ds.id, ankiNotetypeId: 1, name: 'Basic', kind: 'standard', css: '.card{}', renderKind: 'basic' }).returning()
    if (!d || !nt) throw new Error('no deck/notetype')
    const [n] = await db.insert(notes).values({ deckSetId: ds.id, noteTypeId: nt.id, ankiGuid: 'g1', fieldsJson: ['Front', 'Back'], tags: ['mcat'], sortField: 'Front' }).returning()
    if (!n) throw new Error('no note')
    const [c] = await db.insert(cards).values({ deckSetId: ds.id, noteId: n.id, deckId: d.id, templateOrd: 0, renderKind: 'basic' }).returning()
    if (!c) throw new Error('no card')

    const gotNote = await db.select().from(notes).where(eq(notes.id, n.id))
    expect(gotNote[0]?.fieldsJson).toEqual(['Front', 'Back'])
    expect(gotNote[0]?.tags).toEqual(['mcat'])
    expect((await db.select().from(cards).where(eq(cards.id, c.id)))[0]?.templateOrd).toBe(0)
  })
})
