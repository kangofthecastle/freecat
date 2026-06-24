// test/flashcards/modern-import.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { randomUUID } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { buildModernApkg, type ModernSpec } from './fixtures/modern'
import { importFromFile } from '../../src/main/flashcards/import'
import { listDeckSets, listDecks, listCards, getCard } from '../../src/main/repositories/flashcards'
import { cards, media } from '../../src/main/db/schema'

const spec: ModernSpec = {
  noteTypes: [{ id: 1, name: 'Basic', kind: 'standard', css: '.card{color:blue}', fields: [{ ord: 0, name: 'Front' }, { ord: 1, name: 'Back' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}<img src="pic.png">', afmt: '{{Back}}' }] }],
  decks: [{ id: 1, name: 'Default' }, { id: 2, name: 'Default::Sub' }],
  notes: [{ id: 10, guid: 'g', mid: 1, flds: ['the front', 'the back'], sfld: 'the front' }],
  cards: [{ id: 1, nid: 10, did: 2, ord: 0 }]
}

let db: DB, dir: string
beforeEach(async () => { db = await createTestDb(); dir = join(tmpdir(), `fc-mimp-${randomUUID()}`); mkdirSync(dir, { recursive: true }) })
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } })

describe('importFromFile (modern .colpkg, end-to-end)', () => {
  it('imports a synthetic modern package into rows + media, renderable via getCard', async () => {
    const apkg = await buildModernApkg(spec, { 'pic.png': new TextEncoder().encode('PNGBYTES') })
    const file = join(dir, 'deck.colpkg'); writeFileSync(file, apkg)

    const res = await importFromFile(db, file, join(dir, 'media'))
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)

    const sets = await listDeckSets(db)
    expect(sets[0]?.cardCount).toBe(1)
    expect(await db.select().from(cards)).toHaveLength(1)
    expect((await db.select().from(media))[0]?.filename).toBe('pic.png')
    expect(readdirSync(join(dir, 'media'))).toHaveLength(1)

    // The protobuf-decoded css/qfmt + \x1f deck name survive into a renderable CardView.
    const setId = sets[0]?.id
    if (setId === undefined) throw new Error('no deck set')
    const sub = (await listDecks(db, setId)).find((d) => d.leafName === 'Default')?.children[0]
    if (!sub) throw new Error('no sub deck')
    const cardId = (await listCards(db, { deckId: sub.deckId })).cards[0]?.cardId
    if (cardId === undefined) throw new Error('no card')
    const view = await getCard(db, cardId)
    if (!view.ok) throw new Error(view.error)
    expect(view.data.css).toBe('.card{color:blue}')
    expect(view.data.qfmt).toBe('{{Front}}<img src="pic.png">')
    expect(view.data.deckName).toBe('Default::Sub')
    expect(view.data.media.map((m) => m.filename)).toEqual(['pic.png'])
  })
})
